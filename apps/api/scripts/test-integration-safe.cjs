#!/usr/bin/env node
// apps/api/scripts/test-integration-safe.cjs
//
// Runs the integration suite against a DEDICATED throwaway database (`stimuliiq_test`),
// never the developer's `stimuliiq` dev database.
//
// WHY THIS EXISTS. test/integration/global-setup.ts resolves its database by trying the
// AMBIENT env FIRST (`tryAmbientEnv()`), and only falling back to ephemeral testcontainers
// if that fails. That ordering is deliberate — several specs assume a `pnpm db:seed`-
// populated DB, and a fresh container is never seeded — but it means that whenever
// DATABASE_URL happens to be exported, `pnpm test:integration` writes fixtures into
// whatever database it points at. The suite fires thousands of requests and creates users,
// so "whatever database it points at" must never be one whose contents you care about.
//
// This wrapper removes the ambiguity: it pins DATABASE_URL/REDIS_URL to the throwaway DB
// explicitly, so the ambient path resolves somewhere safe BY CONSTRUCTION rather than by
// the accident of an unset variable.
//
// One-time setup for a fresh machine:
//   docker exec stimuliiq-postgres-1 psql -U postgres -c "CREATE DATABASE stimuliiq_test;"
//   DATABASE_URL=postgresql://postgres:postgres@localhost:55433/stimuliiq_test npx prisma migrate deploy --schema prisma/schema.prisma
//   DATABASE_URL=postgresql://postgres:postgres@localhost:55433/stimuliiq_test pnpm db:seed
//
// Usage:  pnpm --filter @stimuliiq/api test:integration:safe [-- <jest args>]

const { spawn } = require("node:child_process");

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:55433/stimuliiq_test";
const TEST_REDIS_URL = process.env.TEST_REDIS_URL ?? "redis://localhost:6380";

// Refuse to run against anything that isn't an obviously-local, obviously-disposable DB.
// A wrapper whose whole purpose is safety should verify its own premise.
if (!/^postgresql:\/\/[^@]*@(localhost|127\.0\.0\.1)[:/]/.test(TEST_DATABASE_URL)) {
  console.error(`[test:integration:safe] REFUSING to run: TEST_DATABASE_URL is not local.\n  ${TEST_DATABASE_URL}`);
  process.exit(1);
}
if (!/_test(\?|$)/.test(TEST_DATABASE_URL)) {
  console.error(
    `[test:integration:safe] REFUSING to run: the target database name must end in "_test".\n` +
      `  Got: ${TEST_DATABASE_URL}\n` +
      `  This guard is what stops the suite writing fixtures into your real dev database.`,
  );
  process.exit(1);
}

console.log(`[test:integration:safe] target DB: ${TEST_DATABASE_URL.replace(/:[^:@]*@/, ":****@")}`);

// `npx` (rather than require.resolve) because jest's package.json `exports` map does not
// expose ./bin/jest.js, so resolving it directly throws ERR_PACKAGE_PATH_NOT_EXPORTED.
// shell:true is what makes this work on Windows, where the local binary is jest.CMD.
const child = spawn(
  "npx",
  ["jest", "--config", "jest.integration.config.js", "--passWithNoTests", "--runInBand", ...process.argv.slice(2)],
  {
    stdio: "inherit",
    shell: true,
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL, REDIS_URL: TEST_REDIS_URL },
  },
);

child.on("exit", (code) => process.exit(code ?? 1));
