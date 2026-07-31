// apps/api/src/prisma/local-db-guard.ts
//
// Gate for the `*.integration.spec.ts` suites in this directory, which write real rows
// (and hard-`deleteMany` them again in `afterAll`) against whatever `DATABASE_URL` names.
//
// WHY THIS EXISTS. These four specs are named `*.integration.spec.ts` (dot), which the
// UNIT config's `testRegex: ".*\\.spec\\.ts$"` matches — while
// `jest.integration.config.js` only matches `*.integration-spec.ts` (hyphen). So they run
// as part of a plain `pnpm test`, NOT under `test:integration:safe` and its local-only
// guard. On top of that, importing `@prisma/client` auto-loads the repo-root `.env` as a
// side effect, so `process.env.DATABASE_URL` is populated even when the developer never
// exported it. The old gate — `!!process.env.DATABASE_URL` — therefore evaluated TRUE
// against whatever `.env` points at, which on this repo is the PRODUCTION Supabase
// instance. A bare `pnpm test` would create a `stimuliiq-*-integration-test` tenant in
// production and then issue `deleteMany`s against it.
//
// The blast radius was always scoped to the suites' own throwaway tenant, so production
// rows were never the delete target — but "the fixtures happen to be tenant-scoped" is a
// property of the spec bodies, not a guarantee of the harness, and it is not something a
// future edit should be free to break silently. Fail closed instead: unless the target
// database is obviously local AND obviously disposable, skip.
//
// Mirrors the predicate in `apps/api/scripts/test-integration-safe.cjs` deliberately —
// same two conditions (local host, `_test`-suffixed database name), so the two entry
// points into DB-writing tests agree on what "safe to write to" means.

/** Host must be loopback: never a remote/managed Postgres (Supabase, RDS, Neon, …). */
const LOCAL_HOST = /^postgresql:\/\/[^@]*@(localhost|127\.0\.0\.1)[:/]/;

/**
 * Database name must end in `_test`, so the target is a throwaway rather than the
 * developer's working `stimuliiq` dev database. Tolerates a trailing query string
 * (`?schema=public`, `?connection_limit=1`).
 */
const DISPOSABLE_NAME = /_test(\?|$)/;

/** True only for a loopback, `_test`-suffixed Postgres URL. */
export function isDisposableLocalDatabase(url: string | undefined): boolean {
  if (!url) return false;
  return LOCAL_HOST.test(url) && DISPOSABLE_NAME.test(url);
}

/**
 * `describe` when `DATABASE_URL` names a disposable local database, `describe.skip`
 * otherwise. Skipping (not failing) keeps `pnpm test` green on a machine with no local
 * test DB — the same contract the previous `hasDatabase` gate offered.
 *
 * Point it at one with:
 *   TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:55433/stimuliiq_test
 * (see `apps/api/scripts/test-integration-safe.cjs` for the one-time DB setup).
 */
export const describeIfLocalDb = isDisposableLocalDatabase(process.env.DATABASE_URL)
  ? describe
  : describe.skip;
