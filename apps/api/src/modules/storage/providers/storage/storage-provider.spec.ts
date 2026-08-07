// apps/api/src/modules/storage/providers/storage/storage-provider.spec.ts
//
// Unit tests for the StorageProvider adapters:
//   - NoopStorageProvider (deterministic fake URLs, TTL/expiry, head defaults)
//   - S3StorageProvider (fail-closed when unconfigured; key validation)
//   - sanitiseFilename / validateStorageKey / buildStorageKey helpers
//
// Test strategy (docs/plans/phase-4.md task #3 DoD, CLAUDE.md §3.10):
//   - All tests are UNIT — no live network calls, no real S3/R2 bucket.
//   - @aws-sdk/client-s3 and @aws-sdk/s3-request-presigner are mocked so the
//     S3StorageProvider tests exercise the adapter logic without network.
//   - node:crypto is NOT used by StorageProvider (no HMAC signing here — that is
//     S3 SDK internal); therefore no crypto mock is needed.
//   - Tests cover:
//       1. NoopStorageProvider.getSignedUploadUrl — URL shape, storageKey, TTL, expiry.
//       2. NoopStorageProvider.getSignedDownloadUrl — URL shape, TTL, expiry.
//       3. NoopStorageProvider.delete — no-op (does not throw).
//       4. NoopStorageProvider.head — default "exists" response; headExistsDefault=false.
//       5. NoopStorageProvider — determinism (same key + same second → same URL).
//       6. NoopStorageProvider static helpers — buildExpectedUploadUrl / buildExpectedDownloadUrl.
//       7. sanitiseFilename — path traversal, null bytes, disallowed chars, truncation.
//       8. validateStorageKey — prefix check, ".." rejection, null byte rejection.
//       9. buildStorageKey — correct layout for each namespace; error on missing ids.
//      10. S3StorageProvider — fail-closed: constructor does NOT throw when unconfigured;
//          calls throw with a clear message; no URL returned.
//      11. S3StorageProvider — with mocked SDK: getSignedUploadUrl returns url + storageKey
//          + expiresAt + requiredHeaders; getSignedDownloadUrl returns url + expiresAt.
//      12. Content-type constraint plumbing (requiredHeaders["Content-Type"] === input).
//
// Secrets invariant: no real AWS credentials are used; the STORAGE_ACCESS_KEY_ID /
// STORAGE_SECRET_ACCESS_KEY in REQUIRED_ENV are clearly test-only constants and are
// NEVER asserted to appear in any return value.

import { __resetEnvCacheForTests } from "../../../../config/env";
import {
  sanitiseFilename,
  validateStorageKey,
  buildStorageKey,
  isPublicAssetKey,
  type StorageKeyNamespace,
} from "./s3-storage.provider";
import {
  NoopStorageProvider,
} from "./noop-storage.provider";
import {
  DEFAULT_STORAGE_UPLOAD_TTL_SECONDS,
  DEFAULT_STORAGE_DOWNLOAD_TTL_SECONDS,
} from "./storage-provider.interface";

// ─────────────────────────────────────────────────────────────────────────────
// Mock @aws-sdk/client-s3 and @aws-sdk/s3-request-presigner
//
// The S3StorageProvider unit tests should not hit any real S3 endpoint.
// We mock `getSignedUrl` to return a deterministic fake URL so we can assert
// the shape of the URL returned by the adapter without real credentials.
//
// NOTE: jest.mock() factories are hoisted to the top of the file by babel-jest /
// ts-jest.  Any `const` declared in the file body is NOT yet initialized when
// the factory runs, so we must embed the literal value directly here.
// ─────────────────────────────────────────────────────────────────────────────

// Declared here (below the mock blocks) so imports can reference it.
// The literal value MUST match what is inside the jest.mock factory above.
const FAKE_PRESIGNED_URL = "https://fake-s3-bucket.s3.amazonaws.com/test-key?X-Amz-Signature=fakeS4sig";

jest.mock("@aws-sdk/s3-request-presigner", () => ({
  // Literal value — cannot reference the FAKE_PRESIGNED_URL const here (not yet initialized).
  getSignedUrl: jest.fn().mockResolvedValue(
    "https://fake-s3-bucket.s3.amazonaws.com/test-key?X-Amz-Signature=fakeS4sig",
  ),
}));

jest.mock("@aws-sdk/client-s3", () => {
  const mockSend = jest.fn();

  class MockS3Client {
    send = mockSend;
  }

  // Minimal command stubs — the adapter only needs the class to exist so the
  // constructor is callable.  The actual SDK call is mocked via `send`.
  class PutObjectCommand {
    constructor(public readonly input: Record<string, unknown>) {}
  }
  class GetObjectCommand {
    constructor(public readonly input: Record<string, unknown>) {}
  }
  class DeleteObjectCommand {
    constructor(public readonly input: Record<string, unknown>) {}
  }
  class HeadObjectCommand {
    constructor(public readonly input: Record<string, unknown>) {}
  }
  class S3ServiceException extends Error {
    $metadata: { httpStatusCode?: number } = {};
    override name: string = "S3ServiceException";
    constructor(msg: string, meta: { httpStatusCode?: number } = {}) {
      super(msg);
      this.$metadata = meta;
      this.name = "S3ServiceException";
    }
  }

  return {
    S3Client: MockS3Client,
    PutObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand,
    HeadObjectCommand,
    S3ServiceException,
    __mockSend: mockSend,
  };
});

// Import after mocks are installed.
import { S3StorageProvider } from "./s3-storage.provider";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// ─────────────────────────────────────────────────────────────────────────────
// Env helpers
// ─────────────────────────────────────────────────────────────────────────────

const REQUIRED_ENV: Record<string, string> = {
  DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  REDIS_URL: "redis://localhost:6379",
  JWT_PRIVATE_KEY_PATH: "./keys/jwt-private.pem",
  JWT_PUBLIC_KEY_PATH: "./keys/jwt-public.pem",
  COOKIE_SECRET: "test-cookie-secret-at-least-32-chars-long!!",
  CSRF_SECRET: "test-csrf-secret-at-least-32-chars-long!!!",
};

