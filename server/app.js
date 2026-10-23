import { BRAND } from '../src/branding.js';
import { createConversation, normalizeSeed, VERSION } from '../src/conversation.js';

export const CANONICAL_ORIGIN = 'https://hammerlee.ai';
const REDIRECT_HOSTS = new Set(['hammerlee.tw', 'www.hammerlee.tw', 'www.hammerlee.ai']);
const MAX_REQUEST_BYTES = 1024;
const MAX_UPSTREAM_BYTES = 65_536;
const MAX_IMAGE_BYTES = 2_097_152;
const COMMON_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), accelerometer=(self), gyroscope=(self)',
};

class PayloadLimitError extends Error {}

function response(body, { status = 200, headers = {}, head = false } = {}) {
  return new Response(head ? null : body, { status, headers: { ...COMMON_HEADERS, ...headers } });
}

function json(body, status = 200, extraHeaders = {}) {
  return response(JSON.stringify(body), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow',
    ...extraHeaders,
  } });
}

function error(code, status) { return json({ error: code }, status); }

function decodeBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function readLimited(stream, maximum) {
  if (!stream) return new Uint8Array();
  const reader = stream.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximum) {
        await reader.cancel();
        throw new PayloadLimitError('Payload exceeds the allowed size.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

function parseVersion(search, fallback = VERSION) {
  const versions = search.getAll('version');
  const aliases = search.getAll('v');
  if (versions.length > 1 || aliases.length > 1) return null;
  if (versions.length && aliases.length && versions[0] !== aliases[0]) return null;
  const value = versions[0] ?? aliases[0];
  if (value === undefined) return fallback;
  return value === '1' || value === '2' ? Number(value) : null;
}

function validClientIp(value) {
  if (!value || value.length > 45) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) return value.split('.').every(part => Number(part) <= 255);
  if (!/^[a-f0-9:.]+$/i.test(value) || !value.includes(':')) return false;
  try { return new URL(`https://[${value}]/`).hostname.startsWith('['); } catch { return false; }
}

function sameOrigin(request, url, write = false) {
  const origin = request.headers.get('Origin');
  const site = request.headers.get('Sec-Fetch-Site');
  if (site === 'cross-site' || site === 'same-site') return false;
  if (write) return origin === url.origin;
  return !origin || origin === url.origin;
}

function backendConfig(env) {
  try {
    const endpoint = new URL(env.SUPABASE_JOURNEY_FUNCTION_URL);
    if (endpoint.protocol !== 'https:' || !/^[a-z0-9]+\.supabase\.co$/.test(endpoint.hostname)
      || endpoint.pathname.replace(/\/$/, '') !== '/functions/v1/journeys'
      || endpoint.search || endpoint.hash || endpoint.username || endpoint.password) return null;
    if (typeof env.SUPABASE_PUBLISHABLE_KEY !== 'string' || !env.SUPABASE_PUBLISHABLE_KEY.trim()
      || typeof env.SUPABASE_JOURNEY_PROXY_SECRET !== 'string' || env.SUPABASE_JOURNEY_PROXY_SECRET.length < 32) return null;
    endpoint.pathname = endpoint.pathname.replace(/\/$/, '');
    return { endpoint, key: env.SUPABASE_PUBLISHABLE_KEY, secret: env.SUPABASE_JOURNEY_PROXY_SECRET };
  } catch { return null; }
}

async function boundedFetch(fetcher, url, init, maximum, milliseconds) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), milliseconds);
  try {
    const upstream = await fetcher(url, { ...init, redirect: 'manual', signal: controller.signal });
    const statedLength = Number(upstream.headers.get('Content-Length'));
    if (Number.isFinite(statedLength) && statedLength > maximum) {
      await upstream.body?.cancel();
      throw new PayloadLimitError('Upstream payload exceeds the allowed size.');
    }
    return { upstream, bytes: await readLimited(upstream.body, maximum) };
  } finally { clearTimeout(timeout); }
}

