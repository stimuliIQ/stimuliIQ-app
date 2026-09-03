// apps/api/src/modules/lms/providers/video/video-provider.spec.ts
//
// Unit tests for the VideoProvider adapters:
//   - NoopVideoProvider (deterministic fake URLs, HMAC webhook verification, parseTranscodeEvent)
//   - CloudflareStreamVideoProvider (signed HLS via mocked jose, webhook sig, parseTranscodeEvent)
//   - MuxVideoProvider (signed HLS via mocked jose, webhook sig, parseTranscodeEvent)
//   - parseCloudflareWebhookSignatureHeader / parseMuxWebhookSignatureHeader helpers
//   - timingSafeEqualHex helper
//
// Test strategy (docs/plans/phase-3.md task #4 DoD, CLAUDE.md §3.10):
//   - All tests are UNIT, no live network calls, no real Cloudflare/Mux credentials.
//   - jose's SignJWT + importPKCS8 are mocked (the unit suite routes jose through
//     test/unit-mocks/jose.ts via moduleNameMapper in jest.config.js; the per-suite
//     jest.mock() below installs a controllable mock on top of that).
//   - node:crypto (createHmac, timingSafeEqual) is the REAL implementation, HMAC
//     correctness is truly tested, not faked.
//   - Tests cover:
//       1. Noop: mintSignedHlsUrl, deterministic URL shape + expiry (no secrets in output).
//       2. Noop: verifyWebhookSignature, correct/incorrect/absent-secret fail-closed.
//       3. Noop: parseTranscodeEvent, noop / CF-like / Mux-like / unknown payload.
//       4. Noop: createUploadTarget, deterministic fake output.
//       5. Noop: makeWebhookSignature / buildExpectedUrl static helpers.
//       6. CF: mintSignedHlsUrl, mocked jose produces a JWT; URL has correct format;
//          NO signing key / raw URL in output.
//       7. CF: verifyWebhookSignature, correct/incorrect/absent-secret/malformed-header.
//       8. CF: parseTranscodeEvent, ready/errored/processing/null (non-CF) payloads.
//       9. CF: constructor does NOT throw when keys are absent; mintSignedHlsUrl throws lazily.
//      10. Mux: mintSignedHlsUrl, mocked jose; signed URL appends token query param.
//      11. Mux: verifyWebhookSignature, correct/incorrect/absent-secret/malformed-header.
//      12. Mux: parseTranscodeEvent, ready/errored/processing/null payloads.
//      13. Mux: constructor does NOT throw when keys are absent; mintSignedHlsUrl throws lazily.
//      14. Helper: parseCloudflareWebhookSignatureHeader, valid/invalid/missing.
//      15. Helper: parseMuxWebhookSignatureHeader, valid/invalid/missing.
//      16. Helper: timingSafeEqualHex, equal/unequal/different-length.
//
// Secrets invariant: no real Cloudflare or Mux secrets are used; test constants are
// clearly labelled as test-only and are NEVER asserted to appear in return values.

import { createHmac } from "node:crypto";
import { __resetEnvCacheForTests } from "../../../../config/env";

// ─────────────────────────────────────────────────────────────────────────────
// Mock jose (SignJWT + importPKCS8) at the unit-test level.
// The per-module mock overrides the test/unit-mocks/jose.ts stub already applied
// via jest.config.js moduleNameMapper. We install a controllable mock here so we can:
//   a) Assert that SignJWT.sign() was called with correct claims.
//   b) Control the returned token string (FAKE_JWT_TOKEN).
//   c) Assert the signing private key is never in any return value.
// importPKCS8 returns a stable fake CryptoKey object (no real RS256 key needed).
// ─────────────────────────────────────────────────────────────────────────────

const FAKE_JWT_TOKEN = "fake.jwt.token.for.testing";

// We declare the mock before imports so jest.mock is hoisted.
jest.mock("jose", () => {
  const mockSign = jest.fn().mockResolvedValue(FAKE_JWT_TOKEN);

  class MockSignJWT {
    private _payload: Record<string, unknown> = {};
    private _header: Record<string, unknown> = {};
    private _iat?: number;
    private _nbf?: number;
    private _exp?: number;

    constructor(payload: Record<string, unknown>) {
      this._payload = payload;
    }
    setProtectedHeader(h: Record<string, unknown>) {
      this._header = h;
      return this;
    }
    setIssuedAt(v?: number) {
      this._iat = v;
      return this;
    }
    setNotBefore(v?: number) {
      this._nbf = v;
      return this;
    }
    setExpirationTime(v?: number) {
      this._exp = v;
      return this;
    }
    setSubject(s: string) {
      this._payload["sub"] = s;
      return this;
    }
    setIssuer(s: string) {
      this._payload["iss"] = s;
      return this;
    }
    setJti(s: string) {
      this._payload["jti"] = s;
      return this;
    }
    // Expose the captured arguments on the mock so tests can inspect them.
    sign(key: unknown) {
      return mockSign(key, {
        payload: this._payload,
        header: this._header,
        iat: this._iat,
        nbf: this._nbf,
        exp: this._exp,
      });
    }
  }

  return {
    SignJWT: MockSignJWT,
    importPKCS8: jest.fn().mockResolvedValue({ type: "private" }), // fake CryptoKey
    importSPKI: jest.fn().mockResolvedValue({ type: "public" }),
    jwtVerify: jest.fn().mockResolvedValue({ payload: {} }),
  };
});

// ─── Import providers AFTER jest.mock() is hoisted ───────────────────────────
import { Test } from "@nestjs/testing";
import type { StorageProvider } from "../../../storage/providers/storage/storage-provider.interface";
import { NoopVideoProvider, DEFAULT_NOOP_WEBHOOK_SECRET } from "./noop-video.provider";
import {
  CloudflareStreamVideoProvider,
  parseCloudflareWebhookSignatureHeader,
  timingSafeEqualHex,
} from "./cloudflare-stream-video.provider";
import { MuxVideoProvider, parseMuxWebhookSignatureHeader } from "./mux-video.provider";
import { DEFAULT_HLS_TTL_SECONDS, VIDEO_PROVIDER } from "./video-provider.interface";
import { VideoProviderModule } from "./video-provider.module";

// ─────────────────────────────────────────────────────────────────────────────
// Test constants (never real values)
// ─────────────────────────────────────────────────────────────────────────────

const TEST_ASSET_ID = "test-asset-uid-abc123";
const TEST_USER_ID = "user-uuid-00000001";
const TEST_LESSON_ID = "lesson-uuid-00000001";
const TEST_TTL = 300;

