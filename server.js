const path = require('path');
const fs = require('fs');
const localEnvFile = path.join(__dirname, 'faizii1.env.local');
require('dotenv').config({
    path: fs.existsSync(localEnvFile) ? localEnvFile : path.join(__dirname, 'faizii1.env')
});
const express = require('express'),
    crypto = require('crypto');
const bcrypt = require('bcryptjs'),
    jwt = require('jsonwebtoken'),
    nodemailer = require('nodemailer');

const app = express();
app.use(express.json({ limit: '32kb' }));
const asyncHandler = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

const SUPABASE_REST_URL = (process.env.SUPABASE_REST_URL || 'https://igowvkdyyxaczkhlgkie.supabase.co/rest/v1').replace(/\/+$/, '');
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const isVercel = process.env.VERCEL === '1';

const supabaseError = (message, status = 502) => Object.assign(new Error(message), { status });
const supabaseRequest = async (table, query = '', method = 'GET', body, prefer) => {
    if (!SUPABASE_SERVICE_ROLE_KEY)
        throw supabaseError('Supabase is not configured. Add SUPABASE_SERVICE_ROLE_KEY to faizii1.env.local.', 503);

    let response;
    try {
        response = await fetch(`${SUPABASE_REST_URL}/${table}${query}`, {
            method,
            headers: {
                apikey: SUPABASE_SERVICE_ROLE_KEY,
                Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                'Content-Type': 'application/json',
                ...(method === 'GET' ? {} : { Prefer: prefer || 'return=representation' })
            },
            body: body === undefined ? undefined : JSON.stringify(body)
        });
    } catch (error) {
        console.error('Supabase connection failed:', error.message);
        throw supabaseError('Could not connect to Supabase. Check the server configuration and try again.');
    }

    const text = await response.text();
    let result = null;
    try {
        result = text ? JSON.parse(text) : null;
    } catch {
        if (response.ok) throw supabaseError('Supabase returned an invalid response.');
    }
    if (!response.ok) {
        const detail = result && (result.message || result.details);
        throw supabaseError(detail ?
            `Supabase rejected the ${table} request: ${detail}` :
            `Supabase ${table} request failed (HTTP ${response.status}).`,
        response.status === 409 || (result && result.code === '23505') ? 409 : 502);
    }
    return result;
};

