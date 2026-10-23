/**
 * Opt-in sensory controls. Call enable and toggle methods from a trusted click;
 * constructing this controller never starts audio, vibration or sensor access.
 * Browser API references (checked 2026-10-23):
 * https://developer.chrome.com/blog/web-audio-autoplay
 * https://developer.mozilla.org/en-US/docs/Web/API/Navigator/vibrate
 * https://developer.mozilla.org/en-US/docs/Web/API/DeviceOrientationEvent/requestPermission_static
 */

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const validReading = reading => reading && Number.isFinite(reading.beta) && Number.isFinite(reading.gamma);
const wrapDegrees = value => ((value + 180) % 360 + 360) % 360 - 180;

/** Convert a calibrated sensor reading to bounded screen-relative parallax. */
export function clampTilt(reading, reference, screenAngle = 0, maximumDegrees = 24) {
  if (!validReading(reading) || !validReading(reference) || !Number.isFinite(screenAngle)
    || !Number.isFinite(maximumDegrees) || maximumDegrees <= 0) return null;
  const dx = wrapDegrees(clamp(reading.gamma, -90, 90) - clamp(reference.gamma, -90, 90));
  const dy = wrapDegrees(clamp(reading.beta, -180, 180) - clamp(reference.beta, -180, 180));
  const angle = screenAngle * Math.PI / 180;
  const x = clamp((dx * Math.cos(angle) + dy * Math.sin(angle)) / maximumDegrees, -1, 1);
  const y = clamp((dy * Math.cos(angle) - dx * Math.sin(angle)) / maximumDegrees, -1, 1);
  return { x: Math.abs(x) < 1e-12 ? 0 : x, y: Math.abs(y) < 1e-12 ? 0 : y };
}

/** A drop-only gate: rejected arrivals never create timers or delayed playback. */
export function createNotificationGate(intervalMs = 350) {
  if (!Number.isFinite(intervalMs) || intervalMs < 0) throw new RangeError('Notification interval must be nonnegative.');
  let lastAllowed = -Infinity;
  return {
    allow(now, { visible = true, enabled = true, role = 'guide' } = {}) {
      if (!Number.isFinite(now) || !visible || !enabled || !['guide', 'visitor'].includes(role)) return false;
      if (now - lastAllowed < intervalMs) return false;
      lastAllowed = now;
      return true;
    },
    reset() { lastAllowed = -Infinity; },
  };
}

/**
 * onTilt({x,y}) receives normalized [-1,1] offsets, including a zero on disable.
 * onStatus({feature,status,message,state}) receives a detached state snapshot.
 * Sound and tilt enable/toggle methods are async; vibration methods are sync.
 * Each enable/toggle method returns the complete current state.
 */
