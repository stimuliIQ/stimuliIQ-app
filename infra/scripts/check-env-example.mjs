#!/usr/bin/env node
// infra/scripts/check-env-example.mjs
//
// Lightweight reminder hook (runs on `pnpm install` via the root "prepare" script).
// Does NOT fail install — just nudges a first-time clone to copy `.env.example` to
// `.env` and to generate JWT keys, since `apps/api` will fail fast without them.

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");

const envPath = join(repoRoot, ".env");
const keysDir = join(repoRoot, "keys");

if (!existsSync(envPath)) {
  console.log("\n[setup] No .env found. Run:");
  console.log("  cp .env.example .env");
}

if (!existsSync(keysDir)) {
  console.log("[setup] No local JWT keys found. Run:");
  console.log("  pnpm gen:keys\n");
}
