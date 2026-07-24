// apps/api/test/integration/setup-env.ts
//
// Jest `setupFiles` entry for the integration suite (qa-engineer Wave 5,
// docs/plans/phase-9-completion.md T41, item 3a). Runs ONCE per test FILE, before that
// file's own module-level code (and therefore before any Nest app in that file boots) —
// see jest.integration.config.js's `setupFiles` wiring.
//
// WHY THIS EXISTS: AuthIpRateLimitGuard (apps/api/src/modules/auth/guards/
// auth-ip-rate-limit.guard.ts) buckets by `auth:ip-rl:<handler>:<ip>` in REDIS, with NO
// per-test-run/per-file namespacing. Every `*.integration-spec.ts` file that logs in
// (auth-rbac, leads-*, crm-*, commerce-*, p4/p5/p6, phase-8/9-*) shares the SAME Redis
// instance (`REDIS_URL`, see global-setup.ts) and, in CI/most dev boxes, the SAME source
// IP (loopback) — so login/refresh/otp attempts accumulate against ONE shared bucket
// across the whole `pnpm test:integration` run. The production default
// (`AUTH_IP_RATE_LIMIT_MAX_ATTEMPTS=20` per 60s, env.ts) is sized for real credential-
// stuffing defense, not for a serialized suite of 20+ spec files each performing several
// logins — so late-running files started tripping 429 on `/auth/login`/`/auth/refresh`
// calls that have nothing to do with the guard's actual security property.
//
// FIX: raise the ceiling for the integration run ONLY (never touches the guard's
// production defaults in env.ts, and never disables the guard — auth-rbac.integration-
// spec.ts and auth-ip-rate-limit.guard.spec.ts still exercise the REAL 429 behavior by
// setting a low ceiling via `AUTH_IP_RATE_LIMIT_MAX_ATTEMPTS`/`__resetEnvCacheForTests()`
// themselves, which — since those assignments happen in the spec file's OWN module-level
// code, which runs AFTER this `setupFiles` entry — still win for those specific files).
process.env.AUTH_IP_RATE_LIMIT_MAX_ATTEMPTS ??= "100000";
process.env.AUTH_IP_RATE_LIMIT_WINDOW_SECONDS ??= "60";