// A minimal valid-looking PKCS#8 PEM header, not a real key, just enough for
// the env var check to think a key is present. importPKCS8 is mocked anyway.
const FAKE_PEM = "-----BEGIN PRIVATE KEY-----\nZmFrZWtleQ==\n-----END PRIVATE KEY-----";
const FAKE_KEY_ID = "test-signing-key-id";
const FAKE_CF_ACCOUNT_ID = "test-cf-account-id";
const FAKE_CF_API_TOKEN = "test-cf-api-token";
const FAKE_CF_WEBHOOK_SECRET = "test-cf-webhook-secret-32-chars!!";
const FAKE_MUX_TOKEN_ID = "test-mux-token-id";
const FAKE_MUX_TOKEN_SECRET = "test-mux-token-secret";
const FAKE_MUX_WEBHOOK_SECRET = "test-mux-webhook-secret-32-chars!";

// ─────────────────────────────────────────────────────────────────────────────
// Env setup helpers
// ─────────────────────────────────────────────────────────────────────────────

const REQUIRED_ENV: Record<string, string> = {
  DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  REDIS_URL: "redis://localhost:6379",
  JWT_PRIVATE_KEY_PATH: "./keys/jwt-private.pem",
  JWT_PUBLIC_KEY_PATH: "./keys/jwt-public.pem",
  COOKIE_SECRET: "test-cookie-secret-at-least-32-chars-long!!",
  CSRF_SECRET: "test-csrf-secret-at-least-32-chars-long!!!",
  // Coherent PRODUCTION values. `validateEnv` requires these once NODE_ENV/APP_ENV is
  // "production" — a session cookie issued without Secure, or scoped to localhost, is a
  // real misconfiguration, so the boot refuses it. Cases below that exercise a
  // production boot guard would otherwise fail on env validation before reaching the
  // guard under test.
  COOKIE_SECURE: "true",
  COOKIE_DOMAIN: ".stimuliiq.test",
};

function setTestEnvCf(overrides: Record<string, string | undefined> = {}): void {
  Object.assign(process.env, {
    ...REQUIRED_ENV,
    VIDEO_PROVIDER: "cloudflare_stream",
    CLOUDFLARE_ACCOUNT_ID: FAKE_CF_ACCOUNT_ID,
    CLOUDFLARE_STREAM_API_TOKEN: FAKE_CF_API_TOKEN,
    CLOUDFLARE_STREAM_SIGNING_KEY_ID: FAKE_KEY_ID,
    CLOUDFLARE_STREAM_SIGNING_KEY_PEM: FAKE_PEM,
    CLOUDFLARE_STREAM_WEBHOOK_SECRET: FAKE_CF_WEBHOOK_SECRET,
    ...overrides,
  });
}

function setTestEnvMux(overrides: Record<string, string | undefined> = {}): void {
  Object.assign(process.env, {
    ...REQUIRED_ENV,
    VIDEO_PROVIDER: "mux",
    MUX_TOKEN_ID: FAKE_MUX_TOKEN_ID,
    MUX_TOKEN_SECRET: FAKE_MUX_TOKEN_SECRET,
    MUX_SIGNING_KEY_ID: FAKE_KEY_ID,
    MUX_SIGNING_KEY_PRIVATE: FAKE_PEM,
    MUX_WEBHOOK_SECRET: FAKE_MUX_WEBHOOK_SECRET,
    ...overrides,
  });
}

// Storage creds so the VideoProviderModule's imported StorageProviderModule binds a
// (lazy) S3StorageProvider rather than boot-throwing on noop, isolates the boot-guard
// tests below to the VIDEO_PROVIDER selector alone.
const STORAGE_KEYS: Record<string, string> = {
  STORAGE_PROVIDER: "r2",
  STORAGE_BUCKET: "test-bucket",
  STORAGE_REGION: "auto",
  STORAGE_ACCESS_KEY_ID: "test-akid",
  STORAGE_SECRET_ACCESS_KEY: "test-secret",
  STORAGE_ENDPOINT: "https://test.r2.cloudflarestorage.com",
};

/**
 * Boot the real VideoProviderModule through NestJS DI exactly as app boot does, with a
 * controlled env, then resolve the VIDEO_PROVIDER token (which runs the factory guard).
 * Restores process.env afterwards. Mirrors live-class-provider.spec.ts's bootWith.
 */
async function bootVideoModuleWith(env: Record<string, string | undefined>): Promise<void> {
  const previous = { ...process.env };
  for (const k of [
    "VIDEO_PROVIDER",
    "CLOUDFLARE_ACCOUNT_ID",
    "CLOUDFLARE_STREAM_SIGNING_KEY_ID",
    "CLOUDFLARE_STREAM_SIGNING_KEY_PEM",
    "MUX_TOKEN_ID",
    "MUX_TOKEN_SECRET",
    "MUX_SIGNING_KEY_ID",
    "MUX_SIGNING_KEY_PRIVATE",
  ]) {
    delete process.env[k];
  }
  Object.assign(process.env, REQUIRED_ENV, STORAGE_KEYS, env);
  __resetEnvCacheForTests();
  try {
    const moduleRef = await Test.createTestingModule({
      imports: [VideoProviderModule],
    }).compile();
    moduleRef.get(VIDEO_PROVIDER);
    await moduleRef.close();
  } finally {
    process.env = previous;
    __resetEnvCacheForTests();
  }
}

