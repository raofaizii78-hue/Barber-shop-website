require('dotenv').config({ path: require('path').join(__dirname, 'faizii1.env') });
const express = require('express'),
    fs = require('fs'),
    path = require('path');
const bcrypt = require('bcryptjs'),
    jwt = require('jsonwebtoken'),
    nodemailer = require('nodemailer');

const app = express();
app.use(express.json());

/* ---------- simple JSON database ---------- */
const DB = path.join(__dirname, 'db.json');
const load = () => fs.existsSync(DB) ? JSON.parse(fs.readFileSync(DB)) : { users: [], bookings: [], resets: [] };
const save = d => fs.writeFileSync(DB, JSON.stringify(d, null, 2));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* ---------- email ---------- */
const mailer = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});
const sendMail = (to, subject, html) =>
    mailer.sendMail({ from: `"Faizii Barber Shop" <${process.env.EMAIL_USER}>`, to, subject, html })
    .catch(e => console.log('Mail error:', e.message));

/* ---------- auth helpers ---------- */
const isEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e || '');
const sign = u => jwt.sign({ id: u.id, name: u.name, email: u.email, role: u.role }, process.env.JWT_SECRET, { expiresIn: '7d' });
const auth = (req, res, next) => {
    try { req.user = jwt.verify((req.headers.authorization || '').replace('Bearer ', ''), process.env.JWT_SECRET);
        next(); } catch { res.status(401).json({ error: 'Please sign in first' }); }
};

/* ---------- pages (only safe files are public) ---------- */
const page = f => (req, res) => res.sendFile(path.join(__dirname, f));
app.get('/', page('faizii1.html'));
app.get('/faizii1.css', page('faizii1.css'));
app.get('/faizii1.js', page('faizii1.js'));
app.use('/images', express.static(path.join(__dirname, 'images')));

/* ---------- sign up / sign in ---------- */
app.post('/api/signup', async(req, res) => {
    const { name, email, password } = req.body;
    if (!name || !isEmail(email) || !password || password.length < 6)
        return res.status(400).json({ error: 'Valid name, email and password (min 6 chars) required' });
    const db = load();
    if (db.users.find(u => u.email === email.toLowerCase())) return res.status(400).json({ error: 'Email already registered' });
    const user = {
        id: uid(),
        name,
        email: email.toLowerCase(),
        hash: await bcrypt.hash(password, 10),
        role: email.toLowerCase() === (process.env.ADMIN_EMAIL || '').toLowerCase() ? 'admin' : 'user',
        createdAt: new Date().toISOString()
    };
    db.users.push(user);
    save(db);
    sendMail(user.email, 'Welcome to Faizii Barber Shop', `<h2>Welcome ${name}!</h2><p>Your account is ready. Book your next style with us.</p>`);
    res.json({ token: sign(user), user: { name: user.name, email: user.email, role: user.role } });
});

app.post('/api/signin', async(req, res) => {
    const { email, password } = req.body;
    const user = load().users.find(u => u.email === (email || '').toLowerCase());
    if (!user || !(await bcrypt.compare(password || '', user.hash))) return res.status(400).json({ error: 'Wrong email or password' });
    res.json({ token: sign(user), user: { name: user.name, email: user.email, role: user.role } });
});

/* ---------- forgot / reset password ---------- */
app.post('/api/forgot', (req, res) => {
    const email = (req.body.email || '').toLowerCase();
    const db = load();
    if (db.users.find(u => u.email === email)) {
        const code = String(Math.floor(100000 + Math.random() * 900000));
        db.resets = db.resets.filter(r => r.email !== email);
        db.resets.push({ email, code, expires: Date.now() + 15 * 60 * 1000 });
        save(db);
        sendMail(email, 'Faizii Barber Shop - Password reset code', `<p>Your reset code is:</p><h1>${code}</h1><p>Valid for 15 minutes.</p>`);
    }
    res.json({ message: 'If this email is registered, a reset code has been sent.' });
});

app.post('/api/reset', async(req, res) => {
    const { email, code, password } = req.body;
    const db = load();
    const r = db.resets.find(x => x.email === (email || '').toLowerCase() && x.code === code && x.expires > Date.now());
    if (!r || !password || password.length < 6) return res.status(400).json({ error: 'Invalid/expired code or weak password' });
    const user = db.users.find(u => u.email === r.email);
    user.hash = await bcrypt.hash(password, 10);
    db.resets = db.resets.filter(x => x !== r);
    save(db);
    res.json({ message: 'Password changed. Please sign in.' });
});

/* ---------- bookings: create / read / edit / delete ---------- */
const bookingMail = (b, title) => `
  <div style="font-family:Arial;max-width:480px;border:2px solid #d4a017;padding:20px">
    <h2 style="color:#d4a017">✂ Faizii Barber Shop</h2><h3>${title}</h3>
    <p><b>Name:</b> ${b.name}</p><p><b>Service:</b> ${b.service} (Rs ${b.price})</p>
    <p><b>Date:</b> ${b.date} &nbsp; <b>Time:</b> ${b.time}</p><p><b>Phone:</b> ${b.phone}</p>
    <p>Thank you for choosing us!</p></div>`;

const validBooking = b => b.name && /^[0-9+\-\s]{7,15}$/.test(b.phone || '') && isEmail(b.email) && b.service && b.date && b.time;

app.post('/api/bookings', auth, (req, res) => {
    const b = req.body;
    if (!validBooking(b)) return res.status(400).json({ error: 'Please fill all fields correctly' });
    const db = load();
    const booking = {
        id: uid(),
        userId: req.user.id,
        name: b.name,
        phone: b.phone,
        email: b.email,
        service: b.service,
        price: b.price,
        date: b.date,
        time: b.time,
        createdAt: new Date().toISOString()
    };
    db.bookings.push(booking);
    save(db);
    sendMail(booking.email, 'Booking Confirmed - Faizii Barber Shop', bookingMail(booking, 'Your booking is confirmed ✔'));
    if (process.env.ADMIN_EMAIL) sendMail(process.env.ADMIN_EMAIL, 'New Booking', bookingMail(booking, 'New booking received'));
    res.json(booking);
});

app.get('/api/bookings', auth, (req, res) => {
    const all = load().bookings;
    res.json(req.user.role === 'admin' ? all : all.filter(b => b.userId === req.user.id));
});

app.put('/api/bookings/:id', auth, (req, res) => {
    const db = load();
    const b = db.bookings.find(x => x.id === req.params.id);
    if (!b || (req.user.role !== 'admin' && b.userId !== req.user.id)) return res.status(404).json({ error: 'Booking not found' });
    if (!validBooking(req.body)) return res.status(400).json({ error: 'Please fill all fields correctly' });
    Object.assign(b, { name: req.body.name, phone: req.body.phone, email: req.body.email, service: req.body.service, price: req.body.price, date: req.body.date, time: req.body.time, updatedAt: new Date().toISOString() });
    save(db);
    sendMail(b.email, 'Booking Updated - Faizii Barber Shop', bookingMail(b, 'Your booking was updated'));
    res.json(b);
});

app.delete('/api/bookings/:id', auth, (req, res) => {
    const db = load();
    const b = db.bookings.find(x => x.id === req.params.id);
    if (!b || (req.user.role !== 'admin' && b.userId !== req.user.id)) return res.status(404).json({ error: 'Booking not found' });
    db.bookings = db.bookings.filter(x => x !== b);
    save(db);
    sendMail(b.email, 'Booking Cancelled - Faizii Barber Shop', bookingMail(b, 'Your booking was cancelled'));
    res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Faizii Barber Shop running: http://localhost:${PORT}`));