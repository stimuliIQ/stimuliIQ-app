// apps/api/src/modules/lms/pwa-smoke.spec.ts
//
// Phase-3 Wave-6 QA: PWA smoke tests (unit — light).
//
// These tests verify two LMS PWA artefacts at the file-content level:
//   1. apps/lms/src/app/manifest.ts → Next.js MetadataRoute.Manifest shape
//   2. apps/lms/public/sw.js        → critical security invariants (same-origin
//      guard, GET-only guard) that prevent caching signed HLS URLs or mutation
//      requests.
//
// WHY HERE (apps/api unit suite) rather than apps/lms?
//   The lms app has no test runner configured yet (package.json "test" is a
//   placeholder echo). The manifest.ts and sw.js are authored artefacts that can
//   be verified without a browser — reading the compiled manifest function output
//   (Node.js fs) and sw.js source text. Running them here avoids adding a new
//   jest/vitest install to apps/lms (CLAUDE.md: do NOT install new dependencies).
//
// ACCEPTANCE CRITERIA COVERED (AC-5: PWA smoke)
//   AC-5a  manifest default export returns an object with the required fields
//   AC-5b  manifest.display === "standalone"
//   AC-5c  manifest.icons array has at least one entry
//   AC-5d  sw.js contains the GET-only early-return guard (non-GET mutations skipped)
//   AC-5e  sw.js contains the same-origin guard (cross-origin signed HLS skipped)

import * as path from "node:path";
import * as fs from "node:fs";

// Absolute paths — independent of cwd.
const LMS_ROOT = path.resolve(__dirname, "../../../../lms");
const MANIFEST_TS = path.join(LMS_ROOT, "src/app/manifest.ts");
const SW_JS = path.join(LMS_ROOT, "public/sw.js");

// ─── AC-5: manifest.ts ────────────────────────────────────────────────────────

describe("AC-5a/b/c: apps/lms/src/app/manifest.ts — PWA manifest shape", () => {
  // We require the manifest module via ts-jest (it's compiled inline).
  // `import type { MetadataRoute }` is a type-only import — safe at runtime,
  // ts-jest strips it.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const manifestModule = require(MANIFEST_TS) as {
    default: () => Record<string, unknown>;
  };
  const manifest = manifestModule.default();

  it("AC-5a: manifest has required fields: name, short_name, start_url, display, icons", () => {
    expect(manifest).toHaveProperty("name");
    expect(manifest).toHaveProperty("short_name");
    expect(manifest).toHaveProperty("start_url");
    expect(manifest).toHaveProperty("display");
    expect(manifest).toHaveProperty("icons");
  });

  it("AC-5a: manifest.name is a non-empty string containing the brand", () => {
    expect(typeof manifest["name"]).toBe("string");
    expect((manifest["name"] as string).length).toBeGreaterThan(0);
    expect((manifest["name"] as string).toLowerCase()).toContain("stimuliiq");
  });

  it("AC-5a: manifest.short_name is a non-empty string", () => {
    expect(typeof manifest["short_name"]).toBe("string");
    expect((manifest["short_name"] as string).length).toBeGreaterThan(0);
  });

  it("AC-5a: manifest.start_url is /", () => {
    expect(manifest["start_url"]).toBe("/");
  });

  it("AC-5b: manifest.display === 'standalone' (required for add-to-home-screen)", () => {
    expect(manifest["display"]).toBe("standalone");
  });

  it("AC-5c: manifest.icons is an array with at least one icon entry", () => {
    const icons = manifest["icons"] as unknown[];
    expect(Array.isArray(icons)).toBe(true);
    expect(icons.length).toBeGreaterThanOrEqual(1);
  });

  it("AC-5c: each icon entry has src and sizes fields", () => {
    const icons = manifest["icons"] as Record<string, unknown>[];
    for (const icon of icons) {
      expect(icon).toHaveProperty("src");
      expect(icon).toHaveProperty("sizes");
      expect(typeof icon["src"]).toBe("string");
    }
  });
});

// ─── AC-5d/e: sw.js security invariants ──────────────────────────────────────

describe("AC-5d/e: apps/lms/public/sw.js — service worker security guards", () => {
  let swSource: string;

  beforeAll(() => {
    expect(fs.existsSync(SW_JS)).toBe(true);
    swSource = fs.readFileSync(SW_JS, "utf8");
  });

  it("AC-5d: sw.js contains the GET-only early-return guard (method !== GET check)", () => {
    // The guard must be present to prevent caching mutations (PUT progress pings,
    // POST mark-complete, POST auth). Exact text from docs/plans/phase-3.md §Risks.
    expect(swSource).toContain("request.method !== \"GET\"");
    // Must also contain `return` immediately after (not just the condition).
    // We check the condition line is followed by a `return` statement nearby.
    const methodCheckIdx = swSource.indexOf("request.method !== \"GET\"");
    const nearbySource = swSource.slice(methodCheckIdx, methodCheckIdx + 40);
    expect(nearbySource).toMatch(/return/);
  });

  it("AC-5e: sw.js contains the same-origin guard (cross-origin bypass for signed HLS)", () => {
    // The guard must be present so that cross-origin signed HLS video CDN URLs
    // are NEVER passed through the SW cache. Exact text from sw.js comments.
    expect(swSource).toContain("url.origin !== self.location.origin");
    // Must also skip (return) on cross-origin.
    const originCheckIdx = swSource.indexOf("url.origin !== self.location.origin");
    const nearbySource = swSource.slice(originCheckIdx, originCheckIdx + 50);
    expect(nearbySource).toMatch(/return/);
  });

  it("AC-5e: sw.js does NOT call cache.put() without first checking same-origin", () => {
    // sw.js opens caches via `caches.open(name).then(cache => cache.put(...))`.
    // The actual `.put()` call is on the opened `cache` object (singular),
    // not on the `caches` global (CacheStorage). We verify the first `.put(` call
    // (preceded by `cache`) appears AFTER the same-origin guard.
    const guardIdx = swSource.indexOf("url.origin !== self.location.origin");
    // Find the first occurrence of `.put(` in the source.
    const firstCachePutIdx = swSource.indexOf(".put(");

    // Both the guard and the put call must exist.
    expect(guardIdx).toBeGreaterThan(-1);
    expect(firstCachePutIdx).toBeGreaterThan(-1);
    // The first cache write must appear AFTER the same-origin guard.
    expect(firstCachePutIdx).toBeGreaterThan(guardIdx);
  });

  it("AC-5d/e: sw.js does NOT hard-code any video CDN origin (no vendor leak)", () => {
    // If a dev hard-coded cloudflare/mux origins, that would be an accidental
    // whitelist and could cause signed-URL caching if the guard was wrong.
    expect(swSource).not.toMatch(/cloudflare\.com/i);
    expect(swSource).not.toMatch(/mux\.com/i);
    expect(swSource).not.toMatch(/cloudflarestream/i);
  });

  it("AC-5: sw.js version constant is present (cache-busting on redeploy)", () => {
    // Ensures the SW_VERSION constant or equivalent is defined so old caches
    // are invalidated when the service worker is updated.
    expect(swSource).toMatch(/SW_VERSION\s*=\s*["'`]v\d+["'`]/);
  });
});
