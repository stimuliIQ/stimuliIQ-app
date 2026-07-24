// apps/api/test/integration/global-setup.ts
//
// Jest globalSetup for the auth/RBAC integration suite (docs/04 §6: "Integration | Jest +
// testcontainers | API + real Postgres/Redis"). Strategy, in order:
//
//   1. Try the AMBIENT env (DATABASE_URL/REDIS_URL already pointing at a reachable
//      Postgres/Redis — e.g. the repo's `docker-compose up`'d containers a developer, or
//      this very CI job, already has running). Preferred FIRST (Phase-7 Wave 2 security
//      hardening batch A follow-up): several `*.integration-spec.ts` files (e.g.
//      p6-engagement.integration-spec.ts) assume a `pnpm db:seed`-populated database
//      (tenant + system roles) — a FRESH ephemeral testcontainers DB has the schema
//      (migrate deploy runs below regardless of which path wins) but is NEVER seeded, so
//      those specs fail with "No tenant found" if testcontainers wins ahead of an
//      already-seeded ambient DB. Preferring ambient-when-reachable fixes that without
//      changing either path's own behavior.
//   2. If the ambient env is absent/unreachable, FALL BACK to testcontainers
//      (@testcontainers/postgresql + @testcontainers/redis) — spins up ephemeral,
//      disposable Postgres 16 + Redis 7 containers, matching docs/04 §6. This remains
//      what CI uses on a clean runner with no pre-seeded service containers (GH
//      ubuntu-latest ships Docker but starts with an empty DB either way).
//   3. If neither works, mark the run as "no DB available" — every `*.integration-spec.ts`
//      file checks `test/integration/db-available.json` (written here) and uses
//      `describe.skip` for the whole suite, so `pnpm test:integration` (and therefore
///     CI, if Docker were ever unavailable there) stays GREEN rather than failing on
//      missing infra, matching the same skip-gracefully pattern already established by
//      src/prisma/soft-delete-audit.integration.spec.ts.
//
// On success, this also runs `prisma migrate deploy` against the resolved Postgres so the
// schema exists before any spec file connects (a no-op if already up to date, as is
// typical for the ambient path), and writes the resolved DATABASE_URL/REDIS_URL into a
// temp file that globalTeardown + the spec files read (Jest does not let globalSetup
// mutate `process.env` for the actual test processes — they run in separate workers).

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface IntegrationEnvFile {
  available: boolean;
  databaseUrl?: string;
  redisUrl?: string;
  /** Set when containers were started here, so globalTeardown can stop them. */
  usedTestcontainers: boolean;
}

const STATE_DIR = join(tmpdir(), "stimuliiq-qa-integration");
export const STATE_FILE = join(STATE_DIR, "env.json");

declare global {
  // `declare global { var ... }` is the only syntax TypeScript accepts for augmenting
  // globalThis here (module-scope handoff from globalSetup to globalTeardown); this
  // project's eslint config does not enable `no-var`, so no suppression is needed.
  var __stimuliiqContainers: { postgres?: { stop(): Promise<void> }; redis?: { stop(): Promise<void> } } | undefined;
}

// Phase-7 Wave 4 (devops CI hardening): each `*.integration-spec.ts` file boots its own
// full Nest `AppModule` (PrismaService = 2 pooled PrismaClients: `client` + `baseClient`,
// prisma.service.ts) PLUS its own raw fixtures `PrismaClient` — 3 independently-pooled
// clients per file. Prisma's default pool size (`num_physical_cpus * 2 + 1`) multiplied
// across 3 clients per file, run across 14 files, was observed to exhaust the
// testcontainers Postgres's connection slots ("too many clients already") on
// higher-core CI runners, especially if any client from a prior file's teardown hasn't
// fully released its backend connections before the next file's `beforeAll` opens new
// ones. `--runInBand` (apps/api/package.json `test:integration` script) already
// serializes file execution; capping each client's own pool size here is the second,
// belt-and-braces guard (also being explicit is cheaper than relying on GC/timing
// between files) — every spec file reads `DATABASE_URL` from this generated URL
// (via the STATE_FILE JSON, see each spec's `envFile.databaseUrl` usage), so appending
// the query param once, here, bounds every PrismaClient instance in the entire run
// without editing any of the 14 spec files individually.
const CONNECTION_LIMIT_PARAMS = "connection_limit=5&pool_timeout=20";

function withConnectionLimit(connectionUri: string): string {
  const separator = connectionUri.includes("?") ? "&" : "?";
  return `${connectionUri}${separator}${CONNECTION_LIMIT_PARAMS}`;
}

async function tryTestcontainers(): Promise<IntegrationEnvFile | undefined> {
  try {
    const { PostgreSqlContainer } = await import("@testcontainers/postgresql");
    const { RedisContainer } = await import("@testcontainers/redis");

    const postgres = await new PostgreSqlContainer("postgres:16-alpine")
      .withDatabase("stimuliiq_test")
      .withUsername("postgres")
      .withPassword("postgres")
      .start();

    const redis = await new RedisContainer("redis:7-alpine").start();

    globalThis.__stimuliiqContainers = { postgres, redis };

    return {
      available: true,
      usedTestcontainers: true,
      databaseUrl: withConnectionLimit(postgres.getConnectionUri()),
      redisUrl: `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`,
    };
  } catch (error) {
    console.warn(
      "[integration:global-setup] testcontainers unavailable (Docker daemon unreachable?) — " +
        "falling back to ambient DATABASE_URL/REDIS_URL. Error:",
      error instanceof Error ? error.message : error,
    );
    return undefined;
  }
}

