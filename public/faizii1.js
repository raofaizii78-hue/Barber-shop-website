const $ = s => document.querySelector(s);
let token = localStorage.getItem('fz_token');
let user = null;
try {
    user = JSON.parse(localStorage.getItem('fz_user') || 'null');
} catch {
    localStorage.removeItem('fz_user');
    localStorage.removeItem('fz_token');
    token = null;
}
let pendingBookingDraft = null;

/* ----- data: change names, prices, images here ----- */
const SERVICES = [
    { name: 'Hair Cut', price: 300, img: 'haircut.jpg', icon: '✂️' },
    { name: 'Beard Trim', price: 300, img: 'beard.jpg', icon: '🧔' },
    { name: 'Hair Colour', price: 500, img: 'colour.jpg', icon: '🎨' },
    { name: 'Facial', price: 600, img: 'facial.jpg', icon: '💆' },
    { name: 'Laser Treatment', price: 1500, img: 'laser.jpg', icon: '✨' },
    { name: 'Head Massage', price: 400, img: 'massage.jpg', icon: '💈' }
];
const OFFERS = [
    { t: '20% OFF', d: 'Hair Colour + Facial combo' },
    { t: 'Rs 500', d: 'Haircut + Beard Trim + Wash' },
    { t: 'FREE', d: 'Head massage with any Facial' }
];

SERVICES[0].img = 'https://images.unsplash.com/photo-1621605815971-fbc98d665033?auto=format&fit=crop&w=900&q=85';
SERVICES[1].img = 'https://static.wixstatic.com/media/d27a30_e4e8a7ddf69849c8ac8b74bd8ef4c3ae~mv2.jpg/v1/fill/w_1024%2Ch_1024%2Cal_c%2Cq_85%2Cenc_auto/d27a30_e4e8a7ddf69849c8ac8b74bd8ef4c3ae~mv2.jpg';
SERVICES[2].img = 'https://imagedelivery.net/xaKlCos5cTg_1RWzIu_h-A/085629cd-7171-414c-5e1b-a0a54cabc700/public';
SERVICES[3].img = 'https://images.squarespace-cdn.com/content/5f650753a13cc53cd4f6e673/1724723432008-JJBA5PR2EHC38E56XSHH/Men%27s%2BFacial.jpg?content-type=image%2Fjpeg&format=1500w';
SERVICES[4].img = 'https://triera-clinic.ru/images/sitepics/servssnew/836.jpg';
SERVICES[5].img = 'https://lynfordbarbershop.com/images/services-and-treatment-photo3.jpg';

/* ----- render services & offers ----- */
$('#serviceGrid').innerHTML = SERVICES.map((s, i) => `
  <div class="card">
    <img src="${s.img.startsWith('http') ? s.img : 'images/' + s.img}" alt="${s.name} service at Faizii Barber Shop" loading="lazy" onerror="this.outerHTML='<div class=pic>${s.icon}</div>'">
    <h3>${s.name}</h3><div class="price">Rs ${s.price}</div>
    <button class="btn" data-book="${i}">Booking</button>
  </div>`).join('');
$('#offerGrid').innerHTML = OFFERS.map(o => `<div class="offer"><b>${o.t}</b><p>${o.d}</p></div>`).join('');

/* ----- helpers ----- */
async function api(url, method = 'GET', body) {
    const endpoint = '/api' + url;
    let r;
    try {
        r = await fetch(endpoint, {
            method,
            headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
            body: body ? JSON.stringify(body) : undefined
        });
    } catch {
        throw new Error('Could not connect to the shop. Make sure the website server is running and try again.');
    }
    const text = await r.text();
    const contentType = r.headers.get('content-type') || '';
    let d;
    const trimmedText = text.trimStart();
    if (text && (contentType.includes('application/json') || trimmedText.startsWith('{') || trimmedText.startsWith('['))) {
        try {
            d = JSON.parse(text);
        } catch {
            d = null;
        }
    }
    if (!r.ok) {
        const messages = {
            400: 'Please check the information you entered and try again.',
            401: 'Please sign in again to continue.',
            403: 'You do not have permission to do that.',
            404: `The API endpoint ${endpoint} was not found.`,
            409: 'This request conflicts with existing information. Check your details and try again.',
            500: 'The shop server encountered an error. Please try again later.'
        };
        const message = d && typeof d.error === 'string' ? d.error :
            r.status === 404 && (!contentType.includes('application/json') || !d || typeof d.error !== 'string') ?
            `The API endpoint ${endpoint} returned a non-JSON 404. This deployment may not be routing requests to the Express API; check the Vercel project root and deployment logs.` :
            messages[r.status] || `The shop server returned HTTP ${r.status}. Please try again later.`;
        console.warn('Shop API request failed:', { method, endpoint, status: r.status, contentType });
        if (r.status === 401 && token) logout();
        const error = new Error(message);
        error.status = r.status;
        throw error;
    }
    if (!d || typeof d !== 'object' || Array.isArray(d)) {
        console.warn('Shop API returned an unexpected response:', { method, endpoint, status: r.status, contentType });
        throw new Error(`The shop server returned an invalid response for ${endpoint} (HTTP ${r.status}).`);
    }
    return d;
}
const open = id => { document.querySelectorAll('.modal').forEach(m => m.classList.remove('open'));
    $(id).classList.add('open'); };
