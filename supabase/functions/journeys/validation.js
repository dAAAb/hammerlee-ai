/** Pure validation shared by the Edge Function and its Node tests. */
export class JourneyInputError extends Error {
  constructor(code, status = 400) { super(code); this.name = 'JourneyInputError'; this.code = code; this.status = status; }
}

export function validateJourneyInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new JourneyInputError('invalid_request');
  const keys = Object.keys(value).sort();
  if (keys.length !== 2 || keys[0] !== 'seed' || keys[1] !== 'version') throw new JourneyInputError('unexpected_fields');
  if (typeof value.seed !== 'string' || !/^[a-fA-F0-9]{32}$/.test(value.seed)) throw new JourneyInputError('invalid_seed');
  if (!Number.isInteger(value.version) || ![1, 2].includes(value.version)) throw new JourneyInputError('unsupported_version');
  return { seed: value.seed.toLowerCase(), version: value.version };
}

export function parseJourneyQuery(url) {
  const params = new URL(url).searchParams;
  if ([...params].length !== 2 || params.getAll('seed').length !== 1 || params.getAll('version').length !== 1) throw new JourneyInputError('invalid_query');
  if (!/^[12]$/.test(params.get('version') ?? '')) throw new JourneyInputError('unsupported_version');
  return validateJourneyInput({ seed: params.get('seed'), version: Number(params.get('version')) });
}

/** Bound actual streamed bytes, not just the client-provided Content-Length. */
export async function readJourneyBody(request, maximumBytes = 256) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) throw new JourneyInputError('json_required', 415);
  const declaredLength = request.headers.get('content-length');
  if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > maximumBytes)) throw new JourneyInputError('body_too_large', 413);
  if (!request.body) throw new JourneyInputError('invalid_json');
  const reader = request.body.getReader();
  const chunks = []; let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) { await reader.cancel(); throw new JourneyInputError('body_too_large', 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let data;
  try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new JourneyInputError('invalid_json'); }
  return validateJourneyInput(data);
}

/** Accept one canonical address from the authenticated Worker, never a proxy list. */
export function normalizeClientIp(input) {
  if (typeof input !== 'string' || input.length > 45 || !/^[a-fA-F0-9:.]+$/.test(input)) return null;
  if (!input.includes(':')) {
    const parts = input.split('.');
    if (parts.length !== 4 || parts.some(part => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return null;
    return parts.map(Number).join('.');
  }
  try {
    const hostname = new URL(`http://[${input}]/`).hostname;
    return hostname.startsWith('[') ? hostname.slice(1, -1).toLowerCase() : null;
  } catch { return null; }
}

/** Day-scoped HMAC; no raw IP or stable cross-day identifier is persisted. */
export async function hashRateIdentity(input, secret, utcDay) {
  const ip = normalizeClientIp(input);
  if (!ip) throw new JourneyInputError('client_ip_unavailable', 503);
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('Rate secret is not configured.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(utcDay) || new Date(`${utcDay}T00:00:00Z`).toISOString().slice(0, 10) !== utcDay) throw new TypeError('Invalid UTC day.');
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(`journey-rate-v1\n${utcDay}\n${ip}`));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Compare fixed-length digests without returning early at a mismatched byte. */
export async function matchesProxySecret(provided, expected) {
  if (typeof expected !== 'string' || expected.length < 32 || expected.length > 512
    || typeof provided !== 'string' || provided.length > 512) return false;
  const encoder = new TextEncoder();
  const hashes = await Promise.all([provided, expected].map(value => crypto.subtle.digest('SHA-256', encoder.encode(value))));
  const a = new Uint8Array(hashes[0]), b = new Uint8Array(hashes[1]);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}

/** Verify a proxy secret against its server-stored SHA-256 digest. */
export async function matchesProxyDigest(provided, expectedHex) {
  if (typeof provided !== 'string' || provided.length < 32 || provided.length > 512
    || typeof expectedHex !== 'string' || !/^[a-f0-9]{64}$/.test(expectedHex)) return false;
  const actual = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(provided)));
  const expected = Uint8Array.from(expectedHex.match(/../g), byte => Number.parseInt(byte, 16));
  let difference = 0;
  for (let i = 0; i < actual.length; i++) difference |= actual[i] ^ expected[i];
  return difference === 0;
}
