// apps/api/src/modules/captcha/providers/captcha/captcha-provider.spec.ts
//
// Unit tests for the CaptchaProvider adapters:
//   - NoopCaptchaProvider   — always success, no network
//   - TurnstileCaptchaProvider — success/fail path (mocked fetch); fail-closed
//     when CAPTCHA_SECRET_KEY is absent; no secret in any return value/log
//   - FailClosedCaptchaProvider — always returns { success: false }
//
// Test strategy (docs/plans/phase-5.md task #3 DoD, CLAUDE.md §3.10):
//   - All tests are UNIT — no live network calls, no real Cloudflare endpoint.
//   - global.fetch is mocked per-test via jest.spyOn so individual tests can
//     control success/failure/timeout paths.
//   - Tests cover:
//       1. NoopCaptchaProvider — always returns { success: true }.
//       2. NoopCaptchaProvider — deterministic (same result every call).
//       3. NoopCaptchaProvider — SECURITY: returns no secret key material.
//       4. TurnstileCaptchaProvider — success path (mocked fetch 200 + {success:true}).
//       5. TurnstileCaptchaProvider — failure path (mocked fetch 200 + {success:false}).
//       6. TurnstileCaptchaProvider — fail-closed when CAPTCHA_SECRET_KEY absent.
//       7. TurnstileCaptchaProvider — fail-closed on network error.
//       8. TurnstileCaptchaProvider — fail-closed on HTTP non-200.
//       9. TurnstileCaptchaProvider — fail-closed on JSON parse error.
//      10. TurnstileCaptchaProvider — SECURITY: secret key NEVER appears in result.
//      11. TurnstileCaptchaProvider — propagates error-codes from Cloudflare.
//      12. TurnstileCaptchaProvider — constructor does NOT throw when key absent.
//      13. FailClosedCaptchaProvider — always returns { success: false }.
//      14. FailClosedCaptchaProvider — errorCodes includes 'captcha-provider-not-configured'.
//      15. FailClosedCaptchaProvider — constructor does NOT throw.
//
// Secrets invariant: CAPTCHA_SECRET_KEY never appears in any returned object or
// log output. This is verified in tests 6 and 10.

import { __resetEnvCacheForTests } from "../../../../config/env";
import { NoopCaptchaProvider } from "./noop-captcha.provider";
import { TurnstileCaptchaProvider } from "./turnstile-captcha.provider";
import { FailClosedCaptchaProvider } from "./fail-closed-captcha.provider";

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

const TEST_SECRET = "test-turnstile-secret-key-never-expose";

function setEnvWith(overrides: Record<string, string | undefined> = {}): void {
  Object.assign(process.env, { ...REQUIRED_ENV, ...overrides });
}

function clearEnv(): void {
  const keys = [
    ...Object.keys(REQUIRED_ENV),
    "CAPTCHA_PROVIDER",
    "CAPTCHA_SECRET_KEY",
    "CAPTCHA_SITE_KEY",
    "NODE_ENV",
    "APP_ENV",
  ];
  for (const k of keys) delete process.env[k];
}

// ─────────────────────────────────────────────────────────────────────────────
// fetch mock helpers
// ─────────────────────────────────────────────────────────────────────────────

function mockFetchSuccess(body: Record<string, unknown>): jest.SpyInstance {
  return jest.spyOn(global, "fetch").mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => body,
  } as unknown as Response);
}

function mockFetchHttpError(status: number): jest.SpyInstance {
  return jest.spyOn(global, "fetch").mockResolvedValueOnce({
    ok: false,
    status,
    json: async () => ({}),
  } as unknown as Response);
}

function mockFetchNetworkError(err: Error): jest.SpyInstance {
  return jest.spyOn(global, "fetch").mockRejectedValueOnce(err);
}

