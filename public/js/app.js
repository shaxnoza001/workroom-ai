// WORKROOM AI — Room app (admin panel + employee view)
const { $, $$, api, toast, esc, avatar, money, session, setSession, ic } = WR;
const CODE = location.pathname.split('/').pop().toUpperCase().replace('#', '');
const S = { room: null, admin: false, me: null, tasks: [], att: [], view: 'home', stream: null, abort: null, cleanup: null };
const socket = io();

// Admin link from another device: /room/UZ1234#admin=KEY
(function importKeys() {
  const m = location.hash.match(/admin=([a-f0-9]+)/), e = location.hash.match(/emp=([a-f0-9]+)/);
  if (m) setSession(CODE, { adminKey: m[1] });
  if (e) setSession(CODE, { empKey: e[1], adminKey: undefined });
  if (m || e) history.replaceState(null, '', location.pathname);
})();
const joinRoom = () => { const s = session(CODE); socket.emit('room:join', { code: CODE, key: s.adminKey || s.empKey }); };

const MENU_ADMIN = [
  ['home', 'home', 'Boshqaruv'], ['kiosk', 'scan', 'Face ID'], ['meetings', 'video', 'Majlislar'], ['mentor', 'brain', 'AI Mentor'],
  ['tasks', 'check', 'Vazifalar'], ['people', 'users', 'Xodimlar'], ['kpi', 'wallet', 'KPI & Maosh'], ['kb', 'book', 'Bilim bazasi'], ['settings', 'settings', 'Sozlamalar'],
];
const MENU_EMP = [['home', 'home', 'Bosh sahifa'], ['kiosk', 'scan', 'Face ID'], ['mentor', 'brain', 'AI Mentor'], ['meetings', 'video', 'Majlislar'], ['tasks', 'check', 'Vazifalarim']];

async function boot() {
  try {
    const j = await api('/api/rooms/' + CODE, {}, CODE);
    S.room = j.room; S.admin = j.admin; S.linkCommand = j.linkCommand; S.myLink = j.myLink;
    if (j.pending) return pendingScreen(j);
    S.me = (S.room.employees || []).find((e) => e.id === j.me) || null;
  } catch (e) {
    if (/topilmadi/i.test(e.message)) { WR.store.del('wr:' + CODE); if (WR.store.get('wr:last') === CODE) WR.store.del('wr:last'); }
    $('#view').innerHTML = `<div class="card center" style="max-width:460px;margin:60px auto"><h2>Room topilmadi</h2><p class="muted">${esc(e.message)}</p><a class="btn" style="margin-top:14px" href="/#join">Bosh sahifa</a></div>`;
    return;
  }
  if (!S.admin && !S.me) { location.href = '/#join'; return; }
  joinRoom();
  $('#room-name').textContent = S.room.company;
  $('#room-code').textContent = '#' + CODE;
  $('#me-name').textContent = (S.me ? S.me.name : 'Admin') + (S.admin ? ' · admin' : '');
  const menu = S.admin ? MENU_ADMIN : MENU_EMP;
  $('#menu').innerHTML = menu.map(([v, i, t]) => `<button data-v="${v}">${ic(i)} ${t}</button>`).join('');
  const bn = S.admin ? menu.filter((m) => ['home', 'kiosk', 'meetings', 'mentor', 'tasks', 'people'].includes(m[0])) : menu;
  $('#bnav').innerHTML = bn.map(([v, i, t]) => `<button data-v="${v}">${ic(i, 'lg')}${t.split(' ')[0] === 'AI' ? 'Mentor' : t.split(' ')[0]}</button>`).join('');
  $$('[data-v]').forEach((b) => (b.onclick = () => go(b.dataset.v)));
  await loadTasks();
  Offline.sync(true);
  const m = location.hash.match(/meet=([a-f0-9]+)/);
  go(m ? 'live' : 'home', m ? m[1] : undefined);
}

async function pendingScreen(j) {
  $('.side').classList.add('hidden'); $('.shell').style.gridTemplateColumns = 'minmax(0,1fr)';
  joinRoom();
  $('#view').innerHTML = `<div class="card center" style="max-width:520px;margin:50px auto">
    <div style="color:var(--warn)">${ic('clock', 'xl')}</div><h2 style="margin-top:8px">Rahbar tasdiqlashini kuting</h2>
    <p class="muted" style="margin-top:8px">${esc(j.room.company)} rahbariga so‘rovingiz yuborildi. Tasdiqlanishi bilan bu sahifa o‘zi ochiladi.</p>
    ${j.hasFace ? `<p class="small" style="margin-top:14px;color:var(--mint)">${ic('check')} Yuzingiz ro‘yxatga olingan</p>` : `<div style="margin-top:18px"><div class="cam"><video id="p-video"></video><canvas id="p-canvas"></canvas><div class="ring"></div><div class="scan-line"></div><div class="msg" id="p-msg">Yuzingizni hozirdan skaner qilib qo‘ying</div></div><div class="progress" style="margin-top:10px"><i id="p-prog" style="width:0"></i></div><button class="btn" style="margin-top:12px" id="p-go">${ic('scan')} Skaner qilish</button></div>`}
    <a class="btn ghost sm" style="margin-top:18px" href="/">Bosh sahifa</a></div>`;
  const b = $('#p-go'); if (!b) return;
  b.onclick = async () => {
    b.disabled = true;
    try {
      await Face.load(); const st = await Face.startCam($('#p-video'));
      const res = await Face.enroll($('#p-video'), $('#p-canvas'), { onStatus: (m) => ($('#p-msg').textContent = m), onProgress: (x) => ($('#p-prog').style.width = x * 100 + '%') });
      await api(`/api/rooms/${CODE}/employees/${j.me}/face`, { method: 'PUT', body: res }, CODE);
      Face.stopCam(st); toast('Face ID saqlandi'); pendingScreen({ ...j, hasFace: true });
    } catch (e) { toast(e.message); b.disabled = false; }
  };
}

function go(v, arg) {
  if (S.cleanup) { try { S.cleanup(); } catch (_) {} S.cleanup = null; }
  S.view = v;
  $$('[data-v]').forEach((b) => b.classList.toggle('on', b.dataset.v === v || (v === 'live' && b.dataset.v === 'meetings')));
  window.scrollTo(0, 0);
  ({ home, kiosk, people, meetings, tasks, kpi, settings, mentor, kb, offline: (t) => Offline.open(t), live: (id) => Meeting.open(id), meeting: meetingDetail })[v](arg);
}
const emp = (id) => S.room.employees.find((e) => e.id === id);
async function loadTasks() { S.tasks = (await api(`/api/rooms/${CODE}/tasks`, {}, CODE)).tasks; }
async function loadAtt(from, to) { return (await api(`/api/rooms/${CODE}/attendance?from=${from || ''}&to=${to || ''}`, {}, CODE)).attendance; }
const statusBadge = (s) => `<span class="badge ${{ keldi: 'ok', kechikdi: 'warn', ketdi: '', 'erta ketdi': 'bad', kelmadi: 'bad', kasal: 'bad', 'ta’til': 'warn', uzrli: 'warn' }[s] || ''}">${esc(s)}</span>`;

