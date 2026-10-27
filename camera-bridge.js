/* Runs in the meeting's MAIN world before camera requests.
 * Intent: no uploads, no audio replacement, no automatic microphone permission.
 * Prototype uses clean-plate differencing, NOT semantic person segmentation.
 * Changes in the room and shadows may dissolve too. Not a privacy tool.
 */
(() => {
  'use strict';
  if (window.__snapDustInstalled || !navigator.mediaDevices?.getUserMedia) return;
  window.__snapDustInstalled = true;
  const nativeGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  const sessions = new Set();
  let enabled = false, armed = false, microphone = null, audioContext = null, audioTimer = null, listenGeneration = 0;
  let resolveReady;
  const ready = new Promise(resolve => { resolveReady = resolve; setTimeout(resolve, 1500); });
  const emit = (text, extra = {}) => window.postMessage({ channel: 'snap-dust-status', text, ...extra }, location.origin);
  function stopListening() {
    armed = false; listenGeneration++;
    clearInterval(audioTimer); audioTimer = null;
    microphone?.getTracks().forEach(track => track.stop()); microphone = null;
    audioContext?.close().catch(() => {}); audioContext = null;
    emit('Snap listening off', { listening: false });
  }
  async function listen() {
    if (armed) { stopListening(); return; }
    armed = true;
    const generation = ++listenGeneration;
    emit('Requesting microphone — click again to cancel', { listening: true });
    try {
      const stream = await nativeGetUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false });
      if (!armed || generation !== listenGeneration || sessions.size === 0) { stream.getTracks().forEach(t => t.stop()); return; }
      microphone = stream;
      audioContext = new AudioContext(); await audioContext.resume();
      if (!armed || generation !== listenGeneration) return;
      const source = audioContext.createMediaStreamSource(stream);
      const filter = audioContext.createBiquadFilter(); filter.type = 'highpass'; filter.frequency.value = 1800;
      const analyser = audioContext.createAnalyser(); analyser.fftSize = 1024;
      source.connect(filter).connect(analyser); // Never connected to speakers or meeting audio.
      const samples = new Float32Array(analyser.fftSize);
      let floor = 0.003, previous = 0, lastSnap = 0;
      audioTimer = setInterval(() => {
        analyser.getFloatTimeDomainData(samples);
        const energy = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
        const now = performance.now();
        if (energy > 0.035 && energy > floor * 5 && energy > previous * 1.7 && now - lastSnap > 2200) {
          lastSnap = now; trigger();
        }
        floor = floor * 0.97 + Math.min(energy, floor * 2) * 0.03; previous = energy;
      }, 12);
      emit('Listening locally — sharp clicks or claps may also trigger', { listening: true });
    } catch (error) { if (generation === listenGeneration) { stopListening(); emit(`Microphone unavailable: ${error.name}`); } }
  }
  function trigger() {
    let count = 0;
    for (const session of sessions) if (session.snap()) count++;
    if (!count) emit([...sessions].some(session => session.hasPlate()) ? 'Already disappearing or invisible — click Reappear first' : 'Capture an empty room first, then step back into view');
  }
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.channel !== 'snap-dust-command') return;
    const { command } = event.data;
    if (command === 'configure') { enabled = event.data.enabled === true; resolveReady(); return; }
    if (!enabled) return;
    if (command === 'snap') trigger();
    if (command === 'plate') for (const session of sessions) session.plate();
    if (command === 'return') for (const session of sessions) session.reset();
    if (command === 'listen' && sessions.size) void listen();
  });
  navigator.mediaDevices.getUserMedia = async function (constraints) {
    await ready;
    const stream = await nativeGetUserMedia(constraints);
    if (!enabled || !constraints?.video || !stream.getVideoTracks().length) return stream;
    let session;
    try { session = await createSession(stream); sessions.add(session); emit('Camera ready — step out and capture the empty room', { active: true }); return session.output; }
    catch (error) { session?.dispose(); stream.getTracks().forEach(track => track.stop()); throw error; }
  };
  async function createSession(input) {
    const original = input.getVideoTracks()[0];
    const video = document.createElement('video'); video.muted = true; video.playsInline = true; video.srcObject = input;
    try { await video.play(); } catch (error) { video.srcObject = null; throw error; }
    const settings = original.getSettings();
    const width = Math.min(960, video.videoWidth || settings.width || 640);
    const height = Math.round(width * (video.videoHeight || settings.height || 480) / (video.videoWidth || settings.width || 640));
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const foreground = document.createElement('canvas'); foreground.width = width; foreground.height = height;
    const fg = foreground.getContext('2d');
    let clean = null, state = 'live', start = 0, particles = [], timer, closed = false;
    ctx.drawImage(video, 0, 0, width, height);
    const output = canvas.captureStream(30);
    input.getAudioTracks().forEach(track => output.addTrack(track)); // Preserve original meeting microphone tracks.
    const transformed = output.getVideoTracks()[0];
    const session = {
      output,
      hasPlate() { return clean !== null; },
      plate() { if (closed) return; ctx.drawImage(video, 0, 0, width, height); clean = ctx.getImageData(0, 0, width, height); state = 'live'; emit('Empty room saved — return to your position, then snap'); },
      reset() { state = 'live'; particles = []; emit('You are visible again'); },
      snap() {
        if (!clean || state !== 'live' || closed) return false;
        ctx.drawImage(video, 0, 0, width, height);
        const frozen = ctx.getImageData(0, 0, width, height);
        particles = [];
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
          const p = y * width + x, i = p * 4;
          const diff = Math.max(Math.abs(frozen.data[i] - clean.data[i]), Math.abs(frozen.data[i + 1] - clean.data[i + 1]), Math.abs(frozen.data[i + 2] - clean.data[i + 2]));
          if (diff > 32) {
            if (x % 4 === 0 && y % 4 === 0) particles.push({ x, y, delay: (1 - x / width) * 850 + Math.random() * 200, vx: 45 + Math.random() * 120, vy: -35 - Math.random() * 85, size: 1 + Math.random() * 2.6, color: `rgb(${frozen.data[i]},${frozen.data[i + 1]},${frozen.data[i + 2]})` });
          } else frozen.data[i + 3] = 0;
        }
        fg.putImageData(frozen, 0, 0); start = performance.now(); state = 'dust';
        emit('Turning to dust…'); return true;
      },
      dispose() {
        if (closed) return; closed = true; clearInterval(timer);
        original.stop(); nativeStop(); video.pause(); video.srcObject = null;
        sessions.delete(session); clean = null; particles = [];
        if (!sessions.size) { stopListening(); emit('Camera stopped', { active: false }); }
      }
    };
    const nativeStop = transformed.stop.bind(transformed);
    // A meeting normally stops the outgoing replacement track, not the hidden source.
    Object.defineProperty(transformed, 'stop', { value: () => session.dispose() });
    transformed.addEventListener('ended', () => session.dispose());
    original.addEventListener('ended', () => session.dispose());
    function render() {
      if (closed) return;
      try {
        if (state === 'live') { ctx.drawImage(video, 0, 0, width, height); return; }
        ctx.putImageData(clean, 0, 0);
        if (state === 'gone') return;
        const elapsed = performance.now() - start;
        // A right-to-left erasure front removes the frozen difference silhouette.
        ctx.save(); ctx.beginPath(); ctx.rect(0, 0, Math.max(0, width * (1 - elapsed / 1100)), height); ctx.clip(); ctx.drawImage(foreground, 0, 0); ctx.restore();
        for (const p of particles) {
          const age = (elapsed - p.delay) / 1000;
          if (age < 0 || age > 1.9) continue;
          ctx.globalAlpha = Math.max(0, 1 - age / 1.9); ctx.fillStyle = p.color;
          ctx.fillRect(p.x + p.vx * age + Math.sin(age * 8 + p.y) * age * 12, p.y + p.vy * age, p.size, p.size);
        }
        ctx.globalAlpha = 1;
        if (elapsed > 3100) { state = 'gone'; particles = []; emit('Disappeared — click Reappear to return'); }
      } catch (error) { emit(`Camera effect stopped: ${error.name}`); session.dispose(); }
    }
    // Timer rather than rAF; background tabs may still be throttled by Chrome.
    timer = setInterval(render, 1000 / 30);
    return session;
  }
  window.addEventListener('pagehide', () => { for (const session of [...sessions]) session.dispose(); stopListening(); });
})();
