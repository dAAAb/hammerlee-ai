import test from 'node:test';
import assert from 'node:assert/strict';
import { createConversation } from '../src/conversation.js';
import { shareJourney } from '../src/export.js';

const seed = '861867271b8530efa78e63489d6c0d7a';
const canonical = version => `https://hammerlee.ai/?v=${version}&s=${seed}`;

function setNavigator(t, value) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'navigator', previous); else delete globalThis.navigator; });
}

test('native sharing derives the replay link from the approved script, never from an input URL', async t => {
  const shared = [];
  setNavigator(t, { share: async data => { shared.push(data); } });
  for (const version of [1, 2]) for (const url of [
    `https://hammerlee.ai/?v=${version}&s=${seed}&email=private@example.test#access_token=PRIVATE`,
    'http://127.0.0.1:5173/?s=not-the-current-journey#private-note',
    'https://user:secret@untrusted.example/redirect?url=PRIVATE',
    'javascript:PRIVATE', undefined,
  ]) {
    const result = await shareJourney({ conversation: createConversation(seed, version), url });
    assert.deepEqual(result, { method: 'native', url: canonical(version) });
    assert.equal(shared.at(-1).url, canonical(version));
    assert.equal(Object.hasOwn(shared.at(-1), 'files'), false, 'link sharing never attaches a selfie or card');
  }
  assert.equal(JSON.stringify(shared).includes('PRIVATE'), false);
  assert.equal(JSON.stringify(shared).includes('private@example.test'), false);
});

test('clipboard fallback and manual fallback expose only the canonical replay URL', async t => {
  let copied;
  const navigator = { share: async () => { throw new Error('Share unavailable'); }, clipboard: {
    writeText: async value => { copied = value; },
  } };
  setNavigator(t, navigator);
  const input = { conversation: createConversation(seed, 2), url: 'https://elsewhere.example/#PRIVATE' };
  assert.deepEqual(await shareJourney(input), { method: 'clipboard', url: canonical(2) });
  assert.equal(copied, canonical(2));
  delete navigator.clipboard;
  const manual = await shareJourney(input);
  assert.equal(manual.method, 'manual');
  assert.equal(manual.url, canonical(2));
});

test('invalid script identity cannot be smuggled through an otherwise valid share URL', async t => {
  let calls = 0;
  setNavigator(t, { share: async () => { calls++; } });
  for (const conversation of [
    { ...createConversation(seed, 2), seed: 'invalid' },
    { ...createConversation(seed, 2), version: 999 },
  ]) await assert.rejects(shareJourney({ conversation, url: canonical(2) }), TypeError);
  assert.equal(calls, 0);
});
