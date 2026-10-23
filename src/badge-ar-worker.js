import { exportBadgeUsdz } from './badge-usdz.js';

// Each instance owns one export and is terminated by its controller afterwards.
// A restart can terminate CPU-bound mesh conversion immediately, not just ignore it.
let started = false;
self.addEventListener('message', async event => {
  if (started) return;
  started = true;
  const { id, seed, version } = event.data || {};
  try {
    if (!Number.isSafeInteger(id) || typeof seed !== 'string' || !/^[0-9a-f]{32}$/i.test(seed) || ![1, 2].includes(version)) {
      throw new TypeError('Invalid badge identity');
    }
    const { blob, filename } = await exportBadgeUsdz({ seed, version });
    const buffer = await blob.arrayBuffer();
    self.postMessage({ id, ok: true, buffer, filename }, [buffer]);
  } catch {
    self.postMessage({ id, ok: false, error: 'generation_failed' });
  }
});
