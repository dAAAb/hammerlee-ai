import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createWorker, CANONICAL_ORIGIN } from '../server/app.js';
import { createConversation } from '../src/conversation.js';

const seed = '00112233445566778899aabbccddeeff';
const png = fs.readFileSync(new URL('../server/assets/og-fallback.png', import.meta.url));
const asset = (body, type) => ({ base64: Buffer.from(body).toString('base64'), type, etag: '"fixture"' });
const assets = {
  '/index.html': asset('<!doctype html><html><head><title>Old</title><meta name="robots" content="noindex,nofollow"><meta name="description" content="Old"></head><body>川伯，聊聊<script type="module" src="/assets/app-12345678.js"></script></body></html>', 'text/html; charset=utf-8'),
  '/assets/app-12345678.js': { ...asset('console.log("client")', 'text/javascript; charset=utf-8'), cacheControl: 'public, max-age=31536000, immutable' },
  '/og/default.png': asset(png, 'image/png'),
};
const env = {
  SUPABASE_JOURNEY_FUNCTION_URL: 'https://projectref.supabase.co/functions/v1/journeys',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_server_test_only',
  SUPABASE_JOURNEY_PROXY_SECRET: '0123456789abcdef0123456789abcdef',
};
const createRequest = (pathname = '/', options = {}) => new Request(`${CANONICAL_ORIGIN}${pathname}`, options);
const post = (body = { seed, version: 2 }, extraHeaders = {}) => createRequest('/api/journeys', {
  method: 'POST', headers: { Origin: CANONICAL_ORIGIN, 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.42', ...extraHeaders },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});
const stored = (status = 200, version = 2) => new Response(JSON.stringify({ journey: { seed, version, script: createConversation(seed, version), created_at: '2026-10-23T00:00:00Z', snapshot_url: null }, created: status === 201 }), { status, headers: { 'Content-Type': 'application/json' } });

test('all secondary hosts permanently redirect to the primary domain preserving share information', async () => {
  const worker = createWorker({ assets });
  for (const origin of ['https://hammerlee.tw', 'https://www.hammerlee.tw', 'https://www.hammerlee.ai', 'http://hammerlee.ai']) {
    const result = await worker.fetch(new Request(`${origin}/?s=${seed}&v=1`));
    assert.equal(result.status, 301);
    assert.equal(result.headers.get('Location'), `${CANONICAL_ORIGIN}/?s=${seed}&v=1`);
  }
});

test('homepage is indexable only on the primary hostname and has canonical and social metadata', async () => {
  const worker = createWorker({ assets });
  const result = await worker.fetch(createRequest('/'), env);
  assert.match(result.headers.get('X-Robots-Tag'), /^index/);
  const html = await result.text();
  assert.match(html, /rel="canonical" href="https:\/\/hammerlee\.ai\/"/);
  assert.match(html, /property="og:image" content="https:\/\/hammerlee\.ai\/og\/default\.png"/);
  assert.match(html, /<title>川伯，聊聊/);
  assert.equal((html.match(/name="robots"/g) || []).length, 1);
  assert.ok(!html.includes('noindex,nofollow'));
  assert.ok(!html.includes(env.SUPABASE_PUBLISHABLE_KEY));
  assert.ok(!html.includes(env.SUPABASE_JOURNEY_PROXY_SECRET));
  const preview = await worker.fetch(new Request('https://preview.example/'));
  assert.equal(preview.headers.get('X-Robots-Tag'), 'noindex, follow');
});

test('shared pages expose seed-specific metadata but canonicalise and noindex the parameterised page', async () => {
  const worker = createWorker({ assets });
  const result = await worker.fetch(createRequest(`/?s=${seed}&v=2`));
  const html = await result.text();
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('X-Robots-Tag'), 'noindex, follow');
  assert.ok(html.includes(`https://hammerlee.ai/og/v2/${seed}.png`));
  assert.ok(html.includes(`https://hammerlee.ai/?s=${seed}&amp;v=2`));
  assert.ok(html.includes(createConversation(seed, 2).messages[4].text));
  assert.match(html, /rel="canonical" href="https:\/\/hammerlee\.ai\/"/);
  const legacy = await worker.fetch(createRequest(`/?s=${seed}`));
  assert.ok((await legacy.text()).includes(`/og/v1/${seed}.png`));
  assert.equal((await worker.fetch(createRequest('/?s=%3Cscript%3E&v=2'))).status, 400);
  assert.equal((await worker.fetch(createRequest(`/?s=${seed}&v=3`))).status, 400);
  assert.equal((await worker.fetch(createRequest(`/?s=${seed}&s=${seed}&v=2`))).status, 400);
});

test('robots and sitemap expose only the canonical homepage, and asset GET/HEAD/ETag are supported', async () => {
  const worker = createWorker({ assets });
  const robots = await (await worker.fetch(createRequest('/robots.txt'))).text();
  assert.ok(robots.includes('Sitemap: https://hammerlee.ai/sitemap.xml'));
  assert.ok(!robots.includes('Disallow: /\n'));
  assert.match(await (await worker.fetch(new Request('https://preview.example/robots.txt'))).text(), /Disallow: \/\n/);
  const sitemap = await (await worker.fetch(createRequest('/sitemap.xml'))).text();
  assert.equal((sitemap.match(/<loc>/g) || []).length, 1);
  assert.ok(sitemap.includes('<loc>https://hammerlee.ai/</loc>'));
  const javascript = await worker.fetch(createRequest('/assets/app-12345678.js'));
  assert.equal(await javascript.text(), 'console.log("client")');
  assert.match(javascript.headers.get('Cache-Control'), /immutable/);
  assert.equal((await worker.fetch(createRequest('/assets/app-12345678.js', { headers: { 'If-None-Match': '"fixture"' } }))).status, 304);
  const head = await worker.fetch(createRequest('/assets/app-12345678.js', { method: 'HEAD' }));
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.equal((await worker.fetch(createRequest('/missing.js'))).status, 404);
});

test('POST forwards only validated seed/version plus server credentials and trusted edge IP', async () => {
  let forwarded;
  const worker = createWorker({ assets, fetcher: async (url, init) => { forwarded = { url, init }; return stored(201); } });
  const result = await worker.fetch(post({ seed: seed.toUpperCase(), version: 2 }, {
    'x-journey-client-ip': '198.51.100.99', Authorization: 'Bearer attacker', Cookie: 'session=private',
  }), env);
  assert.equal(result.status, 201);
  assert.equal(forwarded.url, env.SUPABASE_JOURNEY_FUNCTION_URL);
  assert.deepEqual(JSON.parse(forwarded.init.body), { seed, version: 2 });
  assert.equal(forwarded.init.headers['x-journey-client-ip'], '203.0.113.42');
  assert.equal(forwarded.init.headers['x-journey-proxy-secret'], env.SUPABASE_JOURNEY_PROXY_SECRET);
  assert.equal(forwarded.init.headers.apikey, env.SUPABASE_PUBLISHABLE_KEY);
  assert.equal(forwarded.init.headers.Authorization, undefined);
  assert.equal(forwarded.init.headers.Cookie, undefined);
  assert.equal(forwarded.init.redirect, 'manual');
  assert.equal(result.headers.get('Cache-Control'), 'no-store');
  assert.equal((await result.json()).journey.seed, seed);
});

test('public writes reject cross-origin, extra fields, invalid versions, large bodies and missing trusted IP before fetching', async () => {
  let calls = 0;
  const worker = createWorker({ assets, fetcher: async () => { calls += 1; return stored(); } });
  assert.equal((await worker.fetch(post(undefined, { Origin: 'https://other.example' }), env)).status, 403);
  assert.equal((await worker.fetch(post(undefined, { 'Sec-Fetch-Site': 'cross-site' }), env)).status, 403);
  assert.equal((await worker.fetch(post(undefined, { 'Content-Type': 'text/plain' }), env)).status, 415);
  assert.equal((await worker.fetch(post({ seed, version: 2, script: 'untrusted' }), env)).status, 400);
  assert.equal((await worker.fetch(post({ seed, version: '2' }), env)).status, 400);
  assert.equal((await worker.fetch(post({ seed: 'no', version: 2 }), env)).status, 400);
  assert.equal((await worker.fetch(post('invalid json'), env)).status, 400);
  assert.equal((await worker.fetch(post(' '.repeat(2048)), env)).status, 413);
  assert.equal((await worker.fetch(post(undefined, { 'CF-Connecting-IP': '' }), env)).status, 503);
  assert.equal((await worker.fetch(post(undefined, { 'CF-Connecting-IP': '999.1.2.3' }), env)).status, 503);
  assert.equal(calls, 0);
});

test('GET uses one fixed backend endpoint and normalises the version alias', async () => {
  let forwarded;
  const worker = createWorker({ assets, fetcher: async (url, init) => { forwarded = { url, init }; return stored(200, 1); } });
  const result = await worker.fetch(createRequest(`/api/journeys/${seed}?v=1`), env);
  assert.equal(result.status, 200);
  assert.equal(forwarded.url, `${env.SUPABASE_JOURNEY_FUNCTION_URL}?seed=${seed}&version=1`);
  assert.equal(forwarded.init.method, 'GET');
  assert.equal(forwarded.init.headers['x-journey-client-ip'], undefined);
  assert.equal((await worker.fetch(createRequest(`/api/journeys/${seed}?version=2&v=1`), env)).status, 400);
  assert.equal((await worker.fetch(createRequest(`/api/journeys/${seed}?url=https://evil.example`), env)).status, 400);
  assert.equal((await worker.fetch(createRequest('/api/journeys'), env)).status, 405);
  assert.equal((await worker.fetch(createRequest('/api/anything'), env)).status, 404);
  assert.equal((await worker.fetch(createRequest(`/api/journeys/${seed}`), { ...env, SUPABASE_JOURNEY_FUNCTION_URL: 'https://evil.example/functions/v1/journeys' })).status, 503);
});

test('storage outages, redirects, non-JSON and oversized payloads fail closed; legitimate conflicts remain explicit', async () => {
  const request = () => createRequest(`/api/journeys/${seed}?version=2`);
  for (const result of [
    new Response(null, { status: 302, headers: { Location: 'https://evil.example' } }),
    new Response('<html>bad gateway</html>', { status: 200, headers: { 'Content-Type': 'text/html' } }),
    new Response('x'.repeat(70_000), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    new Response(JSON.stringify({ journey: { seed: 'f'.repeat(32), version: 2 } }), { headers: { 'Content-Type': 'application/json' } }),
  ]) {
    const worker = createWorker({ assets, fetcher: async () => result });
    assert.equal((await worker.fetch(request(), env)).status, 502);
  }
  const offline = createWorker({ assets, fetcher: async () => { throw new TypeError('network unavailable'); } });
  assert.equal((await offline.fetch(request(), env)).status, 502);
  assert.equal((await offline.fetch(request(), {})).status, 503);
  const conflict = createWorker({ assets, fetcher: async () => new Response('{"error":"version_conflict"}', { status: 409, headers: { 'Content-Type': 'application/json' } }) });
  assert.equal((await conflict.fetch(request(), env)).status, 409);
});

test('OG routes return the real bundled PNG fallback until a fixed-path stored PNG exists', async () => {
  const fallbackWorker = createWorker({ assets, fetcher: async () => new Response(null, { status: 404 }) });
  const fallback = await fallbackWorker.fetch(createRequest(`/og/v2/${seed}.png`), env);
  assert.equal(fallback.status, 200);
  assert.equal(fallback.headers.get('Content-Type'), 'image/png');
  assert.equal(fallback.headers.get('X-OG-Image-Source'), 'fallback');
  assert.deepEqual(new Uint8Array(await fallback.arrayBuffer()), new Uint8Array(png));
  let storedUrl;
  const storedWorker = createWorker({ assets, fetcher: async url => { storedUrl = url; return new Response(png, { headers: { 'Content-Type': 'image/png' } }); } });
  const image = await storedWorker.fetch(createRequest(`/og/v1/${seed}.png`), env);
  assert.equal(storedUrl, `https://projectref.supabase.co/storage/v1/object/public/journey-images/v1/${seed}.png`);
  assert.equal(image.headers.get('X-OG-Image-Source'), 'stored');
  assert.equal((await storedWorker.fetch(createRequest('/og/v3/anything.png'), env)).status, 404);
});
