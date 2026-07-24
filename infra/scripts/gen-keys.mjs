#!/usr/bin/env node
// infra/scripts/gen-keys.mjs
//
// Generates a LOCAL-ONLY RS256 keypair for JWT signing (CLAUDE.md locked decision).
// Writes PEM files into `keys/` at the repo root, which is gitignored — never commit
// these. Real staging/prod keys come from a secrets manager, not this script.
//
// Usage: `pnpm gen:keys` (idempotent: skips generation if both files already exist,
// unless --force is passed).

import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");
const keysDir = join(repoRoot, "keys");

const privateKeyPath = join(keysDir, "jwt-private.pem");
const publicKeyPath = join(keysDir, "jwt-public.pem");

const force = process.argv.includes("--force");

if (!existsSync(keysDir)) {
  mkdirSync(keysDir, { recursive: true });
}

if (!force && existsSync(privateKeyPath) && existsSync(publicKeyPath)) {
  console.log(`[gen:keys] Keys already exist at ${keysDir} — skipping (use --force to regenerate).`);
  process.exit(0);
}

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

writeFileSync(privateKeyPath, privateKey, { mode: 0o600 });
writeFileSync(publicKeyPath, publicKey, { mode: 0o644 });

console.log(`[gen:keys] Generated local-only RS256 keypair:`);
console.log(`  private: ${privateKeyPath}`);
console.log(`  public:  ${publicKeyPath}`);
console.log(`[gen:keys] These are gitignored. Reference them via JWT_PRIVATE_KEY_PATH /`);
console.log(`[gen:keys] JWT_PUBLIC_KEY_PATH in your .env (see .env.example).`);
