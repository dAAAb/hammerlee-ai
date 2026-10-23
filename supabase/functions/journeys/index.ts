/**
 * Server-to-server endpoint. Deploy journeys with verify_jwt=false: every request
 * is authenticated here with a dedicated proxy secret before database access.
 * Worker secret SUPABASE_JOURNEY_PROXY_SECRET is 32+ random characters. Store its
 * SHA-256 hex digest in private.journey_configuration, name proxy_secret_sha256.
 * Edge obtains that digest through a server-role-only RPC; no custom environment
 * secrets are needed. Digest cache lifetime is 60 seconds (also rotation delay).
 * No client-supplied scripts, images, accounts, names or emails are accepted.
 * Bundle from the repository so the shared versioned conversation imports remain
 * available. Never replace this shared generator with a client-provided script.
 */
import { createConversation } from '../../../src/conversation.js';
import { JourneyInputError, hashRateIdentity, matchesProxyDigest, normalizeClientIp, parseJourneyQuery, readJourneyBody } from './validation.js';
import { createJourneySnapshot, findJourneySnapshot } from './og-storage.ts';

type JourneyRow = {
  seed: string; version: number; script: unknown; created_at: string; snapshot_path: string | null;
};

const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { ...headers, ...extra } });
let cachedProxyDigest: { value: string; expires: number } | null = null;

function adminKey(): string | null {
  // Prefer current server keys; retain built-in legacy compatibility for projects
  // whose environment has not yet gained the new key map. Nothing reaches clients.
  try {
    const current = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}');
    if (typeof current.default === 'string' && current.default.startsWith('sb_secret_')) return current.default;
  } catch { /* Fall back only to the server's built-in service-role variable. */ }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || null;
}

async function database(base: string, key: string, path: string, body?: unknown): Promise<unknown> {
  const auth: Record<string, string> = { apikey: key, 'content-type': 'application/json' };
  if (!key.startsWith('sb_secret_')) auth.authorization = `Bearer ${key}`;
  const response = await fetch(`${base}/rest/v1/${path}`, {
    method: body === undefined ? 'GET' : 'POST', headers: auth,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error('Database request failed.');
  return response.json();
}

async function proxyDigest(base: string, key: string): Promise<string | null> {
  if (cachedProxyDigest && cachedProxyDigest.expires > Date.now()) return cachedProxyDigest.value;
  const digest = await database(base, key, 'rpc/journey_proxy_digest', {});
  if (typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest)) return null;
  cachedProxyDigest = { value: digest, expires: Date.now() + 60000 };
  return digest;
}

function publicJourney(row: JourneyRow, base: string, generatedSnapshot: string | null = null) {
  const expectedPath = `v${row.version}/${row.seed}.png`;
  return {
    seed: row.seed, version: row.version, script: row.script, created_at: row.created_at,
    snapshot_url: generatedSnapshot ?? (row.snapshot_path === expectedPath ? `${base}/storage/v1/object/public/journey-images/${expectedPath}` : null),
  };
}

export async function handleRequest(request: Request): Promise<Response> {
  try {
    const suppliedSecret = request.headers.get('x-journey-proxy-secret');
    if (!suppliedSecret || suppliedSecret.length < 32 || suppliedSecret.length > 512) return json({ error: 'unauthorized' }, 401);
    const base = (Deno.env.get('SUPABASE_URL') || '').replace(/\/$/, '');
    const key = adminKey();
    if (!/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(base) || !key) return json({ error: 'service_not_configured' }, 503);
    const digest = await proxyDigest(base, key);
    if (!digest) return json({ error: 'service_not_configured' }, 503);
    if (!await matchesProxyDigest(suppliedSecret, digest)) return json({ error: 'unauthorized' }, 401);
    if (!['GET', 'POST'].includes(request.method)) return json({ error: 'method_not_allowed' }, 405, { allow: 'GET, POST' });
    const input = request.method === 'GET' ? parseJourneyQuery(request.url) : await readJourneyBody(request);

    if (request.method === 'GET') {
      const rows = await database(base, key, `journeys?select=seed,version,script,created_at,snapshot_path&seed=eq.${input.seed}&version=eq.${input.version}&limit=1`) as JourneyRow[];
      if (!Array.isArray(rows) || rows.length === 0) return json({ error: 'not_found' }, 404);
      const snapshot = await findJourneySnapshot(base, input.seed, input.version);
      return json({ journey: publicJourney(rows[0], base, snapshot), created: false });
    }

    const ip = normalizeClientIp(request.headers.get('x-journey-client-ip'));
    if (!ip) return json({ error: 'client_ip_unavailable' }, 503);
    const utcDay = new Date().toISOString().slice(0, 10);
    // Domain-separated HMAC of the address and day, using a server-only key.
    // Neither the key nor raw address is sent to Postgres or returned to callers.
    const rateHash = await hashRateIdentity(ip, key, utcDay);
    const script = createConversation(input.seed, input.version);
    const result = await database(base, key, 'rpc/register_journey', {
      p_seed: input.seed, p_version: input.version, p_script: script,
      p_rate_hash: rateHash, p_rate_day: utcDay,
    }) as { error?: string; created?: boolean; journey?: JourneyRow };
    if (result.error === 'version_conflict') return json({ error: result.error }, 409);
    if (result.error === 'rate_limited') {
      const retry = Math.max(1, Math.ceil((Date.parse(`${utcDay}T00:00:00Z`) + 86400000 - Date.now()) / 1000));
      return json({ error: result.error }, 429, { 'retry-after': String(retry) });
    }
    if (!result.journey || result.journey.seed !== input.seed || result.journey.version !== input.version) throw new Error('Invalid database result.');
    const snapshot = result.created
      ? await createJourneySnapshot(base, key, script)
      : await findJourneySnapshot(base, input.seed, input.version);
    return json({ journey: publicJourney(result.journey, base, snapshot), created: Boolean(result.created) }, result.created ? 201 : 200);
  } catch (error) {
    if (error instanceof JourneyInputError) return json({ error: error.code }, error.status);
    // Do not log request headers, raw addresses, secrets, or internal DB errors.
    return json({ error: 'service_unavailable' }, 503);
  }
}

Deno.serve(handleRequest);