const close = () => document.querySelectorAll('.modal').forEach(m => m.classList.remove('open'));
const say = (el, text, state) => {
    el.textContent = text;
    el.className = `msg${state === 'error' ? ' err' : state === 'warning' ? ' warning' : ''}`;
};
document.querySelectorAll('[data-close]').forEach(x => x.onclick = close);
document.querySelectorAll('.modal').forEach(modal => modal.addEventListener('click', event => {
    if (event.target === modal) close();
}));
document.addEventListener('keydown', event => {
    if (event.key === 'Escape') close();
});

/* ----- quick booking from the home-page button ----- */
$('#heroBook').onclick = e => {
    e.preventDefault();
    $('#bookTitle').textContent = 'Book Appointment';
    $('#bId').value = '';
    $('#bService').value = 'Hair Cut';
    $('#bPrice').value = 300;
    $('#bName').value = user ? user.name : '';
    $('#bEmail').value = user ? user.email : '';
    $('#bPhone').value = '';
    $('#bDate').value = '';
    $('#bTime').value = '';
    $('#bDate').min = new Date().toISOString().split('T')[0];
    say($('#bMsg'), 'Please enter your name, email and contact number.');
    open('#mBook');
};

/* ----- auth UI ----- */
function renderAuth() {
    const authBox = $('#authBox');
    authBox.replaceChildren();
    if (user) {
        const name = document.createElement('span');
        name.textContent = `👤 ${user.name}${user.role === 'admin' ? ' (Admin)' : ''}`;
        const logoutButton = document.createElement('button');
        logoutButton.className = 'btn small outline';
        logoutButton.textContent = 'Sign Out';
        logoutButton.onclick = logout;
        authBox.append(name, logoutButton);
    } else {
        const signinButton = document.createElement('button');
        signinButton.className = 'btn small';
        signinButton.textContent = 'Sign In';
        signinButton.onclick = () => open('#mSignin');
        const signupButton = document.createElement('button');
        signupButton.className = 'btn small outline';
        signupButton.textContent = 'Create Account';
        signupButton.onclick = () => open('#mSignup');
        authBox.append(signinButton, signupButton);
    }
    $('#navMy').hidden = !user;
    $('#my').hidden = !user;
    if (user) loadBookings();
}

function setSession(d) {
    token = d.token;
    user = d.user;
    localStorage.setItem('fz_token', token);
    localStorage.setItem('fz_user', JSON.stringify(user));
    close();
    renderAuth();
    if (pendingBookingDraft) {
        const draft = pendingBookingDraft;
        pendingBookingDraft = null;
        $('#bName').value = draft.name;
        $('#bPhone').value = draft.phone;
        $('#bEmail').value = draft.email;
        $('#bDate').value = draft.date;
        $('#bTime').value = draft.time;
        say($('#bMsg'), 'You are signed in. Review your details and confirm the appointment.');
        open('#mBook');
    }
}

function logout() { token = null;
    user = null;
    localStorage.removeItem('fz_token');
    localStorage.removeItem('fz_user');
    renderAuth(); }

$('#toSignup').onclick = () => {
    say($('#siMsg'), '');
    open('#mSignup');
};
$('#toSignin').onclick = () => {
    say($('#suMsg'), '');
    open('#mSignin');
};
$('#toForgot').onclick = () => {
    say($('#siMsg'), '');
    open('#mForgot');
};

$('#formSignin').addEventListener('submit', async event => {
    event.preventDefault();
    const submit = $('#siSubmit');
    submit.disabled = true;
    try {
        setSession(await api('/signin', 'POST', { email: $('#siEmail').value, password: $('#siPass').value }));
    } catch (e) {
        say($('#siMsg'), e.message, 'error');
    } finally {
        submit.disabled = false;
    }
});
$('#formSignup').addEventListener('submit', async event => {
    event.preventDefault();
    const submit = $('#suSubmit');
    submit.disabled = true;
    try {
        setSession(await api('/signup', 'POST', {
            name: $('#suName').value,
            email: $('#suEmail').value,
            password: $('#suPass').value
        }));
    } catch (e) {
        say($('#suMsg'), e.message, 'error');
    } finally {
        submit.disabled = false;
    }
});
$('#formForgotRequest').addEventListener('submit', async event => {
    event.preventDefault();
    const submit = $('#fgSend');
    submit.disabled = true;
    try {
        say($('#fgMsg'), (await api('/forgot', 'POST', { email: $('#fgEmail').value })).message);
    } catch (e) {
        say($('#fgMsg'), e.message, 'error');
    } finally {
        submit.disabled = false;
    }
});
$('#formReset').addEventListener('submit', async event => {
    event.preventDefault();
    const submit = $('#fgReset');
    submit.disabled = true;
    try {
        say($('#fgMsg'), (await api('/reset', 'POST', {
            email: $('#fgEmail').value,
            code: $('#fgCode').value,
            password: $('#fgPass').value
        })).message);
        setTimeout(() => open('#mSignin'), 1500);
    } catch (e) { say($('#fgMsg'), e.message, 'error'); }
    finally {
        submit.disabled = false;
    }
});

