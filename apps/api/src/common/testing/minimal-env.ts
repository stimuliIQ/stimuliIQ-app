// apps/api/src/common/testing/minimal-env.ts
//
// qa-engineer Wave 5 (docs/plans/phase-9-completion.md T41, item 1 — "cold-validateEnv
// test-hygiene debt"). Several unit specs call the REAL `validateEnv()` (config/env.ts)
// through the module under test but only ever set the ONE env var they care about
// (e.g. `SCHEDULER_ENABLED`) before calling `__resetEnvCacheForTests()` — they then only
// passed because some EARLIER spec file, in the SAME Jest worker, happened to already
// have exported `DATABASE_URL`/`REDIS_URL`/JWT key paths/`COOKIE_SECRET`/`CSRF_SECRET`
// into the ambient shell env first. Run in isolation (or first in a worker, or with a
// cold/empty env — no exported vars at all) they threw "Invalid environment
// configuration" because those five fields have NO default in the zod schema.
//
// This is the single source of a minimal, schema-satisfying env for any unit spec that
// (a) needs `validateEnv()` to SUCCEED, but (b) doesn't care about DB/Redis/JWT actually
// working (never opens a real connection, never signs a real token) — i.e. every spec
// this file is imported by is a pure unit test with mocked collaborators.
//
// Lives under src/ (not test/) so it stays inside the api tsconfig `rootDir` — unit specs
// are compiled as part of `src/**/*.ts`, and importing a test-only helper from outside
// rootDir breaks `tsc --noEmit` (TS6059).
//
// Deliberately uses fake-but-well-formed values, not real credentials — never reads a
// real `.env`. Matches the values already inlined ad hoc in certificates.service.spec.ts
// / content-intake.service.spec.ts (kept in sync with those by hand; this file exists so
// NEW specs don't have to re-invent the list).

export const MINIMAL_ENV: Readonly<Record<string, string>> = Object.freeze({
  DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/stimuliiq",
  REDIS_URL: "redis://localhost:6379",
  JWT_PRIVATE_KEY_PATH: "./keys/jwt-private.pem",
  JWT_PUBLIC_KEY_PATH: "./keys/jwt-public.pem",
  COOKIE_SECRET: "a".repeat(32),
  CSRF_SECRET: "b".repeat(32),
});

/**
 * Sets every schema-required-with-no-default env var (unless already present in
 * `process.env`, so a spec's own more-specific override always wins) and nothing else —
 * callers add whichever OTHER var they're actually asserting behavior on (e.g.
 * `SCHEDULER_ENABLED`, `VIDEO_PROVIDER`) on top of this. Does NOT call
 * `__resetEnvCacheForTests()` itself — call that explicitly (order matters: reset THEN
 * set THEN reset-or-call-the-code-under-test, per the existing certificates.service.spec.ts
 * pattern) so this helper stays a pure "fill in the gaps" utility.
 */
export function setMinimalEnv(overrides: Record<string, string> = {}): void {
  for (const [key, value] of Object.entries(MINIMAL_ENV)) {
    process.env[key] ??= value;
  }
  Object.assign(process.env, overrides);
}
