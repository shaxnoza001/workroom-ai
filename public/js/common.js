// Shared helpers: API, session, UI
const WR = (() => {
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (_) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} },
    del(k) { try { localStorage.removeItem(k); } catch (_) {} },
  };
  const session = (code) => store.get('wr:' + code) || {};
  const setSession = (code, s) => { store.set('wr:' + code, { ...session(code), ...s }); store.set('wr:last', code); };

  // API: vaqt chegarasi + server uyg'onayotganda (Render bepul tarifi) avtomatik qayta urinish
  let wakeToast = false;
  async function api(path, opts = {}, code) {
    const s = code ? session(code) : {};
    const isBlob = opts.body instanceof Blob;
    const headers = { ...(opts.body && !isBlob ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers || {}) };
    if (s.adminKey) headers['x-admin-key'] = s.adminKey;
    if (s.empKey) headers['x-emp-key'] = s.empKey;
    const body = opts.body && !isBlob && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body;
    const long = isBlob || /analyze|mentor|brief|diag/.test(path);
    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await fetch(path, { ...opts, headers, body, signal: AbortSignal.timeout ? AbortSignal.timeout(long ? 180000 : 30000) : undefined });
      } catch (e) {
        if (attempt < 4 && !isBlob) { if (!wakeToast) { wakeToast = true; toast('Server uyg‘onmoqda… bir necha soniya kuting', 6000); } await new Promise((r) => setTimeout(r, 2500 * (attempt + 1))); continue; }
        throw new Error(e.name === 'TimeoutError' ? 'Server javob bermadi. Internetni tekshirib, qayta urinib ko‘ring.' : 'Internet aloqasi yo‘q yoki server ishlamayapti.');
      }
      if ([502, 503, 504].includes(res.status) && attempt < 4) { if (!wakeToast) { wakeToast = true; toast('Server uyg‘onmoqda… bir necha soniya kuting', 6000); } await new Promise((r) => setTimeout(r, 3000 * (attempt + 1))); continue; }
      wakeToast = false;
      const j = await res.json().catch(() => ({}));
      if (res.status === 429) throw new Error(j.error || 'Juda ko‘p urinish. Biroz kuting.');
      if (!res.ok) throw new Error(j.error || 'Xatolik: ' + res.status);
      return j;
    }
  }
  function toast(msg, ms = 3000) {
    const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
    document.body.appendChild(t); setTimeout(() => t.remove(), ms);
  }
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const initials = (n) => String(n || '?').split(' ').map((x) => x[0]).slice(0, 2).join('').toUpperCase();
  const avatar = (e, size = 38) => e && e.photo
    ? `<img class="av" style="width:${size}px;height:${size}px" src="${e.photo}" alt="">`
    : `<span class="av" style="width:${size}px;height:${size}px">${esc(initials(e && e.name))}</span>`;
  const money = (n) => (Math.round(n || 0)).toLocaleString('ru-RU').replace(/,/g, ' ') + ' so‘m';
  function today() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date());
  }
  // Line icons (24x24, stroke)
  const P = {
    home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
    scan: 'M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M9 10h.01M15 10h.01M9.5 15a3.5 3.5 0 0 0 5 0',
    users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
    video: 'M15 10l5-3v10l-5-3zM3 6h12v12H3z',
    check: 'M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
    wallet: 'M20 7H5a2 2 0 0 1 0-4h13v4M3 5v14a2 2 0 0 0 2 2h15V7M16 14h.01',
    settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
    spark: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z',
    book: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5zM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5',
    bell: 'M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0',
    mic: 'M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v3',
    cam: 'M23 7l-7 5 7 5zM1 5h15v14H1z',
    screen: 'M2 3h20v14H2zM8 21h8M12 17v4',
    brain: 'M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24A2.5 2.5 0 0 1 9.5 2zM14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24A2.5 2.5 0 0 0 14.5 2z',
    plus: 'M12 5v14M5 12h14', trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6', edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
    send: 'M22 2 11 13M22 2l-7 20-4-9-9-4z', clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
    alert: 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01',
    link: 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7',
    download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
    shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4',
    building: 'M4 21V3h11v18M15 9h5v12M8 7h3M8 11h3M8 15h3M3 21h18',
    chart: 'M3 3v18h18M7 15l4-4 3 3 5-6', x: 'M18 6 6 18M6 6l12 12', logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
    play: 'M6 4l14 8-14 8z', pause: 'M7 5h3v14H7zM14 5h3v14h-3z', stop: 'M6 6h12v12H6z', phone: 'M7 2h10v20H7zM11 18h2', telegram: 'M21 4 2 11l6 2 2 6 3-4 5 4zM8 13l10-7',
    sick: 'M12 2a3 3 0 0 0-3 3v9.5a4 4 0 1 0 6 0V5a3 3 0 0 0-3-3zM12 15v-3', arrow: 'M5 12h14M13 6l6 6-6 6', zap: 'M13 2 3 14h9l-1 8 10-12h-9z',
    calendar: 'M3 5h18v16H3zM16 3v4M8 3v4M3 10h18', key: 'M21 2l-2 2m-7.6 7.6a5.5 5.5 0 1 1-7.8 7.8 5.5 5.5 0 0 1 7.8-7.8zM15.5 7.5l3 3L22 7l-3-3',
  };
  const ic = (n, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${P[n] || ''}"/></svg>`;
  const MON = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];
  const WD = ['yakshanba', 'dushanba', 'seshanba', 'chorshanba', 'payshanba', 'juma', 'shanba'];
  function uzDate(ts = Date.now(), withTime) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tashkent', weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
    const wd = WD[['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday)];
    const base = `${p.day}-${MON[p.month - 1]}`;
    return withTime ? `${base}, ${p.hour === '24' ? '00' : p.hour}:${p.minute}` : `${wd[0].toUpperCase() + wd.slice(1)}, ${base}`;
  }
  // Kun / tun rejimi
  function applyTheme(t) {
    document.documentElement.dataset.theme = t;
    const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = t === 'light' ? '#e9eefb' : '#050816';
  }
  function toggleTheme(ev) {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    store.set('wr:theme', next);
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!document.startViewTransition || reduce) return applyTheme(next);
    const x = ev && ev.clientX ? ev.clientX : innerWidth - 40, y = ev && ev.clientY ? ev.clientY : 30;
    const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    const tr = document.startViewTransition(() => applyTheme(next));
    tr.ready.then(() => document.documentElement.animate({ clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] }, { duration: 650, easing: 'cubic-bezier(.6,0,.3,1)', pseudoElement: '::view-transition-new(root)' })).catch(() => {});
  }
  const themeBtn = (cls = '') => `<button class="theme-btn ${cls}" type="button" aria-label="Kun / tun rejimi" title="Kun / tun rejimi" onclick="WR.toggleTheme(event)"><svg class="sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg><svg class="moon" viewBox="0 0 24 24"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg></button>`;
  applyTheme(store.get('wr:theme') || document.documentElement.dataset.theme || 'dark');
  addEventListener('DOMContentLoaded', () => document.querySelectorAll('[data-theme-btn]').forEach((el) => (el.outerHTML = themeBtn(el.dataset.themeBtn))));
  return { toggleTheme, themeBtn, store, session, setSession, api, toast, $, $$, esc, avatar, money, today, initials, ic, uzDate, icp: (n) => P[n] || '' };
})();
