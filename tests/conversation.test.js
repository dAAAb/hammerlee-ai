import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { BRAND } from '../src/branding.js';
import {
  VERSION, TOPICS, COMBINATION_COUNT,
  createConversation, normalizeSeed, newSeed,
} from '../src/conversation.js';

const SAMPLE_SEED = '00112233445566778899aabbccddeeff';
const allowedStickers = new Set(['heart', 'sun', 'tree', 'train', 'home', 'spark', 'thumb', 'badge']);

test('the same version and seed reproduce the complete shareable conversation', () => {
  const first = createConversation(SAMPLE_SEED, 1);
  const second = createConversation(SAMPLE_SEED.toUpperCase(), 1);
  assert.deepEqual(first, second);
  assert.equal(first.version, 1);
  assert.equal(first.seed, SAMPLE_SEED);
  // A consumer can animate or annotate its result without changing later replays.
  first.messages[0].text = 'changed by renderer';
  first.topicOrder.reverse();
  first.variantIndices.ai = 99;
  assert.deepEqual(createConversation(SAMPLE_SEED, 1), second);
});

test('version 1 replays the unchanged legacy scripts for all 256 reference seeds', () => {
  const hash = createHash('sha256');
  for (let index = 0; index < 256; index += 1) {
    hash.update(JSON.stringify(createConversation(index.toString(16).padStart(32, '0'), 1)));
  }
  assert.equal(hash.digest('hex'), '43f1c007875d405b8909f878ca6e551292bd4d5050a8638d84fc26b28ff40e2e');
});

test('new conversations use branded version 2 with explicit scripting and attribution disclosure', () => {
  const conversation = createConversation(SAMPLE_SEED);
  assert.equal(VERSION, 2);
  assert.equal(conversation.version, 2);
  assert.deepEqual(conversation, createConversation(SAMPLE_SEED, 2));
  assert.ok(conversation.messages.every(({ id }) => id.startsWith('v2-')));
  assert.ok(conversation.messages[0].text.includes(BRAND.subtitle));
  assert.ok(conversation.messages[0].text.includes('雙方對話皆為預先編寫'));
  assert.ok(conversation.messages[0].text.includes('非李四川本人原話'));
  assert.equal(conversation.messages[1].text, '你好，歡迎來到「川伯，聊聊」。一起看看未來新北的市政議題。');
  const legacy = createConversation(SAMPLE_SEED, 1);
  assert.deepEqual(conversation.topicOrder, legacy.topicOrder);
  assert.deepEqual(conversation.variantIndices, legacy.variantIndices);
  const withoutIds = (result) => result.messages.slice(4).map(({ id, ...message }) => message);
  assert.deepEqual(withoutIds(conversation), withoutIds(legacy));
});

test('unknown versions are rejected instead of silently replacing the shared script', () => {
  for (const version of [0, 3, -1, 1.5, '1', '2', null, NaN]) {
    assert.throws(() => createConversation(SAMPLE_SEED, version), RangeError);
  }
});

test('every run contains 48 individually addressable messages and all eight topics', () => {
  const conversation = createConversation(SAMPLE_SEED);
  assert.equal(conversation.messages.length, 48);
  assert.equal(new Set(conversation.messages.map(({ id }) => id)).size, 48);
  assert.deepEqual([...conversation.topicOrder].sort(), TOPICS.map(({ id }) => id).sort());
  assert.equal(conversation.messages.filter(({ topic }) => topic === 'intro').length, 4);
  assert.equal(conversation.messages.filter(({ topic }) => topic === 'ending').length, 4);
  for (const topic of TOPICS) {
    const messages = conversation.messages.filter((message) => message.topic === topic.id);
    assert.equal(messages.length, 5);
    assert.deepEqual(messages.map(({ role }) => role), ['guide', 'visitor', 'guide', 'visitor', 'guide']);
  }
  for (const message of conversation.messages) {
    assert.ok(message.text.length > 0);
    assert.ok(['guide', 'visitor', 'system'].includes(message.role));
    if (message.sticker) assert.ok(allowedStickers.has(message.sticker));
  }
});

test('the opening states that all interaction and visitor responses are prewritten', () => {
  const opening = createConversation(SAMPLE_SEED).messages.slice(0, 4);
  assert.ok(opening.some(({ text }) => text.includes('預先編寫') && text.includes('不是真人即時聊天')));
  assert.ok(opening.some(({ text }) => text.includes('示範腳本') && text.includes('不代表你的意見')));
});

test('the advertised route count is exactly eight permutations times four variants each', () => {
  const factorial = (number) => number <= 1 ? 1 : number * factorial(number - 1);
  const independentlyCalculated = factorial(TOPICS.length) * (4 ** TOPICS.length);
  assert.equal(independentlyCalculated, 2_642_411_520);
  assert.equal(COMBINATION_COUNT, independentlyCalculated);
  assert.equal(createConversation(SAMPLE_SEED).combinationCount, independentlyCalculated);
  assert.ok(Number.isSafeInteger(COMBINATION_COUNT));
});

test('a fixed corpus of seeds reaches all four complete variants and different topic orders', () => {
  const seenVariants = new Map(TOPICS.map(({ id }) => [id, new Set()]));
  const orders = new Set();
  for (let index = 0; index < 256; index += 1) {
    const result = createConversation(index.toString(16).padStart(32, '0'));
    orders.add(result.topicOrder.join(','));
    assert.equal(result.messages.length, 48);
    for (const { id } of TOPICS) {
      const variant = result.variantIndices[id];
      assert.ok(Number.isInteger(variant) && variant >= 0 && variant < 4);
      seenVariants.get(id).add(variant);
      assert.equal(result.messages.filter(({ topic }) => topic === id).length, 5);
    }
  }
  for (const variants of seenVariants.values()) assert.deepEqual([...variants].sort(), [0, 1, 2, 3]);
  assert.ok(orders.size > 200, `Only ${orders.size} distinct orders in the fixed seed corpus`);
});

test('seed validation canonicalises complete hexadecimal values and rejects malformed links', () => {
  assert.equal(normalizeSeed(`  ${SAMPLE_SEED.toUpperCase()}  `), SAMPLE_SEED);
  assert.equal(normalizeSeed('0'.repeat(32)), '0'.repeat(32));
  for (const invalid of ['', 'f'.repeat(31), 'f'.repeat(33), 'g'.repeat(32), '0x' + 'f'.repeat(30), null, 123, {}, []]) {
    assert.equal(normalizeSeed(invalid), null);
    assert.throws(() => createConversation(invalid), TypeError);
  }
  assert.match(newSeed(), /^[0-9a-f]{32}$/);
  assert.equal(createConversation().messages.length, 48);
});
