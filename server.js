// WORKROOM AI — server (Express + Socket.io)
// Rooms, Face ID davomat, video-majlis signaling, Meeting AI (Gemini), Telegram bot.
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL_ENV = (process.env.GEMINI_MODEL || '').trim();
const AI = { model: GEMINI_MODEL_ENV || '', ok: null, error: '', at: 0, models: [] };
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TZ = 'Asia/Tashkent';
const FACE_THRESHOLD = Number(process.env.FACE_THRESHOLD || 0.5);

// ---------- Storage ----------
fs.mkdirSync(DATA_DIR, { recursive: true });
let db = { rooms: {}, tgOffset: 0 };
try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch (e) {
  if (fs.existsSync(DB_FILE)) { // buzilgan fayl: eng so'nggi zaxiradan tiklash
    console.error('db.json o‘qilmadi:', e.message);
    const b = fs.readdirSync(DATA_DIR).filter((x) => x.startsWith('backup-')).sort().pop();
    if (b) { try { db = JSON.parse(fs.readFileSync(path.join(DATA_DIR, b), 'utf8')); console.log('Zaxiradan tiklandi:', b); } catch (_) {} }
  }
}
db.rooms = db.rooms || {};
let saveTimer = null;
function saveNow() {
  try { fs.writeFileSync(DB_FILE + '.tmp', JSON.stringify(db)); fs.renameSync(DB_FILE + '.tmp', DB_FILE); } catch (e) { console.error('Saqlash xatosi:', e.message); }
}
// Kunlik zaxira nusxa (oxirgi 7 kun)
function backup() {
  try {
    const d = new Date().toISOString().slice(0, 10); const f = path.join(DATA_DIR, `backup-${d}.json`);
    if (!fs.existsSync(f)) { fs.writeFileSync(f, JSON.stringify(db)); fs.readdirSync(DATA_DIR).filter((x) => x.startsWith('backup-')).sort().slice(0, -7).forEach((x) => fs.unlinkSync(path.join(DATA_DIR, x))); }
  } catch (e) { console.error('Backup xatosi:', e.message); }
}
setInterval(backup, 3600 * 1000).unref();
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFile(DB_FILE + '.tmp', JSON.stringify(db), (err) => {
      if (!err) fs.rename(DB_FILE + '.tmp', DB_FILE, () => {});
    });
  }, 300);
}

// ---------- Helpers ----------
const id = (n = 8) => crypto.randomBytes(n).toString('hex').slice(0, n);
const safeEq = (a, b) => { a = String(a || ''); b = String(b || ''); if (!a || !b || a.length !== b.length) return false; return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)); };
const roomOf = (code) => { const c = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); return Object.prototype.hasOwnProperty.call(db.rooms, c) ? db.rooms[c] : null; };
const clip = (v, n) => String(v == null ? '' : v).slice(0, n);
function hashPw(pw) { const salt = crypto.randomBytes(16).toString('hex'); return salt + ':' + crypto.scryptSync(String(pw), salt, 32).toString('hex'); }
function checkPw(pw, stored) { if (!stored) return false; const [salt, h] = stored.split(':'); return safeEq(crypto.scryptSync(String(pw), salt, 32).toString('hex'), h); }
const isTime = (t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(t));
function nowTZ() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  const hour = p.hour === '24' ? '00' : p.hour;
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${hour}:${p.minute}`, sec: p.second };
}
const toMin = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + (m || 0); };
function newCode() {
  let c;
  // 6 raqam = 900 000 variant + rate limit: kodni taxmin qilish amalda imkonsiz
  do { c = 'UZ' + crypto.randomInt(100000, 1000000); } while (db.rooms[c]);
  return c;
}
function meanDesc(list) { const m = new Array(128).fill(0); list.forEach((d) => d.forEach((v, i) => (m[i] += v / list.length))); return m; }
function dist(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; }
  return Math.sqrt(s);
}
function publicEmp(e) {
  return { id: e.id, name: e.name, role: e.role, salary: e.salary, hasFace: !!(e.descriptors && e.descriptors.length), photo: e.photo || null, isAdmin: !!e.isAdmin, createdAt: e.createdAt, tg: !!e.tgChatId, pending: !!e.pending };
}
function roomView(r) {
  return {
    code: r.code, company: r.company, workStart: r.workStart, workEnd: r.workEnd,
    lateFine: r.lateFine, telegramLinked: !!r.telegramChatId, autopilot: !!r.autopilot, graceMin: r.graceMin || 15, requireApproval: r.requireApproval !== false, liveness: r.liveness !== false, hasPassword: !!r.adminPass,
    employees: r.employees.map(publicEmp),
  };
}

// ---------- Platform events (super admin) ----------
const SUPER_KEY = (process.env.SUPER_ADMIN_KEY || '').length >= 16 ? process.env.SUPER_ADMIN_KEY : '';
if (process.env.SUPER_ADMIN_KEY && !SUPER_KEY) console.warn('SUPER_ADMIN_KEY kamida 16 belgidan iborat bo‘lishi kerak — umumiy admin o‘chirildi.');
db.events = db.events || [];
function pushEvent(r, type, text) {
  const ev = { id: id(), code: r ? r.code : null, company: r ? r.company : '', type, text, ts: Date.now() };
  db.events.push(ev); if (db.events.length > 300) db.events = db.events.slice(-200);
  if (r) r.lastActivity = ev.ts;
  io.to('super').emit('super:event', ev);
}

// ---------- App ----------
const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e6, pingTimeout: 30000 });
const PROD = process.env.NODE_ENV === 'production' || !!process.env.RENDER;

app.disable('x-powered-by');
app.set('trust proxy', 1); // Render / reverse proxy ortida haqiqiy IP
// HTTPS majburiy + xavfsizlik sarlavhalari
app.use((req, res, next) => {
  if (PROD && req.get('x-forwarded-proto') === 'http') return res.redirect(301, 'https://' + req.get('host') + req.originalUrl);
  res.set({
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob:",
      "media-src 'self' blob: mediastream:",
      "connect-src 'self' ws: wss: https://cdn.jsdelivr.net",
      "worker-src 'self' blob:",
      "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(self), microphone=(self), display-capture=(self), geolocation=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
  });
  if (PROD) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
  next();
});
// Oddiy xotiradagi rate limiter (IP + guruh bo'yicha)
const buckets = new Map();
function limit(group, max, windowMs) {
  return (req, res, next) => {
    const k = group + ':' + req.ip; const now = Date.now();
    let b = buckets.get(k); if (!b || now > b.reset) { b = { n: 0, reset: now + windowMs }; buckets.set(k, b); }
    if (++b.n > max) { res.set('Retry-After', Math.ceil((b.reset - now) / 1000)); return res.status(429).json({ error: 'Juda ko‘p so‘rov. Birozdan so‘ng urinib ko‘ring.' }); }
    next();
  };
}
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (now > b.reset) buckets.delete(k); }, 60000).unref();
app.use('/api/', limit('api', 600, 60000));
app.use('/api/super', limit('super', 30, 60000));
app.post('/api/rooms', limit('create', 8, 3600000));
app.post('/api/rooms/:code/join', limit('join', 10, 600000));
app.post('/api/rooms/:code/checkin', limit('checkin', 60, 60000));
app.post('/api/rooms/:code/mentor', limit('mentor', 20, 60000));
app.post('/api/rooms/:code/meetings/:mid/analyze', limit('analyze', 10, 600000));
app.get('/api/rooms/:code/brief', limit('brief', 10, 600000));
app.get('/api/rooms/:code', limit('lookup', 60, 60000));

app.use(express.json({ limit: '2mb' }));
// no-cache + ETag: yangilanishdan keyin brauzer eski JS/CSS'ni ishlatmaydi (o'zgarmagan fayl 304 bilan tez keladi)
app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html', etag: true, setHeaders: (res) => res.set('Cache-Control', 'no-cache') }));

function getRoom(req, res) {
  const r = roomOf(req.params.code);
  if (!r) { res.status(404).json({ error: 'Room topilmadi. Kodni tekshiring.' }); return null; }
  r.kb = r.kb || []; r.absences = r.absences || []; r.suggestions = r.suggestions || []; r.mentorLog = r.mentorLog || []; r.posts = r.posts || [];
  return r;
}
function isAdmin(req, r) { return safeEq(req.get('x-admin-key'), r.adminKey); }
function requireAdmin(req, res, r) {
  if (!isAdmin(req, r)) { res.status(403).json({ error: 'Faqat admin (room ochgan rahbar) uchun.' }); return false; }
  return true;
}
function empFromKey(req, r) {
  const k = req.get('x-emp-key');
  return k ? r.employees.find((e) => safeEq(e.empKey, k)) || null : null;
}
// Tasdiqlangan a'zo (admin yoki tasdiqlangan xodim). Kutilayotgan xodimlar ma'lumot ko'ra olmaydi.
function member(req, r) {
  if (isAdmin(req, r)) return r.employees.find((e) => e.isAdmin) || { id: 'admin', name: 'Rahbar', role: 'Rahbar' };
  const e = empFromKey(req, r); return e && !e.pending ? e : null;
}
function requireMember(req, res, r) { const m = member(req, r); if (!m) res.status(403).json({ error: 'Avval Room’ga kiring (yoki rahbar tasdiqlashini kuting).' }); return m; }
function emit(r, ev, data) { io.to('room:' + r.code).emit(ev, data); }

// Create room
app.post('/api/rooms', (req, res) => {
  let { company, adminName, workStart = '09:00', workEnd = '18:00' } = req.body || {};
  company = clip(company, 80).trim(); adminName = clip(adminName, 60).trim();
  if (!company || !adminName) return res.status(400).json({ error: 'Kompaniya nomi va rahbar ismi kerak.' });
  if (!isTime(workStart)) workStart = '09:00'; if (!isTime(workEnd)) workEnd = '18:00';
  const pw = String((req.body || {}).adminPassword || '');
  if (pw.length < 6) return res.status(400).json({ error: 'Rahbar paroli kamida 6 belgi bo‘lsin.' });
  const code = newCode();
  const admin = { id: id(), name: String(adminName).slice(0, 60), role: 'Rahbar', salary: 0, isAdmin: true, empKey: id(16), descriptors: [], createdAt: Date.now() };
  const r = {
    code, company, adminKey: id(32), linkSecret: id(10), requireApproval: true, liveness: true, adminPass: hashPw(pw),
    workStart, workEnd, lateFine: 20000, telegramChatId: null, lastReport: null,
    employees: [admin], attendance: [], meetings: [], tasks: [], createdAt: Date.now(),
    absences: [], suggestions: [], mentorLog: [],
    kb: [{ id: id(), title: 'Ish tartibi', text: `Ish vaqti: ${workStart} dan ${workEnd} gacha. Har kuni kelganda va ketganda Face ID orqali belgilanish shart. 5 daqiqadan ortiq kechikish "kechikdi" hisoblanadi va jarima qo‘llanadi. Kasal bo‘lsangiz yoki ta’tilga chiqsangiz, platformada "Bugun kela olmayman" tugmasini bosing — vazifalaringiz AI yordamida hamkasbga o‘tkaziladi.`, createdAt: Date.now() }],
  };
  db.rooms[code] = r; save();
  pushEvent(r, 'room', `Yangi Room ochildi: ${r.company} (${adminName})`);
  res.json({ code, adminKey: r.adminKey, empId: admin.id, empKey: admin.empKey, room: roomView(r) });
});

// Room info (anyone with code)
app.get('/api/rooms/:code', (req, res) => {
  const r = getRoom(req, res); if (!r) return;
  const meE = empFromKey(req, r);
  if (!isAdmin(req, r) && (!meE || meE.pending)) {
    // begona yoki kutilayotgan xodim: faqat kompaniya nomi (xodimlar ro'yxati, rasmlar ochilmaydi)
    return res.json({ room: { code: r.code, company: r.company }, admin: false, me: meE ? meE.id : null, pending: !!(meE && meE.pending), hasFace: !!(meE && meE.descriptors.length) });
  }
  res.json({ room: roomView(r), admin: isAdmin(req, r), me: (meE || {}).id || null, myLink: meE ? `/men ${r.code} ${meE.empKey.slice(0, 8)}` : undefined, linkCommand: isAdmin(req, r) ? `/ulash ${r.code} ${r.linkSecret}` : undefined });
});

// Settings
app.patch('/api/rooms/:code/settings', (req, res) => {
  const r = getRoom(req, res); if (!r || !requireAdmin(req, res, r)) return;
  const { workStart, workEnd, lateFine, company } = req.body || {};
  if (isTime(workStart)) r.workStart = workStart;
  if (isTime(workEnd)) r.workEnd = workEnd;
  if (lateFine !== undefined) r.lateFine = Math.max(0, Math.min(1e8, Number(lateFine) || 0));
  if (company) r.company = clip(company, 80);
  if (req.body.requireApproval !== undefined) r.requireApproval = !!req.body.requireApproval;
  if (req.body.liveness !== undefined) r.liveness = !!req.body.liveness;
  if (req.body.autopilot !== undefined) r.autopilot = !!req.body.autopilot;
  if (req.body.graceMin !== undefined) r.graceMin = Math.max(5, Math.min(180, Number(req.body.graceMin) || 15));
  save(); res.json({ room: roomView(r) });
});

// Employees
app.post('/api/rooms/:code/employees', (req, res) => {
  const r = getRoom(req, res); if (!r || !requireAdmin(req, res, r)) return;
  const { name, role = 'Xodim', salary = 0 } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Ism kerak.' });
  if (r.employees.length >= 500) return res.status(400).json({ error: 'Xodimlar soni chegarasi (500)' });
  const e = { id: id(), name: clip(name, 60).trim(), role: clip(role, 40), salary: Math.max(0, Math.min(1e10, Number(salary) || 0)), empKey: id(24), descriptors: [], createdAt: Date.now() };
  r.employees.push(e); save(); emit(r, 'employees', r.employees.map(publicEmp));
  res.json({ employee: publicEmp(e), empKey: e.empKey });
});
app.patch('/api/rooms/:code/employees/:eid', (req, res) => {
  const r = getRoom(req, res); if (!r || !requireAdmin(req, res, r)) return;
  const e = r.employees.find((x) => x.id === req.params.eid);
  if (!e) return res.status(404).json({ error: 'Xodim topilmadi' });
  ['name', 'role'].forEach((k) => { if (req.body[k]) e[k] = String(req.body[k]).slice(0, 60); });
  if (req.body.salary !== undefined) e.salary = Math.max(0, Math.min(1e10, Number(req.body.salary) || 0));
  save(); emit(r, 'employees', r.employees.map(publicEmp)); res.json({ employee: publicEmp(e) });
});
app.delete('/api/rooms/:code/employees/:eid', (req, res) => {
  const r = getRoom(req, res); if (!r || !requireAdmin(req, res, r)) return;
  const e = r.employees.find((x) => x.id === req.params.eid);
  if (!e || e.isAdmin) return res.status(400).json({ error: 'O‘chirib bo‘lmaydi' });
  r.employees = r.employees.filter((x) => x.id !== e.id); save();
  emit(r, 'employees', r.employees.map(publicEmp)); res.json({ ok: true });
});

// Rahbar boshqa qurilmadan: kod + parol → admin kaliti
app.post('/api/rooms/:code/admin-login', limit('adminlogin', 8, 900000), (req, res) => {
  const r = roomOf(req.params.code);
  if (!r || !checkPw((req.body || {}).password, r.adminPass)) return res.status(401).json({ error: 'Kod yoki parol noto‘g‘ri.' });
  const a = r.employees.find((e) => e.isAdmin) || {};
  pushEvent(r, 'room', 'Rahbar yangi qurilmadan kirdi');
  res.json({ adminKey: r.adminKey, empId: a.id, empKey: a.empKey, name: a.name });
});
app.post('/api/rooms/:code/password', (req, res) => {
  const r = getRoom(req, res); if (!r || !requireAdmin(req, res, r)) return;
  const pw = String((req.body || {}).password || ''); if (pw.length < 6) return res.status(400).json({ error: 'Kamida 6 belgi' });
  r.adminPass = hashPw(pw); save(); res.json({ ok: true });
});

// Admin: xodimning shaxsiy taklif havolasi (kalit faqat adminga ko'rinadi)
app.get('/api/rooms/:code/employees/:eid/invite', (req, res) => {
  const r = getRoom(req, res); if (!r || !requireAdmin(req, res, r)) return;
  const e = r.employees.find((x) => x.id === req.params.eid); if (!e || e.isAdmin) return res.status(404).json({ error: 'Xodim topilmadi' });
  res.json({ path: `/room/${r.code}#emp=${e.empKey}` });
});
app.post('/api/rooms/:code/employees/:eid/approve', (req, res) => {
  const r = getRoom(req, res); if (!r || !requireAdmin(req, res, r)) return;
  const e = r.employees.find((x) => x.id === req.params.eid); if (!e) return res.status(404).json({ error: 'Xodim topilmadi' });
  e.pending = false; save(); emit(r, 'employees', r.employees.map(publicEmp)); io.to('emp:' + e.id).emit('approved');
  if (e.tgChatId) tg('sendMessage', { chat_id: e.tgChatId, text: `✅ ${e.name}, ${r.company} rahbari sizni tasdiqladi. Xush kelibsiz!` });
  res.json({ employee: publicEmp(e) });
});