function clearTestEnv(): void {
  const keysToDelete = [
    ...Object.keys(REQUIRED_ENV),
    "VIDEO_PROVIDER",
    "CLOUDFLARE_ACCOUNT_ID",
    "CLOUDFLARE_STREAM_API_TOKEN",
    "CLOUDFLARE_STREAM_SIGNING_KEY_ID",
    "CLOUDFLARE_STREAM_SIGNING_KEY_PEM",
    "CLOUDFLARE_STREAM_WEBHOOK_SECRET",
    "MUX_TOKEN_ID",
    "MUX_TOKEN_SECRET",
    "MUX_SIGNING_KEY_ID",
    "MUX_SIGNING_KEY_PRIVATE",
    "MUX_WEBHOOK_SECRET",
  ];
  for (const k of keysToDelete) {
    delete process.env[k];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HMAC helpers (mirrors production logic for fixture generation)
// ─────────────────────────────────────────────────────────────────────────────

/** Build a Cloudflare-style webhook signature header value: "time=<ts>,sig1=<hex>" */
function makeCfWebhookSigHeader(rawBody: string | Buffer, secret: string, time: string): string {
  const bodyStr = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : rawBody;
  const source = `${time}.${bodyStr}`;
  const hex = createHmac("sha256", secret).update(source, "utf8").digest("hex");
  return `time=${time},sig1=${hex}`;
}

/** Build a Mux-style webhook signature header value: "t=<ts>,v1=<hex>" */
function makeMuxWebhookSigHeader(rawBody: string | Buffer, secret: string, ts: string): string {
  const bodyStr = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : rawBody;
  const source = `${ts}.${bodyStr}`;
  const hex = createHmac("sha256", secret).update(source, "utf8").digest("hex");
  return `t=${ts},v1=${hex}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1: Helper functions
// ─────────────────────────────────────────────────────────────────────────────

describe("timingSafeEqualHex", () => {
  it("returns true for identical hex strings", () => {
    const h = "a".repeat(64);
    expect(timingSafeEqualHex(h, h)).toBe(true);
  });

  it("returns false for strings with same length but different content", () => {
    const a = "a".repeat(64);
    const b = "b".repeat(64);
    expect(timingSafeEqualHex(a, b)).toBe(false);
  });

  it("returns false when lengths differ (shorter b)", () => {
    expect(timingSafeEqualHex("a".repeat(64), "a".repeat(32))).toBe(false);
  });

  it("returns false when lengths differ (longer b)", () => {
    expect(timingSafeEqualHex("a".repeat(32), "a".repeat(64))).toBe(false);
  });

  it("returns true for empty strings", () => {
    expect(timingSafeEqualHex("", "")).toBe(true);
  });
});

describe("parseCloudflareWebhookSignatureHeader", () => {
  it("parses a valid header", () => {
    const result = parseCloudflareWebhookSignatureHeader(
      "time=1230811200,sig1=60493ec9388b44585",
    );
    expect(result).toEqual({ time: "1230811200", sig1: "60493ec9388b44585" });
  });

  it("returns null for null input", () => {
    expect(parseCloudflareWebhookSignatureHeader(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(parseCloudflareWebhookSignatureHeader(undefined)).toBeNull();
  });

  it("returns null when sig1 is missing", () => {
    expect(parseCloudflareWebhookSignatureHeader("time=12345")).toBeNull();
  });

  it("returns null when time is missing", () => {
    expect(parseCloudflareWebhookSignatureHeader("sig1=abcdef")).toBeNull();
  });

  it("handles extra whitespace around parts", () => {
    const result = parseCloudflareWebhookSignatureHeader(
      " time=1111 , sig1=aaaa ",
    );
    expect(result).toEqual({ time: "1111", sig1: "aaaa" });
  });
});

describe("parseMuxWebhookSignatureHeader", () => {
  it("parses a valid header", () => {
    const result = parseMuxWebhookSignatureHeader(
      "t=1565220904,v1=20c75c1180c701ee8a796e81507cfd5c",
    );
    expect(result).toEqual({
      timestamp: "1565220904",
      v1: "20c75c1180c701ee8a796e81507cfd5c",
    });
  });

  it("returns null for null input", () => {
    expect(parseMuxWebhookSignatureHeader(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(parseMuxWebhookSignatureHeader(undefined)).toBeNull();
  });

  it("returns null when v1 is missing", () => {
    expect(parseMuxWebhookSignatureHeader("t=12345")).toBeNull();
  });

  it("returns null when t is missing", () => {
    expect(parseMuxWebhookSignatureHeader("v1=abcdef")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2: NoopVideoProvider
// ─────────────────────────────────────────────────────────────────────────────

describe("NoopVideoProvider", () => {
  let provider: NoopVideoProvider;

  beforeEach(() => {
    provider = new NoopVideoProvider();
  });

  // ─── mintSignedHlsUrl ───────────────────────────────────────────────────────

  describe("mintSignedHlsUrl", () => {
    it("returns a URL containing the assetId, userId, and lessonId", async () => {
      const result = await provider.mintSignedHlsUrl({
        assetId: TEST_ASSET_ID,
        userId: TEST_USER_ID,
        lessonId: TEST_LESSON_ID,
        ttlSeconds: TEST_TTL,
      });

      expect(result.url).toContain(encodeURIComponent(TEST_ASSET_ID));
      expect(result.url).toContain(TEST_USER_ID);
      expect(result.url).toContain(TEST_LESSON_ID);
      expect(result.url).toMatch(/^https:\/\/noop\.video\.local\/hls\//);
      expect(result.url).toMatch(/\?token=noop-signed-/);
    });

    it("provider field is 'noop'", async () => {
      const result = await provider.mintSignedHlsUrl({
        assetId: TEST_ASSET_ID,
        userId: TEST_USER_ID,
        lessonId: TEST_LESSON_ID,
      });
      expect(result.provider).toBe("noop");
    });

    it("expiresAt is approximately now + ttlSeconds", async () => {
      const beforeMs = Date.now();
      const result = await provider.mintSignedHlsUrl({
        assetId: TEST_ASSET_ID,
        userId: TEST_USER_ID,
        lessonId: TEST_LESSON_ID,
        ttlSeconds: TEST_TTL,
      });
      const afterMs = Date.now();

      const expMs = result.expiresAt.getTime();
      expect(expMs).toBeGreaterThanOrEqual(beforeMs + TEST_TTL * 1000 - 1000);
      expect(expMs).toBeLessThanOrEqual(afterMs + TEST_TTL * 1000 + 1000);
    });

    it("uses DEFAULT_HLS_TTL_SECONDS when ttlSeconds is omitted", async () => {
      const beforeMs = Date.now();
      const result = await provider.mintSignedHlsUrl({
        assetId: TEST_ASSET_ID,
        userId: TEST_USER_ID,
        lessonId: TEST_LESSON_ID,
        // no ttlSeconds
      });
      const afterMs = Date.now();

      const expMs = result.expiresAt.getTime();
      expect(expMs).toBeGreaterThanOrEqual(beforeMs + DEFAULT_HLS_TTL_SECONDS * 1000 - 1000);
      expect(expMs).toBeLessThanOrEqual(afterMs + DEFAULT_HLS_TTL_SECONDS * 1000 + 1000);
    });

    it("is DETERMINISTIC, same inputs at same second produce same URL (no randomness)", async () => {
      // Freeze time so the expS is the same for both calls within the same second.
      const nowS = Math.floor(Date.now() / 1000);
      const expS = nowS + TEST_TTL;
      const expectedUrl = NoopVideoProvider.buildExpectedUrl(
        TEST_ASSET_ID,
        TEST_USER_ID,
        TEST_LESSON_ID,
        expS,
      );

      const result = await provider.mintSignedHlsUrl({
        assetId: TEST_ASSET_ID,
        userId: TEST_USER_ID,
        lessonId: TEST_LESSON_ID,
        ttlSeconds: TEST_TTL,
      });

      // The expS in the actual URL must match what buildExpectedUrl computes for the SAME second.
      // We allow the current second OR the next second (in case the test crosses a second boundary).
      const alternativeUrl = NoopVideoProvider.buildExpectedUrl(
        TEST_ASSET_ID,
        TEST_USER_ID,
        TEST_LESSON_ID,
        expS + 1, // in case we crossed a second boundary
      );
      expect([expectedUrl, alternativeUrl]).toContain(result.url);
    });

    it("different users produce different URLs (per-user scoping)", async () => {
      const [r1, r2] = await Promise.all([
        provider.mintSignedHlsUrl({ assetId: TEST_ASSET_ID, userId: "user-A", lessonId: TEST_LESSON_ID }),
        provider.mintSignedHlsUrl({ assetId: TEST_ASSET_ID, userId: "user-B", lessonId: TEST_LESSON_ID }),
      ]);
      expect(r1.url).not.toBe(r2.url);
      expect(r1.url).toContain("user-A");
      expect(r2.url).toContain("user-B");
    });

    it("SECURITY: signing key material never appears in the URL or result", async () => {
      // The Noop has no real signing key, but ensure no secret-looking values leak.
      const result = await provider.mintSignedHlsUrl({
        assetId: TEST_ASSET_ID,
        userId: TEST_USER_ID,
        lessonId: TEST_LESSON_ID,
      });
      expect(JSON.stringify(result)).not.toContain(DEFAULT_NOOP_WEBHOOK_SECRET);
    });
  });

  // ─── verifyWebhookSignature ─────────────────────────────────────────────────

  describe("verifyWebhookSignature", () => {
    const RAW_BODY = '{"uid":"asset-123","readyToStream":true}';

    it("returns true for a correct HMAC-SHA256 signature (string body)", () => {
      const sig = NoopVideoProvider.makeWebhookSignature(RAW_BODY);
      expect(provider.verifyWebhookSignature({ rawBody: RAW_BODY, signatureHeader: sig })).toBe(true);
    });

    it("returns true for a correct HMAC-SHA256 signature (Buffer body)", () => {
      const rawBodyBuf = Buffer.from(RAW_BODY, "utf8");
      const sig = NoopVideoProvider.makeWebhookSignature(rawBodyBuf);
      expect(provider.verifyWebhookSignature({ rawBody: rawBodyBuf, signatureHeader: sig })).toBe(true);
    });

    it("returns false for an incorrect signature", () => {
      const wrongSig = NoopVideoProvider.makeWebhookSignature(RAW_BODY, "wrong-secret");
      expect(provider.verifyWebhookSignature({ rawBody: RAW_BODY, signatureHeader: wrongSig })).toBe(false);
    });

    it("returns false for a tampered body", () => {
      const sig = NoopVideoProvider.makeWebhookSignature(RAW_BODY);
      const tampered = RAW_BODY.replace("true", "false");
      expect(provider.verifyWebhookSignature({ rawBody: tampered, signatureHeader: sig })).toBe(false);
    });

    it("FAIL CLOSED, returns false when simulateWebhookSecretAbsent=true", () => {
      const failClosedProvider = new NoopVideoProvider({ simulateWebhookSecretAbsent: true });
      const sig = NoopVideoProvider.makeWebhookSignature(RAW_BODY);
      expect(failClosedProvider.verifyWebhookSignature({ rawBody: RAW_BODY, signatureHeader: sig })).toBe(false);
    });

    it("does NOT throw when signature is absent, returns false", () => {
      expect(
        () => provider.verifyWebhookSignature({ rawBody: RAW_BODY, signatureHeader: "" }),
      ).not.toThrow();
      expect(provider.verifyWebhookSignature({ rawBody: RAW_BODY, signatureHeader: "" })).toBe(false);
    });
  });

  // ─── parseTranscodeEvent ───────────────────────────────────────────────────

  describe("parseTranscodeEvent", () => {
    it("parses a noop-specific 'ready' payload", () => {
      const result = provider.parseTranscodeEvent({
        noop: true,
        uid: "asset-001",
        status: "ready",
        duration: 120,
      });
      expect(result).toEqual({ providerAssetId: "asset-001", status: "ready", durationS: 120 });
    });

    it("parses a noop-specific 'errored' payload", () => {
      const result = provider.parseTranscodeEvent({
        noop: true,
        uid: "asset-002",
        status: "errored",
      });
      expect(result).toEqual({ providerAssetId: "asset-002", status: "errored", durationS: undefined });
    });

    it("parses a Cloudflare-like 'readyToStream=true' payload", () => {
      const result = provider.parseTranscodeEvent({
        uid: "cf-asset-xyz",
        readyToStream: true,
        state: "ready",
        duration: 90,
      });
      expect(result).toEqual({ providerAssetId: "cf-asset-xyz", status: "ready", durationS: 90 });
    });

    it("parses a Cloudflare-like 'error' state payload", () => {
      const result = provider.parseTranscodeEvent({
        uid: "cf-asset-err",
        readyToStream: false,
        state: "error",
      });
      expect(result).toEqual({ providerAssetId: "cf-asset-err", status: "errored", durationS: undefined });
    });

    it("parses a Mux-like 'video.asset.ready' payload", () => {
      const result = provider.parseTranscodeEvent({
        type: "video.asset.ready",
        object: { type: "asset", id: "mux-asset-abc" },
        data: { id: "mux-asset-abc", duration: 75.5, status: "ready" },
      });
      expect(result).toEqual({ providerAssetId: "mux-asset-abc", status: "ready", durationS: 76 });
    });

    it("parses a Mux-like 'video.asset.errored' payload", () => {
      const result = provider.parseTranscodeEvent({
        type: "video.asset.errored",
        object: { type: "asset", id: "mux-err-asset" },
        data: { id: "mux-err-asset" },
      });
      expect(result).toEqual({ providerAssetId: "mux-err-asset", status: "errored", durationS: undefined });
    });

    it("returns null for an unknown/unrelated payload", () => {
      expect(provider.parseTranscodeEvent({ foo: "bar" })).toBeNull();
      expect(provider.parseTranscodeEvent({})).toBeNull();
      expect(provider.parseTranscodeEvent({ type: "live.stream.active" })).toBeNull();
    });
  });

  // ─── createUploadTarget ────────────────────────────────────────────────────

  describe("createUploadTarget", () => {
    it("returns a fake upload URL and asset id without network calls", async () => {
      const result = await provider.createUploadTarget({});
      expect(result.uploadUrl).toMatch(/^https:\/\/noop\.video\.local\/upload\//);
      expect(result.providerAssetId).toMatch(/^noop-asset-/);
    });

    // The CRM ingest drawer PUTs the file straight at whatever URL we return, so with a
    // storage seam wired the URL must be a real, reachable signed target, `noop.video.local`
    // does not resolve and surfaced as "Network error during upload".
    it("mints a real signed upload URL from the storage seam when one is wired", async () => {
      const getSignedUploadUrl = jest.fn().mockResolvedValue({
        url: "http://localhost:4000/api/v1/storage/local/video/source/noop-asset-1?sig=abc&exp=123",
        storageKey: "video/source/noop-asset-1",
        expiresAt: new Date(),
      });
      const withStorage = new NoopVideoProvider({
        storage: { getSignedUploadUrl } as unknown as StorageProvider,
      });

      const result = await withStorage.createUploadTarget({ maxSizeBytes: 1234 });

      expect(result.uploadUrl).toBe(
        "http://localhost:4000/api/v1/storage/local/video/source/noop-asset-1?sig=abc&exp=123",
      );
      expect(result.providerAssetId).toMatch(/^noop-asset-/);
      expect(getSignedUploadUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          key: expect.stringMatching(/^video\/source\/noop-asset-/),
          maxBytes: 1234,
        }),
      );
    });
  });

  // ─── Static helpers ────────────────────────────────────────────────────────

  describe("makeWebhookSignature (static)", () => {
    it("produces a signature valid for verifyWebhookSignature with default secret", () => {
      const body = '{"test":"fixture"}';
      const sig = NoopVideoProvider.makeWebhookSignature(body);
      const p = new NoopVideoProvider();
      expect(p.verifyWebhookSignature({ rawBody: body, signatureHeader: sig })).toBe(true);
    });

    it("produces a signature that fails with a different secret", () => {
      const body = '{"test":"fixture"}';
      const sig = NoopVideoProvider.makeWebhookSignature(body, "secret-A");
      const p = new NoopVideoProvider({ webhookSecret: "secret-B" });
      expect(p.verifyWebhookSignature({ rawBody: body, signatureHeader: sig })).toBe(false);
    });
  });

  describe("buildExpectedUrl (static)", () => {
    it("produces a URL matching mintSignedHlsUrl output for the same expS", async () => {
      const ttl = 60;
      const nowS = Math.floor(Date.now() / 1000);
      const expS = nowS + ttl;
      const expected = NoopVideoProvider.buildExpectedUrl(TEST_ASSET_ID, TEST_USER_ID, TEST_LESSON_ID, expS);

      const result = await provider.mintSignedHlsUrl({
        assetId: TEST_ASSET_ID,
        userId: TEST_USER_ID,
        lessonId: TEST_LESSON_ID,
        ttlSeconds: ttl,
      });

      // Allow ±1 second for the test crossing a second boundary.
      const alt = NoopVideoProvider.buildExpectedUrl(TEST_ASSET_ID, TEST_USER_ID, TEST_LESSON_ID, expS + 1);
      expect([expected, alt]).toContain(result.url);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 3: CloudflareStreamVideoProvider
// ─────────────────────────────────────────────────────────────────────────────

describe("CloudflareStreamVideoProvider", () => {
  let provider: CloudflareStreamVideoProvider;

  beforeEach(() => {
    __resetEnvCacheForTests();
    setTestEnvCf();
    // Reset the jose mock between tests so call counts are clean.
    jest.clearAllMocks();
    provider = new CloudflareStreamVideoProvider();
  });

  afterEach(() => {
    clearTestEnv();
    __resetEnvCacheForTests();
  });

  // ─── mintSignedHlsUrl ───────────────────────────────────────────────────────

  describe("mintSignedHlsUrl", () => {
    it("returns a signed HLS URL with the CF customer subdomain format", async () => {
      const result = await provider.mintSignedHlsUrl({
        assetId: TEST_ASSET_ID,
        userId: TEST_USER_ID,
        lessonId: TEST_LESSON_ID,
        ttlSeconds: TEST_TTL,
      });

      expect(result.url).toMatch(
        /^https:\/\/customer-test-cf-account-id\.cloudflarestream\.com\/.+\/manifest\/video\.m3u8$/,
      );
    });

    it("embeds the JWT token (mocked) in the URL", async () => {
      const result = await provider.mintSignedHlsUrl({
        assetId: TEST_ASSET_ID,
        userId: TEST_USER_ID,
        lessonId: TEST_LESSON_ID,
        ttlSeconds: TEST_TTL,
      });

      expect(result.url).toContain(FAKE_JWT_TOKEN);
    });

    it("provider field is 'cloudflare_stream'", async () => {
      const result = await provider.mintSignedHlsUrl({
        assetId: TEST_ASSET_ID,
        userId: TEST_USER_ID,
        lessonId: TEST_LESSON_ID,
      });
      expect(result.provider).toBe("cloudflare_stream");
    });

    it("expiresAt is approximately now + ttlSeconds", async () => {
      const beforeMs = Date.now();
      const result = await provider.mintSignedHlsUrl({
        assetId: TEST_ASSET_ID,
        userId: TEST_USER_ID,
        lessonId: TEST_LESSON_ID,
        ttlSeconds: TEST_TTL,
      });
      const afterMs = Date.now();

      const expMs = result.expiresAt.getTime();
      expect(expMs).toBeGreaterThanOrEqual(beforeMs + TEST_TTL * 1000 - 1000);
      expect(expMs).toBeLessThanOrEqual(afterMs + TEST_TTL * 1000 + 1000);
    });

    it("SECURITY: signing key PEM is not in the returned URL or result", async () => {
      const result = await provider.mintSignedHlsUrl({
        assetId: TEST_ASSET_ID,
        userId: TEST_USER_ID,
        lessonId: TEST_LESSON_ID,
      });
      const serialised = JSON.stringify(result);
      expect(serialised).not.toContain(FAKE_PEM);
      expect(serialised).not.toContain(FAKE_CF_API_TOKEN);
      // Note: the JWT token itself IS in the URL (it's the signed credential, not the key)
    });

    it("SECURITY: API token is not in the returned URL or result", async () => {
      const result = await provider.mintSignedHlsUrl({
        assetId: TEST_ASSET_ID,
        userId: TEST_USER_ID,
        lessonId: TEST_LESSON_ID,
      });
      expect(JSON.stringify(result)).not.toContain(FAKE_CF_API_TOKEN);
    });

    it("SECURITY: result does not contain the assetId as a plain string (it's inside the JWT)", async () => {
      const result = await provider.mintSignedHlsUrl({
        assetId: TEST_ASSET_ID,
        userId: TEST_USER_ID,
        lessonId: TEST_LESSON_ID,
      });
      // The assetId is embedded in the JWT payload (signed, not raw), not in the URL path.
      // The JWT token in the URL is the FAKE_JWT_TOKEN (mocked), which doesn't contain assetId.
      expect(result.url).not.toContain(TEST_ASSET_ID);
    });

    it("calls importPKCS8 to load the signing key (lazy, first call only)", async () => {
      const { importPKCS8: mockImportPKCS8 } = await import("jose");
      const importMock = mockImportPKCS8 as jest.Mock;

      // First call, should trigger importPKCS8
      await provider.mintSignedHlsUrl({ assetId: TEST_ASSET_ID, userId: TEST_USER_ID, lessonId: TEST_LESSON_ID });
      expect(importMock).toHaveBeenCalledTimes(1);

      // Second call, key is memoized, importPKCS8 NOT called again
      await provider.mintSignedHlsUrl({ assetId: TEST_ASSET_ID, userId: TEST_USER_ID, lessonId: TEST_LESSON_ID });
      expect(importMock).toHaveBeenCalledTimes(1); // still 1
    });
  });

  // ─── Constructor, lazy validation ─────────────────────────────────────────

  describe("constructor, lazy validation (does NOT throw when keys absent)", () => {
    it("does NOT throw at construction when signing key is absent", () => {
      __resetEnvCacheForTests();
      setTestEnvCf({
        CLOUDFLARE_STREAM_SIGNING_KEY_ID: undefined,
        CLOUDFLARE_STREAM_SIGNING_KEY_PEM: undefined,
      });
      delete process.env["CLOUDFLARE_STREAM_SIGNING_KEY_ID"];
      delete process.env["CLOUDFLARE_STREAM_SIGNING_KEY_PEM"];
      __resetEnvCacheForTests();

      expect(() => new CloudflareStreamVideoProvider()).not.toThrow();
    });

    it("throws lazily at mintSignedHlsUrl when signing key is absent", async () => {
      __resetEnvCacheForTests();
      setTestEnvCf({
        CLOUDFLARE_STREAM_SIGNING_KEY_ID: undefined,
        CLOUDFLARE_STREAM_SIGNING_KEY_PEM: undefined,
      });
      delete process.env["CLOUDFLARE_STREAM_SIGNING_KEY_ID"];
      delete process.env["CLOUDFLARE_STREAM_SIGNING_KEY_PEM"];
      __resetEnvCacheForTests();

      const p = new CloudflareStreamVideoProvider();
      await expect(
        p.mintSignedHlsUrl({ assetId: TEST_ASSET_ID, userId: TEST_USER_ID, lessonId: TEST_LESSON_ID }),
      ).rejects.toThrow(/CLOUDFLARE_STREAM_SIGNING_KEY/);
    });

    it("does NOT throw when webhook secret is absent (just warns)", () => {
      __resetEnvCacheForTests();
      setTestEnvCf({ CLOUDFLARE_STREAM_WEBHOOK_SECRET: undefined });
      delete process.env["CLOUDFLARE_STREAM_WEBHOOK_SECRET"];
      __resetEnvCacheForTests();

      expect(() => new CloudflareStreamVideoProvider()).not.toThrow();
    });
  });

  // ─── verifyWebhookSignature ─────────────────────────────────────────────────

  describe("verifyWebhookSignature", () => {
    const RAW_BODY = '{"uid":"cf-asset-xyz","readyToStream":true}';
    const TIME = "1230811200";

    it("returns true for a correct Cloudflare Stream webhook signature", () => {
      const sigHeader = makeCfWebhookSigHeader(RAW_BODY, FAKE_CF_WEBHOOK_SECRET, TIME);
      expect(
        provider.verifyWebhookSignature({ rawBody: RAW_BODY, signatureHeader: sigHeader }),
      ).toBe(true);
    });

    it("returns true when rawBody is a Buffer", () => {
      const rawBuf = Buffer.from(RAW_BODY, "utf8");
      const sigHeader = makeCfWebhookSigHeader(rawBuf, FAKE_CF_WEBHOOK_SECRET, TIME);
      expect(
        provider.verifyWebhookSignature({ rawBody: rawBuf, signatureHeader: sigHeader }),
      ).toBe(true);
    });

    it("returns false for a wrong secret", () => {
      const sigHeader = makeCfWebhookSigHeader(RAW_BODY, "wrong-secret", TIME);
      expect(
        provider.verifyWebhookSignature({ rawBody: RAW_BODY, signatureHeader: sigHeader }),
      ).toBe(false);
    });

    it("returns false for a tampered body", () => {
      const sigHeader = makeCfWebhookSigHeader(RAW_BODY, FAKE_CF_WEBHOOK_SECRET, TIME);
      const tampered = RAW_BODY.replace("true", "false");
      expect(
        provider.verifyWebhookSignature({ rawBody: tampered, signatureHeader: sigHeader }),
      ).toBe(false);
    });

    it("FAIL CLOSED, returns false when CLOUDFLARE_STREAM_WEBHOOK_SECRET is not configured", () => {
      __resetEnvCacheForTests();
      setTestEnvCf({ CLOUDFLARE_STREAM_WEBHOOK_SECRET: undefined });
      delete process.env["CLOUDFLARE_STREAM_WEBHOOK_SECRET"];
      __resetEnvCacheForTests();
      const p = new CloudflareStreamVideoProvider();

      const sigHeader = makeCfWebhookSigHeader(RAW_BODY, FAKE_CF_WEBHOOK_SECRET, TIME);
      expect(p.verifyWebhookSignature({ rawBody: RAW_BODY, signatureHeader: sigHeader })).toBe(false);
    });

    it("FAIL CLOSED, returns false for malformed signature header", () => {
      expect(
        provider.verifyWebhookSignature({ rawBody: RAW_BODY, signatureHeader: "invalid-header" }),
      ).toBe(false);
    });

    it("does NOT throw, returns false on empty signature header", () => {
      expect(
        () => provider.verifyWebhookSignature({ rawBody: RAW_BODY, signatureHeader: "" }),
      ).not.toThrow();
      expect(provider.verifyWebhookSignature({ rawBody: RAW_BODY, signatureHeader: "" })).toBe(false);
    });
  });

  // ─── parseTranscodeEvent ───────────────────────────────────────────────────

  describe("parseTranscodeEvent", () => {
    it("maps readyToStream=true to 'ready'", () => {
      const result = provider.parseTranscodeEvent({
        uid: "cf-asset-ready",
        readyToStream: true,
        state: "ready",
        duration: 150,
      });
      expect(result).toEqual({ providerAssetId: "cf-asset-ready", status: "ready", durationS: 150 });
    });

    it("maps state='error' to 'errored'", () => {
      const result = provider.parseTranscodeEvent({
        uid: "cf-asset-err",
        readyToStream: false,
        state: "error",
      });
      expect(result).toEqual({ providerAssetId: "cf-asset-err", status: "errored", durationS: undefined });
    });

    it("maps state='inprogress' to 'processing'", () => {
      const result = provider.parseTranscodeEvent({
        uid: "cf-asset-prog",
        readyToStream: false,
        state: "inprogress",
      });
      expect(result).toEqual({ providerAssetId: "cf-asset-prog", status: "processing", durationS: undefined });
    });

    it("rounds float duration to integer seconds", () => {
      const result = provider.parseTranscodeEvent({
        uid: "cf-asset-dur",
        readyToStream: true,
        state: "ready",
        duration: 90.7,
      });
      expect(result?.durationS).toBe(91);
    });

    it("returns null when uid is missing", () => {
      expect(provider.parseTranscodeEvent({ readyToStream: true })).toBeNull();
    });

    it("returns null for an unrelated payload", () => {
      expect(provider.parseTranscodeEvent({ type: "live.stream.active" })).toBeNull();
      expect(provider.parseTranscodeEvent({})).toBeNull();
    });

    it("does NOT throw on unexpected payload shapes (defensive)", () => {
      expect(() => provider.parseTranscodeEvent({ uid: 123, readyToStream: "yes" })).not.toThrow();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 4: MuxVideoProvider
// ─────────────────────────────────────────────────────────────────────────────

describe("MuxVideoProvider", () => {
  let provider: MuxVideoProvider;

  beforeEach(() => {
    __resetEnvCacheForTests();
    setTestEnvMux();
    jest.clearAllMocks();
    provider = new MuxVideoProvider();
  });

  afterEach(() => {
    clearTestEnv();
    __resetEnvCacheForTests();
  });

  // ─── mintSignedHlsUrl ───────────────────────────────────────────────────────

  describe("mintSignedHlsUrl", () => {
    it("returns a signed HLS URL with the Mux stream URL format", async () => {
      const result = await provider.mintSignedHlsUrl({
        assetId: TEST_ASSET_ID, // Mux playback_id
        userId: TEST_USER_ID,
        lessonId: TEST_LESSON_ID,
        ttlSeconds: TEST_TTL,
      });

      // Mux format: https://stream.mux.com/<PLAYBACK_ID>.m3u8?token=<JWT>
      expect(result.url).toMatch(/^https:\/\/stream\.mux\.com\/.+\.m3u8\?token=.+$/);
    });

    it("appends the JWT token as a ?token= query parameter", async () => {
      const result = await provider.mintSignedHlsUrl({
        assetId: TEST_ASSET_ID,
        userId: TEST_USER_ID,
        lessonId: TEST_LESSON_ID,
      });

      expect(result.url).toContain(`?token=${FAKE_JWT_TOKEN}`);
    });

    it("provider field is 'mux'", async () => {
      const result = await provider.mintSignedHlsUrl({
        assetId: TEST_ASSET_ID,
        userId: TEST_USER_ID,
        lessonId: TEST_LESSON_ID,
      });
      expect(result.provider).toBe("mux");
    });

    it("expiresAt is approximately now + ttlSeconds", async () => {
      const beforeMs = Date.now();
      const result = await provider.mintSignedHlsUrl({
        assetId: TEST_ASSET_ID,
        userId: TEST_USER_ID,
        lessonId: TEST_LESSON_ID,
        ttlSeconds: TEST_TTL,
      });
      const afterMs = Date.now();

      const expMs = result.expiresAt.getTime();
      expect(expMs).toBeGreaterThanOrEqual(beforeMs + TEST_TTL * 1000 - 1000);
      expect(expMs).toBeLessThanOrEqual(afterMs + TEST_TTL * 1000 + 1000);
    });

    it("SECURITY: signing key PEM is not in the returned result", async () => {
      const result = await provider.mintSignedHlsUrl({
        assetId: TEST_ASSET_ID,
        userId: TEST_USER_ID,
        lessonId: TEST_LESSON_ID,
      });
      expect(JSON.stringify(result)).not.toContain(FAKE_PEM);
      expect(JSON.stringify(result)).not.toContain(FAKE_MUX_TOKEN_SECRET);
    });

    it("SECURITY: API token secret is not in the returned result", async () => {
      const result = await provider.mintSignedHlsUrl({
        assetId: TEST_ASSET_ID,
        userId: TEST_USER_ID,
        lessonId: TEST_LESSON_ID,
      });
      expect(JSON.stringify(result)).not.toContain(FAKE_MUX_TOKEN_SECRET);
    });
  });

  // ─── Constructor, lazy validation ─────────────────────────────────────────

  describe("constructor, lazy validation (does NOT throw when keys absent)", () => {
    it("does NOT throw at construction when signing key is absent", () => {
      __resetEnvCacheForTests();
      setTestEnvMux({
        MUX_SIGNING_KEY_ID: undefined,
        MUX_SIGNING_KEY_PRIVATE: undefined,
      });
      delete process.env["MUX_SIGNING_KEY_ID"];
      delete process.env["MUX_SIGNING_KEY_PRIVATE"];
      __resetEnvCacheForTests();

      expect(() => new MuxVideoProvider()).not.toThrow();
    });

    it("throws lazily at mintSignedHlsUrl when signing key is absent", async () => {
      __resetEnvCacheForTests();
      setTestEnvMux({
        MUX_SIGNING_KEY_ID: undefined,
        MUX_SIGNING_KEY_PRIVATE: undefined,
      });
      delete process.env["MUX_SIGNING_KEY_ID"];
      delete process.env["MUX_SIGNING_KEY_PRIVATE"];
      __resetEnvCacheForTests();

      const p = new MuxVideoProvider();
      await expect(
        p.mintSignedHlsUrl({ assetId: TEST_ASSET_ID, userId: TEST_USER_ID, lessonId: TEST_LESSON_ID }),
      ).rejects.toThrow(/MUX_SIGNING_KEY/);
    });

    it("does NOT throw when webhook secret is absent (just warns)", () => {
      __resetEnvCacheForTests();
      setTestEnvMux({ MUX_WEBHOOK_SECRET: undefined });
      delete process.env["MUX_WEBHOOK_SECRET"];
      __resetEnvCacheForTests();

      expect(() => new MuxVideoProvider()).not.toThrow();
    });
  });

  // ─── verifyWebhookSignature ─────────────────────────────────────────────────

  describe("verifyWebhookSignature", () => {
    const RAW_BODY = '{"type":"video.asset.ready","data":{"id":"mux-asset-abc"}}';
    const TS = "1565220904";

    it("returns true for a correct Mux-Signature webhook signature", () => {
      const sigHeader = makeMuxWebhookSigHeader(RAW_BODY, FAKE_MUX_WEBHOOK_SECRET, TS);
      expect(
        provider.verifyWebhookSignature({ rawBody: RAW_BODY, signatureHeader: sigHeader }),
      ).toBe(true);
    });

    it("returns true when rawBody is a Buffer", () => {
      const rawBuf = Buffer.from(RAW_BODY, "utf8");
      const sigHeader = makeMuxWebhookSigHeader(rawBuf, FAKE_MUX_WEBHOOK_SECRET, TS);
      expect(
        provider.verifyWebhookSignature({ rawBody: rawBuf, signatureHeader: sigHeader }),
      ).toBe(true);
    });

    it("returns false for a wrong secret", () => {
      const sigHeader = makeMuxWebhookSigHeader(RAW_BODY, "wrong-secret", TS);
      expect(
        provider.verifyWebhookSignature({ rawBody: RAW_BODY, signatureHeader: sigHeader }),
      ).toBe(false);
    });

    it("returns false for a tampered body", () => {
      const sigHeader = makeMuxWebhookSigHeader(RAW_BODY, FAKE_MUX_WEBHOOK_SECRET, TS);
      const tampered = RAW_BODY.replace("ready", "errored");
      expect(
        provider.verifyWebhookSignature({ rawBody: tampered, signatureHeader: sigHeader }),
      ).toBe(false);
    });

    it("FAIL CLOSED, returns false when MUX_WEBHOOK_SECRET is not configured", () => {
      __resetEnvCacheForTests();
      setTestEnvMux({ MUX_WEBHOOK_SECRET: undefined });
      delete process.env["MUX_WEBHOOK_SECRET"];
      __resetEnvCacheForTests();
      const p = new MuxVideoProvider();

      const sigHeader = makeMuxWebhookSigHeader(RAW_BODY, FAKE_MUX_WEBHOOK_SECRET, TS);
      expect(p.verifyWebhookSignature({ rawBody: RAW_BODY, signatureHeader: sigHeader })).toBe(false);
    });

    it("FAIL CLOSED, returns false for malformed Mux-Signature header", () => {
      expect(
        provider.verifyWebhookSignature({ rawBody: RAW_BODY, signatureHeader: "bad-header" }),
      ).toBe(false);
    });

    it("does NOT throw on empty signature header, returns false", () => {
      expect(
        () => provider.verifyWebhookSignature({ rawBody: RAW_BODY, signatureHeader: "" }),
      ).not.toThrow();
      expect(provider.verifyWebhookSignature({ rawBody: RAW_BODY, signatureHeader: "" })).toBe(false);
    });
  });

  // ─── parseTranscodeEvent ───────────────────────────────────────────────────

  describe("parseTranscodeEvent", () => {
    it("maps 'video.asset.ready' to 'ready'", () => {
      const result = provider.parseTranscodeEvent({
        type: "video.asset.ready",
        object: { type: "asset", id: "mux-asset-001" },
        data: { id: "mux-asset-001", duration: 210.3, status: "ready" },
      });
      expect(result).toEqual({ providerAssetId: "mux-asset-001", status: "ready", durationS: 210 });
    });

    it("maps 'video.asset.errored' to 'errored'", () => {
      const result = provider.parseTranscodeEvent({
        type: "video.asset.errored",
        object: { type: "asset", id: "mux-err-001" },
        data: { id: "mux-err-001" },
      });
      expect(result).toEqual({ providerAssetId: "mux-err-001", status: "errored", durationS: undefined });
    });

    it("maps 'video.asset.created' to 'processing'", () => {
      const result = provider.parseTranscodeEvent({
        type: "video.asset.created",
        object: { type: "asset", id: "mux-asset-new" },
        data: { id: "mux-asset-new", status: "preparing" },
      });
      expect(result).toEqual({ providerAssetId: "mux-asset-new", status: "processing", durationS: undefined });
    });

    it("falls back to object.id when data.id is absent", () => {
      const result = provider.parseTranscodeEvent({
        type: "video.asset.ready",
        object: { type: "asset", id: "from-object-id" },
        data: { duration: 60 },
      });
      expect(result?.providerAssetId).toBe("from-object-id");
    });

    it("returns null for a non-video-asset event type", () => {
      expect(provider.parseTranscodeEvent({ type: "live.stream.active" })).toBeNull();
    });

    it("returns null for payload without type", () => {
      expect(provider.parseTranscodeEvent({})).toBeNull();
    });

    it("returns null when asset id cannot be extracted", () => {
      expect(
        provider.parseTranscodeEvent({ type: "video.asset.ready", data: {}, object: {} }),
      ).toBeNull();
    });

    it("does NOT throw on unexpected payload shapes (defensive)", () => {
      expect(() => provider.parseTranscodeEvent({ type: "video.asset.ready" })).not.toThrow();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 5: VideoProviderModule, production boot guard (mirrors LiveClassProviderModule)
// ─────────────────────────────────────────────────────────────────────────────

describe("VideoProviderModule, boot guard", () => {
  it("BOOTS in production when VIDEO_PROVIDER=disabled (feature off, no video vendor needed)", async () => {
    await expect(
      bootVideoModuleWith({ NODE_ENV: "production", VIDEO_PROVIDER: "disabled" }),
    ).resolves.not.toThrow();
  });

  it("THROWS in production when VIDEO_PROVIDER=noop (would serve FAKE signed HLS URLs)", async () => {
    await expect(
      bootVideoModuleWith({ NODE_ENV: "production", VIDEO_PROVIDER: "noop" }),
    ).rejects.toThrow(/FAKE signed HLS/i);
  });

  it("THROWS in production when VIDEO_PROVIDER is unset (defaults to noop)", async () => {
    await expect(bootVideoModuleWith({ NODE_ENV: "production" })).rejects.toThrow(/FAKE signed HLS/i);
  });

  it("THROWS in production when cloudflare_stream is selected but keys are missing", async () => {
    await expect(
      bootVideoModuleWith({ NODE_ENV: "production", VIDEO_PROVIDER: "cloudflare_stream" }),
    ).rejects.toThrow(/environment variables are not set/i);
  });

  it("BOOTS in production when cloudflare_stream is selected with all signing keys present", async () => {
    await expect(
      bootVideoModuleWith({
        NODE_ENV: "production",
        VIDEO_PROVIDER: "cloudflare_stream",
        CLOUDFLARE_ACCOUNT_ID: "acct-test",
        CLOUDFLARE_STREAM_SIGNING_KEY_ID: "kid-test",
        CLOUDFLARE_STREAM_SIGNING_KEY_PEM: "-----BEGIN PRIVATE KEY-----\nZmFrZQ==\n-----END PRIVATE KEY-----",
      }),
    ).resolves.not.toThrow();
  });

  it("BOOTS outside production when VIDEO_PROVIDER=disabled", async () => {
    await expect(
      bootVideoModuleWith({ NODE_ENV: "development", APP_ENV: "local", VIDEO_PROVIDER: "disabled" }),
    ).resolves.not.toThrow();
  });
});