async function tryAmbientEnv(): Promise<IntegrationEnvFile | undefined> {
  const rawDatabaseUrl = process.env.DATABASE_URL;
  const redisUrl = process.env.REDIS_URL;
  if (!rawDatabaseUrl || !redisUrl) return undefined;

  // Phase-9 Completion (T31 follow-up): the ambient path previously used the RAW
  // DATABASE_URL with NO connection_limit, unlike the testcontainers path above — every
  // spec file's 3 independently-pooled PrismaClients (see this file's header comment)
  // then defaulted to Prisma's `num_physical_cpus * 2 + 1` pool size EACH, which
  // exhausts a modest `max_connections` shared dev Postgres well before 15+
  // `*.integration-spec.ts` files finish running sequentially ("too many clients
  // already" — observed running the full suite, not specific to any one file). Applying
  // the SAME `withConnectionLimit()` bound here that the testcontainers path already
  // uses fixes this for the ambient path too, with no behavior change for any
  // individual spec (they only ever read `envFile.databaseUrl` from the STATE_FILE,
  // never `process.env.DATABASE_URL` directly).
  const databaseUrl = withConnectionLimit(rawDatabaseUrl);

  // Cheap reachability probe so we never report "available" for an env that points at
  // nothing reachable (e.g. a CI box with stale leftover env vars but no actual DB).
  // Uses `@prisma/client` (already a dependency, CLAUDE.md §1) rather than pulling in a
  // raw `pg` driver as a new dep.
  try {
    const { PrismaClient } = await import("@prisma/client");
    const client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await client.$connect();
    await client.$queryRaw`SELECT 1`;
    await client.$disconnect();
  } catch {
    return undefined;
  }

  return { available: true, usedTestcontainers: false, databaseUrl, redisUrl };
}

export default async function globalSetup(): Promise<void> {
  mkdirSync(STATE_DIR, { recursive: true });

  const resolved = (await tryAmbientEnv()) ?? (await tryTestcontainers());

  if (!resolved) {
    writeFileSync(STATE_FILE, JSON.stringify({ available: false, usedTestcontainers: false } satisfies IntegrationEnvFile));
    console.warn(
      "[integration:global-setup] No reachable Postgres/Redis (testcontainers AND ambient env both " +
        "failed) — the integration suite will SKIP all tests so `pnpm test:integration` stays green.",
    );
    return;
  }

  writeFileSync(STATE_FILE, JSON.stringify(resolved));

  // Apply the Phase-0 core schema to whichever Postgres we resolved, using the same
  // forward-only migrations the rest of the repo ships (CLAUDE.md §3.8) — never
  // `db push`, which would silently diverge from the committed migration history.
  const schemaPath = join(__dirname, "..", "..", "..", "..", "prisma", "schema.prisma");
  const prismaCli = require.resolve("prisma/build/index.js");
  execFileSync(process.execPath, [prismaCli, "migrate", "deploy", "--schema", schemaPath], {
    env: { ...process.env, DATABASE_URL: resolved.databaseUrl },
    stdio: "inherit",
  });

  await flushRateLimitBuckets(resolved.redisUrl!);
}

// qa-engineer Wave 5 fix (docs/plans/phase-9-completion.md T41, item 3 — integration-
// suite flakiness): several fixed-window rate limiters share ONE bucket per source IP
// with NO per-test-run namespacing (`auth:ip-rl:*` — see setup-env.ts, which raises its
// ceiling instead, since it IS env-configurable — plus `public:bookings:rl:*`
// (public-booking-rate-limiter.ts) and any other `*:rl:*`-prefixed key, which are NOT
// env-configurable, just small hardcoded constants). Every `*.integration-spec.ts` file
// shares the SAME Redis instance and, on a dev box/CI runner, the SAME loopback source
// IP — so hits accumulate ACROSS the whole `pnpm test:integration` run and, worse,
// ACROSS repeated back-to-back invocations within the same window (observed: a second
// consecutive full-suite run failing leads-intake-convert.integration-spec.ts's public
// booking-intake test with 429, purely from the FIRST run's leftover bucket state).
// Flushing every `*:rl:*` key ONCE here, before any spec file's app boots (this runs in
// Jest's dedicated globalSetup process, ahead of every worker), gives each invocation of
// the suite a clean rate-limit slate without touching any OTHER Redis-backed state
// (feature-flag eval cache, EMI idempotency keys, etc. use different key prefixes and
// are left alone) and without changing any limiter's actual production behavior.
async function flushRateLimitBuckets(redisUrl: string): Promise<void> {
  try {
    const IORedis = (await import("ioredis")).default;
    const client = new IORedis(redisUrl, { maxRetriesPerRequest: 1, lazyConnect: true });
    await client.connect();
    let cursor = "0";
    let deleted = 0;
    do {
      const [nextCursor, keys] = await client.scan(cursor, "MATCH", "*:rl:*", "COUNT", "500");
      cursor = nextCursor;
      if (keys.length > 0) {
        await client.del(...keys);
        deleted += keys.length;
      }
    } while (cursor !== "0");
    await client.quit();
    if (deleted > 0) {
      console.log(`[integration:global-setup] flushed ${deleted} stale rate-limit bucket key(s) from a prior run.`);
    }
  } catch (error) {
    console.warn(
      "[integration:global-setup] rate-limit bucket flush failed (non-fatal — worst case, some specs may see a " +
        "stale 429 from a prior run's leftover bucket state). Error:",
      error instanceof Error ? error.message : error,
    );
  }
}
