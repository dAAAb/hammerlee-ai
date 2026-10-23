const USDZ_TYPE = 'model/vnd.usdz+zip';
export const BADGE_AR_INSTRUCTIONS = 'iPhone/iPad 用 Safari 開啟可體驗 AR；其他裝置可下載 USDZ。';

function identityFor(value) {
  if (!value || typeof value.seed !== 'string' || !/^[0-9a-f]{32}$/i.test(value.seed) || ![1, 2].includes(value.version)) return null;
  const seed = value.seed.toLowerCase();
  return { seed, version: value.version, key: `${value.version}:${seed}` };
}

function supportsAR(link) {
  try { return link.relList?.supports?.('ar') === true; }
  catch { return false; }
}

function spawnBadgeWorker() {
  if (typeof Worker === 'undefined') {
    const error = new Error('Background model generation is unavailable');
    error.code = 'worker_unavailable';
    throw error;
  }
  return new Worker(new URL('./badge-ar-worker.js', import.meta.url), { type: 'module' });
}

function generateInWorker(input, id, createWorker) {
  const worker = createWorker();
  let settled = false;
  let resolveJob, rejectJob;
  const promise = new Promise((resolve, reject) => { resolveJob = resolve; rejectJob = reject; });
  function finish(error, result) {
    if (settled) return;
    settled = true;
    worker.removeEventListener('message', onMessage);
    worker.removeEventListener('error', onError);
    worker.removeEventListener('messageerror', onError);
    worker.terminate();
    if (error) rejectJob(error);
    else resolveJob(result);
  }
  function onMessage(event) {
    const data = event.data;
    if (data?.id !== id) return;
    if (data.ok !== true || !(data.buffer instanceof ArrayBuffer) || !data.buffer.byteLength) {
      finish(new Error('Background model generation failed'));
      return;
    }
    finish(null, { blob: new Blob([data.buffer], { type: USDZ_TYPE }), filename: data.filename });
  }
  function onError(event) {
    event.preventDefault?.();
    finish(new Error('Background model generation failed'));
  }
  worker.addEventListener('message', onMessage);
  worker.addEventListener('error', onError);
  worker.addEventListener('messageerror', onError);
  try { worker.postMessage({ id, seed: input.seed, version: input.version }); }
  catch (error) { finish(error); }
  return { promise, cancel: () => finish(null, null) };
}

/**
 * DOM contract:
 * - link is an <a> containing exactly one <img>; keep visible text outside it.
 * - status is a separate aria-live status element.
 * - prepareButton is a separate native button (also used for retries).
 * Only the ready anchor's real click opens Quick Look or downloads a file.
 * Importing this controller neither starts a Worker nor loads the exporter.
 * Generation runs in a dedicated Worker; there is no synchronous fallback.
 * The optional second argument supplies deterministic platform doubles in tests;
 * loadExporter is a test-only override, never used by the browser integration.
 */
