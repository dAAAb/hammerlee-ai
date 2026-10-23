import test from 'node:test';
import assert from 'node:assert/strict';
import { createSelfieCameraSession, captureSelfieFrame, requestSelfie } from '../src/selfie.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function makeStream(count = 1) {
  const tracks = Array.from({ length: count }, () => Object.assign(new EventTarget(), {
    readyState: 'live', stops: 0,
    stop() { this.stops++; this.readyState = 'ended'; },
  }));
  return { tracks, getTracks: () => tracks, getVideoTracks: () => tracks };
}

test('camera session is lazy, requests the front camera without audio, and stops every track', async () => {
  let calls = 0, constraints;
  const stream = makeStream(2);
  const camera = createSelfieCameraSession({ getUserMedia: input => { calls++; constraints = input; return Promise.resolve(stream); } });
  assert.equal(calls, 0);
  assert.equal(await camera.start(), stream);
  assert.equal(calls, 1);
  assert.equal(constraints.audio, false);
  assert.equal(constraints.video.facingMode.ideal, 'user');
  assert.equal(camera.isActive(stream), true);
  camera.stop(); camera.stop();
  assert.deepEqual(stream.tracks.map(track => track.stops), [1, 1]);
  assert.equal(camera.isActive(stream), false);
});

test('closing while permission is pending stops a late stream and cannot reopen the session', async () => {
  const pending = deferred();
  let calls = 0;
  const camera = createSelfieCameraSession({ getUserMedia: () => { calls++; return pending.promise; } });
  const start = camera.start();
  camera.close();
  const late = makeStream(2);
  pending.resolve(late);
  assert.equal(await start, null);
  assert.deepEqual(late.tracks.map(track => track.stops), [1, 1]);
  assert.equal(await camera.start(), null);
  assert.equal(calls, 1);
});

test('retake invalidates an older pending request without stopping the newer stream', async () => {
  const first = deferred(), second = deferred();
  const requests = [first, second];
  const camera = createSelfieCameraSession({ getUserMedia: () => requests.shift().promise });
  const oldStart = camera.start();
  camera.stop();
  const newStart = camera.start();
  const current = makeStream(), late = makeStream();
  second.resolve(current);
  assert.equal(await newStart, current);
  first.resolve(late);
  assert.equal(await oldStart, null);
  assert.equal(late.tracks[0].stops, 1);
  assert.equal(current.tracks[0].stops, 0);
  assert.equal(camera.isActive(current), true);
  camera.close();
  assert.equal(current.tracks[0].stops, 1);
});

test('denial can be retried; stale rejection is consumed after a close', async () => {
  const denied = Object.assign(new Error('Denied'), { name: 'NotAllowedError' });
  const current = makeStream();
  let calls = 0;
  const camera = createSelfieCameraSession({ getUserMedia: () => ++calls === 1 ? Promise.reject(denied) : Promise.resolve(current) });
  await assert.rejects(camera.start(), { name: 'NotAllowedError' });
  assert.equal(await camera.start(), current);
  camera.close();
  const pending = deferred();
  const stale = createSelfieCameraSession({ getUserMedia: () => pending.promise });
  const start = stale.start(); stale.close(); pending.reject(denied);
  assert.equal(await start, null);
  await assert.rejects(createSelfieCameraSession().start(), { name: 'NotSupportedError' });
});

test('one broken track cannot prevent other tracks from being stopped', async () => {
  const stream = makeStream(2);
  stream.tracks[0].stop = () => { throw new Error('Already released'); };
  const camera = createSelfieCameraSession({ getUserMedia: () => Promise.resolve(stream) });
  await camera.start(); camera.close();
  assert.equal(stream.tracks[1].stops, 1);
});

