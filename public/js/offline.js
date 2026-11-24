// Oflayn (xonadagi) majlis: bitta telefon/noutbuk stol ustida turadi, butun majlisni yozib oladi.
// Internet bo'lmasa — yozuv qurilmada (IndexedDB) saqlanadi va internet qaytganda avtomatik AI tahliliga yuboriladi.
const Offline = (() => {
  const W = WR;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let st = null;

  // ---- IndexedDB queue ----
  const idb = () => new Promise((ok, no) => {
    try {
      const rq = indexedDB.open('workroom', 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore('pending', { keyPath: 'key' });
      rq.onsuccess = () => ok(rq.result); rq.onerror = () => no(rq.error);
    } catch (e) { no(e); }
  });
  async function qAll() { try { const d = await idb(); return await new Promise((ok) => { const r = d.transaction('pending').objectStore('pending').getAll(); r.onsuccess = () => ok(r.result.filter((x) => x.code === CODE)); r.onerror = () => ok([]); }); } catch (_) { return []; } }
  async function qPut(item) { const d = await idb(); return new Promise((ok, no) => { const t = d.transaction('pending', 'readwrite'); t.objectStore('pending').put(item); t.oncomplete = ok; t.onerror = () => no(t.error); }); }
  async function qDel(key) { try { const d = await idb(); d.transaction('pending', 'readwrite').objectStore('pending').delete(key); } catch (_) {} }

  async function upload(item) {
    const j = await W.api(`/api/rooms/${CODE}/meetings`, { method: 'POST', body: { title: item.title, mode: item.mode || 'offline', transcript: item.transcript || [], date: item.date, time: item.time } }, CODE);
    const big = item.blob && item.blob.size > 19 * 1024 * 1024;
    await W.api(`/api/rooms/${CODE}/meetings/${j.meeting.id}/analyze`, item.blob && !big ? { method: 'POST', body: item.blob, headers: { 'Content-Type': item.blob.type || 'audio/webm' } } : { method: 'POST' }, CODE);
    return j.meeting.id;
  }
  let syncing = false;
  async function sync(quiet) {
    if (syncing || !navigator.onLine) return 0;
    syncing = true; let n = 0;
    for (const it of await qAll()) {
      try { await upload(it); await qDel(it.key); n++; } catch (_) { break; }
    }
    syncing = false;
    if (n && !quiet) W.toast(`${n} ta oflayn majlis AI tahliliga yuborildi`);
    if (n && S.view === 'meetings') go('meetings');
    return n;
  }
  window.addEventListener('online', () => sync());

  function stamp() { const t = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date()); const p = Object.fromEntries(t.map((x) => [x.type, x.value])); return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour === '24' ? '00' : p.hour}:${p.minute}` }; }

  async function open(title) {
    st = { title, transcript: [], chunks: [], t0: Date.now(), paused: false, pausedMs: 0, ...stamp() };
    S.cleanup = () => stop(false);
    W.$('#view').innerHTML = `
      <div class="top"><div><a href="javascript:go('meetings')" class="small">← Majlislar</a><h1><span class="live-dot"></span>${W.esc(title)}</h1><div class="sub">Oflayn majlis · qurilmani stol o‘rtasiga qo‘ying</div></div><span class="badge" id="o-net"></span></div>
      <div class="grid" style="grid-template-columns:minmax(0,1.2fr) minmax(0,1fr)" id="o-grid">
        <div class="card rec-card">
          <div class="rec-time" id="o-time">00:00</div>
          <canvas id="o-wave" class="wave"></canvas>
          <div class="controls">
            <button class="ctl" id="o-pause" title="Pauza">${W.ic('pause')}</button>
            <button class="btn bad lg" id="o-end">${W.ic('brain')} Yakunlash va AI tahlil</button>
          </div>
          <p class="small muted center" id="o-hint" style="margin-top:12px">Gapirayotganda ismingizni ayting (“Men, Aziz…”) — AI spikerlarni aniqroq ajratadi. Internet bo‘lmasa ham yozuv davom etadi.</p>
        </div>
        <div class="card panel" style="height:auto;min-height:360px"><h3>Jonli subtitr</h3><div class="feed" id="o-feed" style="margin-top:8px"><div class="line interim" id="o-int">${SR ? 'Tinglanmoqda…' : 'Bu brauzerda jonli subtitr yo‘q — yozuv baribir AI’ga yuboriladi.'}</div></div></div>
      </div>`;
    if (innerWidth < 900) W.$('#o-grid').style.gridTemplateColumns = 'minmax(0,1fr)';
    const net = () => { const n = W.$('#o-net'); if (n) { n.className = 'badge ' + (navigator.onLine ? 'ok' : 'warn'); n.textContent = navigator.onLine ? 'Onlayn' : 'Internet yo‘q — qurilmada saqlanmoqda'; } };
    net(); st.netH = net; addEventListener('online', net); addEventListener('offline', net);
    const me = st;
    try { me.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: true } }); }
    catch (e) { if (st === me && W.$('#o-hint')) W.$('#o-hint').textContent = 'Mikrofonga ruxsat berilmadi. Brauzer sozlamalaridan ruxsat bering.'; return; }
    if (st !== me) { me.stream.getTracks().forEach((t) => t.stop()); return; }
    try { st.lock = await navigator.wakeLock.request('screen'); } catch (_) {}
    const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
    st.rec = new MediaRecorder(st.stream, { mimeType: type, audioBitsPerSecond: 24000 });
    const chunks = st.chunks; st.rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    st.rec.start(4000);
    // waveform
    st.ac = new (window.AudioContext || window.webkitAudioContext)();
    const an = st.ac.createAnalyser(); an.fftSize = 512; st.ac.createMediaStreamSource(st.stream).connect(an);
    const buf = new Uint8Array(an.frequencyBinCount); const cv = W.$('#o-wave'); const ctx = cv.getContext('2d');
    const draw = () => {
      if (!st || !st.rec) return;
      cv.width = cv.clientWidth * devicePixelRatio; cv.height = cv.clientHeight * devicePixelRatio;
      an.getByteFrequencyData(buf); ctx.clearRect(0, 0, cv.width, cv.height);
      const bars = 48, w = cv.width / bars;
      for (let i = 0; i < bars; i++) {
        const v = st.paused ? 0.04 : (buf[Math.floor(i * buf.length / bars / 1.6)] / 255);
        const h = Math.max(4, v * cv.height * 0.9);
        ctx.fillStyle = i % 7 === 0 ? '#21c99a' : '#4f6bff';
        ctx.beginPath(); ctx.roundRect ? ctx.roundRect(i * w + w * 0.2, (cv.height - h) / 2, w * 0.6, h, w * 0.3) : ctx.rect(i * w + w * 0.2, (cv.height - h) / 2, w * 0.6, h); ctx.fill();
      }
      const sec = Math.floor((Date.now() - st.t0 - st.pausedMs - (st.paused ? Date.now() - st.pauseAt : 0)) / 1000);
      W.$('#o-time').textContent = `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
      st.raf = requestAnimationFrame(draw);
    };
    draw();
    if (SR) listen();
    W.$('#o-pause').onclick = () => {
      st.paused = !st.paused;
      if (st.paused) { st.pauseAt = Date.now(); st.rec.pause(); stopListen(); } else { st.pausedMs += Date.now() - st.pauseAt; st.rec.resume(); if (SR) listen(); }
      W.$('#o-pause').classList.toggle('rec', st.paused); W.$('#o-pause').innerHTML = W.ic(st.paused ? 'play' : 'pause');
    };
    W.$('#o-end').onclick = finish;
  }
  function listen() {
    if (!navigator.onLine) return;
    const r = new SR(); r.lang = 'uz-UZ'; r.continuous = true; r.interimResults = true;
    r.onresult = (e) => {
      if (!st) return;
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript.trim(); if (!t) continue;
        if (e.results[i].isFinal) { st.transcript.push({ name: 'Majlis', text: t, ts: Date.now() }); W.$('#o-int').insertAdjacentHTML('beforebegin', `<div class="line">${W.esc(t)}</div>`); }
        else interim += t + ' ';
      }
      const el = W.$('#o-int'); if (el) { el.textContent = interim || '…'; el.parentNode.scrollTop = 1e9; }
    };
    r.onend = () => { if (st && st.sr === r && !st.paused) setTimeout(() => st && !st.paused && listen(), 300); };
    try { r.start(); st.sr = r; } catch (_) {}
  }
  function stopListen() { if (st && st.sr) { const r = st.sr; st.sr = null; try { r.stop(); } catch (_) {} } }
  function stop(keep) {
    if (!st) return null;
    stopListen(); cancelAnimationFrame(st.raf);
    const p = new Promise((ok) => { if (st.rec && st.rec.state !== 'inactive') { st.rec.onstop = () => ok(); st.rec.stop(); } else ok(); });
    const s = st;
    p.then(() => { s.stream && s.stream.getTracks().forEach((t) => t.stop()); s.ac && s.ac.close().catch(() => {}); s.lock && s.lock.release().catch(() => {}); });
    removeEventListener('online', s.netH); removeEventListener('offline', s.netH);
    if (!keep) { st = null; if (s.chunks.length) W.toast('Oflayn majlis yakunlanmay qoldi — yozuv saqlanmadi', 5000); }
    return p.then(() => s);
  }
  async function finish() {
    if (!confirm('Majlis yakunlansinmi? Yozuv AI tahliliga yuboriladi.')) return;
    S.cleanup = null;
    const s = await stop(true); st = null;
    const blob = new Blob(s.chunks, { type: (s.rec && s.rec.mimeType) || 'audio/webm' });
    const item = { key: 'm' + Date.now(), code: CODE, title: s.title, mode: 'offline', transcript: s.transcript, date: s.date, time: s.time, blob };
    W.$('#view').innerHTML = `<div class="card center" style="max-width:480px;margin:60px auto"><div style="color:var(--acc-ink)">${W.ic('brain', 'xl')}</div><h2 style="margin-top:8px">AI majlisni tinglamoqda…</h2><p class="muted">Spikerlar ajratilmoqda, xulosa va vazifalar tayyorlanmoqda. 10–60 soniya.</p><div class="progress" style="margin-top:16px"><i style="width:100%;animation:pulse 1.4s infinite"></i></div></div>`;
    try { await qPut(item); } catch (_) {}
    if (!navigator.onLine) { W.toast('Internet yo‘q — yozuv qurilmada saqlandi. Internet qaytgach avtomatik yuboriladi.', 7000); return go('meetings'); }
    try { const id = await upload(item); await qDel(item.key); go('meeting', id); }
    catch (e) { W.toast('Yuborib bo‘lmadi: ' + e.message + '. Yozuv saqlandi, keyinroq qayta yuboriladi.', 7000); go('meetings'); }
  }
  async function uploadFile(file) {
    if (!file) return;
    if (file.size > 19 * 1024 * 1024) return W.toast('Fayl 19 MB dan katta. Qisqaroq yoki siqilgan (mp3/m4a) fayl yuklang.', 6000);
    const title = (prompt('Majlis nomi:', file.name.replace(/\.\w+$/, '')) || file.name).slice(0, 100);
    W.$('#view').innerHTML = `<div class="card center" style="max-width:480px;margin:60px auto"><div style="color:var(--acc-ink)">${W.ic('brain', 'xl')}</div><h2 style="margin-top:8px">Audio fayl tahlil qilinmoqda…</h2><p class="muted">${W.esc(file.name)} · ${(file.size / 1048576).toFixed(1)} MB</p><div class="progress" style="margin-top:16px"><i style="width:100%;animation:pulse 1.4s infinite"></i></div></div>`;
    try { const id = await upload({ title, mode: 'fayl', transcript: [], blob: file, ...stamp() }); go('meeting', id); }
    catch (e) { W.toast(e.message, 6000); go('meetings'); }
  }
  return { open, sync, pending: qAll, uploadFile };
})();
