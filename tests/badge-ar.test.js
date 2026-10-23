import test from 'node:test';
import assert from 'node:assert/strict';
import { BADGE_AR_INSTRUCTIONS, createBadgeAR } from '../src/badge-ar.js';

const first = { seed: '0123456789abcdef0123456789abcdef', version: 2 };
const second = { seed: 'fedcba9876543210fedcba9876543210', version: 1 };
const model = (filename = 'badge.usdz', type = 'model/vnd.usdz+zip') => ({ blob: new Blob(['USDZ test fixture'], { type }), filename });
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
class Element extends EventTarget {
  constructor(tagName) { super(); this.tagName = tagName; this.children = []; this.attributes = new Map(); this.hidden = false; this.disabled = false; }
  setAttribute(key, value) { this.attributes.set(key, String(value)); }
  getAttribute(key) { return this.attributes.get(key) ?? null; }
  removeAttribute(key) { this.attributes.delete(key); }
  click() { const event = new Event('click', { cancelable: true }); this.dispatchEvent(event); return event; }
}
function setup({ supported = true, exporter = async () => model(), detectError = false, callbacks = {}, useWorker = false, workerFactory } = {}) {
  const link = new Element('A');
  const image = new Element('IMG'); link.children.push(image);
  link.relList = { supports(token) { assert.equal(token, 'ar'); if (detectError) throw new TypeError('Unsupported token'); return supported; } };
  const status = new Element('P'), prepareButton = new Element('BUTTON'), page = new EventTarget();
  let loads = 0;
  const created = [], revoked = [], changes = [], opened = [];
  const controller = createBadgeAR({ link, status, prepareButton,
    onChange(value) { changes.push(value); callbacks.onChange?.(value); },
    onOpen(value) { opened.push(value); callbacks.onOpen?.(value); },
  }, {
    page,
    ...(useWorker ? (workerFactory ? { createWorker: workerFactory } : {}) : {
      loadExporter: async () => { loads++; return { exportBadgeUsdz: exporter }; },
    }),
    urlAPI: {
      createObjectURL(blob) { const url = `blob:badge-${created.length + 1}`; created.push({ blob, url }); return url; },
      revokeObjectURL(url) { revoked.push(url); },
    },
  });
  return { ...controller, link, image, status, prepareButton, page, created, revoked, changes, opened, loads: () => loads };
}

test('creation and reset are lazy and preserve the single image child', async () => {
  const ui = setup();
  assert.equal(ui.loads(), 0); assert.equal(ui.status.textContent, BADGE_AR_INSTRUCTIONS);
  assert.equal(ui.link.hidden, true); assert.equal(ui.prepareButton.disabled, true);
  ui.reset(first); await flush();
  assert.equal(ui.loads(), 0); assert.equal(ui.prepareButton.disabled, false);
  assert.deepEqual(ui.link.children, [ui.image]);
  assert.equal(ui.link.getAttribute('href'), null);
  ui.dispose();
});

test('one prepared native anchor opens without cancelling or synthesising the user click', async () => {
  let exports = 0;
  const ui = setup({ exporter: async value => { exports++; assert.deepEqual(value, first); return model(); } });
  const result = await ui.prepare(first);
  assert.equal(result.state, 'ready'); assert.equal(result.supported, true);
  assert.equal(ui.link.getAttribute('rel'), 'ar');
  assert.equal(ui.link.getAttribute('href'), 'blob:badge-1');
  assert.equal(ui.link.getAttribute('download'), 'badge.usdz');
  assert.equal(ui.link.getAttribute('aria-disabled'), 'false');
  assert.equal(ui.opened.length, 0); // Preparation never initiates AR itself.
  assert.equal(ui.link.click().defaultPrevented, false);
  assert.equal(ui.opened[0].mode, 'ar');
  assert.match(ui.status.textContent, /Quick Look 切換「AR」/);
  await ui.prepare(first);
  assert.equal(exports, 1); assert.equal(ui.created.length, 1);
  ui.dispose();
});

test('unsupported or throwing feature detection exposes a download of the same USDZ', async () => {
  for (const detectError of [false, true]) {
    const ui = setup({ supported: false, detectError, exporter: async () => model('my-badge.usdz', 'application/octet-stream') });
    await ui.prepare(first);
    assert.equal(ui.link.getAttribute('rel'), null);
    assert.equal(ui.link.getAttribute('download'), 'my-badge.usdz');
    assert.equal(ui.link.getAttribute('href'), 'blob:badge-1');
    assert.equal(ui.created[0].blob.type, 'model/vnd.usdz+zip');
    assert.equal(ui.link.click().defaultPrevented, false);
    assert.equal(ui.opened[0].mode, 'download');
    assert.match(ui.status.textContent, /其他裝置可下載 USDZ/);
    ui.dispose();
  }
});

