// Unit tests for the page-builder marketing-image upload contract
// (ContentPageMediaUploadUrlRequestSchema, pages.schemas.ts), mints a signed PUT URL for
// `POST /crm/content-pages/media-upload-url`. Covers: contentType is a closed raster-image
// enum (SVG explicitly rejected, a stored-XSS vector on the public marketing site if
// served from the CDN), the 5 MB sizeBytes cap, and that a representative
// `marketing_images/...` storageKey parses against the shared ObjectKeySchema (no leading
// slash, no scheme, no "..", see common/primitives.spec.ts for the full ObjectKeySchema
// attack-vector matrix).
import { describe, expect, it } from "vitest";
import { ContentPageMediaUploadUrlRequestSchema } from "./pages.schemas.js";
import { ObjectKeySchema } from "../common/primitives.js";

describe("ContentPageMediaUploadUrlRequestSchema", () => {
  const VALID = { fileName: "hero.webp", contentType: "image/webp" as const, sizeBytes: 1_000_000 };

  it("accepts a valid jpeg/png/webp request", () => {
    for (const contentType of ["image/jpeg", "image/png", "image/webp"] as const) {
      expect(ContentPageMediaUploadUrlRequestSchema.safeParse({ ...VALID, contentType }).success).toBe(true);
    }
  });

  it("rejects image/svg+xml, SVG is a stored-XSS vector on the public site, not in the enum", () => {
    const result = ContentPageMediaUploadUrlRequestSchema.safeParse({ ...VALID, contentType: "image/svg+xml" });
    expect(result.success).toBe(false);
  });

  it("rejects other non-image content types", () => {
    for (const contentType of ["application/pdf", "text/html", "video/mp4"]) {
      expect(ContentPageMediaUploadUrlRequestSchema.safeParse({ ...VALID, contentType }).success).toBe(false);
    }
  });

  it("rejects sizeBytes over the 5 MB cap", () => {
    expect(ContentPageMediaUploadUrlRequestSchema.safeParse({ ...VALID, sizeBytes: 5_242_881 }).success).toBe(false);
    expect(ContentPageMediaUploadUrlRequestSchema.safeParse({ ...VALID, sizeBytes: 5_242_880 }).success).toBe(true);
  });

  it("rejects a missing/empty fileName", () => {
    expect(ContentPageMediaUploadUrlRequestSchema.safeParse({ ...VALID, fileName: "" }).success).toBe(false);
    const { fileName: _fileName, ...withoutFileName } = VALID;
    expect(ContentPageMediaUploadUrlRequestSchema.safeParse(withoutFileName).success).toBe(false);
  });

  it("rejects unknown extra fields (.strict())", () => {
    expect(ContentPageMediaUploadUrlRequestSchema.safeParse({ ...VALID, extra: "nope" }).success).toBe(false);
  });

  it("the returned marketing_images storageKey shape parses against ObjectKeySchema as-is (no leading slash, no scheme, no '..')", () => {
    const storageKey = "marketing_images/tenant-abc/11111111-2222-3333-4444-555555555555-hero.webp";
    expect(ObjectKeySchema.safeParse(storageKey).success).toBe(true);
  });
});
