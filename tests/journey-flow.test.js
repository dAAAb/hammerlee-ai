import test from 'node:test';
import assert from 'node:assert/strict';
import { createConversation, VERSION } from '../src/conversation.js';
import { parseJourneyLink, pendingRunwayHeight, createJourneyFlow } from '../src/journey-flow.js';
import { createWorker } from '../server/app.js';

const SEED = '00112233445566778899aabbccddeeff';
const A = createConversation(SEED, 2);
const B = createConversation('ffeeddccbbaa99887766554433221100', 2);
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

test('client deep-link parsing agrees with the Worker for aliases, legacy links, and invalid versions', async () => {
  const worker = createWorker({ assets: { '/index.html': {
    base64: Buffer.from('<html><head><title>Test</title></head></html>').toString('base64'), type: 'text/html', etag: 'test',
  } } });
  const cases = [
    ['', { seed: null, version: VERSION }], ['?v=1', { seed: null, version: VERSION }],
    [`?s=${SEED}`, { seed: SEED, version: 1 }],
    [`?s=${SEED}&version=2`, { seed: SEED, version: 2 }],
    [`?s=${SEED.toUpperCase()}&v=2`, { seed: SEED, version: 2 }],
    [`?s=${SEED}&v=1&version=1`, { seed: SEED, version: 1 }],
    [`?s=${SEED}&v=2&version=2`, { seed: SEED, version: 2 }],
    [`?s=${SEED}&v=1&version=2`, null], [`?s=${SEED}&version=3`, null],
    [`?s=${SEED}&version=2&version=2`, null], [`?s=${SEED}&v=2&v=2`, null],
    [`?s=${SEED}&s=${SEED}&v=2`, null], ['?s=invalid&v=2', null],
  ];
  for (const [search, expected] of cases) {
    assert.deepEqual(parseJourneyLink(search), expected, search);
    const response = await worker.fetch(new Request(`https://hammerlee.ai/${search}`));
    assert.equal(response.status, expected ? 200 : 400, search);
    if (expected?.seed) assert.ok((await response.text()).includes(`/og/v${expected.version}/${expected.seed}.png`), search);
  }
});

test('phone runway cannot occupy a full screen or exceed the remaining conversation', () => {
  assert.ok(pendingRunwayHeight(5000, 844) < 240);
  assert.ok(pendingRunwayHeight(5000, 844) <= 844 * .28);
  assert.equal(pendingRunwayHeight(5000, 1200), 240);
  assert.equal(pendingRunwayHeight(5000, 400), 160);
  assert.equal(pendingRunwayHeight(90, 844), 90);
  assert.equal(pendingRunwayHeight(0, 844), 0);
});

test('restart cancels the pending share and an older save cannot clear or report for the new save', async () => {
  const pendingA = deferred(), pendingB = deferred();
  const saved = [], shared = [], statuses = [];
  const flow = createJourneyFlow({
    conversation: A,
    save: conversation => { saved.push(conversation.seed); return conversation === A ? pendingA.promise : pendingB.promise; },
    share: async snapshot => { shared.push(snapshot); return { method: 'native' }; },
    onSaveState: state => statuses.push(state.status),
  });
  const saveA = flow.persist();
  assert.equal(flow.persist(), saveA);
  const shareA = flow.share(`https://hammerlee.ai/?s=${A.seed}&v=2`);
  assert.deepEqual(await flow.share('https://hammerlee.ai/ignored'), { method: 'busy' });
  flow.reset(B);
  const saveB = flow.persist();
  await Promise.resolve();
  assert.deepEqual(saved, [A.seed, B.seed]);
  pendingA.resolve();
  await saveA;
  assert.deepEqual(await shareA, { method: 'cancelled' });
  assert.deepEqual(shared, []);
  assert.equal(statuses.at(-1), 'saving');
  assert.equal(flow.persist(), saveB, 'the old finally must not clear the new pending save');
  pendingB.resolve();
  await saveB;
  const url = `https://hammerlee.ai/?v=2&s=${B.seed}`;
  assert.deepEqual(await flow.share(url), { method: 'native' });
  assert.deepEqual(saved, [A.seed, B.seed], 'already saved journeys must not be posted again');
  assert.equal(shared[0].conversation, B);
  assert.equal(shared[0].url, url);
  assert.equal(statuses.at(-1), 'saved');
});

test('a share keeps its clicked URL snapshot and a failed save still permits the same deterministic link', async () => {
  const pending = deferred();
  let received;
  const flow = createJourneyFlow({ conversation: A, save: () => pending.promise,
    share: async snapshot => { received = snapshot; return { method: 'clipboard' }; } });
  let url = `https://hammerlee.ai/?s=${A.seed}&v=2`;
  const operation = flow.share(url);
  url = `https://hammerlee.ai/?s=${B.seed}&v=2`;
  pending.reject(new Error('temporary storage outage'));
  assert.deepEqual(await operation, { method: 'clipboard' });
  assert.equal(received.conversation, A);
  assert.equal(received.url, `https://hammerlee.ai/?s=${A.seed}&v=2`);
});

test('a native share finishing after a restart cannot update the new journey UI', async () => {
  const native = deferred();
  const flow = createJourneyFlow({ conversation: A, save: async () => {}, share: () => native.promise });
  await flow.persist();
  const operation = flow.share(`https://hammerlee.ai/?s=${A.seed}&v=2`);
  await Promise.resolve();
  flow.reset(B);
  native.resolve({ method: 'native' });
  assert.deepEqual(await operation, { method: 'cancelled' });
});