test('duplicate prepares share one export and pending anchors cannot activate', async () => {
  const pending = deferred(); let exports = 0;
  const ui = setup({ exporter: () => { exports++; return pending.promise; } });
  const a = ui.prepare(first), b = ui.prepare(first);
  assert.equal(a, b); assert.equal(ui.prepareButton.disabled, true);
  assert.equal(ui.link.click().defaultPrevented, true);
  await flush(); assert.equal(exports, 1); assert.equal(ui.loads(), 1);
  pending.resolve(model()); await a;
  assert.equal(ui.created.length, 1); assert.equal(ui.opened.length, 0);
  ui.dispose();
});

test('a later seed wins over an old in-flight export without creating a stale URL', async () => {
  const old = deferred(), recent = deferred();
  const ui = setup({ exporter: value => value.seed === first.seed ? old.promise : recent.promise });
  const a = ui.prepare(first); await flush();
  const b = ui.prepare(second); await flush();
  recent.resolve(model('second.usdz')); await b;
  old.resolve(model('first.usdz')); await a;
  assert.equal(ui.created.length, 1);
  assert.equal(ui.changes.at(-1).seed, second.seed);
  assert.equal(ui.changes.at(-1).version, second.version);
  assert.equal(ui.changes.at(-1).state, 'ready');
  ui.dispose();
});

test('reset revokes the previous file; dispose rejects late completion and is idempotent', async () => {
  const later = deferred();
  const ui = setup({ exporter: value => value.seed === first.seed ? Promise.resolve(model()) : later.promise });
  await ui.prepare(first);
  ui.reset(second);
  assert.deepEqual(ui.revoked, ['blob:badge-1']);
  assert.equal(ui.link.getAttribute('href'), null);
  const pending = ui.prepare(second); await flush();
  ui.dispose(); ui.dispose(); later.resolve(model()); await pending;
  assert.equal(ui.created.length, 1);
  assert.equal(ui.changes.at(-1).state, 'disposed');
  await ui.prepare(first); assert.equal(ui.loads(), 2);
});

test('an export error exposes retry and a successful button retry produces a native ready link', async () => {
  let exports = 0;
  const ui = setup({ exporter: async () => { if (++exports === 1) throw new Error('Generation failed'); return model(); } });
  const failed = await ui.prepare(first);
  assert.equal(failed.state, 'error'); assert.equal(ui.prepareButton.hidden, false);
  assert.equal(ui.prepareButton.disabled, false); assert.match(ui.prepareButton.textContent, /重新/);
  ui.prepareButton.click(); await flush();
  assert.equal(ui.changes.at(-1).state, 'ready'); assert.equal(exports, 2);
  ui.dispose();
});

test('bfcache and visibility changes preserve the URL; a real pagehide releases it', async () => {
  const ui = setup(); await ui.prepare(first);
  const cached = new Event('pagehide'); Object.defineProperty(cached, 'persisted', { value: true });
  ui.page.dispatchEvent(cached); ui.page.dispatchEvent(new Event('visibilitychange'));
  assert.equal(ui.revoked.length, 0); assert.equal(ui.link.getAttribute('href'), 'blob:badge-1');
  assert.equal(ui.link.click().defaultPrevented, false);
  const unload = new Event('pagehide'); Object.defineProperty(unload, 'persisted', { value: false });
  ui.page.dispatchEvent(unload);
  assert.deepEqual(ui.revoked, ['blob:badge-1']); assert.equal(ui.link.getAttribute('href'), null);
  assert.equal(ui.changes.at(-1).state, 'disposed');
});

test('invalid identity and empty export cannot produce an actionable link', async () => {
  const ui = setup({ exporter: async () => ({ blob: new Blob([]), filename: 'empty.usdz' }) });
  await ui.prepare({ seed: first.seed, version: 3 });
  assert.equal(ui.loads(), 0); assert.equal(ui.prepareButton.disabled, true);
  await ui.prepare(first);
  assert.equal(ui.changes.at(-1).state, 'error'); assert.equal(ui.created.length, 0);
  assert.equal(ui.link.click().defaultPrevented, true);
  ui.dispose();
});

test('image contract is enforced and callback failures cannot cancel native navigation', async () => {
  const invalid = new Element('A'); invalid.children = [new Element('IMG'), new Element('SPAN')];
  assert.throws(() => createBadgeAR({ link: invalid, status: {}, prepareButton: {} }), /exactly one img/);
  const ui = setup({ callbacks: { onChange() { throw new Error('UI callback'); }, onOpen() { throw new Error('Analytics callback'); } } });
  await ui.prepare(first);
  assert.equal(ui.link.click().defaultPrevented, false);
  assert.deepEqual(ui.link.children, [ui.image]);
  ui.dispose();
});

