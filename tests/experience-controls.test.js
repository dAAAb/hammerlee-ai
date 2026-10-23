import test from 'node:test';
import assert from 'node:assert/strict';
import { clampTilt, createNotificationGate, createExperienceControls } from '../src/experience-controls.js';

test('first orientation reading calibrates to zero, then produces bounded relative motion', () => {
  const reference = { beta: 45, gamma: -10 };
  assert.deepEqual(clampTilt(reference, reference), { x: 0, y: 0 });
  assert.deepEqual(clampTilt({ beta: 57, gamma: 2 }, reference), { x: 0.5, y: 0.5 });
  assert.deepEqual(clampTilt({ beta: 150, gamma: -89 }, reference), { x: -1, y: 1 });
});

test('orientation handles the beta wrap boundary without jumping across the scene', () => {
  const result = clampTilt({ beta: -179, gamma: 0 }, { beta: 179, gamma: 0 });
  assert.ok(Math.abs(result.y - 2 / 24) < 1e-12);
  assert.equal(result.x, 0);
});

test('landscape rotation follows screen axes and clamps diagonal movement', () => {
  const reference = { beta: 0, gamma: 0 };
  assert.deepEqual(clampTilt({ beta: 12, gamma: 0 }, reference, 90), { x: 0.5, y: 0 });
  assert.deepEqual(clampTilt({ beta: 0, gamma: 12 }, reference, 90), { x: 0, y: -0.5 });
  const diagonal = clampTilt({ beta: 90, gamma: 90 }, reference, 45);
  assert.equal(diagonal.x, 1);
  assert.ok(Math.abs(diagonal.y) <= 1);
});

test('unavailable/null/nonfinite sensor readings never masquerade as real motion', () => {
  const reference = { beta: 0, gamma: 0 };
  for (const reading of [null, {}, { beta: null, gamma: 0 }, { beta: 0, gamma: NaN }, { beta: Infinity, gamma: 0 }]) {
    assert.equal(clampTilt(reading, reference), null);
  }
  assert.equal(clampTilt(reference, null), null);
  assert.equal(clampTilt(reference, reference, 0, 0), null);
});

test('notification gate drops fast arrivals rather than queuing a backlog', () => {
  const gate = createNotificationGate();
  assert.equal(gate.allow(0), true);
  for (const time of [1, 20, 100, 349]) assert.equal(gate.allow(time), false);
  assert.equal(gate.allow(350), true);
  assert.equal(gate.allow(699), false);
  assert.equal(gate.allow(700), true);
});

test('hidden, disabled, and system events do not consume notification allowance', () => {
  const gate = createNotificationGate();
  assert.equal(gate.allow(1, { visible: false }), false);
  assert.equal(gate.allow(2, { enabled: false }), false);
  assert.equal(gate.allow(3, { role: 'system' }), false);
  assert.equal(gate.allow(4, { role: 'visitor' }), true);
  assert.equal(gate.allow(400, { role: 'unknown' }), false);
  assert.equal(gate.allow(401, { role: 'guide' }), true);
  gate.reset();
  assert.equal(gate.allow(402), true);
});

test('controller defaults off, exposes detached state, and safely cleans up without browser APIs', () => {
  const controller = createExperienceControls();
  const state = controller.getState();
  assert.equal(state.sound.enabled, false);
  assert.equal(state.vibration.enabled, false);
  assert.equal(state.tilt.enabled, false);
  state.sound.enabled = true;
  assert.equal(controller.getState().sound.enabled, false);
  assert.equal(controller.notifyMessage('guide').delivered, false);
  assert.equal(controller.destroy().destroyed, true);
  assert.equal(controller.destroy().destroyed, true);
  assert.equal(controller.notifyMessage('guide').reason, 'destroyed');
});

function browserFixture(context, { reducedMotion = false, permission = 'granted', vibrate } = {}) {
  const win = new EventTarget(), doc = new EventTarget(), media = new EventTarget();
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const calls = { permission: 0 };
  win.document = doc; doc.hidden = false;
  win.navigator = { userActivation: { isActive: true }, ...(vibrate ? { vibrate } : {}) };
  win.isSecureContext = true;
  media.matches = reducedMotion; win.matchMedia = () => media;
  win.screen = { orientation: Object.assign(new EventTarget(), { angle: 0 }) };
  win.DeviceOrientationEvent = { requestPermission: async () => { calls.permission++; return permission; } };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: win });
  context.after(() => {
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow);
    else delete globalThis.window;
  });
  return { win, doc, media, calls, sendOrientation(beta, gamma) {
    win.dispatchEvent(Object.assign(new Event('deviceorientation'), { beta, gamma }));
  } };
}