async function journeyApi(request, url, env, fetcher) {
  const isCollection = url.pathname === '/api/journeys';
  const match = url.pathname.match(/^\/api\/journeys\/([0-9a-f]{32})$/i);
  if (!isCollection && !match) return error('not_found', 404);
  const isWrite = request.method === 'POST' && isCollection;
  if (!isWrite && !(request.method === 'GET' && match)) {
    return json({ error: 'method_not_allowed' }, 405, { Allow: isCollection ? 'POST' : 'GET' });
  }
  if (!sameOrigin(request, url, isWrite)) return error('cross_origin_not_allowed', 403);

  let seed;
  let version;
  let clientIp;
  if (isWrite) {
    if (url.search) return error('unexpected_query_parameters', 400);
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('Content-Type') || '')) {
      return error('json_content_type_required', 415);
    }
    if (request.headers.has('Content-Encoding') && request.headers.get('Content-Encoding') !== 'identity') {
      return error('content_encoding_not_supported', 415);
    }
    const statedLength = Number(request.headers.get('Content-Length'));
    if (Number.isFinite(statedLength) && statedLength > MAX_REQUEST_BYTES) return error('request_too_large', 413);
    let payload;
    try { payload = JSON.parse(new TextDecoder().decode(await readLimited(request.body, MAX_REQUEST_BYTES))); }
    catch (caught) { return error(caught instanceof PayloadLimitError ? 'request_too_large' : 'invalid_json', caught instanceof PayloadLimitError ? 413 : 400); }
    if (!payload || Array.isArray(payload) || typeof payload !== 'object'
      || Object.keys(payload).length !== 2 || !Object.hasOwn(payload, 'seed') || !Object.hasOwn(payload, 'version')) {
      return error('expected_seed_and_version_only', 400);
    }
    seed = normalizeSeed(payload.seed);
    version = payload.version;
    if (!seed || ![1, 2].includes(version)) return error('invalid_seed_or_version', 400);
    // Cloudflare controls this header at the edge. Never forward the caller's
    // x-journey-client-ip, cookies, Authorization, or other arbitrary headers.
    clientIp = request.headers.get('CF-Connecting-IP');
    if (!validClientIp(clientIp)) return error('trusted_client_address_unavailable', 503);
  } else {
    if ([...url.searchParams.keys()].some(key => key !== 'v' && key !== 'version')) return error('unexpected_query_parameters', 400);
    seed = normalizeSeed(match[1]);
    version = parseVersion(url.searchParams);
    if (!version) return error('invalid_version', 400);
  }

  const backend = backendConfig(env);
  if (!backend) return error('journey_storage_unavailable', 503);
  const endpoint = new URL(backend.endpoint);
  const headers = { Accept: 'application/json', apikey: backend.key, 'x-journey-proxy-secret': backend.secret };
  if (isWrite) { headers['Content-Type'] = 'application/json'; headers['x-journey-client-ip'] = clientIp; }
  else { endpoint.searchParams.set('seed', seed); endpoint.searchParams.set('version', String(version)); }

  try {
    const { upstream, bytes } = await boundedFetch(fetcher, endpoint.href, {
      method: isWrite ? 'POST' : 'GET', headers,
      ...(isWrite ? { body: JSON.stringify({ seed, version }) } : {}),
    }, MAX_UPSTREAM_BYTES, 12_000);
    if (![200, 201, 400, 404, 409, 429].includes(upstream.status)
      || !/^application\/json\b/i.test(upstream.headers.get('Content-Type') || '')) return error('journey_storage_error', 502);
    const payload = JSON.parse(new TextDecoder().decode(bytes));
    if (!payload || Array.isArray(payload) || typeof payload !== 'object') return error('invalid_storage_response', 502);
    if (upstream.ok && (payload.journey?.seed !== seed || payload.journey?.version !== version)) return error('invalid_storage_response', 502);
    const retryAfter = upstream.headers.get('Retry-After');
    return json(payload, upstream.status, upstream.status === 429 && /^\d{1,5}$/.test(retryAfter || '') ? { 'Retry-After': retryAfter } : {});
  } catch { return error('journey_storage_error', 502); }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function shareDetails(url) {
  const seeds = url.searchParams.getAll('s');
  if (!seeds.length) return { seed: null, version: VERSION };
  if (seeds.length !== 1) return null;
  const seed = normalizeSeed(seeds[0]);
  // Existing seeded links without a version came from the original v1 exhibit.
  const version = parseVersion(url.searchParams, 1);
  return seed && version ? { seed, version } : null;
}