const STORAGE_ENV: Record<string, string> = {
  STORAGE_PROVIDER: "s3",
  STORAGE_BUCKET: "test-bucket",
  STORAGE_REGION: "ap-south-1",
  STORAGE_ACCESS_KEY_ID: "test-access-key-id",
  STORAGE_SECRET_ACCESS_KEY: "test-secret-access-key",
};

function setTestEnvStorage(overrides: Record<string, string | undefined> = {}): void {
  Object.assign(process.env, { ...REQUIRED_ENV, ...STORAGE_ENV, ...overrides });
}

function clearTestEnv(): void {
  const keys = [
    ...Object.keys(REQUIRED_ENV),
    ...Object.keys(STORAGE_ENV),
    "STORAGE_ENDPOINT",
    "STORAGE_PUBLIC_BUCKET",
  ];
  for (const k of keys) delete process.env[k];
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1: sanitiseFilename
// ─────────────────────────────────────────────────────────────────────────────

describe("sanitiseFilename", () => {
  it("passes through a safe filename unchanged", () => {
    expect(sanitiseFilename("assignment.pdf")).toBe("assignment.pdf");
  });

  it("replaces path separators with underscores", () => {
    expect(sanitiseFilename("../../etc/passwd")).not.toContain("/");
    expect(sanitiseFilename("..\\..\\Windows\\system32")).not.toContain("\\");
  });

  it("removes null bytes", () => {
    const result = sanitiseFilename("file\0name.pdf");
    expect(result).not.toContain("\0");
  });

  it("replaces disallowed characters with underscores", () => {
    const result = sanitiseFilename("my file (2024).pdf");
    // Spaces and parens are not in [a-zA-Z0-9._-]
    expect(result).not.toMatch(/[ ()]/);
  });

  it("returns 'file' for an empty string", () => {
    expect(sanitiseFilename("")).toBe("file");
  });

  it("returns 'file' when sanitisation removes all characters", () => {
    // Only disallowed chars — should reduce to empty → 'file'
    expect(sanitiseFilename("@@@###$$$")).toBe("file");
  });

  it("truncates long filenames to 200 characters", () => {
    const long = "a".repeat(300) + ".pdf";
    expect(sanitiseFilename(long).length).toBeLessThanOrEqual(200);
  });

  it("preserves dots, hyphens, and underscores", () => {
    const filename = "my_file-v2.1.pdf";
    expect(sanitiseFilename(filename)).toBe(filename);
  });

  it("strips traversal sequences (.../)", () => {
    const result = sanitiseFilename("../../file.pdf");
    expect(result).not.toContain("..");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2: validateStorageKey
// ─────────────────────────────────────────────────────────────────────────────

describe("validateStorageKey", () => {
  it("accepts keys with allowed prefixes", () => {
    expect(() => validateStorageKey("submissions/t1/e1/abc.pdf")).not.toThrow();
    expect(() => validateStorageKey("certificates/t1/cert123.pdf")).not.toThrow();
    expect(() => validateStorageKey("invoices/t1/inv123.pdf")).not.toThrow();
    expect(() => validateStorageKey("resources/t1/l1/abc.pdf")).not.toThrow();
    expect(() => validateStorageKey("exports/t1/job-1.csv")).not.toThrow();
    expect(() => validateStorageKey("receipts/t1/pay-1.pdf")).not.toThrow();
    expect(() => validateStorageKey("careers/t1/uuid-resume.pdf")).not.toThrow();
    expect(() => validateStorageKey("mentor_photos/t1/uuid-photo.jpg")).not.toThrow();
    expect(() => validateStorageKey("program_images/t1/uuid-cover.png")).not.toThrow();
    expect(() => validateStorageKey("marketing_images/t1/uuid-hero.webp")).not.toThrow();
    expect(() => validateStorageKey("college_logos/t1/uuid-logo.webp")).not.toThrow();
    expect(() => validateStorageKey("program_brochures/t1/uuid-syllabus.pdf")).not.toThrow();
  });

  // REGRESSION: `program_brochures/` was a valid `buildStorageKey()` namespace but was
  // missing from ALLOWED_KEY_PREFIXES, so every brochure upload threw inside
  // `getSignedUploadUrl()`'s `validateStorageKey()` call. Any namespace reachable from
  // buildStorageKey must round-trip through validateStorageKey.
  it("accepts every namespace buildStorageKey can emit", () => {
    const namespaces: StorageKeyNamespace[] = [
      "mentor_photos",
      "program_images",
      "program_brochures",
      "marketing_images",
      "college_logos",
      "onboarding",
    ];
    for (const namespace of namespaces) {
      const key = buildStorageKey({
        namespace,
        tenantId: "t1",
        uniqueId: "uuid",
        filename: "file.pdf",
      });
      expect(() => validateStorageKey(key)).not.toThrow();
    }
  });

  // Bucket routing: everything mintCdnUrl() turns into a public URL must resolve to the
  // public bucket, or the object is written to the private bucket while the URL points at
  // the public one — a guaranteed 404 once STORAGE_PUBLIC_BUCKET is configured.
  it("routes exactly the CDN-served namespaces to the public bucket", () => {
    expect(isPublicAssetKey("program_images/t1/uuid-cover.png")).toBe(true);
    expect(isPublicAssetKey("marketing_images/t1/uuid-hero.webp")).toBe(true);
    expect(isPublicAssetKey("mentor_photos/t1/uuid-photo.jpg")).toBe(true);
    expect(isPublicAssetKey("college_logos/t1/uuid-logo.webp")).toBe(true);
    expect(isPublicAssetKey("program_brochures/t1/uuid-syllabus.pdf")).toBe(true);

    // PII / private-by-default namespaces must NEVER land in a world-readable bucket.
    expect(isPublicAssetKey("submissions/t1/e1/abc.pdf")).toBe(false);
    expect(isPublicAssetKey("exports/t1/job-1.csv")).toBe(false);
    expect(isPublicAssetKey("invoices/t1/inv123.pdf")).toBe(false);
    expect(isPublicAssetKey("receipts/t1/pay-1.pdf")).toBe(false);
    expect(isPublicAssetKey("careers/t1/uuid-resume.pdf")).toBe(false);
    // Onboarding file answers — a payment receipt carries an amount and a bank/UPI
    // reference, so it is signed-URL-only like careers/, never CDN-served.
    expect(isPublicAssetKey("onboarding/t1/uuid-receipt.png")).toBe(false);
    expect(isPublicAssetKey("certificates/t1/cert123.pdf")).toBe(false);
    expect(isPublicAssetKey("resources/t1/l1/abc.pdf")).toBe(false);
  });

  it("rejects keys without an allowed prefix", () => {
    expect(() => validateStorageKey("private/t1/file.pdf")).toThrow(/known namespace prefix/);
    expect(() => validateStorageKey("/submissions/t1/file.pdf")).toThrow(/known namespace prefix/);
  });

  it("rejects keys containing '..'", () => {
    expect(() => validateStorageKey("submissions/t1/../secrets/key")).toThrow(/path traversal/);
  });

  it("rejects keys with null bytes", () => {
    expect(() => validateStorageKey("submissions/t1/\0file.pdf")).toThrow(/null bytes/);
  });

  it("rejects empty string", () => {
    expect(() => validateStorageKey("")).toThrow();
  });

  it("SECURITY: rejects a key attempting tenant escape via '..'", () => {
    expect(() =>
      validateStorageKey("submissions/tenant-a/enroll-1/../../tenant-b/secret.pdf"),
    ).toThrow(/path traversal/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 3: buildStorageKey
// ─────────────────────────────────────────────────────────────────────────────

describe("buildStorageKey", () => {
  const TENANT = "tenant-abc-123";
  const UUID = "11111111-2222-3333-4444-555555555555";
  const ENROLLMENT = "enroll-abc";
  const LESSON = "lesson-xyz";

  it("builds a submissions key with correct layout", () => {
    const key = buildStorageKey({
      namespace: "submissions",
      tenantId: TENANT,
      uniqueId: UUID,
      scopeId: ENROLLMENT,
      filename: "assignment.pdf",
    });
    expect(key).toMatch(/^submissions\//);
    expect(key).toContain(TENANT.replace(/[^a-zA-Z0-9_-]/g, "_"));
    expect(key).toContain(ENROLLMENT);
    expect(key).toContain("assignment.pdf");
  });

  it("builds a certificates key with .pdf extension", () => {
    const key = buildStorageKey({
      namespace: "certificates",
      tenantId: TENANT,
      uniqueId: UUID,
    });
    expect(key).toMatch(/^certificates\//);
    expect(key).toMatch(/\.pdf$/);
  });

  it("builds an invoices key with .pdf extension", () => {
    const key = buildStorageKey({
      namespace: "invoices",
      tenantId: TENANT,
      uniqueId: UUID,
    });
    expect(key).toMatch(/^invoices\//);
    expect(key).toMatch(/\.pdf$/);
  });

  it("builds a resources key with correct layout", () => {
    const key = buildStorageKey({
      namespace: "resources",
      tenantId: TENANT,
      uniqueId: UUID,
      scopeId: LESSON,
      filename: "cheatsheet.pdf",
    });
    expect(key).toMatch(/^resources\//);
    expect(key).toContain(LESSON);
    expect(key).toContain("cheatsheet.pdf");
  });

  it("builds a careers key with correct layout, no scopeId required (anonymous applicant)", () => {
    const key = buildStorageKey({
      namespace: "careers",
      tenantId: TENANT,
      uniqueId: UUID,
      filename: "resume.pdf",
    });
    expect(key).toMatch(/^careers\//);
    expect(key).toContain(TENANT.replace(/[^a-zA-Z0-9_-]/g, "_"));
    expect(key).toContain("resume.pdf");
    expect(() => validateStorageKey(key)).not.toThrow();
  });

  it("builds an exports key with the requested extension", () => {
    const csvKey = buildStorageKey({ namespace: "exports", tenantId: TENANT, uniqueId: UUID, extension: "csv" });
    expect(csvKey).toMatch(/^exports\//);
    expect(csvKey).toMatch(/\.csv$/);

    const pdfKey = buildStorageKey({ namespace: "exports", tenantId: TENANT, uniqueId: UUID, extension: "pdf" });
    expect(pdfKey).toMatch(/\.pdf$/);
  });

  it("throws when extension is missing for namespace 'exports'", () => {
    expect(() => buildStorageKey({ namespace: "exports", tenantId: TENANT, uniqueId: UUID })).toThrow(
      /extension .* is required/,
    );
  });

  it("throws when tenantId is missing", () => {
    expect(() =>
      buildStorageKey({ namespace: "certificates", tenantId: "", uniqueId: UUID }),
    ).toThrow(/tenantId is required/);
  });

  it("throws when uniqueId is missing", () => {
    expect(() =>
      buildStorageKey({ namespace: "certificates", tenantId: TENANT, uniqueId: "" }),
    ).toThrow(/uniqueId is required/);
  });

  it("throws when scopeId is missing for submissions", () => {
    expect(() =>
      buildStorageKey({ namespace: "submissions", tenantId: TENANT, uniqueId: UUID }),
    ).toThrow(/scopeId is required/);
  });

  it("throws when scopeId is missing for resources", () => {
    expect(() =>
      buildStorageKey({ namespace: "resources", tenantId: TENANT, uniqueId: UUID }),
    ).toThrow(/scopeId is required/);
  });

  it("SECURITY: sanitises a filename containing path traversal sequences", () => {
    const key = buildStorageKey({
      namespace: "submissions",
      tenantId: TENANT,
      uniqueId: UUID,
      scopeId: ENROLLMENT,
      filename: "../../etc/passwd",
    });
    // The key must not contain traversal sequences or raw path separators.
    // "../../etc/passwd" → sanitiseFilename strips ".." and "/" → "etcpasswd" (or similar
    // safe derivative) — the important invariant is no ".." and no "/" in the filename part.
    expect(key).not.toContain("..");
    // Validate the resulting key is structurally safe (passes the prefix + traversal check).
    expect(() => validateStorageKey(key)).not.toThrow();
    // The key must stay within the submissions namespace prefix (no tenant escape).
    expect(key).toMatch(/^submissions\//);
  });

  it("SECURITY: returned key passes validateStorageKey (always valid)", () => {
    const key = buildStorageKey({
      namespace: "submissions",
      tenantId: TENANT,
      uniqueId: UUID,
      scopeId: ENROLLMENT,
      filename: "test-file.pdf",
    });
    expect(() => validateStorageKey(key)).not.toThrow();
  });

  it("builds a mentor_photos key with correct layout", () => {
    const key = buildStorageKey({ namespace: "mentor_photos", tenantId: TENANT, uniqueId: UUID, filename: "photo.jpg" });
    expect(key).toMatch(/^mentor_photos\//);
    expect(key).toContain("photo.jpg");
    expect(() => validateStorageKey(key)).not.toThrow();
  });

  it("builds a program_images key with correct layout", () => {
    const key = buildStorageKey({ namespace: "program_images", tenantId: TENANT, uniqueId: UUID, filename: "cover.png" });
    expect(key).toMatch(/^program_images\//);
    expect(key).toContain("cover.png");
    expect(() => validateStorageKey(key)).not.toThrow();
  });

  it("builds a marketing_images key with correct layout", () => {
    const key = buildStorageKey({ namespace: "marketing_images", tenantId: TENANT, uniqueId: UUID, filename: "hero.webp" });
    expect(key).toMatch(/^marketing_images\//);
    expect(key).toContain(TENANT.replace(/[^a-zA-Z0-9_-]/g, "_"));
    expect(key).toContain("hero.webp");
    expect(() => validateStorageKey(key)).not.toThrow();
  });

  it("builds a college_logos key with correct layout (Phase-11 locked templates)", () => {
    const key = buildStorageKey({ namespace: "college_logos", tenantId: TENANT, uniqueId: UUID, filename: "logo.webp" });
    expect(key).toMatch(/^college_logos\//);
    expect(key).toContain("logo.webp");
    expect(() => validateStorageKey(key)).not.toThrow();
  });

  // REGRESSION (found during the marketing_images build — mentor_photos/ and
  // program_images/ were valid buildKey() namespaces but were MISSING from
  // ALLOWED_KEY_PREFIXES, so a raw mint against either would have thrown inside
  // getSignedUploadUrl()'s validateStorageKey() call). This test proves EVERY
  // StorageKeyNamespace member produces a key that validateStorageKey() accepts, so this
  // class of prefix-list/namespace-list drift can never silently reappear.
  it("SECURITY REGRESSION: every StorageKeyNamespace's buildKey() output passes validateStorageKey()", () => {
    const namespaces: StorageKeyNamespace[] = [
      "submissions",
      "certificates",
      "invoices",
      "resources",
      "exports",
      "receipts",
      "careers",
      "mentor_photos",
      "program_images",
      "marketing_images",
      "college_logos",
      "onboarding",
    ];

    for (const namespace of namespaces) {
      const opts: Parameters<typeof buildStorageKey>[0] = {
        namespace,
        tenantId: TENANT,
        uniqueId: UUID,
        ...((namespace === "submissions" || namespace === "resources") ? { scopeId: ENROLLMENT } : {}),
        ...(namespace === "exports" ? { extension: "pdf" as const } : {}),
      };
      const key = buildStorageKey(opts);
      expect(() => validateStorageKey(key)).not.toThrow();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 4: NoopStorageProvider
// ─────────────────────────────────────────────────────────────────────────────

describe("NoopStorageProvider", () => {
  let provider: NoopStorageProvider;

  const TEST_KEY = "submissions/tenant-1/enroll-1/uuid-abc-file.pdf";
  const TEST_CONTENT_TYPE = "application/pdf";
  const TEST_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
  const TEST_TTL = 300;

  beforeEach(() => {
    provider = new NoopStorageProvider();
  });

  // ─── getSignedUploadUrl ──────────────────────────────────────────────────

  describe("getSignedUploadUrl", () => {
    it("returns a URL matching the expected noop format", async () => {
      const result = await provider.getSignedUploadUrl({
        key: TEST_KEY,
        contentType: TEST_CONTENT_TYPE,
        maxBytes: TEST_MAX_BYTES,
        ttlSeconds: TEST_TTL,
      });

      expect(result.url).toMatch(/^https:\/\/noop\.local\/storage\/upload\//);
      expect(result.url).toContain("sig=noop");
      expect(result.url).toContain("exp=");
    });

    it("storageKey echoes the input key", async () => {
      const result = await provider.getSignedUploadUrl({
        key: TEST_KEY,
        contentType: TEST_CONTENT_TYPE,
        maxBytes: TEST_MAX_BYTES,
      });
      expect(result.storageKey).toBe(TEST_KEY);
    });

    it("expiresAt is approximately now + ttlSeconds", async () => {
      const beforeMs = Date.now();
      const result = await provider.getSignedUploadUrl({
        key: TEST_KEY,
        contentType: TEST_CONTENT_TYPE,
        maxBytes: TEST_MAX_BYTES,
        ttlSeconds: TEST_TTL,
      });
      const afterMs = Date.now();

      const expMs = result.expiresAt.getTime();
      expect(expMs).toBeGreaterThanOrEqual(beforeMs + TEST_TTL * 1000 - 1000);
      expect(expMs).toBeLessThanOrEqual(afterMs + TEST_TTL * 1000 + 1000);
    });

    it("uses DEFAULT_STORAGE_UPLOAD_TTL_SECONDS when ttlSeconds is omitted", async () => {
      const beforeMs = Date.now();
      const result = await provider.getSignedUploadUrl({
        key: TEST_KEY,
        contentType: TEST_CONTENT_TYPE,
        maxBytes: TEST_MAX_BYTES,
        // no ttlSeconds
      });
      const afterMs = Date.now();

      const expMs = result.expiresAt.getTime();
      expect(expMs).toBeGreaterThanOrEqual(beforeMs + DEFAULT_STORAGE_UPLOAD_TTL_SECONDS * 1000 - 1000);
      expect(expMs).toBeLessThanOrEqual(afterMs + DEFAULT_STORAGE_UPLOAD_TTL_SECONDS * 1000 + 1000);
    });

    it("requiredHeaders includes Content-Type matching the input", async () => {
      const result = await provider.getSignedUploadUrl({
        key: TEST_KEY,
        contentType: TEST_CONTENT_TYPE,
        maxBytes: TEST_MAX_BYTES,
      });
      expect(result.requiredHeaders["Content-Type"]).toBe(TEST_CONTENT_TYPE);
    });

    it("is DETERMINISTIC within the same second", async () => {
      const nowS = Math.floor(Date.now() / 1000);
      const expS = nowS + TEST_TTL;
      const expected = NoopStorageProvider.buildExpectedUploadUrl(TEST_KEY, expS);

      const result = await provider.getSignedUploadUrl({
        key: TEST_KEY,
        contentType: TEST_CONTENT_TYPE,
        maxBytes: TEST_MAX_BYTES,
        ttlSeconds: TEST_TTL,
      });

      // Allow ±1 s for second boundary crossings.
      const alt = NoopStorageProvider.buildExpectedUploadUrl(TEST_KEY, expS + 1);
      expect([expected, alt]).toContain(result.url);
    });

    it("SECURITY: no bucket name, region, or credential appears in the result", async () => {
      const result = await provider.getSignedUploadUrl({
        key: TEST_KEY,
        contentType: TEST_CONTENT_TYPE,
        maxBytes: TEST_MAX_BYTES,
      });
      const serialised = JSON.stringify(result);
      // The noop provider has no real credentials, but ensure the structure never
      // leaks any hypothetical credential.
      expect(serialised).not.toContain("aws");
      expect(serialised).not.toContain("secret");
    });
  });

  // ─── getSignedDownloadUrl ─────────────────────────────────────────────────

  describe("getSignedDownloadUrl", () => {
    it("returns a URL matching the expected noop format", async () => {
      const result = await provider.getSignedDownloadUrl({ key: TEST_KEY, ttlSeconds: TEST_TTL });

      expect(result.url).toMatch(/^https:\/\/noop\.local\/storage\/download\//);
      expect(result.url).toContain("sig=noop");
      expect(result.url).toContain("exp=");
    });

    it("expiresAt is approximately now + ttlSeconds", async () => {
      const beforeMs = Date.now();
      const result = await provider.getSignedDownloadUrl({
        key: TEST_KEY,
        ttlSeconds: TEST_TTL,
      });
      const afterMs = Date.now();

      const expMs = result.expiresAt.getTime();
      expect(expMs).toBeGreaterThanOrEqual(beforeMs + TEST_TTL * 1000 - 1000);
      expect(expMs).toBeLessThanOrEqual(afterMs + TEST_TTL * 1000 + 1000);
    });

    it("uses DEFAULT_STORAGE_DOWNLOAD_TTL_SECONDS when ttlSeconds is omitted", async () => {
      const beforeMs = Date.now();
      const result = await provider.getSignedDownloadUrl({ key: TEST_KEY });
      const afterMs = Date.now();

      const expMs = result.expiresAt.getTime();
      expect(expMs).toBeGreaterThanOrEqual(
        beforeMs + DEFAULT_STORAGE_DOWNLOAD_TTL_SECONDS * 1000 - 1000,
      );
      expect(expMs).toBeLessThanOrEqual(
        afterMs + DEFAULT_STORAGE_DOWNLOAD_TTL_SECONDS * 1000 + 1000,
      );
    });

    it("is DETERMINISTIC within the same second", async () => {
      const nowS = Math.floor(Date.now() / 1000);
      const expS = nowS + TEST_TTL;
      const expected = NoopStorageProvider.buildExpectedDownloadUrl(TEST_KEY, expS);

      const result = await provider.getSignedDownloadUrl({
        key: TEST_KEY,
        ttlSeconds: TEST_TTL,
      });

      const alt = NoopStorageProvider.buildExpectedDownloadUrl(TEST_KEY, expS + 1);
      expect([expected, alt]).toContain(result.url);
    });
  });

  // ─── putObject ───────────────────────────────────────────────────────────

  describe("putObject", () => {
    it("does not throw (no-op)", async () => {
      await expect(
        provider.putObject({ key: "exports/tenant-1/job-1.csv", body: Buffer.from("a,b\n1,2\n"), contentType: "text/csv" }),
      ).resolves.toBeUndefined();
    });
  });

  // ─── delete ──────────────────────────────────────────────────────────────

  describe("delete", () => {
    it("does not throw (no-op)", async () => {
      await expect(provider.delete({ key: TEST_KEY })).resolves.toBeUndefined();
    });
  });

  // ─── head ────────────────────────────────────────────────────────────────

  describe("head", () => {
    it("returns exists=true with defaults by default", async () => {
      const result = await provider.head({ key: TEST_KEY });
      expect(result.exists).toBe(true);
      expect(result.size).toBeDefined();
      expect(result.contentType).toBeDefined();
    });

    it("returns exists=false when headExistsDefault=false", async () => {
      const p = new NoopStorageProvider({ headExistsDefault: false });
      const result = await p.head({ key: TEST_KEY });
      expect(result.exists).toBe(false);
      expect(result.size).toBeUndefined();
      expect(result.contentType).toBeUndefined();
    });

    it("returns custom size and contentType", async () => {
      const p = new NoopStorageProvider({
        headSizeDefault: 2048,
        headContentTypeDefault: "image/png",
      });
      const result = await p.head({ key: TEST_KEY });
      expect(result.size).toBe(2048);
      expect(result.contentType).toBe("image/png");
    });
  });

  // ─── Static helpers ───────────────────────────────────────────────────────

  describe("buildExpectedUploadUrl (static)", () => {
    it("produces a URL matching getSignedUploadUrl for the same expS", async () => {
      const ttl = 60;
      const nowS = Math.floor(Date.now() / 1000);
      const expS = nowS + ttl;
      const expected = NoopStorageProvider.buildExpectedUploadUrl(TEST_KEY, expS);

      const result = await provider.getSignedUploadUrl({
        key: TEST_KEY,
        contentType: TEST_CONTENT_TYPE,
        maxBytes: TEST_MAX_BYTES,
        ttlSeconds: ttl,
      });

      const alt = NoopStorageProvider.buildExpectedUploadUrl(TEST_KEY, expS + 1);
      expect([expected, alt]).toContain(result.url);
    });
  });

  describe("buildExpectedDownloadUrl (static)", () => {
    it("produces a URL matching getSignedDownloadUrl for the same expS", async () => {
      const ttl = 120;
      const nowS = Math.floor(Date.now() / 1000);
      const expS = nowS + ttl;
      const expected = NoopStorageProvider.buildExpectedDownloadUrl(TEST_KEY, expS);

      const result = await provider.getSignedDownloadUrl({
        key: TEST_KEY,
        ttlSeconds: ttl,
      });

      const alt = NoopStorageProvider.buildExpectedDownloadUrl(TEST_KEY, expS + 1);
      expect([expected, alt]).toContain(result.url);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 5: S3StorageProvider — fail-closed when unconfigured
// ─────────────────────────────────────────────────────────────────────────────

describe("S3StorageProvider — fail-closed when unconfigured", () => {
  const TEST_KEY = "submissions/tenant-1/enroll-1/uuid-abc.pdf";

  beforeEach(() => {
    __resetEnvCacheForTests();
    // Provide only REQUIRED_ENV — no STORAGE_ keys.
    Object.assign(process.env, REQUIRED_ENV);
  });

  afterEach(() => {
    clearTestEnv();
    __resetEnvCacheForTests();
    jest.clearAllMocks();
  });

  it("constructor does NOT throw when credentials are absent", () => {
    expect(() => new S3StorageProvider()).not.toThrow();
  });

  it("getSignedUploadUrl throws with a clear message when unconfigured", async () => {
    const provider = new S3StorageProvider();
    await expect(
      provider.getSignedUploadUrl({
        key: TEST_KEY,
        contentType: "application/pdf",
        maxBytes: 1024,
      }),
    ).rejects.toThrow(/credentials not configured/);
  });

  it("getSignedDownloadUrl throws with a clear message when unconfigured", async () => {
    const provider = new S3StorageProvider();
    await expect(provider.getSignedDownloadUrl({ key: TEST_KEY })).rejects.toThrow(
      /credentials not configured/,
    );
  });

  it("delete throws with a clear message when unconfigured", async () => {
    const provider = new S3StorageProvider();
    await expect(provider.delete({ key: TEST_KEY })).rejects.toThrow(
      /credentials not configured/,
    );
  });

  it("putObject throws with a clear message when unconfigured", async () => {
    const provider = new S3StorageProvider();
    await expect(
      provider.putObject({ key: "exports/t1/job-1.csv", body: Buffer.from(""), contentType: "text/csv" }),
    ).rejects.toThrow(/credentials not configured/);
  });

  it("head throws with a clear message when unconfigured", async () => {
    const provider = new S3StorageProvider();
    await expect(provider.head({ key: TEST_KEY })).rejects.toThrow(
      /credentials not configured/,
    );
  });

  it("SECURITY: no URL is returned when unconfigured (call throws, not returns noop URL)", async () => {
    const provider = new S3StorageProvider();
    let resultUrl: string | undefined;
    try {
      const r = await provider.getSignedDownloadUrl({ key: TEST_KEY });
      resultUrl = r.url;
    } catch {
      // expected
    }
    expect(resultUrl).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 6: S3StorageProvider — with mocked SDK
// ─────────────────────────────────────────────────────────────────────────────

describe("S3StorageProvider — with mocked SDK", () => {
  const TEST_KEY = "submissions/tenant-1/enroll-1/uuid-abc.pdf";
  const TEST_CONTENT_TYPE = "application/pdf";
  const TEST_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
  const TEST_TTL = 300;

  beforeEach(() => {
    __resetEnvCacheForTests();
    setTestEnvStorage();
    jest.clearAllMocks();
  });

  afterEach(() => {
    clearTestEnv();
    __resetEnvCacheForTests();
    jest.clearAllMocks();
  });

  // ─── getSignedUploadUrl ──────────────────────────────────────────────────

  describe("getSignedUploadUrl", () => {
    it("returns the mocked presigned URL from getSignedUrl", async () => {
      const provider = new S3StorageProvider();
      const result = await provider.getSignedUploadUrl({
        key: TEST_KEY,
        contentType: TEST_CONTENT_TYPE,
        maxBytes: TEST_MAX_BYTES,
        ttlSeconds: TEST_TTL,
      });
      expect(result.url).toBe(FAKE_PRESIGNED_URL);
    });

    it("storageKey echoes the input key", async () => {
      const provider = new S3StorageProvider();
      const result = await provider.getSignedUploadUrl({
        key: TEST_KEY,
        contentType: TEST_CONTENT_TYPE,
        maxBytes: TEST_MAX_BYTES,
      });
      expect(result.storageKey).toBe(TEST_KEY);
    });

    it("expiresAt is approximately now + ttlSeconds", async () => {
      const provider = new S3StorageProvider();
      const beforeMs = Date.now();
      const result = await provider.getSignedUploadUrl({
        key: TEST_KEY,
        contentType: TEST_CONTENT_TYPE,
        maxBytes: TEST_MAX_BYTES,
        ttlSeconds: TEST_TTL,
      });
      const afterMs = Date.now();

      const expMs = result.expiresAt.getTime();
      expect(expMs).toBeGreaterThanOrEqual(beforeMs + TEST_TTL * 1000 - 1000);
      expect(expMs).toBeLessThanOrEqual(afterMs + TEST_TTL * 1000 + 1000);
    });

    it("requiredHeaders['Content-Type'] matches the input contentType", async () => {
      const provider = new S3StorageProvider();
      const result = await provider.getSignedUploadUrl({
        key: TEST_KEY,
        contentType: TEST_CONTENT_TYPE,
        maxBytes: TEST_MAX_BYTES,
      });
      expect(result.requiredHeaders["Content-Type"]).toBe(TEST_CONTENT_TYPE);
    });

    it("calls getSignedUrl exactly once per upload", async () => {
      const provider = new S3StorageProvider();
      await provider.getSignedUploadUrl({
        key: TEST_KEY,
        contentType: TEST_CONTENT_TYPE,
        maxBytes: TEST_MAX_BYTES,
      });
      expect(getSignedUrl).toHaveBeenCalledTimes(1);
    });

    it("rejects keys that fail validateStorageKey (e.g. path traversal)", async () => {
      const provider = new S3StorageProvider();
      await expect(
        provider.getSignedUploadUrl({
          key: "submissions/t1/../secrets",
          contentType: TEST_CONTENT_TYPE,
          maxBytes: TEST_MAX_BYTES,
        }),
      ).rejects.toThrow(/path traversal/);
    });

    it("SECURITY: credentials do not appear in the returned URL", async () => {
      const provider = new S3StorageProvider();
      const result = await provider.getSignedUploadUrl({
        key: TEST_KEY,
        contentType: TEST_CONTENT_TYPE,
        maxBytes: TEST_MAX_BYTES,
      });
      // The mocked URL is the FAKE_PRESIGNED_URL; assert it doesn't contain raw credentials.
      expect(result.url).not.toContain("test-secret-access-key");
      expect(result.url).not.toContain("test-access-key-id");
    });
  });

  // ─── getSignedDownloadUrl ────────────────────────────────────────────────

  describe("getSignedDownloadUrl", () => {
    it("returns the mocked presigned URL", async () => {
      const provider = new S3StorageProvider();
      const result = await provider.getSignedDownloadUrl({ key: TEST_KEY });
      expect(result.url).toBe(FAKE_PRESIGNED_URL);
    });

    it("expiresAt is approximately now + DEFAULT_STORAGE_DOWNLOAD_TTL_SECONDS", async () => {
      const provider = new S3StorageProvider();
      const beforeMs = Date.now();
      const result = await provider.getSignedDownloadUrl({ key: TEST_KEY });
      const afterMs = Date.now();

      const expMs = result.expiresAt.getTime();
      expect(expMs).toBeGreaterThanOrEqual(
        beforeMs + DEFAULT_STORAGE_DOWNLOAD_TTL_SECONDS * 1000 - 1000,
      );
      expect(expMs).toBeLessThanOrEqual(
        afterMs + DEFAULT_STORAGE_DOWNLOAD_TTL_SECONDS * 1000 + 1000,
      );
    });

    it("rejects keys that contain '..'", async () => {
      const provider = new S3StorageProvider();
      await expect(
        provider.getSignedDownloadUrl({ key: "certificates/t1/../../etc/passwd" }),
      ).rejects.toThrow(/path traversal/);
    });
  });

  // ─── putObject ───────────────────────────────────────────────────────────

  describe("putObject", () => {
    it("calls S3Client.send with a PutObjectCommand carrying Body + ContentType", async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { __mockSend } = require("@aws-sdk/client-s3") as { __mockSend: jest.Mock };
      __mockSend.mockResolvedValueOnce({});

      const provider = new S3StorageProvider();
      const body = Buffer.from("a,b\n1,2\n");
      await expect(
        provider.putObject({ key: "exports/tenant-1/job-1.csv", body, contentType: "text/csv" }),
      ).resolves.toBeUndefined();

      expect(__mockSend).toHaveBeenCalledTimes(1);
      const command = __mockSend.mock.calls[0]![0] as { input: Record<string, unknown> };
      expect(command.input.Body).toBe(body);
      expect(command.input.ContentType).toBe("text/csv");
      expect(command.input.Key).toBe("exports/tenant-1/job-1.csv");
    });

    it("rejects keys with path traversal", async () => {
      const provider = new S3StorageProvider();
      await expect(
        provider.putObject({ key: "exports/t1/../escape.csv", body: Buffer.from(""), contentType: "text/csv" }),
      ).rejects.toThrow(/path traversal/);
    });
  });

  // ─── delete ──────────────────────────────────────────────────────────────

  describe("delete", () => {
    it("calls S3Client.send without throwing for a valid key", async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { __mockSend } = require("@aws-sdk/client-s3") as { __mockSend: jest.Mock };
      __mockSend.mockResolvedValueOnce({});

      const provider = new S3StorageProvider();
      await expect(provider.delete({ key: TEST_KEY })).resolves.toBeUndefined();
      expect(__mockSend).toHaveBeenCalledTimes(1);
    });

    it("rejects keys with path traversal", async () => {
      const provider = new S3StorageProvider();
      await expect(
        provider.delete({ key: "submissions/t1/../escape" }),
      ).rejects.toThrow(/path traversal/);
    });
  });

  // ─── head ────────────────────────────────────────────────────────────────

  describe("head", () => {
    it("returns exists=true with size and contentType on success", async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { __mockSend } = require("@aws-sdk/client-s3") as { __mockSend: jest.Mock };
      __mockSend.mockResolvedValueOnce({
        ContentLength: 8192,
        ContentType: "application/pdf",
      });

      const provider = new S3StorageProvider();
      const result = await provider.head({ key: TEST_KEY });
      expect(result.exists).toBe(true);
      expect(result.size).toBe(8192);
      expect(result.contentType).toBe("application/pdf");
    });

    it("returns exists=false on S3 404", async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { __mockSend, S3ServiceException } = require("@aws-sdk/client-s3") as {
        __mockSend: jest.Mock;
        S3ServiceException: new (msg: string, meta?: { httpStatusCode?: number }) => Error & { $metadata: { httpStatusCode?: number }; name: string };
      };
      const notFoundErr = new S3ServiceException("Not Found", { httpStatusCode: 404 });
      __mockSend.mockRejectedValueOnce(notFoundErr);

      const provider = new S3StorageProvider();
      const result = await provider.head({ key: TEST_KEY });
      expect(result.exists).toBe(false);
    });

    it("rethrows non-404 S3 errors", async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { __mockSend, S3ServiceException } = require("@aws-sdk/client-s3") as {
        __mockSend: jest.Mock;
        S3ServiceException: new (msg: string, meta?: { httpStatusCode?: number }) => Error & { $metadata: { httpStatusCode?: number }; name: string };
      };
      const serverErr = new S3ServiceException("Internal Server Error", { httpStatusCode: 500 });
      __mockSend.mockRejectedValueOnce(serverErr);

      const provider = new S3StorageProvider();
      await expect(provider.head({ key: TEST_KEY })).rejects.toThrow("Internal Server Error");
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite: public/private bucket split (STORAGE_PUBLIC_BUCKET)
//
// R2 grants public read access per BUCKET, not per prefix. To put course images
// behind a CDN without also exposing `submissions/`, `exports/`, `invoices/`,
// `receipts/` and `careers/`, the four publicly-rendered image namespaces are
// routed to a separate bucket. These tests pin WHICH namespaces cross that line —
// a regression here is a data-exposure bug, not a cosmetic one.
// ─────────────────────────────────────────────────────────────────────────────

describe("S3StorageProvider — public/private bucket split", () => {
  const PRIVATE_BUCKET = "test-bucket"; // STORAGE_ENV.STORAGE_BUCKET
  const PUBLIC_BUCKET = "test-public-bucket";

  const PUBLIC_KEYS = [
    "program_images/tenant-1/uuid-a-card.jpg",
    "marketing_images/tenant-1/uuid-b-hero.png",
    "mentor_photos/tenant-1/uuid-c-photo.jpg",
    "college_logos/tenant-1/uuid-d-logo.png",
  ];

  // Everything a public bucket must NEVER hold. `receipts/` and `careers/` are the
  // subtle ones: both are marketing-adjacent but carry payment and applicant PII,
  // and receipts have deterministic keys, so they are not even guess-resistant.
  const PRIVATE_KEYS = [
    "submissions/tenant-1/enroll-1/uuid-e.pdf",
    "exports/tenant-1/job-1.csv",
    "invoices/tenant-1/inv-1.pdf",
    "receipts/tenant-1/pay-1.pdf",
    "careers/tenant-1/uuid-f-resume.pdf",
    "certificates/tenant-1/cert-1.pdf",
    "resources/tenant-1/lesson-1/uuid-g.pdf",
  ];

  /** Bucket the presigner was handed for `key`. */
  async function bucketForUpload(key: string): Promise<unknown> {
    const provider = new S3StorageProvider();
    await provider.getSignedUploadUrl({ key, contentType: "application/octet-stream", maxBytes: 1024 });
    const mockedGetSignedUrl = getSignedUrl as unknown as jest.Mock;
    const command = mockedGetSignedUrl.mock.calls.at(-1)?.[1] as { input: { Bucket: string } };
    return command.input.Bucket;
  }

  afterEach(() => {
    clearTestEnv();
    __resetEnvCacheForTests();
    jest.clearAllMocks();
  });

  describe("with STORAGE_PUBLIC_BUCKET configured", () => {
    beforeEach(() => {
      __resetEnvCacheForTests();
      setTestEnvStorage({ STORAGE_PUBLIC_BUCKET: PUBLIC_BUCKET });
      jest.clearAllMocks();
    });

    it.each(PUBLIC_KEYS)("routes %s to the PUBLIC bucket", async (key) => {
      await expect(bucketForUpload(key)).resolves.toBe(PUBLIC_BUCKET);
    });

    it.each(PRIVATE_KEYS)("keeps %s in the PRIVATE bucket", async (key) => {
      await expect(bucketForUpload(key)).resolves.toBe(PRIVATE_BUCKET);
    });

    it("signs downloads against the same bucket it uploads to", async () => {
      const provider = new S3StorageProvider();
      const mockedGetSignedUrl = getSignedUrl as unknown as jest.Mock;

      await provider.getSignedDownloadUrl({ key: PUBLIC_KEYS[0]! });
      const publicDownload = mockedGetSignedUrl.mock.calls.at(-1)?.[1] as { input: { Bucket: string } };
      expect(publicDownload.input.Bucket).toBe(PUBLIC_BUCKET);

      await provider.getSignedDownloadUrl({ key: PRIVATE_KEYS[0]! });
      const privateDownload = mockedGetSignedUrl.mock.calls.at(-1)?.[1] as { input: { Bucket: string } };
      expect(privateDownload.input.Bucket).toBe(PRIVATE_BUCKET);
    });

    it("does not treat a private namespace that merely CONTAINS a public one as public", async () => {
      // Guards against a substring match replacing the prefix match.
      await expect(bucketForUpload("submissions/tenant-1/program_images/uuid-h.pdf")).resolves.toBe(
        PRIVATE_BUCKET,
      );
    });
  });

  describe("without STORAGE_PUBLIC_BUCKET (default, unchanged behaviour)", () => {
    beforeEach(() => {
      __resetEnvCacheForTests();
      setTestEnvStorage();
      jest.clearAllMocks();
    });

    it.each([...PUBLIC_KEYS, ...PRIVATE_KEYS])("routes %s to the single bucket", async (key) => {
      await expect(bucketForUpload(key)).resolves.toBe(PRIVATE_BUCKET);
    });
  });
});
