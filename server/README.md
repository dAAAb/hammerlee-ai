# Worker and journey API contract

`npm run build` first builds the Vite application into `dist/client/`, then embeds
those assets and `server/assets/og-fallback.png` into one ESM module at
`dist/server/index.js`. The module exports `default.fetch(request, env, ctx)`.
No runtime filesystem, asset binding, Node compatibility flag, or WASM import is
required. The Sites Worker-ESM package includes `dist/server/index.js` and its
hosting metadata; assets are served from embedded bytes.

The build copies an existing `.openai/hosting.json` to the generated output but
never changes the source manifest. A Worker manifest must omit `static`. Local
builds succeed before Site registration. `npm run dev` and `npm run preview`
retain the Vite client workflow; the Worker API is covered by request-level
tests and requires runtime secrets when hosted.

## Runtime values

Configure through the hosting provider's secret controls, never a `VITE_`
variable, source file, or hosting manifest:

| Worker environment name | Value |
| --- | --- |
| `SUPABASE_JOURNEY_FUNCTION_URL` | `https://<project-ref>.supabase.co/functions/v1/journeys` |
| `SUPABASE_PUBLISHABLE_KEY` | The project's current publishable API key |
| `SUPABASE_JOURNEY_PROXY_SECRET` | At least 32 characters; the raw secret whose SHA-256 digest the Edge function checks |

The Supabase function uses `verify_jwt=false` and authenticates every call with
the custom proxy secret against a digest in its private database configuration.
Only the Worker stores the raw secret. The publishable key is sent as `apikey`,
never as a Bearer JWT. The Worker never needs a Supabase service-role key.

## Browser-facing routes

- `POST /api/journeys`: JSON with exactly `{ "seed": "<32 hex characters>", "version": 1 | 2 }`.
  Requires same-origin `Origin`, JSON content type, body no larger than 1024
  bytes, and a valid Cloudflare-managed `CF-Connecting-IP`. The Worker rejects
  missing trusted addresses with 503; it does not accept an address supplied in
  `x-journey-client-ip` by the caller.
- `GET /api/journeys/<seed>?version=2`: public lookup. `v=2` is also accepted for
  existing client links. Duplicate or conflicting versions are rejected.
- `GET /?s=<seed>&v=2`: deterministic replay metadata. A seeded legacy URL with
  no version selects v1. HTML canonical always points to `https://hammerlee.ai/`;
  seeded pages are `noindex, follow` to avoid indexing every combination.
- `GET /og/v2/<seed>.png`: attempts the fixed storage path below, then returns
  the bundled 1200×630 branded PNG if no stored image is available.

## Worker-to-Edge requests

- POST goes to the configured function URL with only `{ seed, version }`.
- GET goes to that URL with `?seed=<seed>&version=2`.
- Both include `apikey` and `x-journey-proxy-secret` from Worker runtime values.
- POST includes `x-journey-client-ip` copied only from `CF-Connecting-IP`.
- Cookies, client Authorization, arbitrary headers, and arbitrary destination
  URLs are never forwarded. Redirects are not followed.
- Responses are JSON, capped at 64 KiB, and returned without caching.

Success response expected from Edge:

```json
{
  "journey": {
    "seed": "00112233445566778899aabbccddeeff",
    "version": 2,
    "script": { "messages": [] },
    "created_at": "2026-10-23T00:00:00Z",
    "snapshot_url": null
  },
  "created": true
}
```

New records return 201; existing records 200; unknown records 404; conflicting
versions 409; throttled requests 429. Edge regenerates the script from the
shared conversation module rather than accepting visitor-authored text. Edge
owns rate limiting and stores a daily HMAC of the client address, not the raw
address. Worker responses distinguish unavailable storage from successfully
stored records; the client must not claim registration after a failed request.

## OG images and SEO

Storage bucket: `journey-images`, public read. Object key:
`v{version}/{seed}.png`. The Worker derives the Supabase origin from its fixed
function URL; it does not accept a visitor-provided image URL. Stored images
must be PNG and at most 2 MiB. Missing, invalid, oversized, or inaccessible
objects use the fallback with `X-OG-Image-Source: fallback`; valid objects use
`X-OG-Image-Source: stored`.

The Supabase Edge function generates a PNG from the selected script when a journey is first saved. It uses trusted glyph outlines and a pinned, integrity-checked SVG renderer. Failures leave the conversation intact and the Worker serves the shared fallback; no visitor-authored image uploads are accepted.

Only `www.hammerlee.ai` redirects with 301 to
`https://hammerlee.ai`, preserving path and query. Only the canonical homepage
is listed in the sitemap. Preview hosts are noindex and disallow crawlers.
`hammerlee.tw` is reserved for another site and is not bound here.
DNS, TLS, public audience settings, and runtime secrets must be configured by
the owner workflow before deployment; this build does not make those changes.

The build follows the installed Sites Worker ESM starter's self-contained module
contract. Implementation references:
[Cloudflare fetch handler](https://developers.cloudflare.com/workers/runtime-apis/handlers/fetch/),
[Cloudflare Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/),
[Supabase function authentication](https://supabase.com/docs/guides/functions/auth).