// Employee self-join from phone (code is the room secret)
app.post('/api/rooms/:code/join', (req, res) => {
  const r = getRoom(req, res); if (!r) return;
  const name = clip((req.body || {}).name, 60).trim();
  if (name.length < 2) return res.status(400).json({ error: 'Ismingizni to‘liq kiriting.' });
  // Mavjud xodim nomi bilan kirib, uning hisobini egallab olishning oldi olinadi
  if (r.employees.some((x) => x.name.toLowerCase() === name.toLowerCase()))
    return res.status(409).json({ error: 'Bu ism Room’da bor. Rahbaringizdan shaxsiy taklif havolasini so‘rang.' });
  if (r.employees.filter((x) => x.pending).length >= 50) return res.status(429).json({ error: 'Tasdiq kutayotganlar juda ko‘p. Rahbarga murojaat qiling.' });
  const pending = r.requireApproval !== false;
  const e = { id: id(), name, role: 'Xodim', salary: 0, empKey: id(24), descriptors: [], pending, createdAt: Date.now() };
  r.employees.push(e); save(); emit(r, 'employees', r.employees.map(publicEmp));
  if (pending) { emit(r, 'assistant', { text: `${name} Room’ga qo‘shilmoqchi — Xodimlar bo‘limida tasdiqlang`, status: 'pending' }); tgSend(r, `🙋 <b>${esc(name)}</b> Room’ga qo‘shilish so‘radi. Tasdiqlash: admin panel → Xodimlar`); pushEvent(r, 'room', `${name} qo‘shilish so‘radi`); }
  res.json({ empId: e.id, empKey: e.empKey, pending });
});

// Register face (admin or the employee themselves)
app.put('/api/rooms/:code/employees/:eid/face', (req, res) => {
  const r = getRoom(req, res); if (!r) return;
  const e = r.employees.find((x) => x.id === req.params.eid);
  if (!e) return res.status(404).json({ error: 'Xodim topilmadi' });
  const self = empFromKey(req, r);
  if (!isAdmin(req, r) && !(self && self.id === e.id)) return res.status(403).json({ error: 'Ruxsat yo‘q' });
  const { descriptors, photo } = req.body || {};
  if (!Array.isArray(descriptors) || !descriptors.length || descriptors.length > 10 || descriptors.some((d) => !Array.isArray(d) || d.length !== 128 || d.some((v) => typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > 2)))
    return res.status(400).json({ error: 'Yuz ma’lumoti noto‘g‘ri' });
  // Sifat: barcha namunalar bitta yuzga tegishli bo'lishi kerak (fon/kiyim "yuz" bo'lib qolmasin)
  const mean = meanDesc(descriptors);
  if (descriptors.length >= 3 && descriptors.some((d) => dist(d, mean) > 0.42))
    return res.status(422).json({ error: 'Skaner sifati past (namunalar bir-biriga o‘xshamadi). Yorug‘ joyda, kameraga yaqinroq qayta urinib ko‘ring.' });
  // Bir yuz ikki xodimga yozilmasin
  for (const other of r.employees) {
    if (other.id === e.id || !(other.descriptors || []).length) continue;
    if (dist(meanDesc(other.descriptors), mean) < FACE_THRESHOLD)
      return res.status(409).json({ error: `Bu yuz allaqachon "${other.name}" nomiga ro‘yxatdan o‘tgan. Avval uning Face ID’sini o‘chiring yoki boshqa odamni skaner qiling.` });
  }
  e.descriptors = descriptors.slice(0, 6).map((d) => d.map((v) => Math.round(v * 1e5) / 1e5));
  if (typeof photo === 'string' && photo.length < 120000 && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(photo)) e.photo = photo;
  save(); emit(r, 'employees', r.employees.map(publicEmp));
  res.json({ employee: publicEmp(e) });
});

app.delete('/api/rooms/:code/employees/:eid/face', (req, res) => {
  const r = getRoom(req, res); if (!r || !requireAdmin(req, res, r)) return;
  const e = r.employees.find((x) => x.id === req.params.eid); if (!e) return res.status(404).json({ error: 'Xodim topilmadi' });
  e.descriptors = []; e.photo = null; save(); emit(r, 'employees', r.employees.map(publicEmp)); res.json({ ok: true });
});

