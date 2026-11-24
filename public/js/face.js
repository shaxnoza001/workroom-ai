// Face ID inside the platform: works with any phone/laptop camera (no special hardware).
// Uses face-api.js (runs in the browser; only 128-number face "fingerprint" is sent to server).
const Face = (() => {
  const LIB = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.14/dist/face-api.js';
  const MODELS = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.14/model/';
  let ready = null;

  function loadScript(src) {
    return new Promise((ok, fail) => {
      const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => fail(new Error('Face ID kutubxonasi yuklanmadi (internetni tekshiring)'));
      document.head.appendChild(s);
    });
  }
  function load() {
    if (!ready) ready = (async () => {
      if (!window.faceapi) await loadScript(LIB);
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(MODELS),
        faceapi.nets.faceLandmark68Net.loadFromUri(MODELS),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODELS),
      ]);
    })();
    return ready;
  }
  async function startCam(video) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('Bu brauzer kamerani qo‘llamaydi. Chrome yoki Safari’dan oching (https kerak).');
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
    video.srcObject = stream; video.muted = true; video.playsInline = true;
    await video.play();
    return stream;
  }
  function stopCam(stream) { if (stream) stream.getTracks().forEach((t) => t.stop()); }
  async function detect(video) {
    if (!video.videoWidth) return null;
    return faceapi.detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }))
      .withFaceLandmarks().withFaceDescriptor();
  }
  function draw(canvas, video, det, ok) {
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!det) return;
    const b = det.detection.box;
    ctx.strokeStyle = ok ? '#22d3a6' : '#5b7cff'; ctx.lineWidth = 3;
    const r = 14; ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(b.x, b.y, b.width, b.height, r) : ctx.rect(b.x, b.y, b.width, b.height);
    ctx.stroke();
    ctx.fillStyle = ok ? '#22d3a6' : '#9fb2ff';
    det.landmarks.positions.forEach((p, i) => { if (i % 3 === 0) { ctx.beginPath(); ctx.arc(p.x, p.y, 1.6, 0, 7); ctx.fill(); } });
  }
  // Quality gate: face big enough & roughly centered
  function quality(video, det) {
    const b = det.detection.box, W = video.videoWidth, H = video.videoHeight;
    if (b.width < W * 0.18) return 'Yaqinroq keling';
    const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
    if (Math.abs(cx - W / 2) > W * 0.22 || Math.abs(cy - H / 2) > H * 0.25) return 'Yuzingizni doira markaziga keltiring';
    if (det.detection.score < 0.7) return 'Yorug‘roq joyga o‘ting';
    return null;
  }
  function snapshot(video, det) {
    const c = document.createElement('canvas'); const S = 160; c.width = S; c.height = S;
    const ctx = c.getContext('2d');
    let sx = 0, sy = 0, sw = video.videoWidth, sh = video.videoHeight;
    if (det) { const b = det.detection.box; const pad = b.width * 0.45; sw = sh = b.width + pad * 2; sx = b.x - pad; sy = b.y - pad * 1.1; }
    ctx.translate(S, 0); ctx.scale(-1, 1);
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, S, S);
    return c.toDataURL('image/jpeg', 0.75);
  }
  // Collect N good samples for enrollment
  function enroll(video, canvas, { samples = 5, onStatus, onProgress, signal } = {}) {
    return new Promise((resolve, reject) => {
      const got = []; let photo = null; let lastT = 0;
      const tick = async () => {
        if (signal && signal.aborted) return reject(new Error('bekor'));
        try {
          const det = await detect(video);
          if (!det) { draw(canvas, video, null); onStatus && onStatus('Yuz topilmadi — kameraga qarang'); }
          else {
            const q = quality(video, det); draw(canvas, video, det, !q);
            if (q) onStatus && onStatus(q);
            else if (Date.now() - lastT > 350) {
              lastT = Date.now(); got.push(Array.from(det.descriptor));
              if (!photo) photo = snapshot(video, det);
              onProgress && onProgress(got.length / samples);
              onStatus && onStatus(got.length < samples ? (got.length === 2 ? 'Boshingizni sal chapga-o‘ngga burang' : 'Skaner qilinmoqda…') : 'Tayyor ✓');
              if (got.length >= samples) return resolve({ descriptors: got, photo });
            }
          }
        } catch (e) { return reject(e); }
        requestAnimationFrame(tick);
      };
      tick();
    });
  }
  return { load, startCam, stopCam, detect, draw, quality, snapshot, enroll };
})();
