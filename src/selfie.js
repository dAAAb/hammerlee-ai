// This module performs no work at import time. The caller supplies selfie.css.
// A photo exists only as an in-memory canvas; this module never uploads or stores it.
let activeRequest = null;
let dialogSequence = 0;

function stopStream(stream) {
  for (const track of stream?.getTracks?.() || []) {
    try { track.stop(); } catch { /* Continue stopping the other tracks. */ }
  }
}

/** Owns both the active stream and late results from an uncancellable permission prompt. */
export function createSelfieCameraSession({ getUserMedia } = {}) {
  let generation = 0;
  let current = null;
  let closed = false;
  const stop = () => {
    generation++;
    const previous = current;
    current = null;
    stopStream(previous);
  };
  return {
    async start() {
      if (closed) return null;
      stop();
      const ticket = generation;
      if (typeof getUserMedia !== 'function') {
        const error = new Error('Camera unavailable');
        error.name = 'NotSupportedError';
        throw error;
      }
      try {
        const stream = await getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'user' }, width: { ideal: 1024 }, height: { ideal: 1024 } },
        });
        if (closed || ticket !== generation) {
          stopStream(stream);
          return null;
        }
        current = stream;
        return stream;
      } catch (error) {
        if (closed || ticket !== generation) return null;
        throw error;
      }
    },
    isActive(stream) { return !closed && current !== null && current === stream; },
    stop,
    close() { closed = true; stop(); },
  };
}

/** Match the mirrored square preview without creating a URL or serialising pixels. */
export function captureSelfieFrame(video, createCanvas = () => document.createElement('canvas')) {
  if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) throw new Error('Camera frame not ready');
  const side = Math.min(video.videoWidth, video.videoHeight);
  const canvas = createCanvas();
  canvas.width = 768;
  canvas.height = 768;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Canvas unavailable');
  context.translate(canvas.width, 0);
  context.scale(-1, 1);
  context.drawImage(video, (video.videoWidth - side) / 2, (video.videoHeight - side) / 2, side, side, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function cameraMessage(error) {
  if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
    return '這次沒有取得相機權限。你可以重新開啟相機，或選擇「不拍照，直接製卡」。';
  }
  if (error?.name === 'NotFoundError' || error?.name === 'NotSupportedError') {
    return '這個裝置或瀏覽器目前無法使用相機。選擇「不拍照，直接製卡」也能完成新北事民卡。';
  }
  return '相機目前無法啟動，可能正由其他程式使用。可以再試一次，或選擇「不拍照，直接製卡」。';
}

/**
 * Open from an explicit download action. Only the dialog's camera/retake buttons
 * request media permission. Skip resolves {cancelled:false}; close resolves true.
 * A confirmed photo resolves {cancelled:false, canvas}; the caller owns that canvas.
 */