class FakeWorker extends EventTarget {
  constructor() { super(); this.requests = []; this.terminations = 0; }
  postMessage(value) { this.requests.push(value); }
  terminate() { this.terminations++; }
  respond(data = {}) {
    const event = new Event('message');
    Object.defineProperty(event, 'data', { value: {
      id: this.requests.at(-1).id, ok: true,
      buffer: new Uint8Array([80, 75, 3, 4]).buffer, filename: 'worker-badge.usdz', ...data,
    } });
    this.dispatchEvent(event);
  }
}
function setupWorkers() {
  const workers = [];
  const ui = setup({ useWorker: true, workerFactory: () => { const worker = new FakeWorker(); workers.push(worker); return worker; } });
  return { ...ui, workers };
}

test('worker generation is lazy and deduplicated; a transferred result terminates its worker', async () => {
  const ui = setupWorkers();
  ui.reset(first); await flush(); assert.equal(ui.workers.length, 0);
  const a = ui.prepare(first), b = ui.prepare(first);
  assert.equal(a, b); await flush();
  assert.equal(ui.workers.length, 1); assert.equal(ui.loads(), 0);
  const worker = ui.workers[0];
  assert.equal(worker.requests[0].seed, first.seed); assert.equal(worker.requests[0].version, 2);
  worker.respond({ id: worker.requests[0].id + 1 });
  assert.equal(ui.created.length, 0); assert.equal(worker.terminations, 0);
  worker.respond();
  assert.equal((await a).state, 'ready'); assert.equal(worker.terminations, 1);
  assert.equal(ui.created[0].blob.type, 'model/vnd.usdz+zip');
  assert.deepEqual([...new Uint8Array(await ui.created[0].blob.arrayBuffer())], [80, 75, 3, 4]);
  assert.equal(ui.link.getAttribute('download'), 'worker-badge.usdz');
  ui.dispose(); assert.equal(worker.terminations, 1);
});

test('reset immediately terminates old CPU work and only a newer worker can publish a URL', async () => {
  const ui = setupWorkers();
  const old = ui.prepare(first); await flush();
  ui.reset(second);
  assert.equal(ui.workers[0].terminations, 1);
  assert.equal((await old).state, 'idle');
  const latest = ui.prepare(second); await flush();
  assert.equal(ui.workers.length, 2);
  ui.workers[0].respond(); assert.equal(ui.created.length, 0);
  ui.workers[1].respond();
  const result = await latest;
  assert.equal(result.state, 'ready'); assert.equal(result.seed, second.seed);
  assert.equal(ui.created.length, 1); assert.equal(ui.workers[1].terminations, 1);
  ui.dispose();
});

test('dispose terminates a pending worker and settles its promise without requiring a response', async () => {
  const ui = setupWorkers();
  const pending = ui.prepare(first); await flush();
  ui.dispose(); ui.dispose();
  assert.equal(ui.workers[0].terminations, 1);
  assert.equal((await pending).state, 'disposed');
  ui.workers[0].respond(); assert.equal(ui.created.length, 0);
});

test('worker crash, decoding error, and export failure terminate the job and allow a fresh retry', async () => {
  for (const failure of ['error', 'messageerror', 'export']) {
    const ui = setupWorkers();
    const pending = ui.prepare(first); await flush();
    if (failure === 'export') ui.workers[0].respond({ ok: false, error: 'generation_failed' });
    else ui.workers[0].dispatchEvent(new Event(failure, { cancelable: true }));
    assert.equal((await pending).state, 'error');
    assert.equal(ui.workers[0].terminations, 1); assert.equal(ui.prepareButton.disabled, false);
    const retry = ui.prepare(first); await flush();
    assert.equal(ui.workers.length, 2); ui.workers[1].respond();
    assert.equal((await retry).state, 'ready');
    ui.dispose();
  }
});

test('a worker postMessage failure is cleaned up and never falls back to main-thread generation', async () => {
  const worker = new FakeWorker(); worker.postMessage = () => { throw new Error('Cannot start worker'); };
  const ui = setup({ useWorker: true, workerFactory: () => worker });
  assert.equal((await ui.prepare(first)).state, 'error');
  assert.equal(worker.terminations, 1); assert.equal(ui.loads(), 0); assert.equal(ui.created.length, 0);
  ui.dispose();
});

test('missing Worker support explains the limitation instead of generating synchronously', async () => {
  assert.equal(typeof globalThis.Worker, 'undefined');
  const ui = setup({ useWorker: true });
  assert.equal((await ui.prepare(first)).state, 'error');
  assert.match(ui.status.textContent, /無法在背景準備徽章/);
  assert.equal(ui.loads(), 0); assert.equal(ui.created.length, 0); assert.equal(ui.prepareButton.disabled, false);
  ui.dispose();
});