// Face ID check-in / check-out
app.post('/api/rooms/:code/checkin', (req, res) => {
  const r = getRoom(req, res); if (!r) return;
  // Kiosk faqat admin qurilmasida; xodim esa faqat o'zini belgilay oladi
  const adm = isAdmin(req, r), self = member(req, r);
  if (!adm && !self) return res.status(403).json({ error: 'Face ID kiosk uchun Room’ga kiring.' });
  const { descriptor } = req.body || {};
  const mode = ['in', 'out'].includes((req.body || {}).mode) ? req.body.mode : 'auto';
  if (!Array.isArray(descriptor) || descriptor.length !== 128 || descriptor.some((v) => typeof v !== 'number' || !Number.isFinite(v))) return res.status(400).json({ error: 'Yuz aniqlanmadi' });
  // Har bir xodim uchun eng yaqin masofa; 1-o'rin 2-o'rindan aniq ajralib turishi shart
  const scores = r.employees.filter((e) => !e.pending && (e.descriptors || []).length)
    .map((e) => ({ e, d: Math.min(...e.descriptors.map((x) => dist(x, descriptor)), dist(meanDesc(e.descriptors), descriptor)) }))
    .sort((a, b) => a.d - b.d);
  const best = scores[0] && scores[0].e, bestD = scores[0] ? scores[0].d : 9;
  if (!best || bestD > FACE_THRESHOLD) return res.json({ match: false });
  if (scores[1] && scores[1].d - bestD < 0.06) return res.json({ match: false, ambiguous: true });
  if (!adm && best.id !== self.id) return res.json({ match: true, notYou: true, employee: { name: best.name } });
  const { date, time } = nowTZ();
  const today = r.attendance.filter((a) => a.empId === best.id && a.date === date);
  const inRec = today.find((a) => a.type === 'in'), outRec = today.find((a) => a.type === 'out');
  const conf = Math.max(50, Math.round((1 - bestD) * 100));
  const reply = (extra) => res.json({ match: true, employee: publicEmp(best), confidence: conf, ...extra });
  // Kelish: kuniga bir marta. Ketish: kelgandan kamida MIN_OUT daqiqa o'tgach yoki kiosk "Ketish" rejimida.
  const MIN_OUT = 180;
  let type;
  if (!inRec) type = 'in';
  else if (mode === 'in') return reply({ repeat: true, record: inRec, hint: 'Bugun kelganingiz allaqachon belgilangan' });
  else if (mode === 'out' || (Date.now() - inRec.ts) / 60000 >= MIN_OUT) type = 'out';
  else return reply({ repeat: true, record: inRec, hint: `Kelganingiz ${inRec.time} da belgilangan. Ketishda kioskda “Ketish” rejimini tanlang yoki ${addMin(inRec.time, MIN_OUT)} dan keyin qarang.` });
  if (type === 'out' && outRec && Date.now() - outRec.ts < 2 * 60000) return reply({ repeat: true, record: outRec, hint: 'Ketishingiz hozirgina belgilandi' });
  let status, lateMin = 0;
  if (type === 'in') { const late = toMin(time) - toMin(r.workStart); status = late > 5 ? 'kechikdi' : 'keldi'; lateMin = Math.max(0, late); }
  else status = toMin(time) < toMin(r.workEnd) ? 'erta ketdi' : 'ketdi';
  let rec;
  if (type === 'out' && outRec) { Object.assign(outRec, { time, status, ts: Date.now() }); rec = outRec; } // oxirgi ketish vaqti yangilanadi
  else { rec = { id: id(), empId: best.id, name: best.name, date, time, type, status, lateMin, ts: Date.now() }; r.attendance.push(rec); }
  if (r.attendance.length > 20000) r.attendance = r.attendance.slice(-15000);
  save(); emit(r, 'attendance', rec);
  pushEvent(r, 'checkin', `${best.name} — ${status} (${time})`);
  const icon = { keldi: '✅', kechikdi: '⏰', ketdi: '🏁', 'erta ketdi': '⚠️' }[status];
  tgSend(r, `${icon} <b>${esc(best.name)}</b> — ${status}${rec.lateMin ? ` (${rec.lateMin} daqiqa)` : ''}\n🕘 ${time} · ${r.company}`);
  reply({ record: rec });
});

app.get('/api/rooms/:code/attendance', (req, res) => {
  const r = getRoom(req, res); if (!r) return;
  const from = req.query.from || nowTZ().date, to = req.query.to || from;
  const me = empFromKey(req, r);
  let list = r.attendance.filter((a) => a.date >= from && a.date <= to);
  if (!isAdmin(req, r)) list = me && !me.pending ? list.filter((a) => a.empId === me.id) : [];
  res.json({ attendance: list, today: nowTZ().date });
});

app.delete('/api/rooms/:code/attendance/:aid', (req, res) => {
  const r = getRoom(req, res); if (!r || !requireAdmin(req, res, r)) return;
  const n = r.attendance.length; r.attendance = r.attendance.filter((a) => a.id !== req.params.aid);
  if (r.attendance.length === n) return res.status(404).json({ error: 'Topilmadi' });
  save(); res.json({ ok: true });
});

// Tasks
app.get('/api/rooms/:code/tasks', (req, res) => {
  const r = getRoom(req, res); if (!r || !requireMember(req, res, r)) return;
  res.json({ tasks: r.tasks });
});
app.post('/api/rooms/:code/tasks', (req, res) => {
  const r = getRoom(req, res); if (!r || !requireAdmin(req, res, r)) return;
  const list = (Array.isArray(req.body.tasks) ? req.body.tasks : [req.body]).slice(0, 50);
  const created = list.filter((t) => t && t.title).map((t) => {
    const emp = r.employees.find((e) => e.id === t.assigneeId) || r.employees.find((e) => t.assigneeName && e.name.toLowerCase() === String(t.assigneeName).toLowerCase());
    return { id: id(), title: clip(t.title, 300), assigneeId: emp ? emp.id : null, assigneeName: emp ? emp.name : clip(t.assigneeName, 60), deadline: clip(t.deadline, 40), status: 'yangi', meetingId: t.meetingId || null, createdAt: Date.now() };
  });
  r.tasks.push(...created); save(); emit(r, 'tasks', r.tasks);
  created.forEach((t) => tgSend(r, `📝 Yangi vazifa: <b>${esc(t.title)}</b>\n👤 ${esc(t.assigneeName || '—')}${t.deadline ? `\n📅 ${esc(t.deadline)}` : ''}`));
  res.json({ tasks: created });
});
app.patch('/api/rooms/:code/tasks/:tid', (req, res) => {
  const r = getRoom(req, res); if (!r) return;
  const t = r.tasks.find((x) => x.id === req.params.tid);
  if (!t) return res.status(404).json({ error: 'Vazifa topilmadi' });
  const me = member(req, r);
  if (!isAdmin(req, r) && !(me && me.id === t.assigneeId)) return res.status(403).json({ error: 'Ruxsat yo‘q' });
  if (['yangi', 'jarayonda', 'bajarildi'].includes(req.body.status)) {
    t.status = req.body.status;
    if (t.status === 'bajarildi') { t.doneAt = Date.now(); tgSend(r, `✔️ <b>${esc(t.assigneeName || '')}</b> vazifani bajardi: ${esc(t.title)}`); }
  }
  if (isAdmin(req, r)) {
    if (req.body.title) t.title = String(req.body.title).slice(0, 300);
    if (req.body.deadline !== undefined) t.deadline = clip(req.body.deadline, 40);
    if (req.body.assigneeId !== undefined) { const e = r.employees.find((x) => x.id === req.body.assigneeId); t.assigneeId = e ? e.id : null; t.assigneeName = e ? e.name : ''; }
  }
  save(); emit(r, 'tasks', r.tasks); res.json({ task: t });
});
app.delete('/api/rooms/:code/tasks/:tid', (req, res) => {
  const r = getRoom(req, res); if (!r || !requireAdmin(req, res, r)) return;
  r.tasks = r.tasks.filter((x) => x.id !== req.params.tid); save(); emit(r, 'tasks', r.tasks); res.json({ ok: true });
});

// Meetings
app.get('/api/rooms/:code/meetings', (req, res) => {
  const r = getRoom(req, res); if (!r || !requireMember(req, res, r)) return;
  res.json({ meetings: r.meetings.slice().reverse().map((m) => ({ ...m, transcript: undefined, lines: m.transcript.length })) });
});
app.get('/api/rooms/:code/meetings/:mid', (req, res) => {
  const r = getRoom(req, res); if (!r || !requireMember(req, res, r)) return;
  const m = r.meetings.find((x) => x.id === req.params.mid);
  if (!m) return res.status(404).json({ error: 'Majlis topilmadi' });
  res.json({ meeting: m });
});
app.post('/api/rooms/:code/meetings', (req, res) => {
  const r = getRoom(req, res); if (!r || !requireAdmin(req, res, r)) return;
  const { date, time } = nowTZ();
  const b = req.body || {};
  const mode = ['online', 'offline', 'fayl'].includes(b.mode) ? b.mode : 'online';
  const transcript = Array.isArray(b.transcript) ? b.transcript.slice(0, 2000).map((l) => ({ name: String(l.name || 'Majlis').slice(0, 60), text: String(l.text || '').slice(0, 1000), ts: Number(l.ts) || Date.now() })).filter((l) => l.text) : [];
  const m = { id: id(), title: clip(b.title || 'Majlis', 100), mode, date: /^\d{4}-\d\d-\d\d$/.test(b.date) ? b.date : date, time: isTime(b.time) ? b.time : time, status: 'live', transcript, summary: '', tasks: [], createdAt: Date.now() };
  r.meetings.push(m); save(); emit(r, 'meeting:started', { id: m.id, title: m.title });
  pushEvent(r, 'meeting', `Majlis boshlandi: ${m.title}`);
  if (mode === 'online') tgSend(r, `🎥 Majlis boshlandi: <b>${esc(m.title)}</b>\nKod: ${r.code}`);
  res.json({ meeting: m });
});