test('capture mirrors a centre-cropped square and refuses an unready frame', () => {
  const calls = [];
  const canvas = { getContext: () => ({
    translate: (...args) => calls.push(['translate', ...args]),
    scale: (...args) => calls.push(['scale', ...args]),
    drawImage: (...args) => calls.push(['drawImage', ...args]),
  }) };
  const video = { readyState: 2, videoWidth: 1280, videoHeight: 720 };
  assert.equal(captureSelfieFrame(video, () => canvas), canvas);
  assert.equal(canvas.width, 768); assert.equal(canvas.height, 768);
  assert.deepEqual(calls, [['translate', 768, 0], ['scale', -1, 1], ['drawImage', video, 280, 0, 720, 720, 0, 0, 768, 768]]);
  assert.throws(() => captureSelfieFrame({ readyState: 0 }, () => { throw new Error('must not allocate'); }), /not ready/);
});

// Minimal event-driven DOM doubles: no browser, device, network, or permission UI.
class FakeElement extends EventTarget {
  constructor(tag, owner) {
    super(); this.tagName = tag; this.owner = owner; this.children = []; this.nodes = new Map();
    this.hidden = false; this.disabled = false; this.isConnected = true; this.open = false;
    this.readyState = 2; this.videoWidth = 1280; this.videoHeight = 720; this.srcObject = null;
  }
  set innerHTML(html) {
    this.html = html;
    for (const match of html.matchAll(/<(\w+)\b([^>]*\bclass="([^"]+)"[^>]*)>/g)) {
      const element = new FakeElement(match[1], this.owner);
      element.hidden = /\bhidden\b/.test(match[2]); element.disabled = /\bdisabled\b/.test(match[2]);
      for (const name of match[3].split(' ')) this.nodes.set('.'+name, element);
    }
  }
  querySelector(selector) { return this.nodes.get(selector); }
  setAttribute(name, value) { this[name] = value; }
  append(element) { this.children.push(element); element.parent = this; if (element.tagName === 'dialog') this.owner.dialog = element; }
  remove() { this.isConnected = false; if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
  focus(options) { this.owner.focus = { element: this, options }; }
  showModal() { this.open = true; }
  close() { this.open = false; this.dispatchEvent(new Event('close')); }
  click() { if (!this.disabled) this.dispatchEvent(new Event('click')); }
  play() { return this.owner.playError ? Promise.reject(this.owner.playError) : Promise.resolve(); }
  pause() { this.paused = true; }
  getContext() { return { translate() {}, scale() {}, drawImage() {} }; }
}
async function withDOM(getUserMedia, run) {
  const previous = ['document', 'window', 'navigator'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  const document = Object.assign(new EventTarget(), { hidden: false, createElement(tag) { return new FakeElement(tag, this); } });
  document.body = new FakeElement('body', document); document.activeElement = new FakeElement('button', document);
  const window = new EventTarget();
  for (const [name, value] of Object.entries({ document, window, navigator: { mediaDevices: getUserMedia ? { getUserMedia } : undefined } })) {
    Object.defineProperty(globalThis, name, { configurable: true, value });
  }
  try { await run({ document, window }); }
  finally { for (const [name, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } }
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('opening and skipping the dialog never requests the camera', async () => {
  let calls = 0;
  await withDOM(() => { calls++; return Promise.resolve(makeStream()); }, async ({ document }) => {
    const result = requestSelfie();
    assert.equal(document.dialog.open, true); assert.equal(calls, 0);
    assert.match(document.dialog.html, /照片只在你的裝置上合成，不會上傳到網站。/);
    document.dialog.querySelector('.selfie-skip').click();
    assert.deepEqual(await result, { cancelled: false }); assert.equal(calls, 0);
    assert.equal(document.body.children.length, 0);
    assert.deepEqual(document.focus.options, { preventScroll: true });
  });
});

test('cancel resolves immediately while a permission prompt is pending, then stops its late stream', async () => {
  const pending = deferred(), stream = makeStream();
  await withDOM(() => pending.promise, async ({ document }) => {
    const result = requestSelfie();
    document.dialog.querySelector('.selfie-start').click();
    document.dialog.querySelector('.selfie-cancel').click();
    assert.deepEqual(await result, { cancelled: true });
    pending.resolve(stream); await flush();
    assert.equal(stream.tracks[0].stops, 1);
  });
});

test('capture stops the camera, retake clears the old canvas, and use transfers the new canvas intact', async () => {
  const first = makeStream(), second = makeStream();
  const streams = [first, second];
  await withDOM(() => Promise.resolve(streams.shift()), async ({ document }) => {
    const result = requestSelfie(), dialog = document.dialog;
    dialog.querySelector('.selfie-start').click(); await flush();
    assert.equal(dialog.querySelector('.selfie-capture').disabled, false);
    dialog.querySelector('.selfie-capture').click();
    const oldCanvas = dialog.querySelector('.selfie-preview').children.at(-1);
    assert.equal(first.tracks[0].stops, 1);
    assert.equal(dialog.querySelector('.selfie-video').srcObject, null);
    dialog.querySelector('.selfie-retake').click(); await flush();
    assert.equal(oldCanvas.width, 0);
    dialog.querySelector('.selfie-capture').click();
    assert.equal(second.tracks[0].stops, 1);
    dialog.querySelector('.selfie-use').click();
    const output = await result;
    assert.equal(output.cancelled, false); assert.equal(output.canvas.width, 768);
    assert.equal(output.canvas.height, 768); assert.equal(document.body.children.length, 0);
  });
});

test('visibility change stops preview; pagehide cancels; neither event restarts a camera', async () => {
  const stream = makeStream(); let calls = 0;
  await withDOM(() => { calls++; return Promise.resolve(stream); }, async ({ document, window }) => {
    const result = requestSelfie();
    document.dialog.querySelector('.selfie-start').click(); await flush();
    document.hidden = true; document.dispatchEvent(new Event('visibilitychange'));
    assert.equal(stream.tracks[0].stops, 1);
    assert.equal(document.dialog.querySelector('.selfie-video').srcObject, null);
    document.hidden = false; document.dispatchEvent(new Event('visibilitychange')); await flush();
    assert.equal(calls, 1);
    window.dispatchEvent(new Event('pagehide'));
    assert.deepEqual(await result, { cancelled: true });
  });
});

test('hiding during permission stops a late stream and leaves skip available', async () => {
  const pending = deferred(), stream = makeStream();
  await withDOM(() => pending.promise, async ({ document }) => {
    const result = requestSelfie();
    document.dialog.querySelector('.selfie-start').click();
    document.hidden = true; document.dispatchEvent(new Event('visibilitychange'));
    pending.resolve(stream); await flush();
    assert.equal(stream.tracks[0].stops, 1);
    assert.equal(document.dialog.querySelector('.selfie-skip').disabled, false);
    document.dialog.querySelector('.selfie-skip').click();
    assert.deepEqual(await result, { cancelled: false });
  });
});

test('permission denial, missing camera API, and failed video playback all retain skip and cancel', async () => {
  for (const mode of ['denied', 'missing', 'playback']) {
    const stream = makeStream();
    const getUserMedia = mode === 'missing' ? undefined : () => mode === 'denied'
      ? Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' })) : Promise.resolve(stream);
    await withDOM(getUserMedia, async ({ document }) => {
      if (mode === 'playback') document.playError = new Error('Playback unavailable');
      const result = requestSelfie();
      document.dialog.querySelector('.selfie-start').click(); await flush();
      assert.equal(document.dialog.querySelector('.selfie-start').disabled, false);
      assert.equal(document.dialog.querySelector('.selfie-skip').disabled, false);
      assert.match(document.dialog.querySelector('.selfie-status').textContent, /直接製卡/);
      if (mode === 'playback') assert.equal(stream.tracks[0].stops, 1);
      document.dialog.querySelector('.selfie-skip').click();
      assert.deepEqual(await result, { cancelled: false });
    });
  }
});
