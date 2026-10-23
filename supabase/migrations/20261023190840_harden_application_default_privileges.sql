-- Application migrations run as postgres. Future objects must receive explicit
-- grants; keep existing RPC/table grants and Supabase-managed schemas untouched.
-- PostgreSQL's built-in PUBLIC function EXECUTE grant is global, so a schema-only
-- revoke does not remove it. This global default affects new functions only.
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public, private
  revoke all on tables from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema public, private
  revoke all on sequences from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema public, private
  revoke all on functions from public, anon, authenticated, service_role;