// Analyze: optional raw audio body (audio/webm) + stored transcript → Gemini → summary + tasks
app.post('/api/rooms/:code/meetings/:mid/analyze',
  express.raw({ type: ['audio/*', 'video/webm', 'application/octet-stream'], limit: '20mb' }),
  async (req, res, next) => { try {
    const r = getRoom(req, res); if (!r || !requireAdmin(req, res, r)) return;
    const m = r.meetings.find((x) => x.id === req.params.mid);
    if (!m) return res.status(404).json({ error: 'Majlis topilmadi' });
    const audio = Buffer.isBuffer(req.body) && req.body.length > 1000 ? req.body : null;
    const mime = (req.get('content-type') || 'audio/webm').split(';')[0];
    let result = null, engine = 'qoida';
    if (GEMINI_API_KEY) {
      try { result = await geminiAnalyze(r, m, audio, mime); engine = 'gemini'; }
      catch (e) { console.error('Gemini xato:', e.message); }
    }
    if (!result) result = ruleAnalyze(r, m);
    if (result.transcript && result.transcript.length && (!m.transcript.length || audio)) {
      m.aiTranscript = result.transcript;
    }
    m.summary = result.summary || '';
    m.decisions = result.decisions || [];
    m.tasks = (result.tasks || []).map((t) => {
      const emp = matchEmp(r, t.assignee);
      return { title: t.task || t.title, assigneeName: emp ? emp.name : (t.assignee || ''), assigneeId: emp ? emp.id : null, deadline: t.deadline || '' };
    }).filter((t) => t.title);
    m.status = 'done'; m.engine = engine; save();
    pushEvent(r, 'meeting', `Majlis tahlil qilindi: ${m.title} — ${m.tasks.length} ta vazifa`);
    tgSend(r, `🧠 <b>${esc(m.title)}</b> — AI xulosasi\n${esc(m.summary).slice(0, 700)}\n\n${m.tasks.map((t, i) => `${i + 1}. ${esc(t.title)}${t.assigneeName ? ' — ' + esc(t.assigneeName) : ''}${t.deadline ? ' (' + esc(t.deadline) + ')' : ''}`).join('\n')}\n\nTasdiqlash: admin panel → Majlislar`);
    emit(r, 'meeting:ended', { id: m.id });
    res.json({ meeting: m, engine });
  } catch (e) { next(e); } });

function matchEmp(r, name) {
  if (!name) return null;
  const n = String(name).toLowerCase();
  return r.employees.find((e) => e.name.toLowerCase() === n)
    || r.employees.find((e) => n.includes(e.name.toLowerCase().split(' ')[0]) || e.name.toLowerCase().includes(n.split(' ')[0]));
}

async function geminiAnalyze(r, m, audio, mime) {
  const names = r.employees.map((e) => `${e.name} (${e.role})`).join(', ');
  const text = m.transcript.map((l) => `${l.name}: ${l.text}`).join('\n');
  const prompt = `Sen "${r.company}" kompaniyasining majlis kotibisan. Majlis o‘zbek tilida (lotin yoki kirill, rus so‘zlari aralash bo‘lishi mumkin).
Xodimlar: ${names}.
Bugungi sana: ${nowTZ().date} (Toshkent). "ertaga", "juma" kabi muddatlarni aniq sanaga aylantir (YYYY-MM-DD), iloji bo‘lmasa so‘zini qoldir.
${audio ? 'Ilova qilingan audio — majlis yozuvi. Uni diqqat bilan tingla va o‘zbek lotin yozuvida transkripsiya qil.' : ''}
${m.mode !== 'online' ? 'Bu xonada bo‘lgan JONLI (oflayn) majlis: bir nechta kishi bitta mikrofonga gapirgan. Transkripsiyada spikerlarni ajrat — har qatorni "Ism: gap" ko‘rinishida yoz; ism aytilmasa ovozidan farqlab "1-spiker", "2-spiker" deb yoz. Kim kimga vazifa berganini kontekstdan aniqla.' : ''}
${text ? 'Jonli subtitr (brauzer tanigan, xatolar bo‘lishi mumkin):\n' + text : ''}
Vazifa: 1) qisqa xulosa (3-5 gap), 2) qabul qilingan qarorlar, 3) aniq vazifalar ro‘yxati — kim, nima, qachongacha. Mas’ul shaxs ismini faqat xodimlar ro‘yxatidan tanla, aniq bo‘lmasa bo‘sh qoldir. Hamma javob o‘zbek tilida (lotin).`;
  const parts = [{ text: prompt }];
  if (audio) parts.push({ inline_data: { mime_type: mime, data: audio.toString('base64') } });
  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          summary: { type: 'STRING' },
          decisions: { type: 'ARRAY', items: { type: 'STRING' } },
          transcript: { type: 'ARRAY', items: { type: 'STRING' } },
          tasks: { type: 'ARRAY', items: { type: 'OBJECT', properties: { task: { type: 'STRING' }, assignee: { type: 'STRING' }, deadline: { type: 'STRING' } }, required: ['task'] } },
        },
        required: ['summary', 'tasks'],
      },
    },
  };
  return geminiCall(body, true);
}

// Gemini modelini avtomatik tanlash: kalitga ochiq eng yangi "flash" modeli (eski model o'chirilsa ham ishlayveradi)
async function resolveModel(force) {
  if (AI.model && !force) return AI.model;
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': GEMINI_API_KEY }, signal: AbortSignal.timeout(20000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error && j.error.message) || 'Gemini: ' + r.status);
  const ok = (j.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent')).map((m) => m.name.replace('models/', ''));
  AI.models = ok;
  if (GEMINI_MODEL_ENV && ok.includes(GEMINI_MODEL_ENV)) return (AI.model = GEMINI_MODEL_ENV);
  const ver = (n) => { const m = n.match(/gemini-(\d+(?:\.\d+)?)/); return m ? parseFloat(m[1]) : 0; };
  const cands = ok.filter((n) => /^gemini-[\d.]+-flash(-\d+)?$/.test(n) || n === 'gemini-flash-latest');
  const pick = cands.filter((n) => n !== 'gemini-flash-latest').sort((a, b) => ver(b) - ver(a) || a.length - b.length)[0]
    || (ok.includes('gemini-flash-latest') && 'gemini-flash-latest')
    || ok.filter((n) => /flash/.test(n) && !/(image|live|tts|audio|embed|exp)/.test(n)).sort((a, b) => ver(b) - ver(a))[0]
    || ok.find((n) => /^gemini/.test(n));
  if (!pick) throw new Error('Kalitingizga mos Gemini modeli topilmadi');
  return (AI.model = pick);
}
async function geminiCall(body, json, retried) {
  let model;
  try { model = await resolveModel(); } catch (e) { AI.ok = false; AI.error = e.message; AI.at = Date.now(); throw e; }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY }, body: JSON.stringify(body), signal: AbortSignal.timeout(120000) });
  const j = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const msg = (j.error && j.error.message) || 'Gemini ' + resp.status;
    if (!retried && (resp.status === 404 || /not found|not supported|deprecated/i.test(msg))) { AI.model = ''; await resolveModel(true).catch(() => {}); return geminiCall(body, json, true); }
    AI.ok = false; AI.error = msg; AI.at = Date.now();
    throw new Error(msg);
  }
  AI.ok = true; AI.error = ''; AI.at = Date.now();
  const cand = j.candidates && j.candidates[0];
  const out = ((cand && cand.content && cand.content.parts) || []).filter((p) => !p.thought).map((p) => p.text || '').join('').trim();
  if (!out) throw new Error('Gemini bo‘sh javob qaytardi' + (cand && cand.finishReason ? ' (' + cand.finishReason + ')' : ''));
  if (!json) return out;
  try { return JSON.parse(out); } catch (_) { const m = out.match(/\{[\s\S]*\}/); if (m) return JSON.parse(m[0]); throw new Error('Gemini javobi JSON emas'); }
}

