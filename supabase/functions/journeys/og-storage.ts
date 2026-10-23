import { createJourneyOgSvg } from './og-image.js';

// Pinned package and binary, verified against the release downloaded for local QA.
const WASM_URL = 'https://unpkg.com/@resvg/resvg-wasm@2.6.2/index_bg.wasm';
const WASM_SHA256 = '22bf6e9f9a100d972da0411a69c5ba504367fc1fa87b3b64e3f35e53926d2d70';
const snapshots = new Map<string, { value: string | null; expires: number }>();
let rendererPromise: Promise<typeof import('npm:@resvg/resvg-wasm@2.6.2')> | null = null;
let failedUntil = 0;

function remember(url: string, value: string | null) {
  if (snapshots.size >= 256) snapshots.delete(snapshots.keys().next().value!);
  snapshots.set(url, { value, expires: Date.now() + (value ? 3600000 : 60000) });
  return value;
}

function pathFor(seed: string, version: number) {
  if (!/^[a-f0-9]{32}$/.test(seed) || ![1, 2].includes(version)) throw new TypeError('Invalid snapshot identity.');
  return `v${version}/${seed}.png`;
}

export async function findJourneySnapshot(base: string, seed: string, version: number): Promise<string | null> {
  const url = `${base}/storage/v1/object/public/journey-images/${pathFor(seed, version)}`;
  const cached = snapshots.get(url);
  if (cached && cached.expires > Date.now()) return cached.value;
  try {
    // Public-download bucket: this probe does not send any privileged key.
    const result = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(1500) });
    return remember(url, result.ok && result.headers.get('content-type')?.includes('image/png') ? url : null);
  } catch { return remember(url, null); }
}

async function wasmRenderer() {
  if (Date.now() < failedUntil) throw new Error('Image generation is cooling down.');
  if (!rendererPromise) {
    rendererPromise = (async () => {
      const module = await import('npm:@resvg/resvg-wasm@2.6.2');
      const response = await fetch(WASM_URL, { signal: AbortSignal.timeout(3500) });
      if (!response.ok) throw new Error('Renderer unavailable.');
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength !== 2478606) throw new Error('Unexpected renderer size.');
      const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
      if (digest !== WASM_SHA256) throw new Error('Renderer integrity check failed.');
      await module.initWasm(bytes);
      return module;
    })().catch(error => { rendererPromise = null; failedUntil = Date.now() + 60000; throw error; });
  }
  return rendererPromise;
}

/** Called only once after a new immutable journey passes the database quotas. */
export async function createJourneySnapshot(base: string, key: string, conversation: { seed: string; version: number; messages: unknown[] }): Promise<string | null> {
  const path = pathFor(conversation.seed, conversation.version);
  const url = `${base}/storage/v1/object/public/journey-images/${path}`;
  try {
    const { Resvg } = await wasmRenderer();
    const started = performance.now();
    const svg = createJourneyOgSvg(conversation);
    if (new TextEncoder().encode(svg).byteLength > 250000) return remember(url, null);
    const renderer = new Resvg(svg, { font: { loadSystemFonts: false }, fitTo: { mode: 'original' } });
    let image: ReturnType<typeof renderer.render> | null = null;
    let png: Uint8Array;
    try {
      // Synchronous WASM cannot be preempted by a JS timer. Fixed 1200x630 size,
      // bounded outline-only source, no user SVG/filters/images, and elapsed-time
      // checks keep this substantially below the platform's CPU limit in QA.
      if (performance.now() - started > 700) return remember(url, null);
      image = renderer.render();
      png = image.asPng();
      if (performance.now() - started > 1200 || png.byteLength > 1048576 || image.width !== 1200 || image.height !== 630) return remember(url, null);
    } finally { image?.free(); renderer.free(); }
    const auth: Record<string, string> = { apikey: key, 'content-type': 'image/png', 'cache-control': 'max-age=31536000', 'x-upsert': 'false' };
    if (!key.startsWith('sb_secret_')) auth.authorization = `Bearer ${key}`;
    const uploaded = await fetch(`${base}/storage/v1/object/journey-images/${path}`, {
      method: 'POST', headers: auth, body: png, signal: AbortSignal.timeout(4000),
    });
    if (!uploaded.ok) return remember(url, null);
    return remember(url, url);
  } catch {
    // The journey was already committed. Missing artwork never erases it or
    // turns the registration into an error; the Worker supplies its static OG.
    return remember(url, null);
  }
}
