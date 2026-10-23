import test from 'node:test';
import assert from 'node:assert/strict';
import { createConversation } from '../src/conversation.js';
import { createJourneyOgSvg } from '../supabase/functions/journeys/og-image.js';
import { glyphs } from '../supabase/functions/journeys/og-glyphs.js';

const seed = '0123456789abcdef0123456789abcdef';

test('share SVG is deterministic, uses actual dialogue, and contains font-independent outline text', () => {
  for (const version of [1, 2]) {
    const conversation = createConversation(seed, version);
    const svg = createJourneyOgSvg(conversation);
    assert.equal(svg, createJourneyOgSvg(createConversation(seed, version)));
    assert.match(svg, /width="1200" height="630"/);
    assert.match(svg, /<path d="/);
    assert.doesNotMatch(svg, /<text\b|<image\b|<foreignObject\b|<filter\b/);
    assert.doesNotMatch(svg, /(?:href|src)=/);
    const topical = conversation.messages.filter(message => !['intro', 'ending'].includes(message.topic));
    assert.ok(svg.includes(topical.find(message => message.role === 'guide').text));
    assert.ok(svg.includes(topical.find(message => message.role === 'visitor').text));
    assert.match(svg, /雙方對話皆為預先編寫/);
    assert.ok(Buffer.byteLength(svg) < 250000);
  }
});

test('share artwork changes with identity and never accepts arbitrary image or unbounded text', () => {
  const first = createConversation(seed, 2);
  const second = createConversation('ffffffffffffffffffffffffffffffff', 2);
  assert.notEqual(createJourneyOgSvg(first), createJourneyOgSvg(second));
  assert.throws(() => createJourneyOgSvg({ ...first, seed: '" onload="alert(1)' }));
  assert.throws(() => createJourneyOgSvg({ ...first, messages: [{ role: 'guide', text: '字'.repeat(121), topic: 'ai' }, { role: 'visitor', text: '好', topic: 'ai' }] }));
});

test('outline subset covers all generated message variants and required display labels', () => {
  const missing = new Set();
  for (let i = 0; i < 256; i++) {
    for (const version of [1, 2]) {
      const conversation = createConversation(i.toString(16).padStart(32, '0'), version);
      for (const message of conversation.messages) for (const char of message.text) if (!/\s/.test(char) && !glyphs[char]) missing.add(char);
    }
  }
  assert.deepEqual([...missing], []);
});
