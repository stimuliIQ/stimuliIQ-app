// prisma.config.ts — replaces the deprecated `package.json#prisma` config block
// (Prisma 6 deprecation warning; removed entirely in Prisma 7).
//
// Keeps the schema path explicit (prisma/schema.prisma, matching every `--schema`
// flag used in package.json scripts) and points the seed command at the same
// ts-node invocation used by `pnpm db:seed`.

import { defineConfig } from "prisma/config";

// Prisma skips its old automatic dotenv loading once a `prisma.config.ts` is present.
// Avoid adding a new `dotenv` dependency (outside the fixed stack) by using Node's
// built-in `process.loadEnvFile` (Node >= 20.6, matches the engines.node requirement
// in package.json) to load the repo-root `.env` before Prisma reads `DATABASE_URL`.
try {
  process.loadEnvFile(new URL("./.env", import.meta.url));
} catch {
  // .env may legitimately be absent in CI where env vars are injected directly —
  // never fail config loading because of this.
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    seed: "ts-node --project prisma/tsconfig.seed.json prisma/seed.ts",
  },
});
