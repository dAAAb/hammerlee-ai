-- Prepared locally: no Supabase CLI was available to generate a migration.
-- Apply only after reviewing against the destination project. This schema has
-- no user identities. Infrastructure access logs have their own retention policy.
begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

create table if not exists private.journey_configuration (
  name text primary key check (name = 'proxy_secret_sha256'),
  value text not null check (value ~ '^[a-f0-9]{64}$')
);
alter table private.journey_configuration enable row level security;
revoke all on private.journey_configuration from public, anon, authenticated, service_role;
grant select on private.journey_configuration to service_role;
comment on table private.journey_configuration is 'SHA-256 digest of the high-entropy Worker proxy secret; never store the raw secret here.';

create or replace function public.journey_proxy_digest()
returns text language sql stable security invoker set search_path = '' as $$
  select value from private.journey_configuration where name = 'proxy_secret_sha256';
$$;
revoke all on function public.journey_proxy_digest() from public, anon, authenticated;
grant execute on function public.journey_proxy_digest() to service_role;

create table if not exists public.journeys (
  seed text primary key check (seed ~ '^[a-f0-9]{32}$'),
  version smallint not null check (version in (1, 2)),
  script jsonb not null check (coalesce(
    jsonb_typeof(script) = 'object'
    and script ->> 'seed' = seed
    and script -> 'version' = to_jsonb(version)
    and jsonb_typeof(script -> 'messages') = 'array'
    and jsonb_array_length(script -> 'messages') = 48
    and octet_length(script::text) <= 65536,
    false
  )),
  snapshot_path text check (snapshot_path is null or snapshot_path = 'v' || version::text || '/' || seed || '.png'),
  created_at timestamptz not null default now()
);
alter table public.journeys enable row level security;
revoke all on public.journeys from public, anon, authenticated, service_role;
grant select, insert on public.journeys to service_role;
comment on table public.journeys is 'Immutable public demonstration scripts. A seed binds to one script version. No visitor identity or responses are recorded.';

create table if not exists private.journey_rate_limits (
  rate_day date not null,
  bucket text not null check (bucket = 'global' or bucket ~ '^[a-f0-9]{64}$'),
  hits integer not null default 0 check (hits >= 0),
  primary key (rate_day, bucket)
);
alter table private.journey_rate_limits enable row level security;
revoke all on private.journey_rate_limits from public, anon, authenticated, service_role;
grant select, insert, update, delete on private.journey_rate_limits to service_role;
comment on table private.journey_rate_limits is 'Day-scoped HMAC rate keys only, never raw IP addresses; expired buckets are removed during registration.';

create or replace function private.reject_journey_update()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  raise exception 'Journeys are immutable.' using errcode = '55000';
end;
$$;
revoke all on function private.reject_journey_update() from public, anon, authenticated;
drop trigger if exists journeys_immutable on public.journeys;
create trigger journeys_immutable before update on public.journeys
for each row execute function private.reject_journey_update();

-- Invoker rights only. Explicit EXECUTE grant and table grants restrict this RPC
-- to the Edge Function's server role; anon/authenticated have no direct API path.
create or replace function public.register_journey(
  p_seed text, p_version integer, p_script jsonb, p_rate_hash text, p_rate_day date
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  existing public.journeys%rowtype;
  global_hits integer;
  client_hits integer;
  today date := (now() at time zone 'UTC')::date;
begin
  if p_seed is null or p_seed !~ '^[a-f0-9]{32}$'
    or p_version is null or p_version not in (1, 2)
    or p_rate_hash is null or p_rate_hash !~ '^[a-f0-9]{64}$'
    or p_rate_day is distinct from today then
    raise exception 'Invalid registration input.' using errcode = '22023';
  end if;
  -- Concurrent registrations of one seed must see the same immutable result.
  perform pg_advisory_xact_lock(hashtextextended(p_seed, 0));
  select * into existing from public.journeys where seed = p_seed;
  if found then
    if existing.version <> p_version then return jsonb_build_object('error', 'version_conflict'); end if;
    return jsonb_build_object('journey', to_jsonb(existing), 'created', false);
  end if;

  -- All new registrations take the same daily row lock. This makes both quotas
  -- and the insert atomic and bounds the number of client buckets per day.
  insert into private.journey_rate_limits(rate_day, bucket, hits)
    values (today, 'global', 0) on conflict do nothing;
  select hits into global_hits from private.journey_rate_limits
    where rate_day = today and bucket = 'global' for update;
  if global_hits >= 1000 then return jsonb_build_object('error', 'rate_limited'); end if;

  insert into private.journey_rate_limits as limits(rate_day, bucket, hits)
    values (today, p_rate_hash, 1)
    on conflict (rate_day, bucket) do update set hits = limits.hits + 1
      where limits.hits < 30
    returning hits into client_hits;
  if client_hits is null then return jsonb_build_object('error', 'rate_limited'); end if;

  insert into public.journeys(seed, version, script)
    values (p_seed, p_version, p_script) returning * into existing;
  update private.journey_rate_limits set hits = hits + 1
    where rate_day = today and bucket = 'global';
  delete from private.journey_rate_limits where rate_day < today - 1;
  return jsonb_build_object('journey', to_jsonb(existing), 'created', true);
end;
$$;
revoke all on function public.register_journey(text, integer, jsonb, text, date) from public, anon, authenticated;
grant execute on function public.register_journey(text, integer, jsonb, text, date) to service_role;

-- PNG-only public-download bucket. No client INSERT/UPDATE/DELETE policies are
-- created. The Edge Function generates images at deterministic version/seed paths
-- without updating the immutable dialogue row or accepting client image uploads.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('journey-images', 'journey-images', true, 1048576, array['image/png'])
on conflict (id) do nothing;

commit;