function pageHtml(source, url, details) {
  const canonical = `${CANONICAL_ORIGIN}/`;
  const shared = Boolean(details.seed);
  const publicHomepage = url.hostname === 'hammerlee.ai' && !shared;
  const robots = publicHomepage ? 'index, follow, max-image-preview:large' : 'noindex, follow';
  const shareUrl = new URL(canonical);
  let description = `${BRAND.subtitle}。${BRAND.disclosure}`;
  let ogImage = `${CANONICAL_ORIGIN}/og/default.png`;
  if (shared) {
    shareUrl.searchParams.set('s', details.seed);
    shareUrl.searchParams.set('v', String(details.version));
    ogImage = `${CANONICAL_ORIGIN}/og/v${details.version}/${details.seed}.png`;
    const selected = createConversation(details.seed, details.version).messages.filter(message => message.topic !== 'intro' && message.role !== 'system').slice(0, 2);
    description = `${BRAND.subtitle}。${selected.map(message => message.text).join(' ')} 雙方皆為預寫腳本，非本人原話。`;
  }
  const title = `${BRAND.title}｜${BRAND.subtitle}`;
  const metadata = [
    `<meta name="robots" content="${robots}">`,
    `<link rel="canonical" href="${canonical}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:locale" content="zh_TW">`,
    `<meta property="og:site_name" content="${escapeHtml(BRAND.title)}">`,
    `<meta property="og:title" content="${escapeHtml(BRAND.title)}">`,
    `<meta property="og:description" content="${escapeHtml(description)}">`,
    `<meta property="og:url" content="${escapeHtml(shareUrl.href)}">`,
    `<meta property="og:image" content="${ogImage}">`,
    `<meta property="og:image:type" content="image/png">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta property="og:image:alt" content="川伯，聊聊預寫市政資訊展示分享卡">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${escapeHtml(BRAND.title)}">`,
    `<meta name="twitter:description" content="${escapeHtml(description)}">`,
    `<meta name="twitter:image" content="${ogImage}">`,
    `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'WebSite', name: BRAND.title, url: canonical, inLanguage: 'zh-Hant-TW', description: BRAND.subtitle }).replace(/</g, '\\u003c')}</script>`,
  ].join('\n');
  return {
    robots,
    html: source
      .replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(title)}</title>`)
      .replace(/<meta\s+[^>]*name=["'](?:robots|description|twitter:[^"']+)["'][^>]*>/gi, '')
      .replace(/<meta\s+[^>]*property=["']og:[^"']+["'][^>]*>/gi, '')
      .replace(/<link\s+[^>]*rel=["']canonical["'][^>]*>/gi, '')
      .replace(/<\/head>/i, `<meta name="description" content="${escapeHtml(description)}">\n${metadata}\n</head>`),
  };
}

function staticResponse(request, asset, extraHeaders = {}) {
  const headers = { 'Content-Type': asset.type, 'Cache-Control': asset.cacheControl || 'public, max-age=0, must-revalidate', ETag: asset.etag, ...extraHeaders };
  if (request.headers.get('If-None-Match') === asset.etag) return response(null, { status: 304, headers });
  return response(decodeBase64(asset.base64), { headers, head: request.method === 'HEAD' });
}

async function ogImage(request, match, env, fetcher, fallback) {
  if (match) {
    const backend = backendConfig(env);
    if (backend) {
      const storageUrl = new URL(`/storage/v1/object/public/journey-images/v${match[1]}/${match[2].toLowerCase()}.png`, backend.endpoint.origin);
      try {
        const { upstream, bytes } = await boundedFetch(fetcher, storageUrl.href, { headers: { Accept: 'image/png' } }, MAX_IMAGE_BYTES, 5000);
        const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
        if (upstream.ok && /^image\/png\b/i.test(upstream.headers.get('Content-Type') || '')
          && pngSignature.every((byte, index) => bytes[index] === byte)) {
          return response(bytes, { head: request.method === 'HEAD', headers: {
            'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
            'X-OG-Image-Source': 'stored', 'X-Robots-Tag': 'noindex',
          } });
        }
      } catch { /* Missing or unavailable stored images use the honest shared fallback. */ }
    }
  }
  return fallback ? staticResponse(request, fallback, {
    'Cache-Control': 'public, max-age=300', 'X-OG-Image-Source': 'fallback', 'X-Robots-Tag': 'noindex',
  }) : error('preview_image_unavailable', 503);
}

/** The assets are immutable build output; no request data is retained globally. */
export function createWorker({ assets, fetcher = globalThis.fetch } = {}) {
  const index = assets?.['/index.html'];
  const indexHtml = index ? new TextDecoder().decode(decodeBase64(index.base64)) : null;
  return {
    async fetch(request, env = {}, _ctx) {
      const url = new URL(request.url);
      if (REDIRECT_HOSTS.has(url.hostname) || (url.hostname === 'hammerlee.ai' && url.protocol !== 'https:')) {
        return response(null, { status: 301, headers: { Location: `${CANONICAL_ORIGIN}${url.pathname}${url.search}`, 'Cache-Control': 'public, max-age=86400' } });
      }
      if (url.pathname.startsWith('/api/')) return journeyApi(request, url, env, fetcher);
      if (!['GET', 'HEAD'].includes(request.method)) return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET, HEAD' });
      const head = request.method === 'HEAD';
      if (url.pathname === '/robots.txt') {
        const rules = url.hostname === 'hammerlee.ai'
          ? `User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${CANONICAL_ORIGIN}/sitemap.xml\n`
          : 'User-agent: *\nDisallow: /\n';
        return response(rules, { head, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
      }
      if (url.pathname === '/sitemap.xml') {
        return response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${CANONICAL_ORIGIN}/</loc></url></urlset>`, {
          head, headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
        });
      }
      const og = url.pathname.match(/^\/og\/v([12])\/([0-9a-f]{32})\.png$/i);
      if (og || url.pathname === '/og/default.png') return ogImage(request, og, env, fetcher, assets?.['/og/default.png']);
      if (url.pathname === '/index.html') return response(null, { status: 301, headers: { Location: `/${url.search}` } });
      if (url.pathname === '/') {
        const details = shareDetails(url);
        if (!details) return error('invalid_share_link', 400);
        if (!indexHtml) return error('site_build_unavailable', 503);
        const rendered = pageHtml(indexHtml, url, details);
        return response(rendered.html, { head, headers: {
          'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=0, must-revalidate',
          'X-Robots-Tag': rendered.robots,
        } });
      }
      const asset = assets?.[url.pathname];
      if (asset && url.pathname !== '/og/default.png') return staticResponse(request, asset);
      return response('找不到這個頁面。', { status: 404, head, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Robots-Tag': 'noindex' } });
    },
  };
}