export function createBadgeAR({ link, status, prepareButton, onChange, onOpen }, {
  loadExporter,
  createWorker = spawnBadgeWorker,
  urlAPI = globalThis.URL,
  page = globalThis.window,
} = {}) {
  if (!link || link.tagName?.toLowerCase() !== 'a' || link.children?.length !== 1 || link.children[0].tagName?.toLowerCase() !== 'img') {
    throw new TypeError('The AR link must be an anchor with exactly one img child.');
  }
  if (!status || !prepareButton) throw new TypeError('AR status and prepare button are required.');
  const supported = supportsAR(link);
  let identity = null;
  let state = 'idle';
  let error = '';
  let generation = 0;
  let active = null;
  let job = null;
  let disposed = false;

  const labelFor = () => state === 'preparing' ? '正在準備立體徽章…'
    : state === 'error' ? '重新準備立體徽章'
      : supported ? '在 AR 中看看徽章' : '下載 3D 徽章（USDZ）';
  const snapshot = () => ({ state, supported, label: labelFor(), seed: identity?.seed ?? null, version: identity?.version ?? null, error });
  function notify(callback, value) {
    try { callback?.(value); } catch { /* Presentation callbacks must not break native link activation. */ }
  }
  function clearLink() {
    link.removeAttribute('href');
    link.removeAttribute('rel');
    link.removeAttribute('download');
    link.hidden = true;
    link.tabIndex = -1;
    link.setAttribute('aria-disabled', 'true');
  }
  function revoke(url) {
    if (!url) return;
    try { urlAPI?.revokeObjectURL?.(url); } catch { /* The document may already be tearing down. */ }
  }
  function releaseActive() {
    clearLink();
    if (active) revoke(active.url);
    active = null;
  }
  function publish(next, reason = '') {
    state = next;
    error = reason;
    const ready = next === 'ready' && active !== null;
    link.hidden = !ready;
    link.tabIndex = ready ? 0 : -1;
    link.setAttribute('aria-disabled', String(!ready));
    link.setAttribute('aria-label', labelFor());
    prepareButton.hidden = ready || next === 'disposed';
    prepareButton.disabled = next === 'preparing' || next === 'disposed' || !identity;
    prepareButton.textContent = next === 'preparing' ? '正在準備立體徽章…' : next === 'error' ? '重新準備立體徽章' : '準備立體徽章';
    if (next === 'preparing') status.textContent = `正在準備這次編號的徽章。${BADGE_AR_INSTRUCTIONS}`;
    else if (next === 'ready') status.textContent = supported
      ? '徽章已準備好。點選後開啟 3D 預覽；可在 Quick Look 切換「AR」，放到身邊看看。'
      : `USDZ 檔案已準備好，可以下載保存。${BADGE_AR_INSTRUCTIONS}`;
    else if (next === 'error') status.textContent = `${reason || '這次沒有準備好徽章，請再試一次。'}${BADGE_AR_INSTRUCTIONS}`;
    else if (next === 'disposed') status.textContent = '';
    else status.textContent = BADGE_AR_INSTRUCTIONS;
    notify(onChange, snapshot());
  }
  function reset(value) {
    if (disposed) return snapshot();
    generation++;
    job?.cancel?.();
    job = null;
    releaseActive();
    identity = identityFor(value);
    publish(identity || value == null ? 'idle' : 'error', identity || value == null ? '' : '這段旅程的編號或版本無法辨識。');
    return snapshot();
  }
  function prepare(value = identity) {
    if (disposed) return Promise.resolve(snapshot());
    const requested = identityFor(value);
    if (!requested) return Promise.resolve(reset(value));
    if (identity?.key !== requested.key) reset(requested);
    if (active?.key === requested.key && state === 'ready') return Promise.resolve(snapshot());
    if (job?.key === requested.key) return job.promise;
    const ticket = ++generation;
    const task = { key: requested.key, ticket, promise: null, cancel: null };
    const stale = () => disposed || ticket !== generation || identity?.key !== requested.key;
    task.promise = Promise.resolve().then(async () => {
      let candidateURL = null;
      try {
        if (stale()) return snapshot();
        let result;
        if (loadExporter) {
          const exporter = await loadExporter();
          if (stale()) return snapshot();
          result = await exporter.exportBadgeUsdz({ seed: requested.seed, version: requested.version });
        } else {
          const background = generateInWorker(requested, ticket, createWorker);
          task.cancel = background.cancel;
          if (stale()) background.cancel();
          result = await background.promise;
          task.cancel = null;
        }
        if (stale()) return snapshot();
        if (!(result?.blob instanceof Blob) || result.blob.size === 0) throw new Error('Empty badge export');
        const blob = result.blob.type === USDZ_TYPE ? result.blob : result.blob.slice(0, result.blob.size, USDZ_TYPE);
        const filename = typeof result.filename === 'string' && !/[\\/\u0000]/.test(result.filename) && /\.usdz$/i.test(result.filename)
          ? result.filename : `hammerlee-badge-v${requested.version}-${requested.seed}.usdz`;
        candidateURL = urlAPI.createObjectURL(blob);
        if (stale()) { revoke(candidateURL); candidateURL = null; return snapshot(); }
        active = { url: candidateURL, filename, key: requested.key };
        candidateURL = null;
        // Keep the Blob URL untouched: Quick Look may share the unique USDZ.
        // The page's existing share action is responsible for replay links.
        link.setAttribute('href', active.url);
        // The official Three.js USDZ example retains a .usdz download filename
        // alongside rel=ar, so Blob-backed native previews also have a filename.
        link.setAttribute('download', filename);
        if (supported) {
          link.setAttribute('rel', 'ar');
        } else {
          link.removeAttribute('rel');
        }
        publish('ready');
      } catch (error) {
        revoke(candidateURL);
        if (!stale()) {
          releaseActive();
          publish('error', error?.code === 'worker_unavailable' ? '這個瀏覽器無法在背景準備徽章。請改用較新版 Safari 或其他支援的瀏覽器。' : '');
        }
      } finally {
        task.cancel?.();
        task.cancel = null;
        if (job === task) job = null;
      }
      return snapshot();
    });
    job = task;
    publish('preparing');
    return task.promise;
  }
  function onPrepare() { void prepare(); }
  function onLinkClick(event) {
    if (disposed || state !== 'ready' || !active) { event.preventDefault(); return; }
    // No await, programmatic click, navigation override, or preventDefault here.
    notify(onOpen, { mode: supported ? 'ar' : 'download', supported, seed: identity.seed, version: identity.version });
  }
  function onPageHide(event) {
    // Quick Look can return to the page. Keep its URL through visibility changes
    // and bfcache, and revoke only on a real unload or explicit reset/dispose.
    if (!event.persisted) dispose();
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    generation++;
    job?.cancel?.();
    job = null;
    releaseActive();
    link.removeEventListener('click', onLinkClick);
    prepareButton.removeEventListener('click', onPrepare);
    page?.removeEventListener?.('pagehide', onPageHide);
    publish('disposed');
  }
  link.addEventListener('click', onLinkClick);
  prepareButton.addEventListener('click', onPrepare);
  page?.addEventListener?.('pagehide', onPageHide);
  clearLink();
  publish('idle');
  return { prepare, reset, dispose };
}