export async function requestSelfie() {
  if (activeRequest) return activeRequest;
  if (typeof document === 'undefined' || !document.body) return { cancelled: false };
  activeRequest = new Promise(resolve => {
    const id = `selfie-${++dialogSequence}`;
    const returnFocus = document.activeElement;
    const dialog = document.createElement('dialog');
    dialog.className = 'selfie-dialog';
    dialog.setAttribute('aria-labelledby', `${id}-title`);
    dialog.setAttribute('aria-describedby', `${id}-privacy`);
    dialog.innerHTML = `
      <div class="selfie-heading"><h2 id="${id}-title">新北事民卡，加張自拍</h2><button type="button" class="selfie-cancel" aria-label="取消製作新北事民卡">取消</button></div>
      <p id="${id}-privacy" class="selfie-privacy">自拍只在本機製卡，不會上傳到網站或出現在分享連結。若自行分享圖卡，收件者可看到自拍。</p>
      <div class="selfie-preview" aria-label="正方形自拍預覽">
        <div class="selfie-placeholder"><span aria-hidden="true">☺</span><p>想留張照片，就開啟相機。<br>不拍照也可以繼續。</p></div>
        <video class="selfie-video" muted autoplay playsinline hidden aria-label="鏡像自拍即時畫面"></video>
      </div>
      <p class="selfie-status" role="status" aria-live="polite" aria-atomic="true">相機尚未開啟。</p>
      <div class="selfie-actions">
        <button type="button" class="selfie-primary selfie-start">開啟相機自拍</button>
        <button type="button" class="selfie-primary selfie-capture" hidden disabled>拍一張</button>
        <button type="button" class="selfie-primary selfie-use" hidden>使用這張照片</button>
        <button type="button" class="selfie-secondary selfie-retake" hidden>重新拍一張</button>
        <button type="button" class="selfie-secondary selfie-skip">不拍照，直接製卡</button>
      </div>`;
    const find = selector => dialog.querySelector(selector);
    const video = find('.selfie-video');
    video.muted = true;
    video.playsInline = true;
    const placeholder = find('.selfie-placeholder');
    const status = find('.selfie-status');
    const startButton = find('.selfie-start');
    const captureButton = find('.selfie-capture');
    const useButton = find('.selfie-use');
    const retakeButton = find('.selfie-retake');
    const mediaDevices = globalThis.navigator?.mediaDevices;
    const camera = createSelfieCameraSession({
      getUserMedia: typeof mediaDevices?.getUserMedia === 'function' ? constraints => mediaDevices.getUserMedia(constraints) : undefined,
    });
    let settled = false;
    let stage = 'idle';
    let attempt = 0;
    let snapshot = null;
    let trackCleanups = [];

    function clearSnapshot() {
      if (!snapshot) return;
      snapshot.remove();
      snapshot.width = 0;
      snapshot.height = 0;
      snapshot = null;
    }
    function stopPreview() {
      attempt++;
      for (const cleanup of trackCleanups) cleanup();
      trackCleanups = [];
      camera.stop();
      try { video.pause(); } catch { /* A detached video may already be inactive. */ }
      video.srcObject = null;
      captureButton.disabled = true;
    }
    function setStage(next, message) {
      stage = next;
      video.hidden = next !== 'live';
      placeholder.hidden = next === 'live' || next === 'captured';
      if (snapshot) snapshot.hidden = next !== 'captured';
      startButton.hidden = next === 'live' || next === 'captured';
      startButton.disabled = next === 'pending';
      startButton.textContent = next === 'pending' ? '等待相機權限…' : '開啟相機自拍';
      captureButton.hidden = next !== 'live';
      useButton.hidden = next !== 'captured';
      retakeButton.hidden = next !== 'captured';
      status.textContent = message;
    }
    function updateFrameReady() {
      if (settled || stage !== 'live' || !camera.isActive(video.srcObject)) return;
      const ready = video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0;
      captureButton.disabled = !ready;
      if (ready) status.textContent = '把自己放在框裡，準備好就拍一張。預覽和照片都是鏡像。';
    }
    function finish(result) {
      if (settled) return;
      settled = true;
      stopPreview();
      camera.close();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      if (result.canvas === snapshot && snapshot) {
        snapshot.remove();
        snapshot = null; // Transfer ownership to the caller without clearing pixels.
      } else clearSnapshot();
      if (dialog.open) dialog.close();
      dialog.remove();
      if (returnFocus?.isConnected && !document.hidden) returnFocus.focus?.({ preventScroll: true });
      resolve(result);
    }
    async function startCamera() {
      if (settled || document.hidden) return;
      stopPreview();
      clearSnapshot();
      const ticket = attempt;
      setStage('pending', '請在瀏覽器提示中選擇是否允許相機。你也可以直接略過。');
      try {
        const stream = await camera.start();
        if (!stream || settled || ticket !== attempt) return;
        if (!stream.getVideoTracks().some(track => track.readyState === 'live')) throw new Error('No active camera');
        video.srcObject = stream;
        for (const track of stream.getVideoTracks()) {
          const onEnded = () => {
            if (settled || !camera.isActive(stream)) return;
            stopPreview();
            setStage('idle', '相機已停止。可以重新開啟，或不拍照直接製卡。');
          };
          track.addEventListener('ended', onEnded);
          trackCleanups.push(() => track.removeEventListener('ended', onEnded));
        }
        setStage('live', '相機已開啟，正在準備畫面。');
        await video.play();
        if (settled || ticket !== attempt || !camera.isActive(stream)) return;
        updateFrameReady();
      } catch (error) {
        if (settled || ticket !== attempt) return;
        stopPreview();
        setStage('idle', cameraMessage(error));
        startButton.focus({ preventScroll: true });
      }
    }
    function onVisibility() {
      if (!document.hidden || settled) return;
      const hadPreview = stage === 'live' || stage === 'pending';
      stopPreview();
      if (hadPreview) setStage('idle', '離開畫面時，相機已關閉。回來後可以重新開啟，或直接製卡。');
    }
    function onPageHide() { finish({ cancelled: true }); }

    startButton.addEventListener('click', startCamera);
    retakeButton.addEventListener('click', startCamera);
    captureButton.addEventListener('click', () => {
      if (settled || stage !== 'live' || captureButton.disabled || !camera.isActive(video.srcObject)) return;
      try {
        snapshot = captureSelfieFrame(video);
        snapshot.className = 'selfie-photo';
        snapshot.setAttribute('role', 'img');
        snapshot.setAttribute('aria-label', '剛剛拍下的自拍照片');
        find('.selfie-preview').append(snapshot);
        stopPreview();
        setStage('captured', '照片拍好了，相機已關閉。可以使用這張照片，或重新拍一張。');
        useButton.focus({ preventScroll: true });
      } catch {
        stopPreview();
        clearSnapshot();
        setStage('idle', '這次沒有拍到照片。可以重新開啟相機，或直接製卡。');
      }
    });
    useButton.addEventListener('click', () => {
      if (stage === 'captured' && snapshot) finish({ cancelled: false, canvas: snapshot });
    });
    find('.selfie-skip').addEventListener('click', () => finish({ cancelled: false }));
    find('.selfie-cancel').addEventListener('click', () => finish({ cancelled: true }));
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish({ cancelled: true }); });
    dialog.addEventListener('close', () => finish({ cancelled: true }));
    for (const event of ['loadeddata', 'canplay', 'resize']) video.addEventListener(event, updateFrameReady);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    document.body.append(dialog);
    try {
      dialog.showModal();
      startButton.focus({ preventScroll: true });
      if (!mediaDevices?.getUserMedia) setStage('idle', cameraMessage({ name: 'NotSupportedError' }));
    } catch {
      finish({ cancelled: false });
    }
  });
  try { return await activeRequest; }
  finally { activeRequest = null; }
}