/* ----- booking ----- */
document.addEventListener('click', e => {
    const bookButton = e.target.closest('[data-book]');
    if (!bookButton) return;
    const i = bookButton.dataset.book;
    const s = SERVICES[i];
    if (!s) {
        say($('#bMsg'), 'This service is unavailable. Please refresh the page and choose another service.', 'error');
        return;
    }
    $('#bookTitle').textContent = 'Book Appointment';
    $('#bId').value = '';
    $('#bService').value = s.name;
    $('#bPrice').value = s.price;
    $('#bName').value = user ? user.name : '';
    $('#bEmail').value = user ? user.email : '';
    $('#bPhone').value = '';
    $('#bDate').value = '';
    $('#bTime').value = '';
    $('#bDate').min = new Date().toISOString().split('T')[0];
    say($('#bMsg'), '');
    open('#mBook');
});

$('#formBooking').addEventListener('submit', async event => {
    event.preventDefault();
    const data = {
        name: $('#bName').value,
        phone: $('#bPhone').value,
        email: $('#bEmail').value,
        service: $('#bService').value,
        price: $('#bPrice').value,
        date: $('#bDate').value,
        time: $('#bTime').value
    };
    const id = $('#bId').value;
    if (!token) {
        pendingBookingDraft = data;
        $('#siEmail').value = data.email;
        say($('#siMsg'), 'Please sign in or create an account to book. Your appointment details are saved.');
        open('#mSignin');
        return;
    }
    const submit = $('#bSubmit');
    submit.disabled = true;
    try {
        const result = await api(id ? '/bookings/' + id : '/bookings', id ? 'PUT' : 'POST', data);
        say($('#bMsg'), result.message || (result.emailSent ?
            'Your appointment was saved and the confirmation email was sent.' :
            'Your appointment was saved, but the confirmation email could not be sent. Please contact the shop to confirm delivery.'),
        result.emailSent === false ? 'warning' : undefined);
        loadBookings();
    } catch (e) {
        say($('#bMsg'), e.message, 'error');
    } finally {
        submit.disabled = false;
    }
});

/* ----- read / edit / delete bookings ----- */
let cache = [];
async function loadBookings() {
    try {
        cache = await api('/bookings');
        const table = $('#bookTable');
        table.replaceChildren();
        const columns = ['Name', 'Phone', 'Email', 'Service', 'Price', 'Date', 'Time', 'Booked At', 'Action'];
        const header = document.createElement('tr');
        columns.forEach(text => {
            const cell = document.createElement('th');
            cell.textContent = text;
            header.append(cell);
        });
        table.append(header);
        if (!cache.length) {
            const row = document.createElement('tr');
            const cell = document.createElement('td');
            cell.colSpan = columns.length;
            cell.textContent = 'No bookings yet. Choose a service to schedule your first visit.';
            row.append(cell);
            table.append(row);
            return;
        }
        cache.forEach(booking => {
            const row = document.createElement('tr');
            [
                booking.name,
                booking.phone,
                booking.email,
                booking.service,
                `Rs ${booking.price}`,
                booking.date,
                booking.time,
                new Date(booking.createdAt).toLocaleString()
            ].forEach(text => {
                const cell = document.createElement('td');
                cell.textContent = text;
                row.append(cell);
            });
            const actions = document.createElement('td');
            const edit = document.createElement('button');
            edit.className = 'edit';
            edit.dataset.edit = booking.id;
            edit.textContent = 'Edit';
            const remove = document.createElement('button');
            remove.className = 'del';
            remove.dataset.del = booking.id;
            remove.textContent = 'Cancel';
            actions.append(edit, remove);
            row.append(actions);
            table.append(row);
        });
    } catch (e) {
        if (e.message.includes('sign in')) logout();
        else {
            const cell = document.createElement('td');
            cell.colSpan = 9;
            cell.textContent = e.message;
            const row = document.createElement('tr');
            row.append(cell);
            $('#bookTable').replaceChildren(row);
        }
    }
}
document.addEventListener('click', async e => {
    const editButton = e.target.closest('[data-edit]');
    if (editButton) {
        const b = cache.find(x => x.id === editButton.dataset.edit);
        if (!b) return;
        $('#bookTitle').textContent = 'Edit Booking';
        $('#bId').value = b.id;
        $('#bService').value = b.service;
        $('#bPrice').value = b.price;
        $('#bName').value = b.name;
        $('#bPhone').value = b.phone;
        $('#bEmail').value = b.email;
        $('#bDate').value = b.date;
        $('#bTime').value = b.time;
        say($('#bMsg'), '');
        open('#mBook');
    }
    const deleteButton = e.target.closest('[data-del]');
    if (deleteButton && confirm('Cancel this appointment?')) {
        try {
            await api('/bookings/' + deleteButton.dataset.del, 'DELETE');
            loadBookings();
        } catch (err) {
            alert(err.message);
        }
    }
});

renderAuth();