test('orientation permission is requested only after an explicit activation and denial stays off', async context => {
  const fixture = browserFixture(context, { permission: 'denied' });
  const controls = createExperienceControls(); context.after(() => controls.destroy());
  assert.equal(fixture.calls.permission, 0);
  fixture.win.navigator.userActivation.isActive = false;
  await controls.enableTilt();
  assert.equal(fixture.calls.permission, 0);
  assert.equal(controls.getState().tilt.status, 'activation-required');
  fixture.win.navigator.userActivation.isActive = true;
  await controls.enableTilt();
  assert.equal(fixture.calls.permission, 1);
  assert.equal(controls.getState().tilt.permission, 'denied');
  assert.equal(controls.getState().tilt.enabled, false);
});

test('reduced-motion remains off until opt-in, first sensor event calibrates, and preference changes stop motion', async context => {
  const fixture = browserFixture(context, { reducedMotion: true });
  const offsets = [];
  const controls = createExperienceControls({ onTilt: offset => offsets.push(offset) }); context.after(() => controls.destroy());
  assert.equal(controls.getState().tilt.status, 'reduced-motion');
  assert.equal(fixture.calls.permission, 0);
  await controls.enableTilt();
  assert.equal(controls.getState().tilt.status, 'waiting');
  fixture.sendOrientation(null, null);
  assert.equal(controls.getState().tilt.hasSensor, false);
  fixture.sendOrientation(60, 10);
  assert.equal(controls.getState().tilt.status, 'on');
  assert.deepEqual(offsets.at(-1), { x: 0, y: 0 });
  fixture.sendOrientation(72, 22);
  assert.deepEqual(offsets.at(-1), { x: 0.1, y: 0.1 });
  fixture.media.dispatchEvent(Object.assign(new Event('change'), { matches: true }));
  assert.equal(controls.getState().tilt.enabled, false);
  assert.equal(controls.getState().tilt.status, 'reduced-motion');
  assert.deepEqual(offsets.at(-1), { x: 0, y: 0 });
});

test('a granted permission without real sensor data times out as unavailable', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  browserFixture(context);
  const controls = createExperienceControls(); context.after(() => controls.destroy());
  await controls.enableTilt();
  assert.equal(controls.getState().tilt.status, 'waiting');
  context.mock.timers.tick(4000);
  assert.equal(controls.getState().tilt.status, 'unavailable');
  assert.equal(controls.getState().tilt.enabled, false);
  assert.equal(controls.getState().tilt.hasSensor, false);
});

test('missing vibration API is reported unsupported rather than simulated', context => {
  browserFixture(context);
  const controls = createExperienceControls(); context.after(() => controls.destroy());
  assert.equal(controls.enableVibration().vibration.status, 'unsupported');
  assert.equal(controls.getState().vibration.enabled, false);
  assert.equal(controls.notifyMessage('guide').vibration, false);
});

test('audio is created and resumed only by opt-in, and interrupted audio is never auto-resumed by messages', async context => {
  const fixture = browserFixture(context);
  const calls = { constructed: 0, resumed: 0, tones: 0 };
  let audio;
  fixture.win.AudioContext = class extends EventTarget {
    constructor() { super(); calls.constructed++; audio = this; this.state = 'suspended'; this.currentTime = 0; this.destination = {}; }
    async resume() { calls.resumed++; this.state = 'running'; }
    async suspend() { this.state = 'suspended'; }
    async close() { this.state = 'closed'; }
    createOscillator() { return { frequency: { setValueAtTime() {} }, connect() {}, disconnect() {}, start() { calls.tones++; }, stop() {} }; }
    createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} }; }
  };
  const controls = createExperienceControls(); context.after(() => controls.destroy());
  controls.notifyMessage('guide');
  assert.equal(calls.constructed, 0);
  fixture.win.navigator.userActivation.isActive = false;
  await controls.enableSound();
  assert.equal(calls.constructed, 0);
  fixture.win.navigator.userActivation.isActive = true;
  await controls.enableSound();
  assert.equal(calls.constructed, 1);
  assert.equal(calls.resumed, 1);
  assert.equal(controls.notifyMessage('guide').sound, true);
  assert.equal(calls.tones, 2);
  audio.state = 'suspended'; audio.dispatchEvent(new Event('statechange'));
  assert.equal(controls.getState().sound.enabled, false);
  assert.equal(controls.getState().sound.status, 'activation-required');
  controls.notifyMessage('guide');
  assert.equal(calls.resumed, 1);
});