// ---------- HOME ----------
async function home() {
  const att = await loadAtt();
  S.att = att;
  const ins = att.filter((a) => a.type === 'in');
  const came = new Set(ins.map((a) => a.empId));
  const late = ins.filter((a) => a.status === 'kechikdi');
  const myTasks = S.tasks.filter((t) => S.admin || t.assigneeId === (S.me && S.me.id));
  const open = myTasks.filter((t) => t.status !== 'bajarildi');
  const hello = S.me ? S.me.name.split(' ')[0] : 'Rahbar';
  const dateStr = WR.uzDate();
  if (!S.admin) {
    const mine = att.filter((a) => a.empId === S.me.id);
    const inRec = mine.find((a) => a.type === 'in'), outRec = mine.find((a) => a.type === 'out');
    $('#view').innerHTML = `
      <div class="top"><div><h1>Salom, ${esc(hello)}</h1><div class="sub">${esc(dateStr)} · ${esc(S.room.company)}</div></div></div>
      ${S.me.hasFace ? '' : `<div class="card assist" style="margin-bottom:16px"><div class="row"><div class="grow"><b>Yuzingiz hali ro‘yxatda emas</b><div class="small muted">Davomat Face ID orqali olinadi — 20 soniya.</div></div><button class="btn ok" onclick="enrollModal(S.me.id)">${ic('scan')} Yuzimni skaner qilish</button></div></div>`}
      <div class="grid g3 stats">
        <div class="card stat"><div class="l">${ic('clock')} Bugun keldim</div><div class="n">${inRec ? inRec.time : '—'}</div>${inRec ? statusBadge(inRec.status) : '<span class="badge ghost">belgilanmagan</span>'}</div>
        <div class="card stat"><div class="l">${ic('logout')} Ketdim</div><div class="n">${outRec ? outRec.time : '—'}</div></div>
        <div class="card stat"><div class="l">${ic('check')} Ochiq vazifalar</div><div class="n">${open.length}</div></div>
      </div>
      <div class="row" style="margin:18px 0"><button class="btn" onclick="go('kiosk')">${ic('scan')} Face ID bilan belgilash</button><button class="btn sec" onclick="go('mentor')">${ic('brain')} AI Mentor’dan so‘rash</button><button class="btn ghost" onclick="absenceModal(S.me.id)">${ic('sick')} Bugun kela olmayman</button></div>
      <div class="grid g2"><div class="card"><h3 style="margin-bottom:6px">Vazifalarim</h3>${open.length ? open.map(taskLine).join('') : empty('check', 'Ochiq vazifa yo‘q')}</div>
      <div><div class="card"><h3>E’lonlar</h3><div id="posts"></div></div>
      ${S.me.tg ? '' : `<div class="card" style="margin-top:16px"><h3 style="display:flex;gap:8px;align-items:center">${ic('telegram')} Telegram’ni ulang</h3><p class="small muted" style="margin-top:6px">Vazifa, e’lon va o‘rinbosarlik xabarlari Telegram’ga keladi; kelolmasangiz bot sababini so‘raydi. Kompaniya botiga yuboring:</p><div class="code-big" style="font-size:16px;letter-spacing:1px">${esc(S.myLink || '')}</div></div>`}</div></div>`;
    loadPosts();
    return;
  }
  let as = { suggestions: [], absences: [] };
  try { as = await api(`/api/rooms/${CODE}/assistant`, {}, CODE); } catch (_) {}
  const away = new Map(as.absences.map((a) => [a.empId, a]));
  const absent = S.room.employees.filter((e) => !came.has(e.id) && !e.pending);
  const pendN = S.room.employees.filter((e) => e.pending).length;
  const noFace = S.room.employees.filter((e) => !e.hasFace && !e.pending);
  const n = S.room.employees.length || 1;
  const pct = (x) => Math.round((x / n) * 100);
  $('#view').innerHTML = `
    <div class="top"><div><h1>Boshqaruv paneli</h1><div class="sub">${esc(dateStr)} · ish vaqti ${S.room.workStart}–${S.room.workEnd}</div></div><div class="row"><button class="btn sec" onclick="briefModal()">${ic('spark')} AI kun xulosasi</button><button class="btn sec" onclick="go('kiosk')">${ic('scan')} Face ID kiosk</button><button class="btn" onclick="go('meetings')">${ic('video')} Majlis</button></div></div>
    <div class="grid g4 stats">
      <div class="card stat"><div class="l">${ic('check')} Keldi</div><div class="n" style="color:var(--mint)">${came.size}<span class="muted small"> / ${S.room.employees.length}</span></div><div class="bar"><i style="width:${pct(came.size)}%;background:var(--mint)"></i></div></div>
      <div class="card stat"><div class="l">${ic('clock')} Kechikdi</div><div class="n" style="color:var(--warn)">${late.length}</div><div class="bar"><i style="width:${pct(late.length)}%;background:var(--warn)"></i></div></div>
      <div class="card stat"><div class="l">${ic('alert')} Kelmadi</div><div class="n" style="color:var(--bad)">${absent.length}</div><div class="bar"><i style="width:${pct(absent.length)}%;background:var(--bad)"></i></div></div>
      <div class="card stat"><div class="l">${ic('zap')} Ochiq vazifalar</div><div class="n">${open.length}</div><div class="bar"><i style="width:${Math.min(100, open.length * 8)}%;background:var(--acc)"></i></div></div>
    </div>
    <div class="card assist" style="margin-top:16px"><div class="row between"><h3 style="display:flex;gap:8px;align-items:center">${ic('spark')} AI Assistant</h3><div class="row"><span class="badge ${as.autopilot ? 'ok' : 'ghost'}" title="Sozlamalar → Avtopilot">${as.autopilot ? 'Avtopilot yoqilgan' : 'Tasdiq bilan'}</span><span class="badge">${as.suggestions.length + (noFace.length ? 1 : 0)} ta bildirishnoma</span></div></div>
      ${!as.suggestions.length && !noFace.length && !(as.subs || []).length ? `<p class="small muted" style="margin-top:8px">Hammasi joyida. Kimdir ${S.room.graceMin} daqiqadan ortiq xabarsiz kelmasa, AI o‘rinbosar topib shu yerda taklif qiladi.</p>` : ''}
      ${(as.subs || []).map((g) => `<div class="sg"><div class="ic" style="background:var(--mint-soft);color:var(--mint)">${ic('check')}</div><div class="grow"><b>Bugun ${esc(g.name)} o‘rniga — ${esc(g.toName)}</b><div class="small muted">${esc(g.reason)}${g.auto ? ' · avtopilot' : ''}</div></div></div>`).join('')}
      ${as.suggestions.map(sgHtml).join('')}
      ${pendN ? `<div class="sg"><div class="ic">${ic('users')}</div><div class="grow"><b>${pendN} kishi Room’ga qo‘shilishni so‘ramoqda</b><div class="small muted">Tasdiqlamaguningizcha ular hech narsani ko‘ra olmaydi</div></div><button class="btn sm" onclick="go('people')">Ko‘rish</button></div>` : ''}
      ${noFace.length ? `<div class="sg"><div class="ic">${ic('scan')}</div><div class="grow"><b>${noFace.length} xodim hali Face ID’dan o‘tmagan</b><div class="small muted">${noFace.map((e) => esc(e.name)).join(', ')}</div></div><button class="btn sm" onclick="bulkEnroll()">Skaner qilish</button></div>` : ''}
    </div>
    <div class="grid g2" style="margin-top:16px">
      <div class="card"><div class="row between"><h3>Bugungi davomat</h3><span class="badge ok"><span class="dot"></span> jonli</span></div><div id="feed">${att.slice().reverse().map(attLine).join('') || empty('scan', 'Hali hech kim belgilanmadi. Ofisdagi planshet yoki noutbukda Face ID kioskni oching.')}</div></div>
      <div class="card"><h3>Kelmaganlar</h3>${absent.map((e) => { const a = away.get(e.id); return `<div class="list-item">${avatar(e)}<div class="grow">${esc(e.name)}<div class="small muted">${esc(e.role)}</div></div>${a ? statusBadge(a.reason) : `${statusBadge('kelmadi')}<button class="icon-btn" title="Kasal / ta’til deb belgilash" onclick="absenceModal('${e.id}')">${ic('sick')}</button>`}</div>`; }).join('') || empty('check', 'Hamma joyida')}
      <h3 style="margin-top:20px">So‘nggi vazifalar</h3>${open.slice(-5).reverse().map(taskLine).join('') || empty('check', 'Yo‘q')}</div>
    </div>
    <div class="card" style="margin-top:16px"><div class="row between"><h3>E’lonlar</h3><span class="small muted">Xodimlarga sayt va Telegram orqali boradi</span></div>
      <form class="row" style="margin-top:10px;flex-wrap:nowrap" onsubmit="event.preventDefault();addPost()"><input id="post-t" placeholder="Masalan: Ertaga soat 10:00 da umumiy majlis"><button class="btn">${ic('send')}</button></form><div id="posts" style="margin-top:6px"></div></div>`;
  loadPosts();
}
async function loadPosts() {
  try { const j = await api(`/api/rooms/${CODE}/posts`, {}, CODE); const el = $('#posts'); if (!el) return;
    el.innerHTML = j.posts.map((p) => `<div class="post row" style="flex-wrap:nowrap;align-items:flex-start"><div class="grow"><div style="white-space:pre-wrap">${esc(p.text)}</div><div class="small muted">${esc(p.by || '')} · ${WR.uzDate(p.ts, true)}</div></div>${S.admin ? `<button class="icon-btn" onclick="delPost('${p.id}')">${ic('trash')}</button>` : ''}</div>`).join('') || `<p class="small muted" style="margin-top:6px">E’lon yo‘q</p>`;
  } catch (_) {}
}
async function addPost() { const t = $('#post-t').value.trim(); if (!t) return; try { await api(`/api/rooms/${CODE}/posts`, { method: 'POST', body: { text: t } }, CODE); $('#post-t').value = ''; loadPosts(); toast('E’lon yuborildi'); } catch (e) { toast(e.message); } }
async function delPost(id) { await api(`/api/rooms/${CODE}/posts/${id}`, { method: 'DELETE' }, CODE); loadPosts(); }
async function briefModal() {
  modal(`<div class="row between"><h2 style="display:flex;gap:8px;align-items:center">${ic('spark', 'lg')} AI kun xulosasi</h2><button class="icon-btn" onclick="closeModal()">${ic('x')}</button></div><div id="brief" style="margin-top:14px"><div class="typing"><span></span><span></span><span></span></div></div>`);
  try { const j = await api(`/api/rooms/${CODE}/brief`, {}, CODE); $('#brief').innerHTML = `<div style="white-space:pre-wrap;line-height:1.65">${esc(j.text)}</div><p class="small muted" style="margin-top:12px">${j.ai ? 'Gemini tomonidan tayyorlandi' : 'Shablon (Gemini kaliti qo‘shilsa — AI tahlili)'} · ish tugaganda Telegram’ga avtomatik yuboriladi.</p><button class="btn sec" style="margin-top:12px" onclick="navigator.clipboard.writeText($('#brief div').textContent).then(()=>toast('Nusxalandi'))">${ic('link')} Nusxalash</button>`; }
  catch (e) { $('#brief').textContent = e.message; }
}
const empty = (i, t) => `<div class="empty">${ic(i)}<div>${esc(t)}</div></div>`;
function sgHtml(g) {
  return `<div class="sg" id="sg-${g.id}"><div class="ic">${ic(g.type === 'reassign' ? 'users' : 'bell')}</div><div class="grow"><b>“${esc(g.text)}”</b>${g.why ? `<div class="small muted">${esc(g.why)}</div>` : ''}
    <div class="row" style="margin-top:10px">${g.type === 'reassign' ? `<button class="btn ok sm" onclick="sgAct('${g.id}','approve')">Ha, o‘tkaz</button><select class="sm" style="width:auto;padding:6px 10px;font-size:13px" onchange="sgAct('${g.id}','approve',this.value)"><option value="">Boshqa xodim…</option>${S.room.employees.filter((e) => e.id !== g.empId).map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join('')}</select>` : ''}<button class="btn ghost sm" onclick="sgAct('${g.id}','reject')">${g.type === 'reassign' ? 'Yo‘q' : 'Tushunarli'}</button></div></div></div>`;
}
async function sgAct(id, action, toId) {
  if (toId === '') return;
  try { const j = await api(`/api/rooms/${CODE}/assistant/${id}`, { method: 'POST', body: { action, toId } }, CODE); await loadTasks(); toast(action === 'approve' && j.suggestion.toName ? `Vazifalar ${j.suggestion.toName}ga o‘tkazildi` : 'Yopildi'); home(); }
  catch (e) { toast(e.message); }
}
function absenceModal(empId) {
  const e = emp(empId);
  modal(`<h2>${S.admin && (!S.me || S.me.id !== empId) ? esc(e.name) + ' bugun kela olmaydi' : 'Bugun kela olmayman'}</h2><p class="muted small" style="margin-top:6px">AI Assistant ochiq vazifalarni kimga o‘tkazishni hisoblab, rahbarga 1-click taklif yuboradi.</p>
    <label>Sabab</label><div class="row">${['kasal', 'ta’til', 'uzrli'].map((r, i) => `<label style="margin:0;display:flex;gap:6px;align-items:center;color:var(--text)"><input type="radio" name="rs" value="${r}" ${i ? '' : 'checked'} style="width:auto"> ${r}</label>`).join('')}</div>
    <div class="row" style="margin-top:20px;justify-content:flex-end"><button class="btn sec" onclick="closeModal()">Bekor</button><button class="btn" onclick="sendAbsence('${empId}')">Yuborish</button></div>`);
}
async function sendAbsence(empId) {
  const reason = ($('input[name=rs]:checked') || {}).value || 'kasal';
  try { const j = await api(`/api/rooms/${CODE}/absence`, { method: 'POST', body: { empId, reason } }, CODE); closeModal(); toast(S.admin ? 'AI Assistant taklif tayyorladi' : 'Rahbarga yuborildi. Tuzalib keting!'); go('home'); }
  catch (e) { toast(e.message); }
}
function attLine(a) {
  const e = emp(a.empId) || { name: a.name };
  return `<div class="list-item" data-a="${a.id}">${avatar(e)}<div class="grow">${esc(a.name)}<div class="small muted">${a.type === 'in' ? 'Keldi' : 'Ketdi'} · ${a.time}${a.lateMin ? ` · ${a.lateMin} daq kechikish` : ''}</div></div>${statusBadge(a.status)}${S.admin ? `<button class="icon-btn" title="Noto‘g‘ri yozuvni o‘chirish" onclick="delAtt('${a.id}')">${ic('trash')}</button>` : ''}</div>`;
}
async function delAtt(id) {
  if (!confirm('Bu davomat yozuvi o‘chirilsinmi?')) return;
  try { await api(`/api/rooms/${CODE}/attendance/${id}`, { method: 'DELETE' }, CODE); document.querySelectorAll(`[data-a="${id}"]`).forEach((x) => x.remove()); toast('O‘chirildi'); } catch (e) { toast(e.message); }
}
function taskLine(t) {
  return `<div class="list-item"><div class="grow"><b>${esc(t.title)}</b><div class="small muted">${ic('users')} ${esc(t.assigneeName || '—')}${t.deadline ? ' · ' + ic('calendar') + ' ' + esc(t.deadline) : ''}</div></div><span class="badge ${t.status === 'bajarildi' ? 'ok' : t.status === 'jarayonda' ? 'warn' : ''}">${t.status}</span></div>`;
}

