const $ = s => document.querySelector(s);
let token = localStorage.getItem('fz_token');
let user = JSON.parse(localStorage.getItem('fz_user') || 'null');

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
    const r = await fetch('/api' + url, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
        body: body ? JSON.stringify(body) : undefined
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Something went wrong');
    return d;
}
const open = id => { document.querySelectorAll('.modal').forEach(m => m.classList.remove('open'));
    $(id).classList.add('open'); };
const close = () => document.querySelectorAll('.modal').forEach(m => m.classList.remove('open'));
const say = (el, text, err) => { el.textContent = text;
    el.className = 'msg' + (err ? ' err' : ''); };
document.querySelectorAll('[data-close]').forEach(x => x.onclick = close);

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
    $('#authBox').innerHTML = user ?
        `<span>👤 ${user.name}${user.role === 'admin' ? ' (Admin)' : ''}</span> <button class="btn small outline" id="btnOut">Logout</button>` :
        `<button class="btn small" id="btnSignin">Sign In</button> <button class="btn small outline" id="btnSignup">Sign Up</button>`;
    $('#navMy').hidden = !user;
    $('#my').hidden = !user;
    if (user) { $('#btnOut').onclick = logout;
        loadBookings(); } else { $('#btnSignin').onclick = () => open('#mSignin');
        $('#btnSignup').onclick = () => open('#mSignup'); }
}

function setSession(d) {
    token = d.token;
    user = d.user;
    localStorage.setItem('fz_token', token);
    localStorage.setItem('fz_user', JSON.stringify(user));
    close();
    renderAuth();
}

function logout() { token = null;
    user = null;
    localStorage.removeItem('fz_token');
    localStorage.removeItem('fz_user');
    renderAuth(); }

$('#toSignup').onclick = () => open('#mSignup');
$('#toSignin').onclick = () => open('#mSignin');
$('#toForgot').onclick = () => open('#mForgot');

$('#siSubmit').onclick = async() => {
    try { setSession(await api('/signin', 'POST', { email: $('#siEmail').value, password: $('#siPass').value })); } catch (e) { say($('#siMsg'), e.message, true); }
};
$('#suSubmit').onclick = async() => {
    try { setSession(await api('/signup', 'POST', { name: $('#suName').value, email: $('#suEmail').value, password: $('#suPass').value })); } catch (e) { say($('#suMsg'), e.message, true); }
};
$('#fgSend').onclick = async() => {
    try { say($('#fgMsg'), (await api('/forgot', 'POST', { email: $('#fgEmail').value })).message); } catch (e) { say($('#fgMsg'), e.message, true); }
};
$('#fgReset').onclick = async() => {
    try {
        say($('#fgMsg'), (await api('/reset', 'POST', { email: $('#fgEmail').value, code: $('#fgCode').value, password: $('#fgPass').value })).message);
        setTimeout(() => open('#mSignin'), 1500);
    } catch (e) { say($('#fgMsg'), e.message, true); }
};

/* ----- booking ----- */
document.addEventListener('click', e => {
    const i = e.target.dataset.book;
    if (i === undefined) return;
    const s = SERVICES[i];
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

$('#bSubmit').onclick = async() => {
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
    try {
        await api(id ? '/bookings/' + id : '/bookings', id ? 'PUT' : 'POST', data);
        say($('#bMsg'), '✔ Done! Confirmation email sent to ' + data.email);
        loadBookings();
        setTimeout(close, 2000);
    } catch (e) { say($('#bMsg'), e.message, true); }
};

/* ----- read / edit / delete bookings ----- */
let cache = [];
async function loadBookings() {
    try {
        cache = await api('/bookings');
        $('#bookTable').innerHTML = `<tr><th>Name</th><th>Phone</th><th>Email</th><th>Service</th><th>Price</th><th>Date</th><th>Time</th><th>Booked At</th><th>Action</th></tr>` +
            (cache.length ? cache.map(b => `<tr>
        <td>${b.name}</td><td>${b.phone}</td><td>${b.email}</td><td>${b.service}</td><td>Rs ${b.price}</td>
        <td>${b.date}</td><td>${b.time}</td><td>${new Date(b.createdAt).toLocaleString()}</td>
        <td><button class="edit" data-edit="${b.id}">Edit</button><button class="del" data-del="${b.id}">Delete</button></td></tr>`).join('') :
                '<tr><td colspan="9">No bookings yet.</td></tr>');
    } catch (e) { if (e.message.includes('sign in')) logout(); }
}
document.addEventListener('click', async e => {
    if (e.target.dataset.edit) {
        const b = cache.find(x => x.id === e.target.dataset.edit);
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
    if (e.target.dataset.del && confirm('Cancel this booking?')) {
        try { await api('/bookings/' + e.target.dataset.del, 'DELETE');
            loadBookings(); } catch (err) { alert(err.message); }
    }
});

renderAuth();
