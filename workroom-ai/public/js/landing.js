// Landing animations: live hero mock, AI brain diagram, meeting→tasks demo, assistant story, scroll reveal
{
  const { $, $$, ic, icp, esc } = WR;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Scroll reveal
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.12 });
  $$('.reveal').forEach((el) => io.observe(el));

  // ---- Hero: live check-ins ----
  const people = [['Aziz', '08:52', 'keldi'], ['Malika', '08:55', 'keldi'], ['Dilshod', '08:58', 'keldi'], ['Nigora', '09:07', 'kechikdi'], ['Sardor', '08:49', 'keldi'], ['Kamola', '08:57', 'keldi']];
  let hi = 0, nIn = 12, nLate = 1;
  function heroTick() {
    const f = $('#hfeed'); if (!f) return;
    const [n, t, st] = people[hi++ % people.length];
    if (nIn < 18) nIn++; else nIn = 12;
    if (st === 'kechikdi') nLate = nLate >= 2 ? 1 : nLate + 1;
    $('#hk-in').textContent = nIn; $('#hk-late').textContent = nLate;
    f.insertAdjacentHTML('afterbegin', `<div class="list-item"><span class="av" style="width:30px;height:30px">${esc(n.slice(0, 2).toUpperCase())}</span><div class="grow"><b style="font-size:13.5px">${esc(n)}</b><div class="small muted">Face ID · ${t}</div></div><span class="badge ${st === 'keldi' ? 'ok' : 'warn'}">${st}</span></div>`);
    while (f.children.length > 2) f.lastElementChild.remove();
    const ph = $('#hphone'); if (ph) ph.innerHTML = `<b>Xush kelibsiz, ${esc(n)}</b><br><span class="muted">${t} · ${st === 'keldi' ? 'o‘z vaqtida' : 'kechikdi'}</span>`;
  }
  heroTick(); heroTick();
  if (!reduce) setInterval(heroTick, 2600);

  // ---- AI brain diagram ----
  const nodes = [
    ['scan', 'Face ID davomat', 'keldi · ketdi · kechikish'],
    ['video', 'Meeting AI', 'o‘zbekcha → vazifa'],
    ['brain', 'AI Mentor', 'bilim bazasi + Gemini'],
    ['spark', 'AI Assistant', 'o‘rinbosar · 1-click'],
    ['wallet', 'Smart KPI & Buxgalter', 'maosh · bonus · jarima'],
  ];
  function drawBrain() {
    const box = $('#brain'); if (!box) return;
    const narrow = box.clientWidth < 640;
    const W = narrow ? 420 : 960, H = narrow ? 640 : 470, cx = W / 2, cy = narrow ? 320 : 235;
    const pos = narrow
      ? [[110, 70], [310, 70], [90, 560], [330, 560], [210, 160 + 380]].map((p, i) => (i === 4 ? [210, 470] : p))
      : [[170, 80], [790, 80], [130, 330], [830, 330], [480, 420]];
    if (narrow) { pos[0] = [106, 80]; pos[1] = [314, 80]; pos[2] = [106, 560]; pos[3] = [314, 560]; pos[4] = [210, 460]; }
    const nw = narrow ? 196 : 230, nh = narrow ? 64 : 66;
    let paths = '', packets = '', ns = '';
    pos.forEach(([x, y], i) => {
      const mx = (cx + x) / 2 + (i % 2 ? 40 : -40), my = (cy + y) / 2;
      const d = `M${cx},${cy} Q${mx},${my} ${x},${y}`;
      paths += `<path id="bp${i}" d="${d}" fill="none" stroke="url(#lg)" stroke-width="2" stroke-dasharray="4 6" opacity=".7"><animate attributeName="stroke-dashoffset" from="0" to="-40" dur="2s" repeatCount="indefinite"/></path>`;
      if (!reduce) {
        packets += `<circle r="4.5" fill="#21c99a" filter="url(#gl)"><animateMotion dur="${2.4 + i * 0.35}s" repeatCount="indefinite" keyPoints="0;1" keyTimes="0;1" calcMode="linear"><mpath href="#bp${i}"/></animateMotion></circle>`;
        packets += `<circle r="3.5" fill="#9db0ff" filter="url(#gl)"><animateMotion dur="${3 + i * 0.3}s" begin="${i * 0.4}s" repeatCount="indefinite" keyPoints="1;0" keyTimes="0;1" calcMode="linear"><mpath href="#bp${i}"/></animateMotion></circle>`;
      }
      const [ic0, t, sub] = nodes[i];
      ns += `<g transform="translate(${x - nw / 2},${y - nh / 2})"><rect width="${nw}" height="${nh}" rx="16" style="fill:var(--card);stroke:var(--line2)"/>
        <rect x="10" y="${nh / 2 - 19}" width="38" height="38" rx="11" fill="rgba(79,107,255,.18)"/>
        <svg x="19" y="${nh / 2 - 10}" width="20" height="20" viewBox="0 0 24 24" fill="none" style="stroke:var(--acc-ink)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${icp(ic0)}"/></svg>
        <text x="58" y="${nh / 2 - 3}" class="lbl" style="font-size:${narrow ? 14 : 15}px">${esc(t)}</text><text x="58" y="${nh / 2 + 15}" class="sub" style="font-size:${narrow ? 11 : 12}px">${esc(sub)}</text></g>`;
    });
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img">
      <defs><linearGradient id="lg" x1="0" x2="1"><stop offset="0" stop-color="#4f6bff"/><stop offset="1" stop-color="#21c99a"/></linearGradient>
      <radialGradient id="hub"><stop offset="0" stop-color="#4f6bff"/><stop offset=".7" stop-color="#2a3fb8"/><stop offset="1" stop-color="#1a2777"/></radialGradient>
      <filter id="gl"><feGaussianBlur stdDeviation="2.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
      ${paths}${packets}
      <circle cx="${cx}" cy="${cy}" r="96" fill="none" stroke="rgba(79,107,255,.25)"><animate attributeName="r" values="80;112;80" dur="4s" repeatCount="indefinite"/><animate attributeName="opacity" values="1;0;1" dur="4s" repeatCount="indefinite"/></circle>
      <circle cx="${cx}" cy="${cy}" r="72" fill="url(#hub)" stroke="rgba(181,194,255,.6)" stroke-width="1.5" filter="url(#gl)"/>
      <svg x="${cx - 18}" y="${cy - 40}" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="${icp('brain')}"/></svg>
      <text x="${cx}" y="${cy + 18}" text-anchor="middle" class="lbl" style="font-size:17px;fill:#fff">AI miya</text>
      <text x="${cx}" y="${cy + 36}" text-anchor="middle" class="sub" style="fill:#c7d0f5">Gemini · real vaqt</text>
      ${ns}</svg>`;
  }
  drawBrain();
  let rw; addEventListener('resize', () => { clearTimeout(rw); rw = setTimeout(drawBrain, 200); });

  // ---- Meeting → tasks demo ----
  const lines = [
    ['Rahbar', 'Assalomu alaykum. Bu hafta yangi filialni ochamiz.'],
    ['Nigora', 'Hamkorlarga taklifnomani men tayyorlayman.', ['Hamkorlarga taklifnoma tayyorlash', 'Nigora', 'juma']],
    ['Rahbar', 'Aziz, kassa dasturini ertaga o‘rnatib qo‘y.', ['Yangi filialga kassa dasturini o‘rnatish', 'Aziz', 'ertaga']],
    ['Aziz', 'Xo‘p, ertalab birinchi ish shu.'],
    ['Rahbar', 'Dilshod oy oxirigacha xarajatlar smetasini tekshirsin.', ['Xarajatlar smetasini tekshirish', 'Dilshod', 'oy oxiri']],
  ];
  let running = false;
  async function playMeeting() {
    if (running) return; running = true;
    while (true) {
      const tr = $('#tr'), tk = $('#tk'); if (!tr) return;
      tr.innerHTML = ''; tk.innerHTML = ''; $('#tcount').textContent = '0 ta'; $('#tok').classList.add('hidden');
      let n = 0;
      for (const [who, text, task] of lines) {
        const el = document.createElement('div'); el.className = 'tline cursor'; el.innerHTML = `<b>${esc(who)}:</b> <span></span>`; tr.appendChild(el);
        const sp = el.querySelector('span');
        for (let i = 0; i <= text.length; i += reduce ? text.length : 2) { sp.textContent = text.slice(0, i); await sleep(28); }
        sp.textContent = text; el.classList.remove('cursor');
        if (task) {
          await sleep(350); n++;
          tk.insertAdjacentHTML('beforeend', `<div class="tcard"><div class="chk">${ic('check')}</div><div class="grow"><b>${esc(task[0])}</b><div class="small muted">${ic('users')} ${esc(task[1])} · ${ic('calendar')} ${esc(task[2])}</div></div></div>`);
          $('#tcount').textContent = n + ' ta';
        }
        await sleep(500);
      }
      $('#tok').classList.remove('hidden');
      await sleep(5000);
    }
  }
  const mo = new IntersectionObserver((es) => { if (es[0].isIntersecting) { playMeeting(); mo.disconnect(); } }, { threshold: 0.3 });
  if ($('#majlis')) mo.observe($('#majlis'));

  // ---- Assistant story ----
  const steps = $$('#story .st'); let si = 0;
  function storyTick() { steps.forEach((s, i) => s.classList.toggle('on', i <= si)); si = (si + 1) % (steps.length + 1); }
  if (steps.length) { if (reduce) steps.forEach((s) => s.classList.add('on')); else { storyTick(); setInterval(storyTick, 1600); } }

  // ---- Effects v5 ----
  // headline word reveal
  (() => {
    const h1 = $('.hero h1'); if (!h1 || reduce) return;
    let i = 0; const wrap = (txt, hl) => txt.split(/(\s+)/).map((w) => (/^\s+$/.test(w) || !w ? w : `<span class="w${hl ? ' hl' : ''}" style="animation-delay:${0.08 * i++ + 0.1}s">${w}</span>`)).join('');
    h1.innerHTML = [...h1.childNodes].map((n) => (n.nodeType === 3 ? wrap(n.textContent) : wrap(n.textContent, true))).join('');
  })();
  // scroll progress
  const sbar = $('#sbar');
  const onScroll = () => { if (sbar) sbar.style.transform = `scaleX(${scrollY / Math.max(1, document.documentElement.scrollHeight - innerHeight)})`; };
  addEventListener('scroll', onScroll, { passive: true }); onScroll();
  // spotlight cards
  document.addEventListener('pointermove', (e) => {
    const c = e.target.closest && e.target.closest('.landing .card'); if (!c) return;
    const r = c.getBoundingClientRect(); c.style.setProperty('--mx', e.clientX - r.left + 'px'); c.style.setProperty('--my', e.clientY - r.top + 'px');
  }, { passive: true });
  // 3D tilt hero mock
  const tilt = $('#tilt'), hero = $('.hero');
  if (tilt && hero && !reduce && matchMedia('(pointer:fine)').matches) {
    hero.addEventListener('pointermove', (e) => { const r = hero.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5; tilt.style.transform = `rotateY(${x * 14}deg) rotateX(${-y * 10}deg)`; });
    hero.addEventListener('pointerleave', () => (tilt.style.transform = ''));
  }
  // magnetic buttons
  if (!reduce && matchMedia('(pointer:fine)').matches) $$('.magnetic').forEach((b) => {
    b.addEventListener('pointermove', (e) => { const r = b.getBoundingClientRect(); b.style.transform = `translate(${(e.clientX - r.left - r.width / 2) * 0.18}px,${(e.clientY - r.top - r.height / 2) * 0.3}px)`; });
    b.addEventListener('pointerleave', () => (b.style.transform = ''));
  });
  // stagger index for reveal children
  $$('.reveal').forEach((sec) => $$('.card, .st, .nums>div', sec).forEach((c, i) => c.style.setProperty('--i', i % 8)));
  // count-up
  const co = new IntersectionObserver((es) => es.forEach((e) => {
    if (!e.isIntersecting) return; co.unobserve(e.target);
    const el = e.target, to = +el.dataset.to, suf = el.dataset.suf || ''; const t0 = performance.now();
    const step = (t) => { const k = Math.min(1, (t - t0) / 1400); el.textContent = Math.round(to * (1 - Math.pow(1 - k, 3))) + suf; if (k < 1) requestAnimationFrame(step); };
    reduce ? (el.textContent = to + suf) : requestAnimationFrame(step);
  }), { threshold: 0.5 });
  $$('[data-to]').forEach((el) => co.observe(el));
}