// Fallback: rule-based Uzbek task extraction (works without API key)
function ruleAnalyze(r, m) {
  const verbs = /(qilsin|qilsinlar|tayyorlasin|yuborsin|jo‘natsin|jo'natsin|tekshirsin|yozsin|topshirsin|bajarsin|olib kelsin|chiqarsin|hal qilsin|gaplashsin|qo‘ng‘iroq qilsin|qilib qo‘ysin|tugatsin|qilish kerak|tayyorlash kerak|kerak|vazifa|mas’ul|mas'ul|qilasan|qilasiz|tayyorlang|yuboring|tekshiring|qiling|[a-zA-Z‘'ʻ’-]+(?:aman|ayman)\b)/i;
  const dl = /(bugun|ertaga|indinga|dushanba|seshanba|chorshanba|payshanba|juma|shanba|yakshanba|hafta oxiri|oy oxiri|\d{1,2}[-.\s]?(yanvar|fevral|mart|aprel|may|iyun|iyul|avgust|sentabr|oktabr|noyabr|dekabr)|soat\s?\d{1,2}(:\d{2})?)(\s?gacha)?/i;
  const sentences = m.transcript.flatMap((l) => l.text.split(/(?<=[.!?])\s+/).map((s) => ({ s: s.trim(), by: l.name }))).filter((x) => x.s);
  const tasks = [];
  for (const { s, by } of sentences) {
    if (!verbs.test(s)) continue;
    const emp = r.employees.find((e) => new RegExp('\\b' + e.name.split(' ')[0].replace(/[.*+?^${}()|[\]\\]/g, '') , 'i').test(s)) || (/(?:aman|ayman)\b/i.test(s) ? r.employees.find((e) => e.name === by) : null);
    const d = s.match(dl);
    tasks.push({ task: s.replace(/^[,\s]+/, ''), assignee: emp ? emp.name : '', deadline: d ? d[0] : '' });
  }
  const words = sentences.length;
  return {
    summary: words ? `Majlisda ${new Set(m.transcript.map((l) => l.name)).size} kishi gapirdi, ${words} ta gap yozib olindi, ${tasks.length} ta vazifa aniqlandi. (Aniqroq tahlil uchun serverga GEMINI_API_KEY qo‘shing.)` : 'Transkripsiya bo‘sh — majlis davomida “AI tinglash” yoqilmagan bo‘lishi mumkin.',
    decisions: [], tasks,
  };
}

// Dashboard / KPI data (admin)
app.get('/api/rooms/:code/report', (req, res) => {
  const r = getRoom(req, res); if (!r || !requireAdmin(req, res, r)) return;
  const month = req.query.month || nowTZ().date.slice(0, 7);
  const att = r.attendance.filter((a) => a.date.startsWith(month));
  const workDays = new Set(att.map((a) => a.date)).size || 1;
  const rows = r.employees.map((e) => {
    const mine = att.filter((a) => a.empId === e.id && a.type === 'in');
    const late = mine.filter((a) => a.status === 'kechikdi');
    const tasks = r.tasks.filter((t) => t.assigneeId === e.id && new Date(t.createdAt).toISOString().startsWith(month));
    const done = tasks.filter((t) => t.status === 'bajarildi').length;
    const attendanceRate = Math.min(1, mine.length / workDays);
    const punctuality = mine.length ? 1 - late.length / mine.length : 0;
    const taskRate = tasks.length ? done / tasks.length : 1;
    const kpi = Math.round((attendanceRate * 0.4 + punctuality * 0.2 + taskRate * 0.4) * 100);
    const fine = late.length * (r.lateFine || 0);
    const bonus = kpi >= 90 ? Math.round(e.salary * 0.1) : kpi >= 80 ? Math.round(e.salary * 0.05) : 0;
    const pay = Math.max(0, Math.round(e.salary * attendanceRate) - fine + bonus);
    return { id: e.id, name: e.name, role: e.role, salary: e.salary, days: mine.length, late: late.length, lateMin: late.reduce((s, a) => s + (a.lateMin || 0), 0), tasks: tasks.length, done, kpi, fine, bonus, pay };
  });
  res.json({ month, workDays, rows });
});

// ---------- AI MENTOR (Gemini) + Bilim bazasi ----------
app.get('/api/rooms/:code/kb', (req, res) => {
  const r = getRoom(req, res); if (!r) return;
  if (!member(req, r)) return res.status(403).json({ error: 'Ruxsat yo‘q' });
  res.json({ kb: r.kb, log: isAdmin(req, r) ? r.mentorLog.slice(-30).reverse() : undefined, ai: !!GEMINI_API_KEY });
});
app.post('/api/rooms/:code/kb', (req, res) => {
  const r = getRoom(req, res); if (!r || !requireAdmin(req, res, r)) return;
  const { title, text } = req.body || {};
  if (!title || !text) return res.status(400).json({ error: 'Sarlavha va matn kerak' });
  if (r.kb.length >= 200) return res.status(400).json({ error: 'Bilim bazasi chegarasi (200 bo‘lim)' });
  const k = { id: id(), title: clip(title, 120), text: clip(text, 20000), createdAt: Date.now() };
  r.kb.push(k); save(); res.json({ item: k });
});
app.delete('/api/rooms/:code/kb/:kid', (req, res) => {
  const r = getRoom(req, res); if (!r || !requireAdmin(req, res, r)) return;
  r.kb = r.kb.filter((k) => k.id !== req.params.kid); save(); res.json({ ok: true });
});

function kbSearch(r, q) {
  const words = String(q).toLowerCase().split(/[^a-zа-яёʻ‘'o‘g‘0-9]+/i).filter((w) => w.length > 2);
  return r.kb.map((k) => {
    const t = (k.title + ' ' + k.text).toLowerCase();
    return { k, score: words.reduce((s, w) => s + (t.includes(w.slice(0, Math.max(4, w.length - 2))) ? 1 : 0), 0) };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).map((x) => x.k);
}

app.post('/api/rooms/:code/mentor', async (req, res, next) => { try {
  const r = getRoom(req, res); if (!r) return;
  const who = member(req, r); if (!who) return res.status(403).json({ error: 'Ruxsat yo‘q' });
  const question = String((req.body || {}).question || '').trim().slice(0, 2000);
  if (!question) return res.status(400).json({ error: 'Savol yozing' });
  const history = (Array.isArray(req.body.history) ? req.body.history.slice(-8) : []).filter((h) => h && typeof h.text === 'string');
  r.mentorLog.push({ name: who.name, q: question, ts: Date.now() });
  if (r.mentorLog.length > 300) r.mentorLog = r.mentorLog.slice(-200);
  save(); pushEvent(r, 'mentor', `AI Mentor’ga savol: ${who.name}`);
  const myTasks = r.tasks.filter((t) => t.assigneeId === who.id && t.status !== 'bajarildi').map((t) => `- ${t.title}${t.deadline ? ' (muddat: ' + t.deadline + ')' : ''}`).join('\n');
  if (GEMINI_API_KEY) {
    try {
      let kbText = r.kb.map((k) => `### ${k.title}\n${k.text}`).join('\n\n');
      if (kbText.length > 60000) kbText = kbText.slice(0, 60000);
      const sys = `Sen "${r.company}" kompaniyasining AI Mentorisan (WORKROOM AI). Vazifang — xodimlarni, ayniqsa yangi kelganlarni o‘qitish va savollariga javob berish, shunda tajribali mutaxassislar vaqti tejaladi.
Qoidalar: javobni o‘zbek tilida (lotin), samimiy va aniq yoz; kerak bo‘lsa qadamlarga bo‘l (1., 2., 3.). Kompaniyaga oid savollarda FAQAT bilim bazasiga tayan; bazada javob yo‘q bo‘lsa, ochiq ayt va "rahbardan aniqlashtiring" deb maslahat ber — to‘qib chiqarma. Umumiy kasbiy savollarda (Excel, sotuv, muloqot va h.k.) o‘z bilimingdan foydalan. Uzunligi 180 so‘zdan oshmasin.
Suhbatdosh: ${who.name}, lavozimi: ${who.role}. Ish vaqti: ${r.workStart}–${r.workEnd}. Bugungi sana va vaqt: ${nowTZ().date} ${nowTZ().time} (Toshkent).
${isAdmin(req, r) ? 'Suhbatdosh — rahbar. Bugungi jonli holat (davomat, vazifalar haqidagi savollarga shundan javob ber):\n' + JSON.stringify(dayFacts(r)) : ''}
Uning ochiq vazifalari:\n${myTasks || '(yo‘q)'}
=== BILIM BAZASI ===\n${kbText || '(bo‘sh)'}`;
      const contents = [
        ...history.map((h) => ({ role: h.role === 'ai' ? 'model' : 'user', parts: [{ text: String(h.text).slice(0, 2000) }] })),
        { role: 'user', parts: [{ text: question }] },
      ];
      const out = await geminiCall({
        systemInstruction: { parts: [{ text: sys }] }, contents,
        generationConfig: { temperature: 0.4, responseMimeType: 'application/json', responseSchema: { type: 'OBJECT', properties: { answer: { type: 'STRING' }, sources: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['answer'] } },
      }, true);
      return res.json({ answer: out.answer, sources: out.sources || [], engine: 'gemini' });
    } catch (e) { console.error('Mentor Gemini xato:', e.message); }
  }
  // Kalitsiz yoki Gemini xatosida ham davomat savollariga jonli ma'lumotdan javob
  if (isAdmin(req, r) && /(kim|nechta|qancha).{0,25}(kel|kech|yo‘q|yoq|ishda)|davomat/i.test(question)) {
    const f = dayFacts(r);
    return res.json({ engine: 'data', sources: ['Bugungi davomat'], answer: `Bugun (${f.date}) ${f.total} xodimdan ${f.came} nafari keldi.${f.late.length ? `\nKechikkanlar: ${f.late.join(', ')}.` : ''}\nSababli kelmaganlar: ${f.absent.join(', ') || 'yo‘q'}.\nXabarsiz kelmaganlar: ${f.missing.join(', ') || 'yo‘q'}.${f.subs.length ? `\nO‘rinbosarlar: ${f.subs.join(', ')}.` : ''}` + (GEMINI_API_KEY && AI.error ? `\n\n(Gemini hozir ishlamayapti: ${AI.error})` : '') });
  }
  const hits = kbSearch(r, question);
  const answer = hits.length
    ? `Bilim bazasidan topdim — “${hits[0].title}”:\n\n${hits[0].text.slice(0, 700)}${hits[0].text.length > 700 ? '…' : ''}`
    : 'Bu savolga bilim bazasida javob topilmadi. Rahbaringizdan aniqlashtiring — u javobni bilim bazasiga qo‘shsa, keyingi safar men darhol aytib beraman.';
  const note = !GEMINI_API_KEY ? '\n\n(Aqlli javoblar uchun serverga GEMINI_API_KEY qo‘shing.)' : AI.error ? `\n\n(Gemini xatosi: ${AI.error}. Sozlamalar → Tizim holati.)` : '';
  res.json({ answer: answer + (isAdmin(req, r) ? note : ''), sources: hits.slice(0, 1).map((k) => k.title), engine: 'qidiruv' });
} catch (e) { next(e); } });

// ---------- E'lonlar ----------
app.get('/api/rooms/:code/posts', (req, res) => { const r = getRoom(req, res); if (!r) return; if (!member(req, r)) return res.status(403).json({ error: 'Ruxsat yo‘q' }); res.json({ posts: r.posts.slice(-20).reverse() }); });
app.post('/api/rooms/:code/posts', (req, res) => {
  const r = getRoom(req, res); if (!r || !requireAdmin(req, res, r)) return;
  const text = String((req.body || {}).text || '').trim().slice(0, 1500); if (!text) return res.status(400).json({ error: 'Matn yozing' });
  if (r.posts.length > 300) r.posts = r.posts.slice(-200);
  const p = { id: id(), text, ts: Date.now(), by: (r.employees.find((e) => e.isAdmin) || {}).name };
  r.posts.push(p); save(); emit(r, 'post', p); tgSend(r, `📢 <b>E’lon</b>\n${esc(text)}`);
  r.employees.forEach((e) => e.tgChatId && !e.isAdmin && tg('sendMessage', { chat_id: e.tgChatId, parse_mode: 'HTML', text: `📢 <b>${esc(r.company)}</b>\n${esc(text)}` }));
  res.json({ post: p });
});
app.delete('/api/rooms/:code/posts/:pid', (req, res) => { const r = getRoom(req, res); if (!r || !requireAdmin(req, res, r)) return; r.posts = r.posts.filter((p) => p.id !== req.params.pid); save(); res.json({ ok: true }); });

// ---------- AI kun xulosasi ----------
function dayFacts(r) {
  const { date } = nowTZ();
  const ins = r.attendance.filter((a) => a.date === date && a.type === 'in');
  const came = new Set(ins.map((a) => a.empId));
  const abs = r.absences.filter((a) => a.date === date);
  const absIds = new Set(abs.map((a) => a.empId));
  const missing = r.employees.filter((e) => !e.isAdmin && !came.has(e.id) && !absIds.has(e.id));
  const done = r.tasks.filter((t) => t.doneAt && nowTZ().date === new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(t.doneAt)));
  const meets = r.meetings.filter((m) => m.date === date);
  const subs = r.suggestions.filter((s) => s.status === 'approved' && s.date === date);
  return { date, total: r.employees.length, came: ins.length, late: ins.filter((a) => a.status === 'kechikdi').map((a) => `${a.name} (${a.lateMin} daq)`), absent: abs.map((a) => `${a.name} — ${a.reason}`), missing: missing.map((e) => e.name), done: done.map((t) => `${t.title} — ${t.assigneeName}`), open: r.tasks.filter((t) => t.status !== 'bajarildi').length, meetings: meets.map((m) => `${m.title}: ${m.summary || ''}`.slice(0, 400)), subs: subs.map((s) => `${s.name} → ${s.toName}`) };
}
async function makeBrief(r) {
  const f = dayFacts(r);
  if (GEMINI_API_KEY) {
    try {
      return await geminiCall({ contents: [{ role: 'user', parts: [{ text: `Sen "${r.company}" rahbarining AI yordamchisisan. Quyidagi bugungi ma’lumotlardan rahbar uchun qisqa kunlik hisobot yoz (o‘zbek lotin, 6–9 qator, raqamlar bilan, oxirida ertaga uchun 1–2 ta aniq tavsiya). Faqat berilgan faktlarga tayan.\n${JSON.stringify(f)}` }] }], generationConfig: { temperature: 0.3 } }, false);
    } catch (e) { console.error('Brief Gemini xato:', e.message); }
  }
  return `📊 ${f.date} — kun xulosasi\n• Keldi: ${f.came}/${f.total}${f.late.length ? `, kechikdi: ${f.late.join(', ')}` : ''}\n• Kelmadi (sababli): ${f.absent.join(', ') || 'yo‘q'}\n• Xabarsiz kelmadi: ${f.missing.join(', ') || 'yo‘q'}\n• O‘rinbosarlar: ${f.subs.join(', ') || 'yo‘q'}\n• Bajarilgan vazifalar: ${f.done.length}, ochiq: ${f.open}\n• Majlislar: ${f.meetings.length}\nTavsiya: ${f.late.length ? 'kechikkanlar bilan qisqa suhbat o‘tkazing; ' : ''}${f.open > 10 ? 'ochiq vazifalar ko‘p — ertalab ustuvorlikni belgilang.' : 'yaxshi kun — jamoani rag‘batlantiring.'}`;
}
app.get('/api/rooms/:code/brief', async (req, res, next) => {
  try { const r = getRoom(req, res); if (!r || !requireAdmin(req, res, r)) return; res.json({ text: await makeBrief(r), ai: !!GEMINI_API_KEY }); } catch (e) { next(e); }
});

// ---------- AI ASSISTANT: kasal/ta'til → vazifalarni o'tkazish taklifi (1-click) ----------
function openTasks(r, empId) { return r.tasks.filter((t) => t.assigneeId === empId && t.status !== 'bajarildi'); }
function makeSuggestion(r, e, why, source, exclude = new Set()) {
  const { date } = nowTZ();
  const absentIds = new Set(r.absences.filter((a) => a.date === date).map((a) => a.empId));
  const tasks = openTasks(r, e.id);
  let sug;
  const pickSub = () => {
    const cands = r.employees.filter((x) => x.id !== e.id && !x.isAdmin && !absentIds.has(x.id) && !exclude.has(x.id));
    // prefer: same role, already checked in today, fewest open tasks
    const inToday = new Set(r.attendance.filter((a) => a.date === date && a.type === 'in').map((a) => a.empId));
    const score = (x) => (x.role === e.role ? -100 : 0) + (inToday.has(x.id) ? -20 : 0) + openTasks(r, x.id).length;
    return cands.sort((a, b) => score(a) - score(b))[0] || r.employees.find((x) => x.isAdmin);
  };
  const to = pickSub();
  const head = source === 'auto' ? `${e.name} soat ${addMin(r.workStart, r.graceMin || 15)} gacha kelmadi va xabar bermadi.` : `${e.name} bugun ${why}.`;
  const whyTo = to.role === e.role ? `${to.name} — ham ${to.role}, ${openTasks(r, to.id).length} ta ochiq vazifasi bor.` : `${to.name} — eng kam band xodim (${openTasks(r, to.id).length} ta ochiq vazifa).`;
  sug = { id: id(), type: 'reassign', source, empId: e.id, name: e.name, reason: why, taskIds: tasks.map((t) => t.id), toId: to.id, toName: to.name, date, status: 'pending', ts: Date.now(),
    text: tasks.length ? `${head} ${tasks.length} ta vazifasini va bugungi o‘rnini ${to.name}ga o‘tkazaymi?` : `${head} Bugun uning o‘rniga ${to.name}ni o‘rinbosar qilib qo‘yaymi?`, why: whyTo };
  r.suggestions.push(sug);
  emit(r, 'assistant', sug);
  if (r.autopilot) approveSuggestion(r, sug, to.id, true);
  else tgSend(r, `🤖 <b>AI Assistant</b>\n${esc(sug.text)}\n${esc(whyTo)}`, { reply_markup: { inline_keyboard: [[{ text: '✅ Ha, o‘tkaz', callback_data: `sg:${r.code}:${sug.id}:ok` }, { text: '✖️ Yo‘q', callback_data: `sg:${r.code}:${sug.id}:no` }]] } });
  return sug;
}
function addMin(hhmm, m) { const t = toMin(hhmm) + m; return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; }
function approveSuggestion(r, sg, toId, auto) {
  const to = r.employees.find((x) => x.id === (toId || sg.toId)); if (!to) return null;
  const moved = [];
  r.tasks.forEach((t) => { if (sg.taskIds.includes(t.id) && t.status !== 'bajarildi') { t.assigneeId = to.id; t.assigneeName = to.name; t.note = `${sg.name} o‘rniga (${sg.reason})`; moved.push(t); } });
  sg.status = 'approved'; sg.toId = to.id; sg.toName = to.name; sg.auto = !!auto;
  emit(r, 'tasks', r.tasks); emit(r, 'assistant', sg);
  tgSend(r, `${auto ? '🤖 Avtopilot' : '✅'}: ${esc(sg.name)} o‘rniga bugun <b>${esc(to.name)}</b>${moved.length ? `, ${moved.length} ta vazifa o‘tkazildi` : ''}.`);
  if (to.tgChatId) tg('sendMessage', { chat_id: to.tgChatId, parse_mode: 'HTML', text: `👋 ${esc(to.name)}, bugun <b>${esc(sg.name)}</b> o‘rniga siz mas’ulsiz (${esc(sg.reason)}).${moved.length ? '\nSizga o‘tkazilgan vazifalar:\n' + moved.map((t) => '• ' + esc(t.title)).join('\n') : ''}` });
  pushEvent(r, 'absence', `O‘rinbosar: ${sg.name} → ${to.name}${auto ? ' (avtopilot)' : ''}`);
  save();
  return sg;
}
app.post('/api/rooms/:code/absence', (req, res) => {
  const r = getRoom(req, res); if (!r) return;
  const { empId, reason = 'kasal' } = req.body || {};
  const self = member(req, r);
  if (!isAdmin(req, r) && !(self && self.id === empId)) return res.status(403).json({ error: 'Ruxsat yo‘q' });
  const e = r.employees.find((x) => x.id === empId); if (!e) return res.status(404).json({ error: 'Xodim topilmadi' });
  const { date } = nowTZ();
  if (r.absences.some((a) => a.empId === e.id && a.date === date)) return res.status(409).json({ error: 'Bugun allaqachon belgilangan' });
  const why = ['kasal', 'ta’til', 'uzrli'].includes(reason) ? reason : 'uzrli';
  r.absences.push({ id: id(), empId: e.id, name: e.name, date, reason: why, ts: Date.now() });
  pushEvent(r, 'absence', `${e.name} — ${why}`);
  const sug = makeSuggestion(r, e, why, self && self.id === e.id ? 'self' : 'admin');
  save(); res.json({ suggestion: sug });
});
app.get('/api/rooms/:code/assistant', (req, res) => {
  const r = getRoom(req, res); if (!r || !requireAdmin(req, res, r)) return;
  const { date } = nowTZ();
  res.json({ suggestions: r.suggestions.filter((s) => s.status === 'pending'), absences: r.absences.filter((a) => a.date === date), subs: r.suggestions.filter((s) => s.status === 'approved' && s.date === date), autopilot: !!r.autopilot });
});
app.post('/api/rooms/:code/assistant/:sid', (req, res) => {
  const r = getRoom(req, res); if (!r || !requireAdmin(req, res, r)) return;
  const sg = r.suggestions.find((x) => x.id === req.params.sid); if (!sg) return res.status(404).json({ error: 'Topilmadi' });
  const { action, toId } = req.body || {};
  if (action === 'approve') { if (!approveSuggestion(r, sg, toId)) return res.status(400).json({ error: 'Xodim topilmadi' }); }
  else sg.status = 'rejected';
  save(); res.json({ suggestion: sg });
});

// ---------- UMUMIY ADMIN (platforma egasi): barcha Room'lar ----------
function superOk(req, res) {
  if (!SUPER_KEY) { res.status(503).json({ error: 'Serverda SUPER_ADMIN_KEY sozlanmagan (Render → Environment).' }); return false; }
  if (!safeEq(req.get('x-super-key'), SUPER_KEY)) { res.status(403).json({ error: 'Kalit noto‘g‘ri' }); return false; }
  return true;
}
function roomStats(r) {
  const { date } = nowTZ();
  const ins = (r.attendance || []).filter((a) => a.date === date && a.type === 'in');
  const n = r.employees.length;
  return {
    code: r.code, company: r.company, createdAt: r.createdAt, lastActivity: r.lastActivity || r.createdAt,
    admin: (r.employees.find((e) => e.isAdmin) || {}).name || '', employees: n,
    faces: r.employees.filter((e) => e.descriptors && e.descriptors.length).length,
    todayIn: ins.length, todayLate: ins.filter((a) => a.status === 'kechikdi').length,
    meetings: (r.meetings || []).length, tasksOpen: (r.tasks || []).filter((t) => t.status !== 'bajarildi').length, tasksDone: (r.tasks || []).filter((t) => t.status === 'bajarildi').length,
    mentorQs: (r.mentorLog || []).length, kb: (r.kb || []).length, telegram: !!r.telegramChatId,
    plan: n <= 15 ? 'START' : 'BUSINESS', mrr: n <= 15 ? 0 : n * 3,
  };
}
app.get('/api/super/overview', (req, res) => {
  if (!superOk(req, res)) return;
  const rooms = Object.values(db.rooms).map(roomStats).sort((a, b) => b.lastActivity - a.lastActivity);
  const sum = (k) => rooms.reduce((s, x) => s + x[k], 0);
  const days = [...Array(14)].map((_, i) => { const d = new Date(Date.now() - (13 - i) * 864e5); return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d); });
  const all = Object.values(db.rooms).flatMap((r) => r.attendance || []);
  const trend = days.map((d) => ({ date: d, checkins: all.filter((a) => a.date === d && a.type === 'in').length, rooms: Object.values(db.rooms).filter((r) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(r.createdAt)) <= d).length }));
  res.json({
    totals: { rooms: rooms.length, employees: sum('employees'), faces: sum('faces'), todayIn: sum('todayIn'), meetings: sum('meetings'), mentorQs: sum('mentorQs'), mrr: sum('mrr'), tasksOpen: sum('tasksOpen') },
    rooms, trend, events: db.events.slice(-40).reverse(), ai: !!GEMINI_API_KEY, telegram: !!TG_TOKEN,
  });
});
app.get('/api/super/rooms/:code', (req, res) => {
  if (!superOk(req, res)) return;
  const r = roomOf(req.params.code); if (!r) return res.status(404).json({ error: 'Topilmadi' });
  res.json({ stats: roomStats(r), adminKey: r.adminKey, employees: r.employees.map(publicEmp), meetings: (r.meetings || []).slice(-10).reverse().map((m) => ({ title: m.title, date: m.date, tasks: (m.tasks || []).length, status: m.status })), events: db.events.filter((e) => e.code === r.code).slice(-20).reverse() });
});
app.delete('/api/super/rooms/:code', (req, res) => {
  if (!superOk(req, res)) return;
  const r = roomOf(req.params.code); if (!r) return res.status(404).json({ error: 'Topilmadi' });
  delete db.rooms[r.code]; save(); pushEvent(null, 'room', `Room o‘chirildi: ${r.company}`); res.json({ ok: true });
});

// ---------- Socket.io: live room + video meeting signaling + live captions ----------
const meetPeers = {}; // meetingId -> { socketId: {name} }
function sockAuth(code, key) {
  const r = roomOf(code); if (!r || !key) return null;
  if (safeEq(key, r.adminKey)) return { r, who: r.employees.find((e) => e.isAdmin) || { id: 'admin', name: 'Rahbar' }, admin: true };
  const e = r.employees.find((x) => safeEq(x.empKey, key));
  if (!e) return null;
  return { r, who: e, admin: false, pending: !!e.pending };
}
io.on('connection', (socket) => {
  let hits = 0; const t0 = setInterval(() => (hits = 0), 10000);
  socket.use((pkt, next) => { if (++hits > 200) return next(new Error('rate')); next(); });
  socket.on('error', () => socket.disconnect(true));
  socket.on('super:join', ({ key } = {}) => { if (SUPER_KEY && safeEq(key, SUPER_KEY)) socket.join('super'); });
  socket.on('room:join', ({ code, key } = {}) => {
    const a = sockAuth(code, key); if (!a) return;
    socket.join('emp:' + a.who.id);
    if (a.pending) return; // kutilayotganlar faqat "approved" xabarini oladi
    socket.join('room:' + a.r.code); socket.data.code = a.r.code; socket.data.auth = a;
  });
  socket.on('meet:join', ({ meetingId } = {}) => {
    const a = socket.data.auth; if (!a) return;
    const m = a.r.meetings.find((x) => x.id === meetingId); if (!m || m.status !== 'live') return;
    const key = 'meet:' + meetingId;
    meetPeers[meetingId] = meetPeers[meetingId] || {};
    if (Object.keys(meetPeers[meetingId]).length >= 12) return socket.emit('meet:full');
    socket.emit('meet:peers', Object.entries(meetPeers[meetingId]).map(([sid, p]) => ({ sid, name: p.name })));
    const name = a.who.name;
    meetPeers[meetingId][socket.id] = { name };
    socket.join(key); socket.data.meetingId = meetingId; socket.data.name = name;
    socket.to(key).emit('meet:joined', { sid: socket.id, name });
  });
  socket.on('meet:signal', ({ to, data } = {}) => {
    const mid = socket.data.meetingId; if (!mid || !meetPeers[mid] || !meetPeers[mid][to]) return; // faqat shu majlis ishtirokchilariga
    if (JSON.stringify(data || {}).length > 20000) return;
    io.to(to).emit('meet:signal', { from: socket.id, name: socket.data.name, data });
  });
  socket.on('meet:caption', ({ text, final } = {}) => {
    const { meetingId, auth, name } = socket.data; if (!meetingId || !auth) return;
    const t = clip(text, 1000).trim(); if (!t) return;
    socket.to('meet:' + meetingId).emit('meet:caption', { sid: socket.id, name, text: t, final: !!final });
    if (final) {
      const m = auth.r.meetings.find((x) => x.id === meetingId);
      if (m && m.status === 'live' && m.transcript.length < 5000) { m.transcript.push({ name, text: t, ts: Date.now() }); save(); io.to('meet:' + meetingId).emit('meet:line', { name, text: t }); }
    }
  });
  socket.on('meet:chat', ({ text } = {}) => {
    const { meetingId, name } = socket.data; if (!meetingId) return;
    const t = clip(text, 500).trim(); if (!t) return;
    io.to('meet:' + meetingId).emit('meet:chat', { name, text: t, ts: Date.now() });
  });
  socket.on('meet:end', () => { const { meetingId, auth } = socket.data; if (meetingId && auth && auth.admin) io.to('meet:' + meetingId).emit('meet:ended'); });
  const leave = () => {
    const { meetingId } = socket.data;
    if (meetingId && meetPeers[meetingId]) {
      delete meetPeers[meetingId][socket.id];
      io.to('meet:' + meetingId).emit('meet:left', { sid: socket.id });
      if (!Object.keys(meetPeers[meetingId]).length) delete meetPeers[meetingId];
    }
    socket.data.meetingId = null;
  };
  socket.on('meet:leave', () => { if (socket.data.meetingId) socket.leave('meet:' + socket.data.meetingId); leave(); });
  socket.on('disconnect', () => { clearInterval(t0); leave(); });
});

// ---------- Telegram bot ----------
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const TG = { mode: TG_TOKEN ? 'kutilmoqda' : 'o‘chiq', ok: null, error: '', username: '', lastUpdate: 0 };
async function tg(method, payload) {
  if (!TG_TOKEN) return null;
  try {
    const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(40000) });
    const j = await r.json();
    if (!j.ok && method !== 'answerCallbackQuery') { TG.error = `${method}: ${j.description || r.status}`; if (j.error_code === 401) TG.ok = false; console.error('Telegram', TG.error); }
    return j;
  } catch (e) { TG.error = `${method}: ${e.message}`; return null; }
}
const TG_SECRET = TG_TOKEN ? crypto.createHash('sha256').update('wr-tg:' + TG_TOKEN).digest('hex').slice(0, 32) : '';
const PUBLIC_URL = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
// Webhook: Telegram xabari serverni uyg'otadi (Render bepul tarifida ham bot ishlaydi)
app.post('/tg/' + (TG_SECRET || 'off'), (req, res) => {
  if (!TG_SECRET || !safeEq(req.get('x-telegram-bot-api-secret-token'), TG_SECRET)) return res.sendStatus(403);
  res.sendStatus(200);
  TG.lastUpdate = Date.now();
  Promise.resolve(processUpdate(req.body || {})).catch((e) => console.error('TG update:', e.message));
});
async function tgStart() {
  const me = await tg('getMe', {});
  if (!me || !me.ok) { TG.ok = false; TG.mode = 'xato'; TG.error = TG.error || 'Token noto‘g‘ri yoki Telegram’ga ulanib bo‘lmadi'; return; }
  TG.username = me.result.username; TG.ok = true; TG.error = '';
  tg('setMyCommands', { commands: [{ command: 'start', description: 'Yordam' }, { command: 'hisobot', description: 'Bugungi davomat' }, { command: 'ulash', description: 'Rahbar: Room’ni ulash' }, { command: 'men', description: 'Xodim: hisobimni ulash' }] });
  if (PUBLIC_URL.startsWith('https://')) {
    const w = await tg('setWebhook', { url: `${PUBLIC_URL}/tg/${TG_SECRET}`, secret_token: TG_SECRET, allowed_updates: ['message', 'callback_query', 'channel_post'], drop_pending_updates: false });
    if (w && w.ok) { TG.mode = 'webhook'; console.log('Telegram webhook:', PUBLIC_URL); return; }
    console.error('Webhook o‘rnatilmadi, polling’ga o‘tildi');
  }
  await tg('deleteWebhook', {}); TG.mode = 'polling'; tgPoll();
}
function tgSend(r, text, extra = {}) { if (r.telegramChatId) tg('sendMessage', { chat_id: r.telegramChatId, text, parse_mode: 'HTML', ...extra }); }
function attendanceText(r) {
  const { date } = nowTZ();
  const ins = r.attendance.filter((a) => a.date === date && a.type === 'in');
  const came = new Set(ins.map((a) => a.empId));
  const absent = r.employees.filter((e) => !came.has(e.id));
  const late = ins.filter((a) => a.status === 'kechikdi');
  return `📊 <b>${esc(r.company)}</b> — ${date}\n` +
    `✅ Keldi: ${came.size}/${r.employees.length}\n` +
    (late.length ? `⏰ Kechikdi: ${late.map((a) => `${esc(a.name)} (${a.time})`).join(', ')}\n` : '') +
    (absent.length ? `❌ Kelmadi: ${absent.map((e) => esc(e.name)).join(', ')}` : '🎉 Hamma joyida!');
}
async function tgPoll() {
  if (!TG_TOKEN || TG.mode !== 'polling') return;
  const j = await tg('getUpdates', { offset: db.tgOffset || 0, timeout: 25 });
  if (j && j.ok) {
    TG.ok = true; TG.error = '';
    for (const u of j.result) { db.tgOffset = u.update_id + 1; TG.lastUpdate = Date.now(); try { await processUpdate(u); } catch (e) { console.error('TG update:', e.message); } }
    save();
  } else if (j && j.error_code === 409) TG.error = 'Boshqa server ham shu bot bilan ishlayapti (eski Render servisini o‘chiring yoki boshqa token oling)';
  setTimeout(tgPoll, j && j.ok ? 300 : 8000);
}
async function processUpdate(u) {
  if (u.callback_query) return handleCallback(u.callback_query);
  {
    {
      const msg = u.message || u.channel_post; if (!msg || !msg.text) return;
      const [cmd, code, secret] = msg.text.trim().split(/\s+/);
      const c = cmd.split('@')[0];
      if (c === '/start' || c === '/help') {
        tg('sendMessage', { chat_id: msg.chat.id, parse_mode: 'HTML', text: '👋 <b>WORKROOM AI</b> botiga xush kelibsiz!\n\n<b>Rahbar:</b> saytda Sozlamalar → Telegram bo‘limidagi <code>/ulash UZ… …</code> buyrug‘ini shu yerga (yoki guruhga) yuboring — davomat, AI Assistant va kun xulosasi keladi.\n\n<b>Xodim:</b> saytdagi bosh sahifangizda <code>/men UZ… …</code> buyrug‘i bor — uni yuboring, vazifa va e’lonlar sizga keladi.\n\n/hisobot — bugungi davomat' });
      } else if (c === '/ulash') {
        const r = roomOf(code);
        if (r && safeEq(secret, r.linkSecret)) { r.telegramChatId = msg.chat.id; tg('sendMessage', { chat_id: msg.chat.id, text: `✅ ${r.company} ulandi. Kim keldi/kelmadi shu yerga keladi.` }); emit(r, 'settings', roomView(r)); }
        else tg('sendMessage', { chat_id: msg.chat.id, text: '❌ Kod yoki maxfiy so‘z noto‘g‘ri.' });
      } else if (c === '/men') {
        const r = roomOf(code);
        const e = r && secret && secret.length >= 8 && r.employees.find((x) => !x.pending && x.empKey && safeEq(x.empKey.slice(0, 8), secret));
        if (e) { e.tgChatId = msg.chat.id; save(); tg('sendMessage', { chat_id: msg.chat.id, text: `✅ ${e.name}, ulandingiz! Vazifalar, e’lonlar va o‘rinbosarlik xabarlari shu yerga keladi.` }); emit(r, 'employees', r.employees.map(publicEmp)); }
        else tg('sendMessage', { chat_id: msg.chat.id, text: '❌ Kod noto‘g‘ri. Saytda “Bosh sahifa” → Telegram bo‘limidagi buyruqni yuboring.' });
      } else if (c === '/hisobot') {
        const r = Object.values(db.rooms).find((x) => x.telegramChatId === msg.chat.id);
        tg('sendMessage', { chat_id: msg.chat.id, text: r ? attendanceText(r) : 'Avval /ulash qiling.', parse_mode: 'HTML' });
      } else if (msg.chat.type === 'private' && c.startsWith('/') === false) {
        tg('sendMessage', { chat_id: msg.chat.id, text: 'Buyruqlar: /start, /hisobot, /ulash, /men' });
      }
      save();
    }
  }
}
async function handleCallback(q) {
  const [kind, code, sid, act] = String(q.data || '').split(':');
  const r = roomOf(code); const ack = (text) => tg('answerCallbackQuery', { callback_query_id: q.id, text });
  if (!r) return ack('Room topilmadi');
  r.absences = r.absences || []; r.suggestions = r.suggestions || [];
  if (kind === 'sg') {
    if (q.message.chat.id !== r.telegramChatId) return ack('Faqat rahbar');
    const sg = r.suggestions.find((x) => x.id === sid);
    if (!sg || sg.status !== 'pending') return ack('Allaqachon hal qilingan');
    if (act === 'ok') approveSuggestion(r, sg); else { sg.status = 'rejected'; save(); emit(r, 'assistant', sg); }
    ack(act === 'ok' ? 'O‘tkazildi' : 'Bekor qilindi');
    tg('editMessageReplyMarkup', { chat_id: q.message.chat.id, message_id: q.message.message_id, reply_markup: { inline_keyboard: [] } });
  } else if (kind === 'ab') { // employee answers "why absent"
    const e = r.employees.find((x) => x.id === sid);
    if (!e || e.tgChatId !== q.message.chat.id) return ack('Ruxsat yo‘q');
    const reason = { kasal: 'kasal', tatil: 'ta’til', kech: 'kechikyapti', uzr: 'uzrli sabab' }[act] || 'uzrli sabab';
    const { date } = nowTZ();
    const ex = r.absences.find((a) => a.empId === e.id && a.date === date);
    if (ex) ex.reason = reason; else r.absences.push({ id: id(), empId: e.id, name: e.name, date, reason, ts: Date.now(), via: 'telegram' });
    const sg = r.suggestions.find((x) => x.empId === e.id && x.date === date && x.source === 'auto');
    if (sg) { sg.reason = reason; sg.text = sg.text.replace('kelmadi va xabar bermadi', `kelmadi — javobi: “${reason}”`); }
    save(); emit(r, 'assistant', sg || {}); ack('Rahmat, rahbarga yetkazildi');
    tg('editMessageText', { chat_id: q.message.chat.id, message_id: q.message.message_id, text: `Javobingiz: ${reason}. Rahbarga yetkazildi. ${reason === 'kasal' ? 'Tezroq sog‘ayib keting!' : ''}` });
    tgSend(r, `💬 <b>${esc(e.name)}</b> javob berdi: ${esc(reason)}`);
    pushEvent(r, 'absence', `${e.name} Telegram orqali javob berdi: ${reason}`);
  }
}

// AI Assistant avto-nazorat: ish boshlanib graceMin o'tgach, xabarsiz kelmaganlarni topadi
setInterval(() => {
  const { date, time } = nowTZ();
  for (const r of Object.values(db.rooms)) {
    r.absences = r.absences || []; r.suggestions = r.suggestions || [];
    if (r.autoCheck === date || toMin(time) < toMin(r.workStart) + (r.graceMin || 15)) continue;
    if (toMin(time) > toMin(r.workEnd)) continue;
    const came = new Set(r.attendance.filter((a) => a.date === date && a.type === 'in').map((a) => a.empId));
    // Bugun hech kim belgilanmagan bo'lsa (dam olish kuni yoki kiosk hali ishlatilmayapti) — yolg'on signal bermaymiz
    if (!came.size) { if (toMin(time) > toMin(r.workStart) + 180) r.autoCheck = date; continue; }
    r.autoCheck = date;
    const away = new Set(r.absences.filter((a) => a.date === date).map((a) => a.empId));
    const missing = r.employees.filter((e) => !e.isAdmin && !e.pending && (e.descriptors || []).length && !came.has(e.id) && !away.has(e.id));
    const missIds = new Set(missing.map((e) => e.id));
    for (const e of missing) {
      makeSuggestion(r, e, 'xabarsiz kelmadi', 'auto', missIds);
      if (e.tgChatId) tg('sendMessage', { chat_id: e.tgChatId, text: `Assalomu alaykum, ${e.name}! Bugun ishda belgilanmadingiz. Sababini tanlang — rahbaringizga yetkazaman:`, reply_markup: { inline_keyboard: [[{ text: '🤒 Kasalman', callback_data: `ab:${r.code}:${e.id}:kasal` }, { text: '⏰ Kechikyapman', callback_data: `ab:${r.code}:${e.id}:kech` }], [{ text: '🏖 Ta’tildaman', callback_data: `ab:${r.code}:${e.id}:tatil` }, { text: '📝 Uzrli sabab', callback_data: `ab:${r.code}:${e.id}:uzr` }]] } });
    }
    pushEvent(r, 'absence', `AI Assistant davomatni tekshirdi`);
    save();
  }
}, 60 * 1000);

// Kun oxirida AI xulosa Telegram'ga
setInterval(async () => {
  const { date, time } = nowTZ();
  for (const r of Object.values(db.rooms)) {
    if (!r.telegramChatId || r.lastBrief === date || toMin(time) < toMin(r.workEnd)) continue;
    r.lastBrief = date; save();
    if (!r.attendance.some((x) => x.date === date)) continue; // dam olish kuni — xulosa yuborilmaydi
    tgSend(r, esc(await makeBrief(r)));
  }
}, 5 * 60 * 1000);

// Daily auto-report: 30 min after work start → who did not come
setInterval(() => {
  const { date, time } = nowTZ();
  for (const r of Object.values(db.rooms)) {
    if (!r.telegramChatId || r.lastReport === date) continue;
    if (toMin(time) >= toMin(r.workStart) + 30) { r.lastReport = date; save(); if (r.attendance.some((x) => x.date === date)) tgSend(r, attendanceText(r)); }
  }
}, 60 * 1000);

// STUN/TURN for video meetings (TURN kerak bo'ladi: mobil internet / qattiq NAT orqasida)
app.get('/api/ice', (_, res) => {
  const ice = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  if (process.env.TURN_URL) ice.push({ urls: process.env.TURN_URL.split(','), username: process.env.TURN_USER, credential: process.env.TURN_PASS });
  res.json({ iceServers: ice });
});

app.get('/healthz', (_, res) => res.json({ ok: true, uptime: Math.round(process.uptime()), gemini: GEMINI_API_KEY ? (AI.ok === false ? 'xato' : 'ok') : 'yo‘q', telegram: TG_TOKEN ? TG.mode : 'yo‘q' }));
// Rahbar uchun tizim holati: Gemini va Telegram'ni jonli tekshiradi, xato matnini ko'rsatadi
app.post('/api/rooms/:code/diag', limit('diag', 10, 600000), async (req, res, next) => {
  try {
    const r = getRoom(req, res); if (!r || !requireAdmin(req, res, r)) return;
    const out = { gemini: { configured: !!GEMINI_API_KEY }, telegram: { configured: !!TG_TOKEN }, storage: { dir: DATA_DIR, persistent: !!process.env.DATA_DIR }, url: PUBLIC_URL };
    if (GEMINI_API_KEY) {
      try { const t = await geminiCall({ contents: [{ role: 'user', parts: [{ text: 'Faqat "OK" deb javob ber.' }] }] }, false); out.gemini = { configured: true, ok: true, model: AI.model, reply: t.slice(0, 40) }; }
      catch (e) { out.gemini = { configured: true, ok: false, model: AI.model, error: e.message }; }
    }
    if (TG_TOKEN) {
      const me = await tg('getMe', {}); const wh = await tg('getWebhookInfo', {});
      out.telegram = { configured: true, ok: !!(me && me.ok), username: me && me.ok ? me.result.username : '', mode: TG.mode, linked: !!r.telegramChatId, error: TG.error || (me && !me.ok ? me.description : ''), webhookError: wh && wh.ok && wh.result.last_error_message ? wh.result.last_error_message : '', pending: wh && wh.ok ? wh.result.pending_update_count : 0 };
    }
    res.json(out);
  } catch (e) { next(e); }
});
app.get('/room/:code', (_, res) => { res.set('Cache-Control', 'no-cache'); res.sendFile(path.join(__dirname, 'public', 'app.html')); });
app.get('/admin', (_, res) => { res.set('Cache-Control', 'no-cache'); res.sendFile(path.join(__dirname, 'public', 'admin.html')); });

// 404 va xatolar — JSON, ichki tafsilotlarsiz
app.use('/api/', (req, res) => res.status(404).json({ error: 'Topilmadi' }));
app.use((req, res) => res.status(404).sendFile(path.join(__dirname, 'public', 'index.html')));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Fayl yoki so‘rov juda katta' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Noto‘g‘ri so‘rov' });
  console.error('Server xatosi:', err);
  res.status(500).json({ error: 'Serverda xatolik. Birozdan so‘ng urinib ko‘ring.' });
});
process.on('unhandledRejection', (e) => console.error('unhandledRejection:', e));
process.on('uncaughtException', (e) => { console.error('uncaughtException:', e); });
const shutdown = () => { console.log('To‘xtatilmoqda — ma’lumotlar saqlanmoqda…'); clearTimeout(saveTimer); saveNow(); process.exit(0); };
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);

server.listen(PORT, () => {
  console.log(`WORKROOM AI: http://localhost:${PORT}  | Gemini: ${GEMINI_API_KEY ? 'ON' : 'OFF'} | Telegram: ${TG_TOKEN ? 'ON' : 'OFF'}`);
  if (TG_TOKEN) tgStart().catch((e) => { TG.ok = false; TG.error = e.message; console.error('Telegram:', e.message); });
  if (GEMINI_API_KEY) resolveModel().then((m) => console.log('Gemini modeli:', m)).catch((e) => { AI.ok = false; AI.error = e.message; console.error('Gemini:', e.message); });
  backup();
});