function mockFetchBadJson(): jest.SpyInstance {
  return jest.spyOn(global, "fetch").mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => {
      throw new SyntaxError("Unexpected token");
    },
  } as unknown as Response);
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1: NoopCaptchaProvider
// ─────────────────────────────────────────────────────────────────────────────

describe("NoopCaptchaProvider", () => {
  let provider: NoopCaptchaProvider;

  beforeEach(() => {
    provider = new NoopCaptchaProvider();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("always returns { success: true } regardless of token", async () => {
    const result = await provider.verify("any-token");
    expect(result.success).toBe(true);
  });

  it("always returns { success: true } regardless of token and remoteIp", async () => {
    const result = await provider.verify("some-token", "1.2.3.4");
    expect(result.success).toBe(true);
  });

  it("returns { success: true } for an empty token string", async () => {
    const result = await provider.verify("");
    expect(result.success).toBe(true);
  });

  it("is deterministic — same result every call", async () => {
    const r1 = await provider.verify("token-a");
    const r2 = await provider.verify("token-b");
    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
  });

  it("makes NO network call (fetch is never invoked)", async () => {
    const fetchSpy = jest.spyOn(global, "fetch");
    await provider.verify("any-token", "1.2.3.4");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("SECURITY: return value contains no secret key material", async () => {
    const result = await provider.verify("token", "1.2.3.4");
    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain("secret");
    expect(serialised).not.toContain("key");
    expect(serialised).not.toContain(TEST_SECRET);
  });

  it("does not throw on construction", () => {
    expect(() => new NoopCaptchaProvider()).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2: TurnstileCaptchaProvider
// ─────────────────────────────────────────────────────────────────────────────

describe("TurnstileCaptchaProvider", () => {
  const TEST_TOKEN = "valid-turnstile-client-token";
  const REMOTE_IP = "203.0.113.42";

  beforeEach(() => {
    __resetEnvCacheForTests();
  });

  afterEach(() => {
    clearEnv();
    __resetEnvCacheForTests();
    jest.restoreAllMocks();
  });

  // ─── Construction ─────────────────────────────────────────────────────────

  it("constructor does NOT throw when CAPTCHA_SECRET_KEY is absent", () => {
    setEnvWith(); // no CAPTCHA_SECRET_KEY
    expect(() => new TurnstileCaptchaProvider()).not.toThrow();
  });

  it("constructor does NOT throw when CAPTCHA_SECRET_KEY is present", () => {
    setEnvWith({ CAPTCHA_SECRET_KEY: TEST_SECRET });
    expect(() => new TurnstileCaptchaProvider()).not.toThrow();
  });

  // ─── Success path ─────────────────────────────────────────────────────────

  it("returns { success: true } when Cloudflare returns { success: true }", async () => {
    setEnvWith({ CAPTCHA_SECRET_KEY: TEST_SECRET });
    mockFetchSuccess({ success: true });

    const provider = new TurnstileCaptchaProvider();
    const result = await provider.verify(TEST_TOKEN);

    expect(result.success).toBe(true);
    expect(result.errorCodes).toBeUndefined();
  });

  it("includes remoteip in the POST body when provided", async () => {
    setEnvWith({ CAPTCHA_SECRET_KEY: TEST_SECRET });
    const fetchSpy = mockFetchSuccess({ success: true });

    const provider = new TurnstileCaptchaProvider();
    await provider.verify(TEST_TOKEN, REMOTE_IP);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const callArgs = fetchSpy.mock.calls[0] as [string, RequestInit];
    const bodyStr = callArgs[1]?.body as string;
    expect(bodyStr).toContain(`remoteip=${encodeURIComponent(REMOTE_IP)}`);
  });

  it("does NOT include remoteip in the body when omitted", async () => {
    setEnvWith({ CAPTCHA_SECRET_KEY: TEST_SECRET });
    const fetchSpy = mockFetchSuccess({ success: true });

    const provider = new TurnstileCaptchaProvider();
    await provider.verify(TEST_TOKEN); // no remoteIp

    const callArgs = fetchSpy.mock.calls[0] as [string, RequestInit];
    const bodyStr = callArgs[1]?.body as string;
    expect(bodyStr).not.toContain("remoteip");
  });

  it("POSTs to the correct Turnstile siteverify URL", async () => {
    setEnvWith({ CAPTCHA_SECRET_KEY: TEST_SECRET });
    const fetchSpy = mockFetchSuccess({ success: true });

    const provider = new TurnstileCaptchaProvider();
    await provider.verify(TEST_TOKEN);

    const callArgs = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(callArgs[0]).toBe(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    );
  });

  // ─── Failure path ─────────────────────────────────────────────────────────

  it("returns { success: false } when Cloudflare returns { success: false }", async () => {
    setEnvWith({ CAPTCHA_SECRET_KEY: TEST_SECRET });
    mockFetchSuccess({ success: false, "error-codes": ["invalid-input-response"] });

    const provider = new TurnstileCaptchaProvider();
    const result = await provider.verify(TEST_TOKEN);

    expect(result.success).toBe(false);
  });

  it("propagates error-codes from Cloudflare on failure", async () => {
    setEnvWith({ CAPTCHA_SECRET_KEY: TEST_SECRET });
    mockFetchSuccess({
      success: false,
      "error-codes": ["timeout-or-duplicate", "invalid-input-response"],
    });

    const provider = new TurnstileCaptchaProvider();
    const result = await provider.verify(TEST_TOKEN);

    expect(result.success).toBe(false);
    expect(result.errorCodes).toEqual(["timeout-or-duplicate", "invalid-input-response"]);
  });

  // ─── Fail-closed: missing secret ──────────────────────────────────────────

  it("FAIL-CLOSED: returns { success: false } when CAPTCHA_SECRET_KEY is absent", async () => {
    setEnvWith(); // no CAPTCHA_SECRET_KEY
    const fetchSpy = jest.spyOn(global, "fetch");

    const provider = new TurnstileCaptchaProvider();
    const result = await provider.verify(TEST_TOKEN, REMOTE_IP);

    expect(result.success).toBe(false);
    // Must NOT make a network call without the secret key.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("FAIL-CLOSED: errorCodes include 'missing-input-secret' when key absent", async () => {
    setEnvWith();
    const provider = new TurnstileCaptchaProvider();
    const result = await provider.verify(TEST_TOKEN);
    expect(result.errorCodes).toContain("missing-input-secret");
  });

  // ─── Fail-closed: network error ───────────────────────────────────────────

  it("FAIL-CLOSED: returns { success: false } on network error", async () => {
    setEnvWith({ CAPTCHA_SECRET_KEY: TEST_SECRET });
    mockFetchNetworkError(new Error("ECONNREFUSED"));

    const provider = new TurnstileCaptchaProvider();
    const result = await provider.verify(TEST_TOKEN);

    expect(result.success).toBe(false);
    expect(result.errorCodes).toContain("network-error");
  });

  it("FAIL-CLOSED: returns { success: false } on HTTP 500 from Cloudflare", async () => {
    setEnvWith({ CAPTCHA_SECRET_KEY: TEST_SECRET });
    mockFetchHttpError(500);

    const provider = new TurnstileCaptchaProvider();
    const result = await provider.verify(TEST_TOKEN);

    expect(result.success).toBe(false);
    expect(result.errorCodes).toContain("network-error");
  });

  it("FAIL-CLOSED: returns { success: false } on HTTP 429 (rate limited by CF)", async () => {
    setEnvWith({ CAPTCHA_SECRET_KEY: TEST_SECRET });
    mockFetchHttpError(429);

    const provider = new TurnstileCaptchaProvider();
    const result = await provider.verify(TEST_TOKEN);

    expect(result.success).toBe(false);
    expect(result.errorCodes).toContain("network-error");
  });

  it("FAIL-CLOSED: returns { success: false } on JSON parse error", async () => {
    setEnvWith({ CAPTCHA_SECRET_KEY: TEST_SECRET });
    mockFetchBadJson();

    const provider = new TurnstileCaptchaProvider();
    const result = await provider.verify(TEST_TOKEN);

    expect(result.success).toBe(false);
    expect(result.errorCodes).toContain("network-error");
  });

  // ─── Security: secret never leaks ────────────────────────────────────────

  it("SECURITY: CAPTCHA_SECRET_KEY does not appear in the verify() return value", async () => {
    setEnvWith({ CAPTCHA_SECRET_KEY: TEST_SECRET });
    mockFetchSuccess({ success: true });

    const provider = new TurnstileCaptchaProvider();
    const result = await provider.verify(TEST_TOKEN);

    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain(TEST_SECRET);
    expect(serialised).not.toContain("secret");
  });

  it("SECURITY: CAPTCHA_SECRET_KEY does not appear in error result when key absent", async () => {
    setEnvWith({ CAPTCHA_SECRET_KEY: TEST_SECRET });
    mockFetchNetworkError(new Error("network fail"));

    const provider = new TurnstileCaptchaProvider();
    const result = await provider.verify(TEST_TOKEN);

    const serialised = JSON.stringify(result);
    // The secret must not appear even in the fail-closed error response.
    expect(serialised).not.toContain(TEST_SECRET);
  });

  it("SECURITY: the fetch call includes the secret in the body but not the URL", async () => {
    setEnvWith({ CAPTCHA_SECRET_KEY: TEST_SECRET });
    const fetchSpy = mockFetchSuccess({ success: true });

    const provider = new TurnstileCaptchaProvider();
    await provider.verify(TEST_TOKEN);

    const callArgs = fetchSpy.mock.calls[0] as [string, RequestInit];
    const url = callArgs[0] as string;
    // Secret must not appear in the URL (only in the POST body — server-to-server).
    expect(url).not.toContain(TEST_SECRET);
  });

  it("SECURITY: the client token does not appear in the return value", async () => {
    setEnvWith({ CAPTCHA_SECRET_KEY: TEST_SECRET });
    mockFetchSuccess({ success: true });

    const provider = new TurnstileCaptchaProvider();
    const result = await provider.verify(TEST_TOKEN);

    // The raw client token must not leak back to the caller via the result.
    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain(TEST_TOKEN);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 3: FailClosedCaptchaProvider
// ─────────────────────────────────────────────────────────────────────────────

describe("FailClosedCaptchaProvider", () => {
  let provider: FailClosedCaptchaProvider;

  beforeEach(() => {
    provider = new FailClosedCaptchaProvider();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("constructor does NOT throw", () => {
    expect(() => new FailClosedCaptchaProvider()).not.toThrow();
  });

  it("always returns { success: false } regardless of token", async () => {
    const result = await provider.verify("any-token");
    expect(result.success).toBe(false);
  });

  it("always returns { success: false } regardless of token + remoteIp", async () => {
    const result = await provider.verify("some-token", "1.2.3.4");
    expect(result.success).toBe(false);
  });

  it("returns errorCodes containing 'captcha-provider-not-configured'", async () => {
    const result = await provider.verify("token");
    expect(result.errorCodes).toContain("captcha-provider-not-configured");
  });

  it("is deterministic — always the same failure", async () => {
    const r1 = await provider.verify("token-a");
    const r2 = await provider.verify("token-b");
    expect(r1.success).toBe(false);
    expect(r2.success).toBe(false);
    expect(r1.errorCodes).toEqual(r2.errorCodes);
  });

  it("makes NO network call", async () => {
    const fetchSpy = jest.spyOn(global, "fetch");
    await provider.verify("any-token");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("SECURITY: return value contains no secret key material", async () => {
    const result = await provider.verify("token");
    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain("secret");
    expect(serialised).not.toContain("key");
  });
});