export function createExperienceControls({ onTilt = () => {}, onStatus = () => {} } = {}) {
  const win = globalThis.window;
  const nav = win?.navigator ?? globalThis.navigator;
  const doc = win?.document ?? globalThis.document;
  const Audio = win?.AudioContext ?? win?.webkitAudioContext;
  const Orientation = win?.DeviceOrientationEvent;
  const media = win?.matchMedia?.('(prefers-reduced-motion: reduce)');
  const secure = Boolean(win?.isSecureContext);
  const soundSupported = typeof Audio === 'function';
  const vibrationSupported = typeof nav?.vibrate === 'function';
  const tiltSupported = secure && typeof Orientation !== 'undefined';
  const state = {
    sound: { supported: soundSupported, enabled: false, status: soundSupported ? 'off' : 'unsupported' },
    vibration: { supported: vibrationSupported, enabled: false, status: vibrationSupported ? 'off' : 'unsupported', hardware: 'unknown' },
    tilt: {
      supported: tiltSupported, enabled: false,
      status: !secure ? 'insecure' : !tiltSupported ? 'unsupported' : media?.matches ? 'reduced-motion' : 'off',
      permission: 'unknown', hasSensor: false, explicitOptIn: false,
    },
    reducedMotion: Boolean(media?.matches), destroyed: false,
  };
  const gate = createNotificationGate(350);
  const tones = new Set();
  let audio = null, soundOperation = 0, tiltOperation = 0;
  let reference = null, filtered = { x: 0, y: 0 }, sensorTimer = null, listening = false;

  function getState() {
    return { ...state, sound: { ...state.sound }, vibration: { ...state.vibration }, tilt: { ...state.tilt } };
  }
  function publish(feature, status, message) {
    state[feature].status = status;
    onStatus({ feature, status, message, state: getState() });
    return getState();
  }
  function activationAllowed(feature) {
    if (nav?.userActivation && !nav.userActivation.isActive) {
      publish(feature, 'activation-required', '請點一下按鈕，再開啟這項功能。');
      return false;
    }
    return true;
  }
  function stopTones() {
    for (const tone of tones) {
      try { tone.oscillator.stop(); } catch { /* A scheduled tone may already have ended. */ }
      tone.oscillator.disconnect(); tone.gain.disconnect();
    }
    tones.clear();
  }
  function playNotification(role) {
    if (!audio || audio.state !== 'running' || !state.sound.enabled) return false;
    // An original, quiet two-note sine chime; no recorded messaging-app sound.
    const frequencies = role === 'visitor' ? [523.25, 659.25] : [659.25, 880];
    frequencies.forEach((frequency, i) => {
      const start = audio.currentTime + 0.008 + i * 0.078;
      const oscillator = audio.createOscillator(), gain = audio.createGain();
      oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.035, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.12);
      oscillator.connect(gain); gain.connect(audio.destination);
      const tone = { oscillator, gain }; tones.add(tone);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); tones.delete(tone); };
      oscillator.start(start); oscillator.stop(start + 0.14);
    });
    return true;
  }
  function handleAudioState() {
    if (!state.destroyed && state.sound.enabled && audio?.state !== 'running') {
      state.sound.enabled = false;
      stopTones();
      publish('sound', 'activation-required', '瀏覽器暫停了聲音；點一下即可重新開啟。');
    }
  }
  async function enableSound() {
    if (state.destroyed) return getState();
    if (!soundSupported) return publish('sound', 'unsupported', '這個瀏覽器不支援訊息提示音。');
    if (!activationAllowed('sound')) return getState();
    const operation = ++soundOperation;
    publish('sound', 'enabling', '正在開啟訊息提示音。');
    try {
      // Construct and resume only in this explicitly invoked click path.
      if (!audio || audio.state === 'closed') {
        audio = new Audio({ latencyHint: 'interactive' });
        audio.addEventListener?.('statechange', handleAudioState);
      }
      if (audio.state !== 'running') await audio.resume();
      if (state.destroyed || operation !== soundOperation) {
        if (!state.destroyed && !state.sound.enabled && state.sound.status !== 'enabling' && audio.state === 'running') audio.suspend().catch(() => {});
        return getState();
      }
      if (audio.state !== 'running') return publish('sound', 'blocked', '瀏覽器尚未允許播放聲音，請再點一次。');
      state.sound.enabled = true;
      return publish('sound', 'on', '已開啟輕柔提示音；新對話出現時會播放。');
    } catch {
      if (state.destroyed || operation !== soundOperation) return getState();
      state.sound.enabled = false;
      return publish('sound', 'blocked', '目前無法開啟聲音，請檢查瀏覽器設定後再試。');
    }
  }
  function disableSound() {
    ++soundOperation; state.sound.enabled = false; stopTones();
    if (audio?.state === 'running') audio.suspend().catch(() => {});
    return publish('sound', soundSupported ? 'off' : 'unsupported', '提示音已關閉。');
  }
  async function toggleSound() {
    if (state.destroyed) return getState();
    return state.sound.enabled || state.sound.status === 'enabling' ? disableSound() : enableSound();
  }
  function enableVibration() {
    if (state.destroyed) return getState();
    if (!vibrationSupported) return publish('vibration', 'unsupported', '這個瀏覽器不提供網頁震動功能。');
    if (!activationAllowed('vibration')) return getState();
    try {
      if (!nav.vibrate(12)) {
        state.vibration.enabled = false;
        return publish('vibration', 'blocked', '瀏覽器未接受震動請求。');
      }
      state.vibration.enabled = true;
      // API acceptance cannot establish whether this device has a vibration motor.
      return publish('vibration', 'on', '已允許輕震提醒；實際震動取決於裝置與系統設定。');
    } catch {
      state.vibration.enabled = false;
      return publish('vibration', 'blocked', '目前無法使用震動提醒。');
    }
  }
  function disableVibration() {
    state.vibration.enabled = false;
    if (vibrationSupported) { try { nav.vibrate(0); } catch { /* Cancellation is best effort. */ } }
    return publish('vibration', vibrationSupported ? 'off' : 'unsupported', '震動提醒已關閉。');
  }
  function toggleVibration() {
    if (state.destroyed) return getState();
    return state.vibration.enabled ? disableVibration() : enableVibration();
  }

  function clearSensorTimer() { if (sensorTimer !== null) clearTimeout(sensorTimer); sensorTimer = null; }
  function resetTilt() { reference = null; filtered = { x: 0, y: 0 }; onTilt({ ...filtered }); }
  function detachSensor() {
    clearSensorTimer();
    if (listening) win.removeEventListener('deviceorientation', handleOrientation);
    listening = false;
  }
  function waitForSensor() {
    clearSensorTimer();
    if (doc?.hidden) return;
    sensorTimer = setTimeout(() => {
      if (state.destroyed || !state.tilt.enabled || state.tilt.hasSensor) return;
      detachSensor(); state.tilt.enabled = false; resetTilt();
      publish('tilt', 'unavailable', '沒有收到方向感應資料；這台裝置或瀏覽器可能不支援。');
    }, 4000);
  }
  function handleOrientation(event) {
    if (!state.tilt.enabled || doc?.hidden || !validReading(event)) return;
    if (!reference) reference = { beta: event.beta, gamma: event.gamma };
    const angle = win.screen?.orientation?.angle ?? (typeof win.orientation === 'number' ? win.orientation : 0);
    const offset = clampTilt(event, reference, angle);
    if (!offset) return;
    if (!state.tilt.hasSensor) {
      state.tilt.hasSensor = true; clearSensorTimer();
      publish('tilt', 'on', '已開啟輕微視差；拿著手機慢慢傾斜看看。');
    }
    filtered = { x: filtered.x + (offset.x - filtered.x) * 0.2, y: filtered.y + (offset.y - filtered.y) * 0.2 };
    onTilt({ ...filtered });
  }
  async function enableTilt() {
    if (state.destroyed) return getState();
    if (!secure) return publish('tilt', 'insecure', '手機方向感應需要 HTTPS 安全連線。');
    if (!tiltSupported) return publish('tilt', 'unsupported', '這個瀏覽器不提供方向感應。');
    if (!activationAllowed('tilt')) return getState();
    const operation = ++tiltOperation;
    detachSensor(); resetTilt(); state.tilt.enabled = false; state.tilt.hasSensor = false;
    publish('tilt', 'requesting', '正在確認手機方向感應權限。');
    try {
      if (typeof Orientation.requestPermission === 'function') {
        // This call stays before any unrelated await so transient activation survives.
        const permission = await Orientation.requestPermission();
        if (state.destroyed || operation !== tiltOperation) return getState();
        state.tilt.permission = permission;
        if (permission !== 'granted') return publish('tilt', 'denied', '方向感應未獲允許；仍可正常捲動閱讀。');
      } else state.tilt.permission = 'not-required';
      if (state.destroyed || operation !== tiltOperation) return getState();
      state.tilt.enabled = true; state.tilt.explicitOptIn = true;
      win.addEventListener('deviceorientation', handleOrientation, { passive: true }); listening = true;
      waitForSensor();
      return publish('tilt', 'waiting', '請輕輕傾斜手機，正在等待方向感應。');
    } catch (error) {
      if (state.destroyed || operation !== tiltOperation) return getState();
      state.tilt.permission = error?.name === 'NotAllowedError' ? 'denied' : 'unknown';
      return publish('tilt', 'denied', '方向感應未獲允許；可以稍後再試。');
    }
  }
  function disableTilt(status = 'off', message = '手機視差已關閉。') {
    ++tiltOperation; detachSensor(); state.tilt.enabled = false; state.tilt.explicitOptIn = false; resetTilt();
    return publish('tilt', tiltSupported ? status : secure ? 'unsupported' : 'insecure', message);
  }
  async function toggleTilt() {
    if (state.destroyed) return getState();
    return state.tilt.enabled || state.tilt.status === 'requesting' ? disableTilt() : enableTilt();
  }
  function handleVisibility() {
    if (doc?.hidden) {
      stopTones(); clearSensorTimer();
      if (state.vibration.enabled) { try { nav.vibrate(0); } catch { /* Best effort. */ } }
      if (state.tilt.enabled) resetTilt();
    } else if (state.tilt.enabled && !state.tilt.hasSensor) waitForSensor();
  }
  function handleScreenRotation() { if (state.tilt.enabled) resetTilt(); }
  function handleReducedMotion(event) {
    state.reducedMotion = Boolean(event.matches);
    if (event.matches && (state.tilt.enabled || state.tilt.status === 'requesting')) {
      disableTilt('reduced-motion', '已配合系統減少動態效果；需要時可手動開啟視差。');
    }
  }
  function notifyMessage(role = 'guide') {
    if (state.destroyed) return { delivered: false, sound: false, vibration: false, reason: 'destroyed' };
    const enabled = state.sound.enabled || state.vibration.enabled;
    const visible = !doc?.hidden;
    const now = globalThis.performance?.now?.() ?? Date.now();
    if (!gate.allow(now, { role, enabled, visible })) {
      return { delivered: false, sound: false, vibration: false, reason: !visible ? 'hidden' : !enabled ? 'off' : !['guide', 'visitor'].includes(role) ? 'role' : 'rate-limited' };
    }
    let sound = false, vibration = false;
    try { sound = playNotification(role); } catch { state.sound.enabled = false; publish('sound', 'blocked', '提示音暫時無法播放，請再點選開啟。'); }
    if (state.vibration.enabled) {
      try { vibration = nav.vibrate(role === 'visitor' ? 9 : 14); } catch { vibration = false; }
      if (!vibration) { state.vibration.enabled = false; publish('vibration', 'blocked', '瀏覽器目前未接受震動請求。'); }
    }
    return { delivered: sound || vibration, sound, vibration, reason: sound || vibration ? 'sent' : 'unavailable' };
  }
  function destroy() {
    if (state.destroyed) return getState();
    state.destroyed = true; ++soundOperation; ++tiltOperation;
    state.sound.enabled = false; state.vibration.enabled = false; state.tilt.enabled = false;
    stopTones(); detachSensor(); resetTilt(); gate.reset();
    if (vibrationSupported) { try { nav.vibrate(0); } catch { /* Best effort. */ } }
    audio?.removeEventListener?.('statechange', handleAudioState);
    if (audio && audio.state !== 'closed') audio.close().catch(() => {});
    doc?.removeEventListener?.('visibilitychange', handleVisibility);
    win?.removeEventListener?.('orientationchange', handleScreenRotation);
    win?.screen?.orientation?.removeEventListener?.('change', handleScreenRotation);
    if (media?.removeEventListener) media.removeEventListener('change', handleReducedMotion);
    else media?.removeListener?.(handleReducedMotion);
    for (const feature of ['sound', 'vibration', 'tilt']) state[feature].status = 'destroyed';
    return getState();
  }
  doc?.addEventListener?.('visibilitychange', handleVisibility);
  win?.addEventListener?.('orientationchange', handleScreenRotation, { passive: true });
  win?.screen?.orientation?.addEventListener?.('change', handleScreenRotation);
  if (media?.addEventListener) media.addEventListener('change', handleReducedMotion);
  else media?.addListener?.(handleReducedMotion);

  return { enableSound, toggleSound, enableVibration, toggleVibration, enableTilt, toggleTilt, notifyMessage, getState, destroy };
}
