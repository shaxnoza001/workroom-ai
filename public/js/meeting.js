// Ichki video-majlis (Zoom'ga o'xshash, WebRTC) + Meeting AI (o'zbekcha jonli subtitr + yozib olish + Gemini tahlil)
const Meeting = (() => {
  const W = WR;
  let st = null;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

  async function open(id) {
    const m = (await W.api(`/api/rooms/${CODE}/meetings/${id}`, {}, CODE)).meeting;
    if (m.status !== 'live') return go('meeting', id);
    const myName = S.me ? S.me.name : 'Rahbar';
    st = { id, m, myName, peers: {}, local: null, cam: true, mic: true, listening: false, rec: null, chunks: [], ac: null, dest: null, sources: new Set(), handlers: {}, ice: null };
    S.cleanup = leave;
    history.replaceState(null, '', '#meet=' + id);
    render();
    try { st.ice = (await W.api('/api/ice')).iceServers; } catch (_) { st.ice = [{ urls: 'stun:stun.l.google.com:19302' }]; }
    try { st.local = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 360 }, facingMode: 'user' }, audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch (_) {
      try { st.local = await navigator.mediaDevices.getUserMedia({ audio: true }); st.cam = false; W.toast('Kamera topilmadi — faqat ovoz'); }
      catch (e) { st.local = new MediaStream(); st.cam = st.mic = false; W.toast('Mikrofon/kamera ruxsati berilmadi'); }
    }
    tile('me', myName + ' (siz)', st.local, true);
    bindSocket();
    socket.emit('meet:join', { code: CODE, meetingId: id, name: myName });
    if (SR) startListening(); else W.$('#m-sr').innerHTML = 'Jonli subtitr uchun Chrome/Edge kerak. Yozuv baribir AI’ga yuboriladi.';
    if (S.admin) startRecording();
    syncButtons();
  }

  function render() {
    W.$('#view').innerHTML = `
      <div class="top"><div><a href="javascript:go('meetings')" class="small">← Majlislar</a><h1><span class="live-dot"></span>${W.esc(st.m.title)}</h1></div>
        <div class="row"><span class="badge" id="m-count">1 ishtirokchi</span>${S.admin ? '<span class="badge bad hidden" id="m-recb">AI yozib olmoqda</span>' : ''}</div></div>
      <div class="meet">
        <div>
          <div class="videos" id="videos"></div>
          <div class="controls">
            <button class="ctl" id="b-mic" title="Mikrofon">${W.ic('mic')}</button>
            <button class="ctl" id="b-cam" title="Kamera">${W.ic('cam')}</button>
            <button class="ctl" id="b-screen" title="Ekran ulashish">${W.ic('screen')}</button>
            <button class="ctl" id="b-ai" title="AI tinglash (subtitr)">${W.ic('brain')}</button>
            ${S.admin ? `<button class="btn bad" id="b-end">${W.ic('stop')} Yakunlash va AI tahlil</button>` : '<button class="btn bad" id="b-leave">Chiqish</button>'}
          </div>
          <p class="small muted center" id="m-sr" style="margin-top:8px">AI o‘zbek tilida tinglayapti — har kim o‘z qurilmasida gapirsa, ismi bilan yoziladi.</p>
          <p class="small muted center">Taklif: xodimlar <b>${location.host}</b> → kod <b>#${CODE}</b> → Majlislar → “Qo‘shilish”.</p>
        </div>
        <div class="card panel">
          <div class="tabs"><button class="on" data-t="tr">Transkript</button><button data-t="chat">Chat</button><button data-t="ppl">Ishtirokchilar</button></div>
          <div class="feed" id="p-tr">${st.m.transcript.map(lineHtml).join('')}<div class="line interim" id="interim"></div></div>
          <div class="feed hidden" id="p-chat"></div>
          <div class="feed hidden" id="p-ppl"></div>
          <form id="chat-f" class="row hidden" style="margin-top:8px;flex-wrap:nowrap"><input id="chat-i" placeholder="Xabar…"><button class="btn sm">➤</button></form>
        </div>
      </div>`;
    W.$$('.tabs button').forEach((b) => (b.onclick = () => {
      W.$$('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
      ['tr', 'chat', 'ppl'].forEach((t) => W.$('#p-' + t).classList.toggle('hidden', t !== b.dataset.t));
      W.$('#chat-f').classList.toggle('hidden', b.dataset.t !== 'chat');
      if (b.dataset.t === 'ppl') renderPeople();
    }));
    W.$('#chat-f').onsubmit = (e) => { e.preventDefault(); const v = W.$('#chat-i').value.trim(); if (v) socket.emit('meet:chat', { text: v }); W.$('#chat-i').value = ''; };
    W.$('#b-mic').onclick = toggleMic; W.$('#b-cam').onclick = toggleCam; W.$('#b-screen').onclick = shareScreen;
    W.$('#b-ai').onclick = () => (st.listening ? stopListening() : startListening());
    if (S.admin) W.$('#b-end').onclick = endMeeting; else W.$('#b-leave').onclick = () => go('meetings');
  }
  const lineHtml = (l) => `<div class="line"><b>${W.esc(l.name)}:</b> ${W.esc(l.text)}</div>`;
  function scrollFeed() { const f = W.$('#p-tr'); if (f) f.scrollTop = f.scrollHeight; }

  function tile(key, name, stream, me) {
    let el = document.getElementById('t-' + key);
    if (!el) {
      el = document.createElement('div'); el.className = 'vtile' + (me ? ' me' : ''); el.id = 't-' + key;
      el.innerHTML = `<video autoplay playsinline ${me ? 'muted' : ''}></video><div class="cap hidden"></div><div class="nm">${W.esc(name)}</div>`;
      W.$('#videos').appendChild(el);
    }
    if (stream) { const v = el.querySelector('video'); if (v.srcObject !== stream) { v.srcObject = stream; v.play().catch(() => {}); } }
    updateCount();
    return el;
  }
  function updateCount() { const c = W.$('#m-count'); if (c) c.textContent = W.$$('.vtile').length + ' ishtirokchi'; }
  function renderPeople() {
    W.$('#p-ppl').innerHTML = [`<div class="list-item">${W.esc(st.myName)} (siz)</div>`, ...Object.values(st.peers).map((p) => `<div class="list-item">${W.esc(p.name)}</div>`)].join('');
  }
  function showCaption(key, name, text, final) {
    const el = document.getElementById('t-' + key); if (!el) return;
    const c = el.querySelector('.cap'); c.textContent = text; c.classList.remove('hidden'); el.classList.add('talk');
    clearTimeout(c._t); c._t = setTimeout(() => { c.classList.add('hidden'); el.classList.remove('talk'); }, final ? 2500 : 4000);
  }

  // ---- WebRTC mesh ----
  function pc(sid, name) {
    if (st.peers[sid]) return st.peers[sid].pc;
    const conn = new RTCPeerConnection({ iceServers: st.ice });
    st.peers[sid] = { pc: conn, name, stream: null };
    st.local.getTracks().forEach((t) => conn.addTrack(t, st.local));
    if (st.screen) { const s = conn.getSenders().find((x) => x.track && x.track.kind === 'video'); if (s) s.replaceTrack(st.screen.getVideoTracks()[0]); }
    conn.onicecandidate = (e) => e.candidate && socket.emit('meet:signal', { to: sid, data: { candidate: e.candidate } });
    conn.ontrack = (e) => {
      const stream = e.streams[0]; st.peers[sid].stream = stream; tile(sid, name, stream);
      if (st.dest && stream.getAudioTracks().length) mix(stream);
    };
    conn.onconnectionstatechange = () => { if (['failed', 'closed'].includes(conn.connectionState)) drop(sid); };
    tile(sid, name, null);
    return conn;
  }
  function drop(sid) {
    const p = st.peers[sid]; if (!p) return;
    try { p.pc.close(); } catch (_) {}
    delete st.peers[sid]; const el = document.getElementById('t-' + sid); if (el) el.remove(); updateCount();
  }
  function bindSocket() {
    const h = st.handlers;
    h['meet:peers'] = async (list) => {
      for (const p of list) {
        const conn = pc(p.sid, p.name);
        const offer = await conn.createOffer(); await conn.setLocalDescription(offer);
        socket.emit('meet:signal', { to: p.sid, data: { sdp: conn.localDescription } });
      }
    };
    h['meet:joined'] = ({ sid, name }) => { W.toast(`${name} qo‘shildi`); st.peers[sid] || (st.pendingNames = { ...(st.pendingNames || {}), [sid]: name }); };
    h['meet:signal'] = async ({ from, name, data }) => {
      const conn = pc(from, name || (st.pendingNames || {})[from] || 'Ishtirokchi');
      if (data.sdp) {
        await conn.setRemoteDescription(data.sdp);
        if (data.sdp.type === 'offer') { const a = await conn.createAnswer(); await conn.setLocalDescription(a); socket.emit('meet:signal', { to: from, data: { sdp: conn.localDescription } }); }
      } else if (data.candidate) { try { await conn.addIceCandidate(data.candidate); } catch (_) {} }
    };
    h['meet:left'] = ({ sid }) => drop(sid);
    h['meet:full'] = () => W.toast('Majlis to‘la (12 kishi). Xonadagi oflayn rejimdan foydalaning.', 6000);
    h['meet:caption'] = ({ sid, name, text, final }) => showCaption(sid, name, text, final);
    h['meet:line'] = (l) => { const i = W.$('#interim'); if (i) { i.insertAdjacentHTML('beforebegin', lineHtml(l)); scrollFeed(); } };
    h['meet:chat'] = (c) => { const f = W.$('#p-chat'); if (f) { f.insertAdjacentHTML('beforeend', `<div class="line"><b>${W.esc(c.name)}:</b> ${W.esc(c.text)}</div>`); f.scrollTop = f.scrollHeight; } };
    h['meet:ended'] = () => { if (!S.admin) { W.toast('Majlis yakunlandi. AI natijalari “Majlislar”da.', 5000); go('meetings'); } };
    Object.entries(h).forEach(([k, f]) => socket.on(k, f));
  }

  // ---- Controls ----
  function toggleMic() {
    st.mic = !st.mic; st.local.getAudioTracks().forEach((t) => (t.enabled = st.mic));
    if (!st.mic) stopListening(true); else if (SR && st.wantListen) startListening();
    syncButtons();
  }
  function toggleCam() { st.cam = !st.cam; st.local.getVideoTracks().forEach((t) => (t.enabled = st.cam)); syncButtons(); }
  async function shareScreen() {
    if (st.screen) return stopScreen();
    try {
      st.screen = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const track = st.screen.getVideoTracks()[0];
      Object.values(st.peers).forEach((p) => { const s = p.pc.getSenders().find((x) => x.track && x.track.kind === 'video'); if (s) s.replaceTrack(track); });
      W.$('#t-me video').srcObject = st.screen; W.$('#t-me').classList.remove('me');
      track.onended = stopScreen; syncButtons();
    } catch (_) { W.toast('Ekran ulashish bekor qilindi yoki telefoningizda qo‘llanmaydi'); }
  }
  function stopScreen() {
    if (!st || !st.screen) return;
    st.screen.getTracks().forEach((t) => t.stop()); st.screen = null;
    const cam = st.local.getVideoTracks()[0];
    Object.values(st.peers).forEach((p) => { const s = p.pc.getSenders().find((x) => x.track && x.track.kind === 'video'); if (s && cam) s.replaceTrack(cam); });
    const v = W.$('#t-me video'); if (v) { v.srcObject = st.local; W.$('#t-me').classList.add('me'); }
    syncButtons();
  }
  function syncButtons() {
    if (!W.$('#b-mic')) return;
    W.$('#b-mic').classList.toggle('off', !st.mic); W.$('#b-cam').classList.toggle('off', !st.cam);
    W.$('#b-screen').classList.toggle('rec', !!st.screen); W.$('#b-ai').classList.toggle('off', !st.listening);
  }

  // ---- Meeting AI: jonli o'zbekcha subtitr (Web Speech API, uz-UZ) ----
  function startListening() {
    if (!SR || !st.mic) return;
    st.wantListen = true;
    if (st.listening) return;
    const r = new SR(); r.lang = 'uz-UZ'; r.continuous = true; r.interimResults = true; r.maxAlternatives = 1;
    let lastSent = 0;
    r.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript.trim(); if (!t) continue;
        if (e.results[i].isFinal) { socket.emit('meet:caption', { text: t, final: true }); showCaption('me', st.myName, t, true); }
        else interim += t + ' ';
      }
      const iEl = W.$('#interim'); if (iEl) iEl.textContent = interim ? `${st.myName}: ${interim}` : '';
      if (interim && Date.now() - lastSent > 500) { lastSent = Date.now(); socket.emit('meet:caption', { text: interim, final: false }); showCaption('me', st.myName, interim, false); }
    };
    r.onerror = (e) => { if (e.error === 'not-allowed') { st.wantListen = false; W.toast('Mikrofon ruxsati yo‘q — subtitr o‘chdi'); } };
    r.onend = () => { st.listening = false; if (st && st.wantListen && st.mic) setTimeout(startListening, 250); syncButtons(); };
    try { r.start(); st.sr = r; st.listening = true; } catch (_) {}
    syncButtons();
  }
  function stopListening(keepWish) { if (!st) return; if (!keepWish) st.wantListen = false; st.listening = false; try { st.sr && st.sr.stop(); } catch (_) {} syncButtons(); }

  // ---- Meeting AI: butun majlis ovozini yozib olish (admin qurilmasida, hamma ovozi aralashtiriladi) ----
  function mix(stream) {
    if (!st.ac || st.sources.has(stream.id) || !stream.getAudioTracks().length) return;
    st.sources.add(stream.id);
    try { st.ac.createMediaStreamSource(stream).connect(st.dest); } catch (_) {}
  }
  function startRecording() {
    if (!window.MediaRecorder || !st.local.getAudioTracks().length) return;
    st.ac = new (window.AudioContext || window.webkitAudioContext)();
    st.dest = st.ac.createMediaStreamDestination();
    mix(st.local); Object.values(st.peers).forEach((p) => p.stream && mix(p.stream));
    const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((t) => MediaRecorder.isTypeSupported(t)) || '';
    st.rec = new MediaRecorder(st.dest.stream, { mimeType: type, audioBitsPerSecond: 24000 });
    st.rec.ondataavailable = (e) => e.data.size && st.chunks.push(e.data);
    st.rec.start(5000);
    const b = W.$('#m-recb'); if (b) b.classList.remove('hidden');
  }
  function stopRecording() {
    return new Promise((res) => {
      if (!st.rec || st.rec.state === 'inactive') return res(null);
      st.rec.onstop = () => res(new Blob(st.chunks, { type: st.rec.mimeType || 'audio/webm' }));
      st.rec.stop();
    });
  }
  async function endMeeting() {
    if (!confirm('Majlis yakunlansinmi? AI xulosa va vazifalar ro‘yxatini tayyorlaydi.')) return;
    stopListening();
    const blob = await stopRecording();
    socket.emit('meet:end');
    W.$('#view').innerHTML = `<div class="card center" style="max-width:480px;margin:60px auto"><div style="color:var(--acc-ink)">${W.ic('brain','xl')}</div><h2>AI majlisni tahlil qilmoqda…</h2><p class="muted">Ovoz tinglanmoqda, vazifalar ajratilmoqda. 10–60 soniya.</p><div class="progress" style="margin-top:16px"><i style="width:100%;animation:pulse 1.4s infinite"></i></div></div>`;
    const id = st.id; teardown();
    try {
      const big = blob && blob.size > 19 * 1024 * 1024;
      if (big) W.toast('Yozuv juda katta — faqat matn tahlil qilinadi');
      await W.api(`/api/rooms/${CODE}/meetings/${id}/analyze`, blob && !big ? { method: 'POST', body: blob, headers: { 'Content-Type': blob.type || 'audio/webm' } } : { method: 'POST' }, CODE);
    } catch (e) { W.toast('Tahlil xatosi: ' + e.message, 6000); }
    go('meeting', id);
  }
  function teardown() {
    if (!st) return;
    stopListening(); stopScreen();
    if (st.rec && st.rec.state !== 'inactive') try { st.rec.stop(); } catch (_) {}
    if (st.ac) st.ac.close().catch(() => {});
    Object.keys(st.peers).forEach(drop);
    st.local && st.local.getTracks().forEach((t) => t.stop());
    socket.emit('meet:leave');
    Object.entries(st.handlers).forEach(([k, f]) => socket.off(k, f));
    history.replaceState(null, '', location.pathname);
    st = null;
  }
  function leave() {
    if (st && S.admin && st.rec && st.rec.state === 'recording') W.toast('Majlis davom etmoqda. Yakunlash uchun qaytib “Yakunlash va AI tahlil”ni bosing.', 5000);
    teardown();
  }
  return { open };
})();
