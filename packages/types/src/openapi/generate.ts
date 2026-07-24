#!/usr/bin/env node
// Emits the OpenAPI 3.1 document derived from the zod registry to every
// consumer location that needs a static copy:
//   - apps/api/openapi/auth.openapi.json   → served by NestJS at /api-docs.json
//   - packages/api-client/openapi/auth.openapi.json → input to the typed SDK
// Run via `pnpm --filter @repo/types gen:openapi` (also wired into
// turbo's build graph so `turbo run build` regenerates both copies whenever
// a schema changes). This script is the seam: today it writes static JSON
// files; later apps/api can import generateOpenApiDocument() directly and
// serve it live instead of reading the file — same source of truth either way.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generateOpenApiDocument } from "./registry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// dist/openapi/generate.js -> packages/types -> packages -> repo root
const repoRoot = resolve(__dirname, "../../../..");

const targets = [
  resolve(repoRoot, "apps/api/openapi/auth.openapi.json"),
  resolve(repoRoot, "packages/api-client/openapi/auth.openapi.json"),
];

const document = generateOpenApiDocument();
const json = `${JSON.stringify(document, null, 2)}\n`;

for (const target of targets) {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, json, "utf8");
  console.log(`[gen:openapi] wrote ${target}`);
}