// ---------- FACE ID KIOSK ----------
async function kiosk() {
  let mode = 'auto';
  const live = S.room.liveness !== false;
  $('#view').innerHTML = `
    <div class="kiosk">
      <div class="top"><div><h1>Face ID davomat</h1><div class="sub">${S.admin ? 'Ofis kirishidagi qurilma. Har bir xodim kameraga qaraydi.' : 'Kameraga qarang — o‘zingizni belgilaysiz.'}</div></div><div class="clock" id="clock"></div></div>
      <div class="seg" id="k-mode">${[['auto', 'Avto'], ['in', 'Keldim'], ['out', 'Ketdim']].map(([k, t]) => `<button data-m="${k}" class="${k === mode ? 'on' : ''}">${t}</button>`).join('')}</div>
      <div class="cam kcam"><video id="k-video"></video><canvas id="k-canvas"></canvas><div class="ring" id="k-ring"></div><div class="scan-line"></div>
        <div class="kres hidden" id="k-res"></div><div class="msg" id="k-msg">Face ID yuklanmoqda…</div></div>
      <p class="small muted center" style="margin-top:10px">${live ? 'Xavfsizlik: tanishdan oldin boshingizni sekin yon tomonga burasiz — rasm yoki telefon ekrani o‘tmaydi.' : 'Tirik yuz tekshiruvi o‘chirilgan (Sozlamalar).'} “Avto”: birinchi qarash — keldi, 3 soatdan keyin — ketdi.</p>
      ${S.admin ? '<div class="card" style="margin-top:14px"><h3>Oxirgi belgilanganlar</h3><div id="k-log"></div></div>' : ''}
    </div>`;
  $$('#k-mode button').forEach((b) => (b.onclick = () => { mode = b.dataset.m; $$('#k-mode button').forEach((x) => x.classList.toggle('on', x === b)); }));
  const clock = setInterval(() => { const c = $('#clock'); if (c) c.textContent = new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Tashkent', hour: '2-digit', minute: '2-digit' }); }, 1000);
  let alive = true, busy = false, cooldown = 0, streak = 0;
  const ab = new AbortController();
  let wake = null; try { wake = await navigator.wakeLock.request('screen'); } catch (_) {}
  const reWake = async () => { if (document.visibilityState === 'visible' && alive) try { wake = await navigator.wakeLock.request('screen'); } catch (_) {} };
  document.addEventListener('visibilitychange', reWake);
  S.cleanup = () => { alive = false; ab.abort(); clearInterval(clock); Face.stopCam(S.stream); document.removeEventListener('visibilitychange', reWake); if (wake) wake.release().catch(() => {}); };
  const msg = (t) => { const m = $('#k-msg'); if (m) m.textContent = t; };
  const show = (html, cls, ms = 3500) => {
    const r = $('#k-res'); if (!r) return;
    r.className = 'kres ' + cls; r.innerHTML = html; cooldown = Date.now() + ms;
    setTimeout(() => { const x = $('#k-res'); if (x) x.className = 'kres hidden'; }, ms - 200);
  };
  try { await Face.load(); if (!alive) return; S.stream = await Face.startCam($('#k-video')); if (!alive) return Face.stopCam(S.stream); }
  catch (e) { if (alive) msg(e.message); return; }
  msg('Kameraga qarang');
  $('.kcam').onclick = () => $('#k-video').play().catch(() => {});
  const video = $('#k-video'), canvas = $('#k-canvas');
  const loop = async () => {
    if (!alive) return;
    if (!busy && Date.now() > cooldown) {
      try {
        const det = await Face.detect(video, !live);
        if (!alive || !$('#k-msg')) return;
        const q = det && Face.quality(video, det);
        Face.draw(canvas, video, det, det ? (q ? 'bad' : null) : null);
        if (!det) { streak = 0; msg('Kameraga qarang'); }
        else if (q) { streak = 0; msg(q); }
        else if (++streak >= 2) {
          busy = true; streak = 0;
          let final = det;
          if (live) { final = await Face.liveness(video, canvas, { onStatus: msg, signal: ab.signal }); if (!alive) return; }
          if (!final || !final.descriptor) { msg('Tekshiruv o‘tmadi — qaytadan kameraga qarang'); busy = false; cooldown = Date.now() + 1200; setTimeout(loop, 150); return; }
          msg('Tekshirilmoqda…');
          const r = await api(`/api/rooms/${CODE}/checkin`, { method: 'POST', body: { descriptor: Array.from(final.descriptor), mode } }, CODE);
          if (!alive) return;
          if (!r.match) show(`<div class="kbig">${ic('alert', 'xl')}</div><b>${r.ambiguous ? 'Aniq tanilmadi' : 'Tanilmadi'}</b><span>${r.ambiguous ? 'Ikki xodimga o‘xshadi — yaqinroq, yorug‘ joyda qayta qarang' : 'Bu yuz Room’da ro‘yxatda yo‘q'}</span>`, 'bad', 2600);
          else if (r.notYou) show(`<div class="kbig">${ic('alert', 'xl')}</div><b>Bu siz emassiz</b><span>Bu yuz ${esc(r.employee.name)}ga tegishli</span>`, 'bad', 2600);
          else {
            const rec = r.record, e = r.employee;
            const title = r.repeat ? 'Allaqachon belgilangan' : rec.type === 'in' ? (rec.status === 'kechikdi' ? `Xush kelibsiz! ${rec.lateMin} daqiqa kechikdingiz` : 'Xush kelibsiz! O‘z vaqtida') : rec.status === 'erta ketdi' ? 'Erta ketish belgilandi' : 'Xayr, yaxshi dam oling!';
            show(`${avatar(e, 84)}<b>${esc(e.name)}</b><span class="badge ${r.repeat ? 'ghost' : rec.status === 'keldi' || rec.status === 'ketdi' ? 'ok' : 'warn'}">${esc(title)}</span><span class="muted">${rec.type === 'in' ? 'Keldi' : 'Ketdi'} · ${rec.time}${r.hint ? '<br>' + esc(r.hint) : ''}</span>`, r.repeat ? 'info' : 'ok', r.hint ? 5000 : 3500);
            if (!r.repeat) speak(rec.type === 'in' ? `Xush kelibsiz, ${e.name}` : `Xayr, ${e.name}`);
            if (S.admin && !r.repeat) { const l = $('#k-log'); if (l) { const o = l.querySelector(`[data-a="${rec.id}"]`); if (o) o.remove(); l.insertAdjacentHTML('afterbegin', attLine(rec)); } }
          }
          msg('Kameraga qarang'); busy = false;
        }
      } catch (e) { busy = false; msg(e.message); cooldown = Date.now() + 2000; }
    }
    setTimeout(() => requestAnimationFrame(loop), 90);
  };
  loop();
  if (S.admin) { const att = await loadAtt(); const l = $('#k-log'); if (l) l.innerHTML = att.slice(-6).reverse().map(attLine).join('') || '<p class="muted small">—</p>'; }
}
function speak(t) { try { if (!t) return; const u = new SpeechSynthesisUtterance(t); u.lang = 'uz-UZ'; u.rate = 1; speechSynthesis.speak(u); } catch (_) {} }

// ---------- PEOPLE ----------
function people() {
  const list = S.room.employees.filter((e) => !e.pending);
  const pend = S.room.employees.filter((e) => e.pending);
  $('#view').innerHTML = `
    ${pend.length ? `<div class="card assist" style="margin-bottom:16px"><h3>Qo‘shilish so‘rovlari (${pend.length})</h3>${pend.map((e) => `<div class="list-item">${avatar(e)}<div class="grow"><b>${esc(e.name)}</b><div class="small muted">${e.hasFace ? 'Face ID topshirgan' : 'Face ID hali yo‘q'} · ${WR.uzDate(e.createdAt, true)}</div></div><button class="btn ok sm" onclick="approveEmp('${e.id}')">Tasdiqlash</button><button class="btn ghost sm" onclick="delEmp('${e.id}')">Rad etish</button></div>`).join('')}</div>` : ''}
    <div class="top"><h1>Xodimlar <span class="muted small">(${list.length})</span></h1><div class="row"><button class="btn sec" onclick="bulkEnroll()">${ic('scan')} Hammani skaner qilish</button><button class="btn" onclick="addEmp()">${ic('plus')} Xodim</button></div></div>
    <div class="card table-wrap"><table><thead><tr><th></th><th>Ism</th><th>Lavozim</th><th>Maosh</th><th>Face ID</th><th></th></tr></thead><tbody>
    ${list.map((e) => `<tr><td>${avatar(e)}</td><td><b>${esc(e.name)}</b>${e.isAdmin ? ' <span class="badge">admin</span>' : ''}</td><td>${esc(e.role)}</td><td>${money(e.salary)}</td>
      <td>${e.hasFace ? '<span class="badge ok">✓ ro‘yxatda</span>' : '<span class="badge warn">yo‘q</span>'}</td>
      <td class="row" style="justify-content:flex-end;flex-wrap:nowrap">${e.isAdmin ? '' : `<button class="icon-btn" title="Shaxsiy kirish havolasi (xodimga yuboring)" onclick="inviteLink('${e.id}')">${ic('link')}</button>`}<button class="btn sm sec" onclick="enrollModal('${e.id}')">${ic('scan')} ${e.hasFace ? 'Qayta' : 'Skaner'}</button><button class="btn sm ghost" onclick="editEmp('${e.id}')">${ic('edit')}</button>${e.isAdmin ? '' : `<button class="btn sm ghost" onclick="delEmp('${e.id}')">${ic('trash')}</button>`}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="card" style="margin-top:16px"><h3>Xodimni telefon orqali taklif qilish</h3><p class="small muted">1-usul (eng xavfsiz): jadvaldagi havola tugmasi — xodimning shaxsiy havolasi, uni faqat o‘ziga yuboring. 2-usul: xodim ${esc(location.host)} → “Roomga kirish” → kod <b style="color:var(--mint)">#${CODE}</b> → siz uni shu yerda tasdiqlaysiz.</p>
    <button class="btn sm sec" style="margin-top:10px" onclick="navigator.clipboard.writeText('${location.origin}/#join').then(()=>toast('Nusxalandi'))">${ic('link')} Taklif havolasi</button></div>`;
}
function modal(html) { $('#modal-body').innerHTML = html; $('#modal').classList.remove('hidden'); }
function closeModal() { $('#modal').classList.add('hidden'); if (S.mAbort) S.mAbort.abort(); Face.stopCam(S.mStream); }
function addEmp() {
  modal(`<h2>Yangi xodim</h2><label>Ism Familiya</label><input id="e-name"><label>Lavozim</label><input id="e-role" placeholder="Xodim"><label>Oylik maosh (so‘m)</label><input id="e-sal" type="number">
  <div class="row" style="margin-top:16px;justify-content:flex-end"><button class="btn sec" onclick="closeModal()">Bekor</button><button class="btn" onclick="saveEmp(true)">Saqlash va yuzini skaner qilish</button></div>`);
}
async function saveEmp(scan) {
  try {
    const j = await api(`/api/rooms/${CODE}/employees`, { method: 'POST', body: { name: $('#e-name').value, role: $('#e-role').value || 'Xodim', salary: $('#e-sal').value } }, CODE);
    S.room.employees.push(j.employee); closeModal(); if (scan) enrollModal(j.employee.id); else people();
  } catch (e) { toast(e.message); }
}
function editEmp(id) {
  const e = emp(id);
  modal(`<h2>Tahrirlash</h2><label>Ism</label><input id="e-name" value="${esc(e.name)}"><label>Lavozim</label><input id="e-role" value="${esc(e.role)}"><label>Maosh</label><input id="e-sal" type="number" value="${e.salary}">
  <div class="row" style="margin-top:16px;justify-content:space-between">${e.hasFace ? `<button class="btn ghost sm" onclick="delFace('${id}')">${ic('trash')} Face ID’ni o‘chirish</button>` : '<span></span>'}<div class="row"><button class="btn sec" onclick="closeModal()">Bekor</button><button class="btn" onclick="updEmp('${id}')">Saqlash</button></div></div>`);
}
async function updEmp(id) {
  try { await api(`/api/rooms/${CODE}/employees/${id}`, { method: 'PATCH', body: { name: $('#e-name').value, role: $('#e-role').value, salary: $('#e-sal').value } }, CODE); closeModal(); await refreshRoom(); people(); }
  catch (e) { toast(e.message); }
}
async function approveEmp(id) { try { await api(`/api/rooms/${CODE}/employees/${id}/approve`, { method: 'POST' }, CODE); await refreshRoom(); people(); toast('Tasdiqlandi'); } catch (e) { toast(e.message); } }
async function inviteLink(id) {
  try {
    const j = await api(`/api/rooms/${CODE}/employees/${id}/invite`, {}, CODE); const url = location.origin + j.path;
    modal(`<h2>Shaxsiy kirish havolasi</h2><p class="small muted" style="margin-top:6px">Faqat ${esc(emp(id).name)}ga yuboring (Telegram shaxsiy xabarda). Bu havola uning parolidek.</p><input readonly id="inv-url" value="${esc(url)}" style="margin-top:12px" onclick="this.select()"><div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn sec" onclick="closeModal()">Yopish</button><button class="btn" onclick="navigator.clipboard.writeText($('#inv-url').value).then(()=>toast('Nusxalandi'))">${ic('link')} Nusxalash</button></div>`);
  } catch (e) { toast(e.message); }
}
async function delFace(id) { if (!confirm('Bu xodimning Face ID ma’lumoti o‘chirilsinmi? Keyin qayta skaner qilasiz.')) return; await api(`/api/rooms/${CODE}/employees/${id}/face`, { method: 'DELETE' }, CODE); closeModal(); await refreshRoom(); people(); toast('Face ID o‘chirildi — endi qayta skaner qiling'); }
async function delEmp(id) { if (!confirm('O‘chirilsinmi?')) return; await api(`/api/rooms/${CODE}/employees/${id}`, { method: 'DELETE' }, CODE); await refreshRoom(); people(); }
async function refreshRoom() { S.room = (await api('/api/rooms/' + CODE, {}, CODE)).room; if (S.me) S.me = emp(S.me.id); }

// Enrollment (single or queue)
async function enrollModal(id, queue) {
  const e = emp(id);
  modal(`<h2>Face ID: ${esc(e.name)}</h2>${queue ? `<p class="muted small">Navbat: ${queue.i + 1} / ${queue.list.length}</p>` : ''}
    <div class="cam" style="margin-top:10px"><video id="m-video"></video><canvas id="m-canvas"></canvas><div class="ring" id="m-ring"></div><div class="scan-line"></div><div class="msg" id="m-msg">Yuklanmoqda…</div></div>
    <div class="progress" style="margin-top:10px"><i id="m-prog" style="width:0"></i></div>
    <div class="row" style="margin-top:14px;justify-content:space-between"><button class="btn sec sm" onclick="closeModal()">Yopish</button>${queue ? '<button class="btn ghost sm" id="m-skip">O‘tkazib yuborish →</button>' : ''}</div>`);
  const next = () => { if (queue && queue.i + 1 < queue.list.length) enrollModal(queue.list[queue.i + 1], { list: queue.list, i: queue.i + 1 }); else { closeModal(); refreshRoom().then(() => go(S.view)); } };
  if (queue) $('#m-skip').onclick = () => { S.mAbort.abort(); next(); };
  try {
    await Face.load();
    if (!S.mStream || !S.mStream.active) S.mStream = await Face.startCam($('#m-video'));
    else { $('#m-video').srcObject = S.mStream; await $('#m-video').play(); }
    S.mAbort = new AbortController();
    const res = await Face.enroll($('#m-video'), $('#m-canvas'), { signal: S.mAbort.signal, onStatus: (m) => ($('#m-msg').textContent = m), onProgress: (x) => ($('#m-prog').style.width = x * 100 + '%') });
    await api(`/api/rooms/${CODE}/employees/${id}/face`, { method: 'PUT', body: res }, CODE);
    $('#m-ring').classList.add('ok'); $('#m-msg').textContent = `✓ ${e.name} saqlandi`;
    setTimeout(next, 1000);
  } catch (err) { if (err.message !== 'bekor') { toast(err.message); $('#m-msg').textContent = err.message; } }
}
function bulkEnroll() {
  const list = S.room.employees.filter((e) => !e.hasFace).map((e) => e.id);
  if (!list.length) return toast('Hamma xodim Face ID’dan o‘tgan ✓');
  enrollModal(list[0], { list, i: 0 });
}

// ---------- MEETINGS ----------
async function meetings() {
  const ms = (await api(`/api/rooms/${CODE}/meetings`, {}, CODE)).meetings;
  const pend = await Offline.pending();
  const live = ms.filter((m) => m.status === 'live' && m.mode !== 'offline' && m.mode !== 'fayl');
  const modeB = (m) => ({ offline: '<span class="badge warn">oflayn</span>', fayl: '<span class="badge ghost">audio fayl</span>' }[m.mode] || '<span class="badge">onlayn</span>');
  $('#view').innerHTML = `
    <div class="top"><div><h1>Majlislar</h1><div class="sub">Onlayn video, xonadagi oflayn majlis yoki tayyor audio — AI o‘zbekcha tinglab, vazifaga aylantiradi</div></div></div>
    ${S.admin ? `<div class="mode-cards">
      <div class="card" onclick="startMeeting()"><div class="ic">${ic('video', 'lg')}</div><h3>Onlayn majlis</h3><p class="small muted" style="margin-top:4px">Platforma ichida video (Zoom o‘rniga). Har kim o‘z qurilmasidan, AI ismi bilan yozadi.</p></div>
      <div class="card mint" onclick="startOffline()"><div class="ic">${ic('mic', 'lg')}</div><h3>Oflayn majlis (xonada)</h3><p class="small muted" style="margin-top:4px">Telefonni stolga qo‘ying — AI butun xonani tinglaydi, spikerlarni ajratadi. Internetsiz ham yozadi.</p></div>
      <label class="card warn" style="margin:0;color:inherit;font-size:inherit"><div class="ic">${ic('download', 'lg')}</div><h3>Audio fayl yuklash</h3><p class="small muted" style="margin-top:4px">Diktofon yoki Telegram ovozli yozuvi (mp3, m4a, ogg, webm) — 19 MB gacha.</p><input type="file" accept="audio/*,video/webm,.m4a,.mp3,.ogg,.opus,.wav" style="display:none" onchange="Offline.uploadFile(this.files[0])"></label>
    </div>` : ''}
    ${pend.length ? `<div class="card" style="margin-bottom:14px;border-color:var(--warn)"><div class="row"><div class="grow"><b>${pend.length} ta oflayn yozuv yuborilishini kutmoqda</b><div class="small muted">${pend.map((p) => esc(p.title) + ' · ' + p.date).join(', ')}</div></div><button class="btn sm" onclick="Offline.sync().then((n)=>!n&&toast('Hozircha yuborib bo‘lmadi — internetni tekshiring'))">Hozir yuborish</button></div></div>` : ''}
    ${live.map((m) => `<div class="card" style="margin-bottom:12px;border-color:var(--mint)"><div class="row"><span class="live-dot"></span><div class="grow"><b>${esc(m.title)}</b><div class="small muted">${m.date} ${m.time} · jonli</div></div><button class="btn ok" onclick="go('live','${m.id}')">Qo‘shilish ${ic('arrow')}</button></div></div>`).join('')}
    <div class="card">${ms.filter((m) => !live.includes(m)).map((m) => `<div class="list-item" style="cursor:pointer" onclick="go('meeting','${m.id}')"><div class="av">${ic(m.mode === 'offline' ? 'mic' : m.mode === 'fayl' ? 'download' : 'video')}</div><div class="grow"><b>${esc(m.title)}</b><div class="small muted">${m.date} ${m.time} · ${(m.tasks || []).length} vazifa${m.status === 'live' ? ' · tahlil kutilmoqda' : ''}</div></div>${modeB(m)}</div>`).join('') || empty('mic', 'Hali majlis yo‘q')}</div>`;
}
async function startMeeting() {
  const title = prompt('Majlis mavzusi:', 'Haftalik reja majlisi'); if (title === null) return;
  try { const j = await api(`/api/rooms/${CODE}/meetings`, { method: 'POST', body: { title } }, CODE); go('live', j.meeting.id); }
  catch (e) { toast(e.message); }
}
function startOffline() { const t = prompt('Majlis mavzusi:', 'Xonadagi majlis'); if (t !== null) go('offline', t || 'Xonadagi majlis'); }
async function meetingDetail(id) {
  const m = (await api(`/api/rooms/${CODE}/meetings/${id}`, {}, CODE)).meeting;
  const lines = m.aiTranscript && m.aiTranscript.length ? m.aiTranscript.map((t) => `<div class="line">${esc(t)}</div>`).join('') : m.transcript.map((l) => `<div class="line"><b>${esc(l.name)}:</b> ${esc(l.text)}</div>`).join('');
  $('#view').innerHTML = `
    <div class="top"><div><a href="javascript:go('meetings')" class="small">← Majlislar</a><h1>${esc(m.title)}</h1><span class="muted small">${m.date} ${m.time} · tahlil: ${m.engine === 'gemini' ? 'Gemini AI' : 'oddiy qoida'}</span></div></div>
    <div class="grid g2">
      <div>
        <div class="card"><h3>Xulosa</h3><p style="margin-top:8px">${esc(m.summary || '—')}</p>
        ${(m.decisions || []).length ? `<h4 style="margin-top:14px">Qarorlar</h4><ul style="margin:6px 0 0 18px">${m.decisions.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>` : ''}</div>
        <div class="card" style="margin-top:16px"><div class="row" style="justify-content:space-between"><h3>AI topgan vazifalar</h3>${S.admin && m.tasks.length ? `<button class="btn ok sm" onclick="approveTasks('${m.id}')">1-Click tasdiqlash</button>` : ''}</div>
          <div id="ai-tasks">${aiTaskEditor(m)}</div></div>
      </div>
      <div class="card"><h3>Transkripsiya</h3><div class="feed" style="max-height:560px;margin-top:8px">${lines || '<p class="muted">Bo‘sh</p>'}</div></div>
    </div>`;
  S.curMeeting = m;
}
function aiTaskEditor(m) {
  if (!m.tasks.length) return '<p class="muted" style="margin-top:8px">Vazifa topilmadi.</p>';
  const opts = (sel) => '<option value="">— mas’ul —</option>' + S.room.employees.map((e) => `<option value="${e.id}" ${e.id === sel ? 'selected' : ''}>${esc(e.name)}</option>`).join('');
  return m.tasks.map((t, i) => S.admin
    ? `<div class="task" data-i="${i}"><input class="t-title" value="${esc(t.title)}"><div class="row" style="margin-top:8px"><select class="t-who" style="flex:1 1 140px">${opts(t.assigneeId)}</select><input class="t-dl" style="flex:1 1 110px" value="${esc(t.deadline)}" placeholder="muddat"><label class="small" style="margin:0"><input type="checkbox" class="t-on" checked style="width:auto"> qo‘shish</label></div></div>`
    : `<div class="task"><div class="t">${esc(t.title)}</div>${t.note ? `<div class="small" style="color:var(--warn)">${esc(t.note)}</div>` : ''}<div class="small muted">${ic('users')} ${esc(t.assigneeName || '—')} ${t.deadline ? ' · ' + esc(t.deadline) : ''}</div></div>`).join('');
}
async function approveTasks(mid) {
  const tasks = $$('#ai-tasks .task').filter((el) => $('.t-on', el).checked).map((el) => ({ title: $('.t-title', el).value, assigneeId: $('.t-who', el).value, deadline: $('.t-dl', el).value, meetingId: mid }));
  if (!tasks.length) return toast('Hech narsa tanlanmagan');
  await api(`/api/rooms/${CODE}/tasks`, { method: 'POST', body: { tasks } }, CODE);
  await loadTasks(); toast(`✓ ${tasks.length} ta vazifa xodimlarga yuborildi`); go('tasks');
}

// ---------- TASKS ----------
function tasks() {
  const list = S.admin ? S.tasks : S.tasks.filter((t) => t.assigneeId === (S.me && S.me.id));
  const col = (st, title) => `<div class="col"><h4>${title}<span class="badge">${list.filter((t) => t.status === st).length}</span></h4>${list.filter((t) => t.status === st).map((t) => `
    <div class="task"><div class="t">${esc(t.title)}</div>${t.note ? `<div class="small" style="color:var(--warn)">${esc(t.note)}</div>` : ''}<div class="small muted">${ic('users')} ${esc(t.assigneeName || '—')}${t.deadline ? ' · ' + ic('calendar') + ' ' + esc(t.deadline) : ''}</div>
    <div class="row" style="margin-top:8px">${st !== 'yangi' ? `<button class="btn sm sec" onclick="setTask('${t.id}','${st === 'bajarildi' ? 'jarayonda' : 'yangi'}')">←</button>` : ''}${st !== 'bajarildi' ? `<button class="btn sm" onclick="setTask('${t.id}','${st === 'yangi' ? 'jarayonda' : 'bajarildi'}')">${st === 'yangi' ? 'Boshlash' : 'Bajarildi ✓'}</button>` : ''}${S.admin ? `<button class="btn sm ghost" onclick="delTask('${t.id}')">${ic('trash')}</button>` : ''}</div></div>`).join('')}</div>`;
  $('#view').innerHTML = `<div class="top"><h1>${S.admin ? 'Vazifalar' : 'Vazifalarim'}</h1>${S.admin ? `<button class="btn" onclick="newTask()">${ic('plus')} Vazifa</button>` : ''}</div>
    <div class="kanban">${col('yangi', 'Yangi')}${col('jarayonda', 'Jarayonda')}${col('bajarildi', 'Bajarildi')}</div>`;
}
async function setTask(id, status) { try { await api(`/api/rooms/${CODE}/tasks/${id}`, { method: 'PATCH', body: { status } }, CODE); await loadTasks(); tasks(); } catch (e) { toast(e.message); } }
async function delTask(id) { await api(`/api/rooms/${CODE}/tasks/${id}`, { method: 'DELETE' }, CODE); await loadTasks(); tasks(); }
function newTask() {
  modal(`<h2>Yangi vazifa</h2><label>Vazifa</label><input id="t-title"><label>Mas’ul</label><select id="t-who">${S.room.employees.map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join('')}</select><label>Muddat</label><input id="t-dl" type="date">
  <div class="row" style="margin-top:16px;justify-content:flex-end"><button class="btn sec" onclick="closeModal()">Bekor</button><button class="btn" onclick="saveTask()">Saqlash</button></div>`);
}
async function saveTask() { await api(`/api/rooms/${CODE}/tasks`, { method: 'POST', body: { title: $('#t-title').value, assigneeId: $('#t-who').value, deadline: $('#t-dl').value } }, CODE); closeModal(); await loadTasks(); tasks(); }

// ---------- KPI ----------
async function kpi(month) {
  month = month || WR.today().slice(0, 7);
  const r = await api(`/api/rooms/${CODE}/report?month=${month}`, {}, CODE);
  const total = r.rows.reduce((s, x) => s + x.pay, 0);
  $('#view').innerHTML = `
    <div class="top"><h1>Smart KPI & Maosh</h1><input type="month" value="${month}" style="width:auto" onchange="kpi(this.value)"></div>
    <div class="grid g3 stats"><div class="card stat"><div class="l">Ish kunlari (davomat bo‘yicha)</div><div class="n">${r.workDays}</div></div><div class="card stat"><div class="l">Jami to‘lov</div><div class="n" style="font-size:22px">${money(total)}</div></div><div class="card stat"><div class="l">Kechikish jarimasi</div><div class="n" style="font-size:22px">${money(S.room.lateFine)}</div></div></div>
    ${(() => { const top = r.rows.filter((x) => x.salary || x.days).sort((a, b) => b.kpi - a.kpi).slice(0, 3); return top.length ? `<h3 style="margin:22px 0 12px">Oyning eng yaxshilari</h3><div class="lead3">${top.map((x, i) => `<div class="card"><div class="medal">${i + 1}-o‘rin</div>${avatar(emp(x.id) || x, 56)}<div style="margin-top:8px"><b>${esc(x.name)}</b></div><div class="small muted">${esc(x.role)}</div><div class="n" style="font-family:var(--head);font-size:26px;font-weight:800;color:var(--mint);margin-top:6px">${x.kpi}%</div></div>`).join('')}</div>` : ''; })()}
    <div class="card table-wrap" style="margin-top:16px"><table><thead><tr><th>Xodim</th><th>Kun</th><th>Kechikish</th><th>Vazifa</th><th>KPI</th><th>Maosh</th><th>Jarima</th><th>Bonus</th><th>To‘lov</th></tr></thead><tbody>
    ${r.rows.map((x) => `<tr><td><b>${esc(x.name)}</b><div class="small muted">${esc(x.role)}</div></td><td>${x.days}</td><td>${x.late} <span class="small muted">(${x.lateMin} daq)</span></td><td>${x.done}/${x.tasks}</td>
      <td><span class="badge ${x.kpi >= 85 ? 'ok' : x.kpi >= 60 ? 'warn' : 'bad'}">${x.kpi}%</span></td><td>${money(x.salary)}</td><td style="color:var(--bad)">−${money(x.fine)}</td><td style="color:var(--acc2)">+${money(x.bonus)}</td><td><b>${money(x.pay)}</b> <button class="icon-btn" title="Maosh varaqasi" onclick="slip('${x.id}','${month}')">${ic('wallet')}</button></td></tr>`).join('')}
    </tbody></table></div>
    <p class="small muted" style="margin-top:12px">KPI = davomat 40% + punktuallik 20% + bajarilgan vazifalar 40%. Bonus: KPI ≥ 90% → +10%, ≥ 80% → +5%. To‘lov = maosh × davomat − jarima + bonus.</p>
    <button class="btn sec" style="margin-top:10px" onclick="exportCsv('${month}')">${ic('download')} Excel (CSV) yuklab olish</button>`;
  S.kpiRows = r.rows;
}
function slip(id, month) {
  const x = S.kpiRows.find((r) => r.id === id);
  modal(`<div class="slip"><div class="row between"><div><b>${esc(S.room.company)}</b><div style="color:#555;font-size:13px">Maosh varaqasi · ${month}</div></div><b style="font-family:var(--head)">WORKROOM AI</b></div>
    <h2 style="margin:16px 0 4px">${esc(x.name)}</h2><div style="color:#555">${esc(x.role)}</div>
    <table style="margin-top:14px"><tr><td>Ishlagan kunlar</td><td class="num">${x.days}</td></tr><tr><td>Kechikishlar</td><td class="num">${x.late} (${x.lateMin} daq)</td></tr><tr><td>Vazifalar</td><td class="num">${x.done}/${x.tasks}</td></tr><tr><td>KPI</td><td class="num">${x.kpi}%</td></tr>
    <tr><td>Asosiy maosh</td><td class="num">${money(x.salary)}</td></tr><tr><td>Jarima</td><td class="num">−${money(x.fine)}</td></tr><tr><td>Bonus</td><td class="num">+${money(x.bonus)}</td></tr><tr class="tot"><td>To‘lanadi</td><td class="num">${money(x.pay)}</td></tr></table>
    <p style="color:#777;font-size:12px;margin-top:12px">Face ID davomat va Meeting AI vazifalari asosida avtomatik hisoblandi.</p></div>
    <div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn sec" onclick="closeModal()">Yopish</button><button class="btn" onclick="window.print()">${ic('download')} Chop etish / PDF</button></div>`);
}
function exportCsv(month) {
  const head = 'Xodim;Lavozim;Kun;Kechikish;Vazifa;Bajarildi;KPI;Maosh;Jarima;Bonus;Tolov';
  const rows = S.kpiRows.map((x) => [x.name, x.role, x.days, x.late, x.tasks, x.done, x.kpi, x.salary, x.fine, x.bonus, x.pay].join(';'));
  const blob = new Blob(['﻿' + [head, ...rows].join('\n')], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `maosh-${month}.csv`; a.click();
}

// ---------- SETTINGS ----------
function settings() {
  const s = session(CODE);
  $('#view').innerHTML = `
    <div class="top"><h1>Sozlamalar</h1></div>
    <div class="grid g2">
      <div class="card"><h3>Ish tartibi</h3>
        <label>Kompaniya nomi</label><input id="s-co" value="${esc(S.room.company)}">
        <div class="grid g2"><div><label>Ish boshlanishi</label><input id="s-start" type="time" value="${S.room.workStart}"></div><div><label>Ish tugashi</label><input id="s-end" type="time" value="${S.room.workEnd}"></div></div>
        <label>Kechikish jarimasi (har safar, so‘m)</label><input id="s-fine" type="number" value="${S.room.lateFine}">
        <h3 style="margin-top:22px">AI Assistant</h3>
        <label>Ish boshlanganidan necha daqiqa o‘tib kelmaganlar tekshirilsin</label><input id="s-grace" type="number" min="5" max="180" value="${S.room.graceMin}">
        <label class="switch"><input type="checkbox" id="s-auto" ${S.room.autopilot ? 'checked' : ''}> Avtopilot: o‘rinbosarni tasdiqsiz o‘zi tayinlasin</label>
        <p class="small muted" style="margin-top:6px">O‘chiq bo‘lsa — AI taklif qiladi, siz saytda yoki Telegram’da bir bosishda tasdiqlaysiz.</p>
        <h3 style="margin-top:22px">Xavfsizlik</h3>
        <label class="switch"><input type="checkbox" id="s-appr" ${S.room.requireApproval !== false ? 'checked' : ''}> Kod bilan kirganlarni men tasdiqlayman (tavsiya etiladi)</label>
        <label class="switch"><input type="checkbox" id="s-live" ${S.room.liveness !== false ? 'checked' : ''}> Face ID’da tirik yuz tekshiruvi (boshni burish) — rasm bilan aldashdan himoya</label>

        <button class="btn" style="margin-top:14px" onclick="saveSettings()">Saqlash</button></div>
      <div class="card"><h3>Telegram bot</h3>
        <p class="muted small" style="margin-top:6px">Holat: ${S.room.telegramLinked ? '<span class="badge ok">ulangan</span>' : '<span class="badge warn">ulanmagan</span>'}</p>
        <ol class="small" style="margin:10px 0 0 18px;line-height:1.9"><li>Botni Telegram guruhingizga qo‘shing (yoki botga shaxsiy yozing)</li><li>Quyidagi buyruqni yuboring:</li></ol>
        <div class="code-big" style="font-size:16px;letter-spacing:1px">${esc(S.linkCommand || '')}</div>
        <p class="small muted">Shundan so‘ng: har bir kelgan/ketgan xodim, ish boshlanganidan 30 daqiqa o‘tib “kim kelmadi” hisoboti va yangi vazifalar botga keladi. <b>/hisobot</b> — istalgan payt.</p></div>
      <div class="card"><h3>Admin havolasi</h3><p class="muted small" style="margin-top:6px">Boshqa qurilmadan (telefoningizdan) admin sifatida kirish uchun. Hech kimga bermang!</p>
        <button class="btn sec" style="margin-top:12px" onclick="navigator.clipboard.writeText('${location.origin}/room/${CODE}#admin=${s.adminKey}').then(()=>toast('Nusxalandi'))">${ic('link')} Admin havolasini nusxalash</button></div>
      <div class="card"><h3>Rahbar paroli</h3><p class="muted small" style="margin-top:6px">${S.room.hasPassword ? 'Parol o‘rnatilgan.' : '<b style="color:var(--warn)">Parol o‘rnatilmagan</b> — boshqa qurilmadan kirish uchun qo‘ying.'} Kirish: bosh sahifa → Roomga kirish → Rahbarman → kod + parol.</p>
        <div class="row" style="margin-top:10px;flex-wrap:nowrap"><input id="s-pw" type="password" autocomplete="new-password" placeholder="Yangi parol (kamida 6 belgi)"><button class="btn" onclick="savePw()">Saqlash</button></div></div>
      <div class="card" style="grid-column:1/-1"><div class="row between"><h3>Tizim holati</h3><button class="btn sec sm" id="diag-btn" onclick="runDiag()">${ic('zap')} Tekshirish</button></div><div id="diag" class="small muted" style="margin-top:8px">Gemini (AI Mentor, Meeting AI) va Telegram bot ishlayaptimi — “Tekshirish”ni bosing.</div></div>
      <div class="card"><h3>Xodimlar uchun</h3><p class="muted small" style="margin-top:6px">Kompaniya kodi:</p><div class="code-big">#${CODE}</div></div>
    </div>`;
}
async function savePw() { try { await api(`/api/rooms/${CODE}/password`, { method: 'POST', body: { password: $('#s-pw').value } }, CODE); S.room.hasPassword = true; toast('Parol saqlandi'); settings(); } catch (e) { toast(e.message); } }
async function runDiag() {
  const el = $('#diag'), b = $('#diag-btn'); b.disabled = true; el.innerHTML = '<div class="typing"><span></span><span></span><span></span></div>';
  try {
    const d = await api(`/api/rooms/${CODE}/diag`, { method: 'POST' }, CODE);
    const row = (ok, title, text) => `<div class="list-item"><span class="badge ${ok === true ? 'ok' : ok === false ? 'bad' : 'warn'}">${ok === true ? 'ishlayapti' : ok === false ? 'xato' : 'sozlanmagan'}</span><div class="grow"><b style="color:var(--text)">${title}</b><div>${text}</div></div></div>`;
    const g = d.gemini, t = d.telegram;
    el.innerHTML =
      row(g.configured ? g.ok : null, 'Gemini AI', !g.configured ? 'Render → Environment’ga <code>GEMINI_API_KEY</code> qo‘shing.' : g.ok ? `Model: ${esc(g.model)} · javob: “${esc(g.reply)}”` : `${esc(g.error || '')}<br>Kalitni aistudio.google.com/apikey’dan qayta oling va Render’da yangilang.`) +
      row(t.configured ? t.ok && !t.error && !t.webhookError : null, 'Telegram bot', !t.configured ? 'Render → Environment’ga <code>TELEGRAM_BOT_TOKEN</code> qo‘shing.' : `${t.username ? '@' + esc(t.username) + ' · ' : ''}rejim: ${esc(t.mode)} · ${t.linked ? 'guruh ulangan' : '<b>hali ulanmagan</b> — pastdagi /ulash buyrug‘ini botga yuboring'}${t.error ? '<br>Xato: ' + esc(t.error) : ''}${t.webhookError ? '<br>Webhook: ' + esc(t.webhookError) : ''}`) +
      row(d.storage.persistent ? true : null, 'Ma’lumotlar saqlanishi', d.storage.persistent ? 'Doimiy disk ulangan' : 'Vaqtinchalik (bepul tarif): server qayta ishga tushsa ma’lumotlar o‘chadi');
  } catch (e) { el.textContent = e.message; }
  b.disabled = false;
}
async function saveSettings() {
  try { const j = await api(`/api/rooms/${CODE}/settings`, { method: 'PATCH', body: { company: $('#s-co').value, workStart: $('#s-start').value, workEnd: $('#s-end').value, lateFine: $('#s-fine').value, graceMin: $('#s-grace').value, autopilot: $('#s-auto').checked, requireApproval: $('#s-appr').checked, liveness: $('#s-live').checked } }, CODE); S.room = j.room; toast('Saqlandi ✓'); }
  catch (e) { toast(e.message); }
}

// ---------- AI MENTOR ----------
function mentor() {
  const key = 'wr:chat:' + CODE + ':' + (S.me ? S.me.id : 'admin');
  S.chat = WR.store.get(key) || [];
  const chips = ['Ish vaqti va qoidalar qanday?', 'Kasal bo‘lsam nima qilaman?', 'Menga birinchi hafta uchun reja tuzib ber', 'Vazifalarimni qaysi tartibda bajaray?'];
  $('#view').innerHTML = `
    <div class="top"><div><h1>AI Mentor</h1><div class="sub">Kompaniya bilim bazasi + Gemini. Savolingizni o‘zbekcha yozing.</div></div>${S.admin ? `<button class="btn sec" onclick="go('kb')">${ic('book')} Bilim bazasini to‘ldirish</button>` : ''}</div>
    <div class="card chat">
      <div class="msgs" id="msgs"></div>
      <div class="chips" id="chips">${chips.map((c) => `<button class="chip">${esc(c)}</button>`).join('')}</div>
      <form id="mf"><input id="mq" placeholder="Masalan: CRM’ga yangi mijozni qanday qo‘shaman?" autocomplete="off"><button class="btn" aria-label="Yuborish">${ic('send')}</button>${S.chat.length ? `<button type="button" class="icon-btn" title="Tozalash" id="mclear">${ic('trash')}</button>` : ''}</form>
    </div>`;
  const render = () => {
    $('#msgs').innerHTML = (S.chat.length ? '' : `<div class="bubble ai">Salom${S.me ? ', ' + esc(S.me.name.split(' ')[0]) : ''}! Men ${esc(S.room.company)} AI Mentoriman. Ish tartibi, jarayonlar, vazifalaringiz yoki kasbiy savollar bo‘yicha so‘rang — tajribali hamkasbingizni chalg‘itmasdan javob topamiz.</div>`)
      + S.chat.map((m) => `<div class="bubble ${m.role === 'ai' ? 'ai' : 'me'}">${esc(m.text)}${m.sources && m.sources.length ? `<span class="src">Manba: ${m.sources.map(esc).join(', ')}</span>` : ''}</div>`).join('');
    $('#msgs').scrollTop = 1e9;
  };
  render();
  const ask = async (q) => {
    q = q.trim(); if (!q) return;
    S.chat.push({ role: 'me', text: q }); render(); $('#mq').value = ''; $('#chips').classList.add('hidden');
    $('#msgs').insertAdjacentHTML('beforeend', '<div class="bubble ai typing" id="typing"><span></span><span></span><span></span></div>'); $('#msgs').scrollTop = 1e9;
    try {
      const j = await api(`/api/rooms/${CODE}/mentor`, { method: 'POST', body: { question: q, history: S.chat.slice(-9, -1) } }, CODE);
      S.chat.push({ role: 'ai', text: j.answer, sources: j.sources });
    } catch (e) { S.chat.push({ role: 'ai', text: 'Xatolik: ' + e.message }); }
    S.chat = S.chat.slice(-40); WR.store.set(key, S.chat); render();
  };
  $('#mf').onsubmit = (e) => { e.preventDefault(); ask($('#mq').value); };
  $$('#chips .chip').forEach((b) => (b.onclick = () => ask(b.textContent)));
  const c = $('#mclear'); if (c) c.onclick = () => { S.chat = []; WR.store.set(key, []); mentor(); };
}

// ---------- BILIM BAZASI (admin) ----------
async function kb() {
  const j = await api(`/api/rooms/${CODE}/kb`, {}, CODE);
  $('#view').innerHTML = `
    <div class="top"><div><h1>Bilim bazasi</h1><div class="sub">AI Mentor shu yerdagi ma’lumotlarga tayanib javob beradi.</div></div><span class="badge ${j.ai ? 'ok' : 'warn'}">${j.ai ? 'Gemini ulangan' : 'Gemini kaliti yo‘q — oddiy qidiruv'}</span></div>
    <div class="grid g2">
      <div class="card"><h3>Yangi bo‘lim qo‘shish</h3>
        <label>Sarlavha</label><input id="kb-t" placeholder="Masalan: Yangi xodim uchun 1-kun">
        <label>Matn (qoidalar, yo‘riqnoma, FAQ — qancha ko‘p bo‘lsa, shuncha yaxshi)</label><textarea id="kb-x" rows="8" placeholder="Masalan: Mijoz qo‘ng‘iroq qilsa, avval CRM’da tekshiring…"></textarea>
        <div class="row" style="margin-top:12px"><button class="btn" onclick="kbAdd()">${ic('plus')} Saqlash</button><label class="btn sec" style="margin:0">${ic('download')} .txt fayldan<input type="file" accept=".txt,.md,text/plain" style="display:none" onchange="kbFile(this)"></label></div>
      </div>
      <div class="card"><h3>Xodimlar nimani so‘rayapti</h3>${(j.log || []).length ? j.log.slice(0, 12).map((l) => `<div class="list-item"><span class="av">${esc(WR.initials(l.name))}</span><div class="grow">${esc(l.q)}<div class="small muted">${esc(l.name)} · ${WR.uzDate(l.ts, true)}</div></div></div>`).join('') : empty('brain', 'Hali savol berilmagan')}</div>
    </div>
    <h3 style="margin:24px 0 12px">Bo‘limlar (${j.kb.length})</h3>
    <div class="grid g2">${j.kb.map((k) => `<div class="card"><div class="row between"><b>${esc(k.title)}</b><button class="icon-btn" onclick="kbDel('${k.id}')" title="O‘chirish">${ic('trash')}</button></div><p class="small muted" style="margin-top:8px;white-space:pre-wrap">${esc(k.text.slice(0, 320))}${k.text.length > 320 ? '…' : ''}</p></div>`).join('') || empty('book', 'Bo‘sh')}</div>`;
}
async function kbAdd() { try { await api(`/api/rooms/${CODE}/kb`, { method: 'POST', body: { title: $('#kb-t').value, text: $('#kb-x').value } }, CODE); toast('Saqlandi — AI Mentor endi buni biladi'); kb(); } catch (e) { toast(e.message); } }
async function kbDel(id) { await api(`/api/rooms/${CODE}/kb/${id}`, { method: 'DELETE' }, CODE); kb(); }
function kbFile(inp) { const f = inp.files[0]; if (!f) return; f.text().then((t) => { $('#kb-t').value = f.name.replace(/\.\w+$/, ''); $('#kb-x').value = t; }); }

// ---------- Realtime ----------
socket.on('attendance', (a) => {
  if (S.view === 'home' && S.admin) { const f = $('#feed'); if (f) home(); }
  if (S.view === 'kiosk' && S.admin) { const l = $('#k-log'); if (l) { const o = l.querySelector(`[data-a="${a.id}"]`); if (o) o.remove(); l.insertAdjacentHTML('afterbegin', attLine(a)); } }
  if (S.admin && S.view !== 'kiosk') toast(`${a.name} — ${a.status} (${a.time})`);
});
socket.on('employees', (list) => { if (S.room) S.room.employees = list; if (S.me) S.me = emp(S.me.id) || S.me; });
socket.on('post', () => loadPosts());
socket.on('assistant', (g) => { if (S.admin && g && g.text) { if (g.status === 'pending') toast('AI Assistant: ' + g.text, 6000); if (S.view === 'home') home(); } });
socket.on('tasks', (t) => { S.tasks = t; if (S.view === 'tasks') tasks(); });
socket.on('settings', (r) => { S.room = r; if (S.view === 'settings') settings(); });
socket.on('meeting:started', (m) => { if (S.view !== 'live' && !S.admin) toast(`Majlis boshlandi: ${m.title} — “Majlislar” bo‘limidan qo‘shiling`, 6000); if (S.view === 'meetings') meetings(); });
socket.on('connect', () => { if (S.room) joinRoom(); });
socket.on('approved', () => { toast('Rahbar sizni tasdiqladi!'); setTimeout(() => location.reload(), 800); });

boot();
