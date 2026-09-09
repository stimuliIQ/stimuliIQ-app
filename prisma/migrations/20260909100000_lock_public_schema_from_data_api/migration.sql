-- Close Supabase's auto-generated Data API over the whole `public` schema.
--
-- WHAT WAS WRONG. Supabase pairs every project with PostgREST, which serves the `public`
-- schema over HTTPS to two browser-facing database roles: `anon` (anybody holding the
-- project's publishable anon key) and `authenticated` (a signed-in Supabase Auth user).
-- A fresh project ships default privileges that grant BOTH roles the full set — SELECT,
-- INSERT, UPDATE, DELETE, TRUNCATE — on every table created in `public`, and this schema is
-- created by Prisma migrations running as `postgres`, so all 91 tables and 8 materialized
-- views inherited them. Row-Level Security was off on all 91. Supabase's linter flagged it
-- as `rls_disabled_in_public`, correctly: users (password hashes included), student
-- profiles, payments, leads, audit logs and certificates were readable AND writable by
-- anyone who had, guessed or was given that key.
--
-- WHY IT WAS NEVER NOTICED. Nothing in this codebase has ever used the Data API. There is no
-- `@supabase/supabase-js`, no `createClient`, no anon key in any app — the API talks to
-- Postgres directly through Prisma as the `postgres` role. The exposure was therefore
-- entirely a side door: a whole second, unauthenticated interface onto the same tables,
-- bypassing every NestJS guard, every `@RequirePermission`, every tenant scope and every
-- audit-log write in the application.
--
-- THE FIX IS THE GRANTS, NOT THE RLS. Enabling RLS satisfies the linter, but a table with
-- RLS on and privileges still granted is one forgotten `USING (true)` policy away from being
-- open again. Taking the privileges away is what actually closes the door, and it is the
-- ONLY thing that can close it for the materialized views — Postgres has no RLS for those,
-- which is why `mv_revenue_daily` and its seven siblings could not have been protected any
-- other way. RLS is then applied on top as defence in depth: if a privilege is ever re-granted
-- by hand or by a future Supabase default, a table with RLS enabled and no policies still
-- denies every role that does not bypass it.
--
-- WHY THIS IS SAFE FOR THE APP. The API connects as `postgres`, which OWNS all 91 tables and
-- carries `rolbypassrls`, so RLS is invisible to it — no policy is needed and none is added.
-- `service_role` is deliberately left alone: it is the secret server-side key, it bypasses
-- RLS anyway, and revoking it would break Supabase's own tooling without adding security.
--
-- ALSO CLOSE THE DATA API IN THE DASHBOARD. This migration removes the privileges the API
-- needs, which is sufficient. Setting Settings ▸ API ▸ Exposed schemas to none as well would
-- stop PostgREST reaching the database at all, and costs nothing here because nothing uses it.

-- ── 1. Revoke what `anon` and `authenticated` already hold ────────────────────────────────
--
-- Guarded on the roles existing at all, so this is a clean no-op on a plain Postgres
-- development database or in CI, where there is no Supabase and no Data API to close.
DO $$
DECLARE
  rel record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    RAISE NOTICE 'no `anon` role — not a Supabase database, nothing to lock down';
    RETURN;
  END IF;

  -- Stop NEW objects inheriting the grants. This is the half that keeps the hole shut: the
  -- default privileges are attached to the role that CREATES the object, and every future
  -- Prisma migration creates its tables as `postgres`. Without this line the very next
  -- migration would hand `anon` full rights on whatever table it added, silently.
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated';
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated';
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated';

  -- Take away what they hold today.
  EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated';
  EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated';
  EXECUTE 'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated';

  -- `ALL TABLES` covers tables, views and foreign tables — but NOT materialized views, which
  -- have to be named one at a time. Missing them would leave the analytics aggregates
  -- (revenue by day, lead funnel, enrolments) readable by exactly the role this migration is
  -- shutting out, and they are the one kind of relation RLS could not have covered either.
  FOR rel IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'm'
  LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', rel.relname);
  END LOOP;

  -- Belt and braces rather than the control: schema USAGE is also granted to the PUBLIC
  -- pseudo-role, which `anon` inherits and which this cannot revoke without affecting every
  -- role in the database. The table grants above are what actually matter — USAGE on a schema
  -- whose objects you hold no privilege on gets you nothing.
  EXECUTE 'REVOKE USAGE ON SCHEMA public FROM anon, authenticated';
END $$;

-- ── 2. Row-Level Security on every table ─────────────────────────────────────────────────
--
-- No policies are created, which is the point: RLS with no policy denies every role that
-- does not own the table or hold `rolbypassrls`. The application's `postgres` role is both,
-- so this changes nothing it can see or do — verified before applying, because getting that
-- wrong would return zero rows everywhere rather than fail loudly.
DO $$
DECLARE
  rel record;
BEGIN
  FOR rel IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', rel.relname);
  END LOOP;
END $$;
