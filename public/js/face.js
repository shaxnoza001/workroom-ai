// Face ID (brauzer ichida): SSD MobileNet detektor + 68 nuqta + 128 o'lchamli yuz izi.
// Serverga rasm emas, faqat 128 ta raqam yuboriladi. "Tirik yuz" — boshni yon tomonga burish (rasm/kiyim o'tmaydi).
const Face = (() => {
  const LIB = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.14/dist/face-api.js';
  const MODELS = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.14/model/';
  let ready = null, useSsd = true;

  function loadScript(src) {
    return new Promise((ok, fail) => {
      const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => fail(new Error('Face ID kutubxonasi yuklanmadi (internetni tekshiring)'));
      document.head.appendChild(s);
    });
  }
  function load() {
    if (!ready) ready = (async () => {
      if (!window.faceapi) await loadScript(LIB);
      if (faceapi.tf && faceapi.tf.ready) await faceapi.tf.ready();
      try { await faceapi.nets.ssdMobilenetv1.loadFromUri(MODELS); } catch (_) { useSsd = false; await faceapi.nets.tinyFaceDetector.loadFromUri(MODELS); }
      await Promise.all([faceapi.nets.faceLandmark68Net.loadFromUri(MODELS), faceapi.nets.faceRecognitionNet.loadFromUri(MODELS)]);
    })().catch((e) => { ready = null; throw e; });
    return ready;
  }
  async function startCam(video) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('Kamera ochilmadi. Saytni https orqali Chrome yoki Safari’da oching.');
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false }); }
    catch (e) { throw new Error(e.name === 'NotAllowedError' ? 'Kameraga ruxsat berilmadi. Manzil satridagi kamera belgisidan ruxsat bering.' : 'Kamera topilmadi yoki band.'); }
    video.setAttribute('playsinline', ''); video.setAttribute('muted', ''); video.setAttribute('autoplay', '');
    video.muted = true; video.playsInline = true; video.srcObject = stream;
    try { await video.play(); } catch (_) { /* iOS: foydalanuvchi bosgandan keyin o'ynaydi */ }
    if (!video.videoWidth) await new Promise((r) => { video.onloadedmetadata = r; setTimeout(r, 3000); });
    return stream;
  }
  function stopCam(stream) { if (stream) stream.getTracks().forEach((t) => t.stop()); }
  const opts = () => (useSsd ? new faceapi.SsdMobilenetv1Options({ minConfidence: 0.6, maxResults: 1 }) : new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.6 }));
  async function detect(video, withDesc = true) {
    if (!video.videoWidth) return null;
    const q = faceapi.detectSingleFace(video, opts()).withFaceLandmarks();
    return withDesc ? q.withFaceDescriptor() : q;
  }
  // Bosh burilishi (yaw): 0 — to'g'ri, ±0.2 — yon tomonga burilgan
  function yaw(det) {
    const p = det.landmarks.positions;
    const L = avg(p.slice(36, 42)), R = avg(p.slice(42, 48)), nose = p[30];
    return (nose.x - L.x) / Math.max(1, R.x - L.x) - 0.5;
  }
  const avg = (pts) => ({ x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length });
  // Yuz haqiqatan yuzmi va kadrga to'g'ri tushganmi
  function quality(video, det) {
    // Chegaralar 22 ta haqiqiy yuzda o'lchab tanlangan (oddiy qarash ham ±0.27 burilish beradi)
    const b = det.detection.box, W = video.videoWidth, H = video.videoHeight, p = det.landmarks.positions;
    if (det.detection.score < 0.6) return 'Yuz aniq ko‘rinmayapti — yorug‘roq joyga o‘ting';
    if (b.width < W * 0.16) return 'Kameraga yaqinroq keling';
    if (b.width > W * 0.85) return 'Biroz uzoqroq turing';
    const ar = b.height / b.width; if (ar < 0.7 || ar > 1.9) return 'Kameraga qarang';
    const L = avg(p.slice(36, 42)), R = avg(p.slice(42, 48)), nose = p[30], mouth = avg(p.slice(48, 68));
    const eyeD = R.x - L.x;
    if (eyeD < b.width * 0.2 || !(L.y < nose.y && R.y < nose.y && nose.y < mouth.y)) return 'Kameraga qarang';
    if (Math.abs(yaw(det)) > 0.45) return 'Kameraga ko‘proq to‘g‘ri qarang';
    const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
    if (Math.abs(cx - W / 2) > W * 0.26 || Math.abs(cy - H / 2) > H * 0.3) return 'Yuzingizni oval markaziga keltiring';
    return null;
  }
  // Toza ramka: faqat yuz burchaklari (nuqtalar yo'q)
  function draw(canvas, video, det, state) {
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, canvas.width, canvas.height);
    const cam = canvas.parentElement; if (cam) cam.classList.toggle('found', !!det);
    if (!det) return;
    const b = det.detection.box, pad = b.width * 0.12;
    const x = b.x - pad, y = b.y - pad * 1.3, w = b.width + pad * 2, h = b.height + pad * 2.2, L = Math.min(w, h) * 0.2;
    ctx.strokeStyle = state === 'ok' ? '#21c99a' : state === 'bad' ? '#f5a524' : 'rgba(255,255,255,.9)';
    ctx.lineWidth = Math.max(3, w * 0.018); ctx.lineCap = 'round';
    ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = state === 'ok' ? 18 : 6;
    ctx.beginPath();
    [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]].forEach(([px, py, sx, sy]) => { ctx.moveTo(px, py + sy * L); ctx.lineTo(px, py); ctx.lineTo(px + sx * L, py); });
    ctx.stroke();
  }
  function snapshot(video, det) {
    const c = document.createElement('canvas'); const S = 160; c.width = S; c.height = S;
    const ctx = c.getContext('2d');
    let sx = 0, sy = 0, sw = video.videoWidth, sh = video.videoHeight;
    if (det) { const b = det.detection.box; const pad = b.width * 0.45; sw = sh = b.width + pad * 2; sx = b.x - pad; sy = b.y - pad * 1.1; }
    ctx.translate(S, 0); ctx.scale(-1, 1);
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, S, S);
    return c.toDataURL('image/jpeg', 0.78);
  }
  const dist = (a, b) => Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0));
  const mean = (list) => list[0].map((_, i) => list.reduce((s, d) => s + d[i], 0) / list.length);

  // Ro'yxatga olish: 5 ta sifatli namuna (tabiiy kichik harakatlar bilan), hammasi bitta yuzga tegishli bo'lishi tekshiriladi
  function enroll(video, canvas, { onStatus, onProgress, signal } = {}) {
    return new Promise((resolve, reject) => {
      let got = [], photo = null, lastT = 0;
      const tick = async () => {
        if (signal && signal.aborted) return reject(new Error('bekor'));
        try {
          const det = await detect(video, true);
          if (!det) { draw(canvas, video, null); onStatus && onStatus('Kameraga qarang'); }
          else {
            const q = quality(video, det);
            draw(canvas, video, det, q ? 'bad' : 'ok');
            if (q) onStatus && onStatus(q);
            else if (Date.now() - lastT > 280) {
              lastT = Date.now(); got.push(Array.from(det.descriptor));
              if (!photo || got.length === 2) photo = snapshot(video, det);
              onProgress && onProgress(got.length / 5);
              onStatus && onStatus(got.length < 5 ? 'Skaner qilinmoqda… kameraga qarab turing' : 'Tayyor ✓');
              if (got.length >= 5) {
                const m = mean(got);
                if (got.some((d) => dist(d, m) > 0.42)) { got = []; photo = null; onProgress && onProgress(0); onStatus && onStatus('Kadrda boshqa yuz aralashdi — qaytadan, faqat bitta odam qarasin'); }
                else return resolve({ descriptors: got, photo });
              }
            }
          }
        } catch (e) { return reject(e); }
        requestAnimationFrame(tick);
      };
      tick();
    });
  }
  // Tirik yuz: boshlang'ich holatga nisbatan boshni yon tomonga burish va qaytish (tekis rasm/ekranda burilish o'zgarmaydi)
  function liveness(video, canvas, { onStatus, signal, timeout = 10000 } = {}) {
    return new Promise((resolve) => {
      const t0 = Date.now(); let phase = 0, base = null, n = 0, lastBox = null, peak = 0;
      const tick = async () => {
        if ((signal && signal.aborted) || Date.now() - t0 > timeout) return resolve(null);
        try {
          const det = await detect(video, phase === 2);
          if (!det) { draw(canvas, video, null); onStatus && onStatus('Yuzingizni kameradan uzoqlashtirmang'); }
          else {
            const b = det.detection.box;
            if (lastBox && Math.abs((b.x + b.width / 2) - (lastBox.x + lastBox.width / 2)) > lastBox.width * 0.9) return resolve(null); // boshqa odam
            lastBox = b;
            const y = yaw(det);
            if (base === null || n < 2) { base = base === null ? y : (base + y) / 2; n++; }
            const d = Math.abs(y - base); peak = Math.max(peak, d);
            draw(canvas, video, det, phase === 2 ? 'ok' : null);
            if (phase === 0) { onStatus && onStatus('↔ Boshingizni sekin chapga yoki o‘ngga burang'); if (n >= 2 && d >= 0.15) phase = 1; }
            else if (phase === 1) { onStatus && onStatus('Zo‘r! Endi yana kameraga qarang'); if (d <= Math.max(0.08, peak * 0.4)) phase = 2; }
            else if (det.descriptor && !quality(video, det)) return resolve(det);
          }
        } catch (_) { return resolve(null); }
        requestAnimationFrame(tick);
      };
      tick();
    });
  }
  return { load, startCam, stopCam, detect, draw, quality, snapshot, enroll, liveness, yaw };
})();
