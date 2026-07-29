// Unit tests for ObjectKeySchema's Wave security-review tightening (M1/L1):
// docs/specs/phase-10-page-builder.md — every `*ImageKey`/`*PhotoKey` field in the
// Phase-10 block registry uses this schema. Locks in the exact attack-vector list from
// the review (open-redirect/traversal-shaped input via a field later concatenated onto
// a CDN base URL, content.util.ts#mintCdnUrl) and confirms the legacy `/images/...`
// static-asset exception (prisma/fixtures/builder-pages/*.json) still parses.
import { describe, expect, it } from "vitest";
import { ObjectKeySchema } from "./primitives.js";

describe("ObjectKeySchema", () => {
  it.each([
    "blog/covers/abc123.jpg",
    "partners/logo.png",
    "cover.jpg",
    "hero/image-1.jpg",
    // The legacy `/images/...` static-asset exception (Phase-10 fixtures).
    "/images/why-us-team-portrait.webp",
    "/images/hero/hero-background.avif",
    "/images/popup/counsellor.png",
  ])("accepts %s", (value) => {
    expect(ObjectKeySchema.safeParse(value).success).toBe(true);
  });

  it.each([
    ["/programs", "absolute path outside the /images/ exception"],
    ["/etc/passwd", "absolute path outside the /images/ exception"],
    ["//evil.com/x", "protocol-relative URL"],
    ["https://evil.com/x", "absolute https:// URL (a scheme, not a raw key)"],
    ["javascript:alert(1)", "javascript: scheme (XSS)"],
    ["data:text/html;base64,x", "data: scheme"],
    ["../../etc/passwd", "path traversal"],
    ["images/../../etc/passwd", "path traversal mid-path"],
    ["foo/../bar", "path traversal single segment"],
    ["mailto:x@example.com", "scheme with no slash at all"],
  ])("rejects %s (%s)", (value) => {
    expect(ObjectKeySchema.safeParse(value).success).toBe(false);
  });

  it("still enforces the pre-existing length bounds", () => {
    expect(ObjectKeySchema.safeParse("").success).toBe(false);
    expect(ObjectKeySchema.safeParse("a".repeat(501)).success).toBe(false);
    expect(ObjectKeySchema.safeParse("a".repeat(500)).success).toBe(true);
  });
});