/* ---------- simple JSON database ---------- */
const DB = process.env.DATABASE_FILE ? path.resolve(process.env.DATABASE_FILE) : path.join(__dirname, 'faizii1.json');
const RESET_MAX_ATTEMPTS = 5;
const emptyDatabase = () => ({ users: [], bookings: [], resets: [] });
const load = () => {
    if (!fs.existsSync(DB)) return emptyDatabase();
    const contents = fs.readFileSync(DB, 'utf8').trim();
    if (!contents) return emptyDatabase();

    let db;
    try {
        db = JSON.parse(contents);
    } catch {
        throw new Error('The database file is not valid JSON. Restore a valid backup before continuing.');
    }
    if (!db || !Array.isArray(db.users) || !Array.isArray(db.bookings) || !Array.isArray(db.resets))
        throw new Error('The database file has an invalid structure. It must contain users, bookings, and resets arrays.');
    return db;
};
const save = d => {
    const temporaryFile = `${DB}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    fs.writeFileSync(temporaryFile, JSON.stringify(d, null, 2), { mode: 0o600 });
    fs.renameSync(temporaryFile, DB);
};
const uid = () => crypto.randomUUID();

const jwtSecret = (() => {
    const configured = process.env.JWT_SECRET;
    if (configured && configured.length >= 32 && !configured.toLowerCase().includes('change_this'))
        return configured;
    if (isVercel)
        throw new Error('Set a private JWT_SECRET of at least 32 characters in the Vercel project environment variables.');

    const secretFile = path.join(__dirname, '.jwt-secret');
    try {
        const stored = fs.readFileSync(secretFile, 'utf8').trim();
        if (stored.length < 64) throw new Error('The local JWT signing key is invalid. Remove .jwt-secret and restart the app.');
        return stored;
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }

    const generated = crypto.randomBytes(48).toString('hex');
    try {
        fs.writeFileSync(secretFile, generated, { flag: 'wx', mode: 0o600 });
        console.warn('JWT_SECRET is not configured; using a private local signing key. Set JWT_SECRET for deployment.');
        return generated;
    } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        return fs.readFileSync(secretFile, 'utf8').trim();
    }
})();

/* ---------- email ---------- */
const emailConfigured = Boolean(
    process.env.EMAIL_USER &&
    process.env.EMAIL_PASS &&
    !process.env.EMAIL_USER.toLowerCase().includes('yourshop') &&
    !process.env.EMAIL_PASS.toLowerCase().includes('xxxx')
);
const mailer = emailConfigured ? nodemailer.createTransport({
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: Number(process.env.EMAIL_PORT || 465),
    secure: process.env.EMAIL_SECURE ? process.env.EMAIL_SECURE === 'true' : Number(process.env.EMAIL_PORT || 465) === 465,
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
}) : null;
const sendMail = async(to, subject, html) => {
    if (!mailer) return false;
    try {
        await mailer.sendMail({
            from: `"Faizii Barber Shop" <${process.env.EMAIL_USER}>`,
            to,
            subject,
            html
        });
        return true;
    } catch (error) {
        console.error(`Email delivery failed (${subject}):`, error.message);
        return false;
    }
};
const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
})[character]);

/* ---------- auth helpers ---------- */
const isEmail = e => typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
const normalizeEmail = email => typeof email === 'string' ? email.trim().toLowerCase() : '';
const adminEmail = normalizeEmail(process.env.ADMIN_EMAIL);
const sign = u => jwt.sign({ id: u.id, name: u.name, email: u.email, role: u.role }, jwtSecret, { expiresIn: '7d' });
const requireAuthStorage = () => {
    if (isVercel && !SUPABASE_SERVICE_ROLE_KEY)
        throw supabaseError('Account storage is not configured. Set SUPABASE_SERVICE_ROLE_KEY in the Vercel project environment variables.', 503);
};
const findUser = async email => {
    requireAuthStorage();
    if (!SUPABASE_SERVICE_ROLE_KEY) return load().users.find(user => user.email === email) || null;
    const query = new URLSearchParams({ select: 'id,name,email,password_hash,role,created_at', email: `eq.${email}`, limit: '1' });
    const users = await supabaseRequest('app_users', `?${query}`);
    if (!Array.isArray(users)) throw supabaseError('Supabase did not return account data.');
    return users[0] || null;
};
const auth = (req, res, next) => {
    try {
        const authorization = req.headers.authorization || '';
        if (!authorization.startsWith('Bearer ')) throw new Error('Missing bearer token');
        req.user = jwt.verify(authorization.slice(7), jwtSecret);
        next();
    } catch {
        res.status(401).json({ error: 'Please sign in first' });
    }
};

/* ---------- pages (only safe files are public) ---------- */
app.use(express.static(path.join(__dirname, 'public')));
app.use('/images', express.static(path.join(__dirname, 'images')));

/* ---------- sign up / sign in ---------- */
app.post('/api/signup', asyncHandler(async(req, res) => {
    const { name, password } = req.body || {};
    const email = normalizeEmail(req.body && req.body.email);
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 120 || !isEmail(email) ||
        typeof password !== 'string' || password.length < 8 || Buffer.byteLength(password, 'utf8') > 72)
        return res.status(400).json({ error: 'Enter your name, a valid email, and a password with at least 8 characters.' });
    requireAuthStorage();
    if (await findUser(email)) return res.status(409).json({ error: 'An account with this email already exists. Please sign in.' });
    const user = {
        id: uid(),
        name: name.trim(),
        email,
        hash: await bcrypt.hash(password, 10),
        role: email === adminEmail && isEmail(adminEmail) && !adminEmail.includes('yourshop') ? 'admin' : 'user',
        createdAt: new Date().toISOString()
    };
    try {
        if (SUPABASE_SERVICE_ROLE_KEY) {
            await supabaseRequest('app_users', '', 'POST', [{
                id: user.id,
                name: user.name,
                email: user.email,
                password_hash: user.hash,
                role: user.role,
                created_at: user.createdAt
            }]);
        } else {
            const db = load();
            db.users.push(user);
            save(db);
        }
    } catch (error) {
        if (error.status === 409) return res.status(409).json({ error: 'An account with this email already exists. Please sign in.' });
        throw error;
    }
    await sendMail(user.email, 'Welcome to Faizii Barber Shop', `<h2>Welcome, ${escapeHtml(user.name)}!</h2><p>Your account is ready. Book your next style with us.</p>`);
    res.json({ token: sign(user), user: { name: user.name, email: user.email, role: user.role } });
}));

app.post('/api/signin', asyncHandler(async(req, res) => {
    const { password } = req.body || {};
    const email = normalizeEmail(req.body && req.body.email);
    if (typeof password !== 'string' || Buffer.byteLength(password, 'utf8') > 72)
        return res.status(400).json({ error: 'Enter your email and password.' });
    const storedUser = await findUser(email);
    const user = storedUser && {
        ...storedUser,
        hash: storedUser.password_hash || storedUser.hash,
        createdAt: storedUser.created_at || storedUser.createdAt
    };
    if (!user || !(await bcrypt.compare(password || '', user.hash))) return res.status(400).json({ error: 'Wrong email or password' });
    res.json({ token: sign(user), user: { name: user.name, email: user.email, role: user.role } });
}));

/* ---------- forgot / reset password ---------- */
app.post('/api/forgot', asyncHandler(async(req, res) => {
    const email = normalizeEmail(req.body && req.body.email);
    if (!isEmail(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (!mailer) return res.status(503).json({ error: 'Password recovery email is not configured. Please contact the shop.' });
    if (await findUser(email)) {
        const code = String(crypto.randomInt(100000, 1000000));
        const codeHash = crypto.createHash('sha256').update(code).digest('hex');
        const delivered = await sendMail(email, 'Faizii Barber Shop - Password reset code', `
          <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:28px;border:1px solid #d4a017;border-radius:12px">
            <h2 style="color:#9a7010">Faizii Barber Shop</h2>
            <p>Use this verification code to reset your password:</p>
            <p style="font-size:28px;font-weight:bold;letter-spacing:8px">${code}</p>
            <p>This code expires in 15 minutes. If you did not request a password reset, you can ignore this email.</p>
          </div>`);
        if (!delivered) return res.status(503).json({ error: 'We could not send the reset email. Please try again later.' });
        const expires = Date.now() + 15 * 60 * 1000;
        if (SUPABASE_SERVICE_ROLE_KEY) {
            await supabaseRequest('password_resets', '', 'POST', [{
                email,
                code_hash: codeHash,
                attempts: 0,
                expires_at: new Date(expires).toISOString()
            }], 'resolution=merge-duplicates,return=minimal');
        } else {
            const db = load();
            db.resets = db.resets.filter(reset => reset.email !== email);
            db.resets.push({ email, codeHash, attempts: 0, expires });
            save(db);
        }
    }
    res.json({ message: 'If this email is registered, a reset code has been sent.' });
}));

app.post('/api/reset', asyncHandler(async(req, res) => {
    const { code, password } = req.body || {};
    const email = normalizeEmail(req.body && req.body.email);
    if (typeof password !== 'string' || password.length < 8 || Buffer.byteLength(password, 'utf8') > 72)
        return res.status(400).json({ error: 'Your new password must contain at least 8 characters.' });
    requireAuthStorage();
    const db = SUPABASE_SERVICE_ROLE_KEY ? null : load();
    let r;
    if (SUPABASE_SERVICE_ROLE_KEY) {
        const query = new URLSearchParams({
            select: 'email,code_hash,attempts,expires_at',
            email: `eq.${email}`,
            expires_at: `gt.${new Date().toISOString()}`,
            attempts: `lt.${RESET_MAX_ATTEMPTS}`,
            limit: '1'
        });
        const resets = await supabaseRequest('password_resets', `?${query}`);
        if (!Array.isArray(resets)) throw supabaseError('Supabase did not return password reset data.');
        r = resets[0] || null;
    } else {
        r = db.resets.find(reset => reset.email === email && reset.expires > Date.now() && (reset.attempts || 0) < RESET_MAX_ATTEMPTS);
    }
    if (!r) return res.status(400).json({ error: 'The code is invalid or expired. Request a new code and try again.' });
    const submittedHash = crypto.createHash('sha256').update(String(code || '')).digest();
    const storedCodeHash = r.code_hash || r.codeHash || crypto.createHash('sha256').update(String(r.code || '')).digest('hex');
    const storedHash = Buffer.from(storedCodeHash, 'hex');
    const codeMatches = submittedHash.length === storedHash.length && crypto.timingSafeEqual(submittedHash, storedHash);
    if (!codeMatches) {
        r.attempts = (r.attempts || 0) + 1;
        if (SUPABASE_SERVICE_ROLE_KEY) {
            const query = new URLSearchParams({ email: `eq.${email}` });
            await supabaseRequest('password_resets', `?${query}`, 'PATCH', { attempts: r.attempts });
        } else {
            save(db);
        }
        return res.status(400).json({ error: 'The code is invalid or expired. Request a new code and try again.' });
    }
    const user = await findUser(r.email);
    if (!user) return res.status(400).json({ error: 'The code is invalid or expired. Request a new code and try again.' });
    const passwordHash = await bcrypt.hash(password, 10);
    if (SUPABASE_SERVICE_ROLE_KEY) {
        const userQuery = new URLSearchParams({ email: `eq.${email}` });
        await supabaseRequest('app_users', `?${userQuery}`, 'PATCH', { password_hash: passwordHash });
        await supabaseRequest('password_resets', `?${userQuery}`, 'DELETE');
    } else {
        user.hash = passwordHash;
        db.resets = db.resets.filter(reset => reset !== r);
        save(db);
    }
    res.json({ message: 'Password changed. Please sign in.' });
}));

/* ---------- bookings: create / read / edit / delete ---------- */
const SERVICES = new Map([
    ['Hair Cut', 300],
    ['Beard Trim', 300],
    ['Hair Colour', 500],
    ['Facial', 600],
    ['Laser Treatment', 1500],
    ['Head Massage', 400]
]);
const bookingMail = (b, title) => `
  <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:28px;border:1px solid #d4a017;border-radius:12px;color:#222">
    <h2 style="color:#9a7010;margin-top:0">Faizii Barber Shop</h2>
    <h3>${escapeHtml(title)}</h3>
    <p>Thank you for choosing us. Here are your appointment details:</p>
    <table style="width:100%;border-collapse:collapse">
      <tr><td style="padding:8px;border-bottom:1px solid #ddd"><b>Booking reference</b></td><td style="padding:8px;border-bottom:1px solid #ddd">${escapeHtml(b.id)}</td></tr>
      <tr><td style="padding:8px;border-bottom:1px solid #ddd"><b>Name</b></td><td style="padding:8px;border-bottom:1px solid #ddd">${escapeHtml(b.name)}</td></tr>
      <tr><td style="padding:8px;border-bottom:1px solid #ddd"><b>Service</b></td><td style="padding:8px;border-bottom:1px solid #ddd">${escapeHtml(b.service)}</td></tr>
      <tr><td style="padding:8px;border-bottom:1px solid #ddd"><b>Price</b></td><td style="padding:8px;border-bottom:1px solid #ddd">Rs ${b.price}</td></tr>
      <tr><td style="padding:8px;border-bottom:1px solid #ddd"><b>Date and time</b></td><td style="padding:8px;border-bottom:1px solid #ddd">${escapeHtml(b.date)} at ${escapeHtml(b.time)}</td></tr>
      <tr><td style="padding:8px"><b>Contact</b></td><td style="padding:8px">${escapeHtml(b.phone)}</td></tr>
    </table>
    <p style="margin-bottom:0">We look forward to seeing you!</p>
  </div>`;

const validBooking = b => {
    if (!b || typeof b.name !== 'string' || !b.name.trim() || b.name.trim().length > 120 ||
        !/^[0-9+\-\s]{7,15}$/.test(b.phone || '') || !isEmail(b.email) ||
        !SERVICES.has(b.service) || !/^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ||
        !/^\d{2}:\d{2}$/.test(b.time || '')) return false;
    const [year, month, day] = b.date.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return false;
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const [hours, minutes] = b.time.split(':').map(Number);
    return b.date >= today && hours < 24 && minutes < 60;
};

const toSupabaseBooking = booking => ({
    id: booking.id,
    user_id: booking.userId,
    name: booking.name,
    phone: booking.phone,
    email: booking.email,
    service: booking.service,
    price: booking.price,
    date: booking.date,
    time: booking.time,
    created_at: booking.createdAt,
    updated_at: booking.updatedAt || null
});
const fromSupabaseBooking = booking => ({
    id: booking.id,
    userId: booking.user_id,
    name: booking.name,
    phone: booking.phone,
    email: booking.email,
    service: booking.service,
    price: booking.price,
    date: booking.date,
    time: typeof booking.time === 'string' ? booking.time.slice(0, 5) : booking.time,
    createdAt: booking.created_at,
    ...(booking.updated_at ? { updatedAt: booking.updated_at } : {})
});
const supabaseResponseBookings = (result, operation) => {
    if (!Array.isArray(result)) throw supabaseError(`Supabase did not return appointments after ${operation}.`);
    return result.map(fromSupabaseBooking);
};
const reportSupabaseError = (res, operation, error) => {
    console.error(`Supabase appointment ${operation} failed:`, error.message);
    return res.status(error.status || 502).json({ error: error.message || 'Supabase appointment request failed.' });
};

app.post('/api/bookings', auth, asyncHandler(async(req, res) => {
    const b = req.body;
    if (!validBooking(b)) return res.status(400).json({ error: 'Please enter valid appointment details and choose one of our listed services.' });
    const booking = {
        id: uid(),
        userId: req.user.id,
        name: b.name.trim(),
        phone: b.phone.trim(),
        email: normalizeEmail(b.email),
        service: b.service,
        price: SERVICES.get(b.service),
        date: b.date,
        time: b.time,
        createdAt: new Date().toISOString()
    };
    try {
        const saved = supabaseResponseBookings(
            await supabaseRequest('appointments', '', 'POST', [toSupabaseBooking(booking)]),
            'create'
        );
        if (saved.length !== 1) throw supabaseError('Supabase did not confirm that the appointment was saved.');
        Object.assign(booking, saved[0]);
    } catch (error) {
        return reportSupabaseError(res, 'create', error);
    }
    const emailSent = await sendMail(booking.email, 'Appointment confirmed | Faizii Barber Shop', bookingMail(booking, 'Your appointment is confirmed'));
    if (emailConfigured && isEmail(adminEmail) && !adminEmail.includes('yourshop'))
        await sendMail(adminEmail, 'New booking | Faizii Barber Shop', bookingMail(booking, 'A new appointment was booked'));
    res.status(201).json({
        ...booking,
        emailSent,
        message: emailSent ?
            `Your appointment is confirmed. A confirmation email was sent to ${booking.email}.` :
            'Your appointment is saved, but the confirmation email could not be sent. Please contact the shop to confirm delivery.'
    });
}));

app.get('/api/bookings', auth, asyncHandler(async(req, res) => {
    try {
        const query = new URLSearchParams({ select: '*', order: 'created_at.desc' });
        if (req.user.role !== 'admin') query.set('user_id', `eq.${req.user.id}`);
        const saved = supabaseResponseBookings(await supabaseRequest('appointments', `?${query}`), 'list');
        const legacy = load().bookings.filter(b => req.user.role === 'admin' || b.userId === req.user.id);
        const appointments = new Map([...legacy, ...saved].map(booking => [booking.id, booking]));
        res.json([...appointments.values()].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
    } catch (error) {
        return reportSupabaseError(res, 'list', error);
    }
}));

app.put('/api/bookings/:id', auth, asyncHandler(async(req, res) => {
    const db = load();
    const legacyBooking = db.bookings.find(x => x.id === req.params.id);
    if (legacyBooking && req.user.role !== 'admin' && legacyBooking.userId !== req.user.id)
        return res.status(404).json({ error: 'Booking not found' });
    if (!validBooking(req.body)) return res.status(400).json({ error: 'Please enter valid appointment details and choose one of our listed services.' });
    const updated = {
        ...(legacyBooking || {}),
        id: req.params.id,
        userId: legacyBooking ? legacyBooking.userId : req.user.id,
        name: req.body.name.trim(),
        phone: req.body.phone.trim(),
        email: normalizeEmail(req.body.email),
        service: req.body.service,
        price: SERVICES.get(req.body.service),
        date: req.body.date,
        time: req.body.time,
        createdAt: legacyBooking ? legacyBooking.createdAt : undefined,
        updatedAt: new Date().toISOString()
    };
    try {
        const query = new URLSearchParams({ select: '*', id: `eq.${req.params.id}` });
        if (!legacyBooking && req.user.role !== 'admin') query.set('user_id', `eq.${req.user.id}`);
        const saved = legacyBooking ?
            supabaseResponseBookings(await supabaseRequest('appointments', '', 'POST', [toSupabaseBooking(updated)]), 'update') :
            supabaseResponseBookings(await supabaseRequest('appointments', `?${query}`, 'PATCH', {
                name: updated.name,
                phone: updated.phone,
                email: updated.email,
                service: updated.service,
                price: updated.price,
                date: updated.date,
                time: updated.time,
                updated_at: updated.updatedAt
            }), 'update');
        if (saved.length !== 1) return res.status(404).json({ error: 'Booking not found' });
        Object.assign(updated, saved[0]);
        if (legacyBooking) {
            db.bookings = db.bookings.filter(booking => booking !== legacyBooking);
            save(db);
        }
    } catch (error) {
        return reportSupabaseError(res, 'update', error);
    }
    const emailSent = await sendMail(updated.email, 'Appointment updated | Faizii Barber Shop', bookingMail(updated, 'Your appointment was updated'));
    res.json({
        ...updated,
        emailSent,
        message: emailSent ?
            `Your appointment was updated. A confirmation email was sent to ${updated.email}.` :
            'Your appointment was updated, but the confirmation email could not be sent. Please contact the shop to confirm delivery.'
    });
}));

app.delete('/api/bookings/:id', auth, asyncHandler(async(req, res) => {
    const db = load();
    const legacyBooking = db.bookings.find(x => x.id === req.params.id);
    let b = legacyBooking;
    if (legacyBooking && req.user.role !== 'admin' && legacyBooking.userId !== req.user.id)
        return res.status(404).json({ error: 'Booking not found' });
    if (legacyBooking) {
        db.bookings = db.bookings.filter(x => x !== legacyBooking);
        save(db);
    } else {
        const query = new URLSearchParams({ select: '*', id: `eq.${req.params.id}` });
        if (req.user.role !== 'admin') query.set('user_id', `eq.${req.user.id}`);
        try {
            const deleted = supabaseResponseBookings(await supabaseRequest('appointments', `?${query}`, 'DELETE'), 'delete');
            if (deleted.length !== 1) return res.status(404).json({ error: 'Booking not found' });
            [b] = deleted;
        } catch (error) {
            return reportSupabaseError(res, 'delete', error);
        }
    }
    const emailSent = await sendMail(b.email, 'Appointment cancelled | Faizii Barber Shop', bookingMail(b, 'Your appointment was cancelled'));
    res.json({
        ok: true,
        emailSent,
        message: emailSent ?
            `Your appointment was cancelled. A confirmation email was sent to ${b.email}.` :
            'Your appointment was cancelled, but the confirmation email could not be sent.'
    });
}));

app.use('/api', (req, res) => res.status(404).json({ error: 'API endpoint not found' }));
app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    console.error('Request error:', err.message);
    const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
    res.status(status).json({ error: status === 400 ? 'Request body must contain valid JSON' : err.message || 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Faizii Barber Shop running: http://localhost:${PORT}`);
        if (!SUPABASE_SERVICE_ROLE_KEY) console.warn('Supabase is not configured. Add SUPABASE_SERVICE_ROLE_KEY to faizii1.env.local to save appointments and use deployed account storage.');
        if (!emailConfigured) console.warn('Email is not configured. Add EMAIL_USER and EMAIL_PASS to faizii1.env.local to send booking confirmations and password reset codes.');
    });
}

module.exports = app;