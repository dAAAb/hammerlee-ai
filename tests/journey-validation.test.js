import test from 'node:test';
import assert from 'node:assert/strict';
import { createConversation } from '../src/conversation.js';
import { validateJourneyInput, parseJourneyQuery, readJourneyBody, normalizeClientIp, hashRateIdentity, matchesProxySecret, matchesProxyDigest } from '../supabase/functions/journeys/validation.js';

const seed = '0123456789abcdef0123456789abcdef';
const secret = 'fixture-only-secret-with-more-than-32-characters';

test('registration accepts only seed/version and rejects client-provided scripts or snapshots', () => {
  assert.deepEqual(validateJourneyInput({ seed: seed.toUpperCase(), version: 2 }), { seed, version: 2 });
  for (const input of [null, [], {}, { seed, version: '2' }, { seed, version: 3 }, { seed: ` ${seed}`, version: 2 }, { seed, version: 2, script: {} }, { seed, version: 2, snapshot: 'data:image/png;base64,abc' }]) {
    assert.throws(() => validateJourneyInput(input));
  }
});

test('exact GET lookup rejects duplicated or ambiguous query parameters', () => {
  assert.deepEqual(parseJourneyQuery(`https://example.test/journeys?version=1&seed=${seed}`), { seed, version: 1 });
  for (const query of [`seed=${seed}&version=1&version=2`, `seed=${seed}&v=2`, `seed=${seed}&version=02`, `seed=${seed}&version=2&script=anything`]) {
    assert.throws(() => parseJourneyQuery(`https://example.test/?${query}`));
  }
});

test('streamed request size is enforced even when Content-Length is absent', async () => {
  const normal = new Request('https://example.test', { method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify({ seed, version: 2 }) });
  assert.deepEqual(await readJourneyBody(normal), { seed, version: 2 });
  const large = new Request('https://example.test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: ' '.repeat(257) });
  await assert.rejects(readJourneyBody(large), error => error.status === 413);
  const wrongType = new Request('https://example.test', { method: 'POST', body: JSON.stringify({ seed, version: 2 }) });
  await assert.rejects(readJourneyBody(wrongType), error => error.status === 415);
  const invalid = new Request('https://example.test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"seed":' });
  await assert.rejects(readJourneyBody(invalid), error => error.code === 'invalid_json');
});

test('only one real IP address is accepted and equivalent IPv6 forms normalize together', () => {
  assert.equal(normalizeClientIp('192.0.2.4'), '192.0.2.4');
  assert.equal(normalizeClientIp('2001:0db8:0000:0000:0000:0000:0000:0001'), '2001:db8::1');
  assert.equal(normalizeClientIp('2001:db8::1'), '2001:db8::1');
  for (const ip of [null, 'unknown', '192.0.2.1, 192.0.2.2', '256.1.2.3', '127.1', '192.0.2.1:8080', '[::1]', '::zz', ' 192.0.2.1']) assert.equal(normalizeClientIp(ip), null);
});

test('HMAC keys rotate by day and secret and never contain the raw address', async () => {
  const a = await hashRateIdentity('2001:db8::1', secret, '2026-10-23');
  const same = await hashRateIdentity('2001:0db8:0000:0000:0000:0000:0000:0001', secret, '2026-10-23');
  assert.match(a, /^[a-f0-9]{64}$/);
  assert.equal(a, same);
  assert.notEqual(a, await hashRateIdentity('2001:db8::1', secret, '2026-10-24'));
  assert.notEqual(a, await hashRateIdentity('2001:db8::1', `${secret}-rotated`, '2026-10-23'));
  assert.equal(a.includes('2001:db8::1'), false);
  await assert.rejects(hashRateIdentity('unknown', secret, '2026-10-23'));
});

test('proxy authorization fails closed for missing, weak, or incorrect secrets', async () => {
  assert.equal(await matchesProxySecret(secret, secret), true);
  assert.equal(await matchesProxySecret(`${secret}!`, secret), false);
  assert.equal(await matchesProxySecret(null, secret), false);
  assert.equal(await matchesProxySecret('short', 'short'), false);
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret)));
  const digest = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  assert.equal(await matchesProxyDigest(secret, digest), true);
  assert.equal(await matchesProxyDigest(`${secret}!`, digest), false);
  assert.equal(await matchesProxyDigest(null, digest), false);
  assert.equal(await matchesProxyDigest(secret, 'invalid'), false);
});

test('validated input regenerates the same immutable 48-message script for each supported version', () => {
  for (const version of [1, 2]) {
    const input = validateJourneyInput({ seed, version });
    const first = createConversation(input.seed, input.version);
    assert.deepEqual(first, createConversation(input.seed, input.version));
    assert.equal(first.messages.length, 48);
    assert.equal(first.version, version);
    assert.equal(first.seed, seed);
    assert.ok(Buffer.byteLength(JSON.stringify(first)) < 65536);
  }
});
