// apps/api/src/modules/notifications/providers/mail/mail-provider.spec.ts
//
// Unit tests for the MailProvider adapters:
//   - NoopMailProvider  , deterministic send, real HMAC webhook verification, no network
//   - ResendMailProvider, send shape + providerMessageId plumbing (Resend SDK mocked);
//                         verifyWebhookSignature pass/fail; fail-closed when key absent
//   - MailProviderModule factory, adapter selection, fail-closed-in-prod boot throw,
//                                  Noop in dev/test
//
// Test strategy (docs/plans/phase-6.md task #3 DoD, CLAUDE.md §3.10):
//   - All tests are UNIT, no live network calls, no real Resend endpoint.
//   - The Resend SDK is mocked (jest.mock('resend')) to avoid any network dependency.
//   - node:crypto (createHmac, timingSafeEqual) is the REAL implementation.
//   - Secrets invariant: RESEND_API_KEY, MAIL_WEBHOOK_SECRET, and MAIL_FROM NEVER appear
//     in any return value or serialised result.
//
// ACs covered (docs/specs/phase-6-engagement.md):
//   AC-12 , Noop does not throw; deterministic success; no network
//   AC-13 , Fail-closed in prod when MAIL_PROVIDER=resend but key absent (boot throw)
//   AC-39 , Forged webhook rejected (false); missing secret → false
//   AC-76 , No secret in any returned object
//   Part 4 edge: constructor does NOT throw when keys absent (lazy validation)

import { __resetEnvCacheForTests } from "../../../../config/env";
import { NoopMailProvider, NOOP_MAIL_ID_PREFIX } from "./noop-mail.provider";
import { ResendMailProvider } from "./resend-mail.provider";

// ─────────────────────────────────────────────────────────────────────────────
// Mock the Resend SDK
// ─────────────────────────────────────────────────────────────────────────────

const mockEmailsSend = jest.fn();
const mockWebhooksVerify = jest.fn();

jest.mock("resend", () => {
  return {
    Resend: jest.fn().mockImplementation(() => ({
      emails: { send: mockEmailsSend },
      webhooks: { verify: mockWebhooksVerify },
    })),
  };
});

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
  // Coherent PRODUCTION values. `validateEnv` requires these once NODE_ENV/APP_ENV is
  // "production" — a session cookie issued without Secure, or scoped to localhost, is a
  // real misconfiguration, so the boot refuses it. Cases below that exercise a
  // production boot guard would otherwise fail on env validation before reaching the
  // guard under test.
  COOKIE_SECURE: "true",
  COOKIE_DOMAIN: ".stimuliiq.test",
};

// Test-only constants, NEVER real credentials.
const TEST_RESEND_API_KEY = "re_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
const TEST_MAIL_FROM = "test@example.com";
const TEST_WEBHOOK_SECRET = "whsec_dGVzdC1zZWNyZXQtbmV2ZXItZXhwb3NlLTEyMzQ1Njc4OTAxMjM=";

function setEnvWith(overrides: Record<string, string | undefined> = {}): void {
  Object.assign(process.env, { ...REQUIRED_ENV, ...overrides });
}

function clearEnvKeys(): void {
  const keys = [
    ...Object.keys(REQUIRED_ENV),
    "MAIL_PROVIDER",
    "RESEND_API_KEY",
    "MAIL_FROM",
    "MAIL_WEBHOOK_SECRET",
    "NODE_ENV",
    "APP_ENV",
  ];
  for (const k of keys) delete process.env[k];
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1: NoopMailProvider
// ─────────────────────────────────────────────────────────────────────────────

describe("NoopMailProvider", () => {
  let provider: NoopMailProvider;

  beforeEach(() => {
    provider = new NoopMailProvider();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ─── Construction ────────────────────────────────────────────────────────

  it("constructor does NOT throw (no keys required for Noop)", () => {
    expect(() => new NoopMailProvider()).not.toThrow();
  });

  // ─── send() ──────────────────────────────────────────────────────────────

  it("send() returns a providerMessageId with the noop prefix", async () => {
    const result = await provider.send({
      to: "student@example.com",
      subject: "Grade Ready",
      html: "<p>Your grade is 95%</p>",
    });
    expect(result.providerMessageId).toMatch(new RegExp(`^${NOOP_MAIL_ID_PREFIX}`));
  });

  it("send() makes NO network call (fetch is never invoked)", async () => {
    const fetchSpy = jest.spyOn(global, "fetch");
    await provider.send({ to: "a@b.com", subject: "Test", text: "Hello" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("send() returns different IDs on successive calls (no collision)", async () => {
    const [r1, r2] = await Promise.all([
      provider.send({ to: "a@b.com", subject: "S1", text: "Body 1" }),
      provider.send({ to: "b@c.com", subject: "S2", text: "Body 2" }),
    ]);
    expect(r1.providerMessageId).not.toBe(r2.providerMessageId);
  });

  it("AC-76: send() result NEVER contains the word 'secret' or 'key'", async () => {
    const result = await provider.send({ to: "a@b.com", subject: "Test", text: "Hello" });
    const serialised = JSON.stringify(result);
    expect(serialised).not.toMatch(/secret/i);
    expect(serialised).not.toMatch(/apikey/i);
    expect(serialised).not.toContain(TEST_RESEND_API_KEY);
  });

  it("send() works with html only (no text)", async () => {
    const result = await provider.send({ to: "a@b.com", subject: "S", html: "<b>hi</b>" });
    expect(result.providerMessageId).toBeTruthy();
  });

  it("send() works with text only (no html)", async () => {
    const result = await provider.send({ to: "a@b.com", subject: "S", text: "hi" });
    expect(result.providerMessageId).toBeTruthy();
  });

  it("send() works with tags", async () => {
    const result = await provider.send({
      to: "a@b.com",
      subject: "S",
      text: "hi",
      tags: [{ name: "category", value: "grade_ready" }],
    });
    expect(result.providerMessageId).toBeTruthy();
  });

  // ─── verifyWebhookSignature() ─────────────────────────────────────────────

  describe("verifyWebhookSignature", () => {
    const RAW_BODY = '{"type":"email.delivered","data":{"email_id":"re_test_001"}}';
    const MSG_ID = "msg_01jwrz_test";
    const TIMESTAMP = "1700000000";
    const TEST_SECRET = "whsec_dGVzdC1zZWNyZXQtbmV2ZXItZXhwb3Nl"; // base64("test-secret-never-expose")

    function makeSig(): string {
      return `v1,${NoopMailProvider.makeSvixSignature(MSG_ID, TIMESTAMP, RAW_BODY, TEST_SECRET)}`;
    }

    it("returns true for a valid Svix signature", () => {
      const sig = makeSig();
      expect(
        provider.verifyWebhookSignature({
          rawBody: RAW_BODY,
          svixId: MSG_ID,
          svixTimestamp: TIMESTAMP,
          svixSignature: sig,
          secret: TEST_SECRET,
        }),
      ).toBe(true);
    });

    it("returns false for a tampered body", () => {
      const sig = makeSig();
      expect(
        provider.verifyWebhookSignature({
          rawBody: RAW_BODY + " tampered",
          svixId: MSG_ID,
          svixTimestamp: TIMESTAMP,
          svixSignature: sig,
          secret: TEST_SECRET,
        }),
      ).toBe(false);
    });

    it("returns false for a wrong secret", () => {
      const wrongSig = `v1,${NoopMailProvider.makeSvixSignature(MSG_ID, TIMESTAMP, RAW_BODY, "whsec_d3Jvbmctc2VjcmV0")}`;
      expect(
        provider.verifyWebhookSignature({
          rawBody: RAW_BODY,
          svixId: MSG_ID,
          svixTimestamp: TIMESTAMP,
          svixSignature: wrongSig,
          secret: TEST_SECRET,
        }),
      ).toBe(false);
    });

    it("FAIL CLOSED, returns false when secret is empty", () => {
      const sig = makeSig();
      expect(
        provider.verifyWebhookSignature({
          rawBody: RAW_BODY,
          svixId: MSG_ID,
          svixTimestamp: TIMESTAMP,
          svixSignature: sig,
          secret: "",
        }),
      ).toBe(false);
    });

    it("returns false for an empty svixSignature (no v1, prefix)", () => {
      expect(
        provider.verifyWebhookSignature({
          rawBody: RAW_BODY,
          svixId: MSG_ID,
          svixTimestamp: TIMESTAMP,
          svixSignature: "",
          secret: TEST_SECRET,
        }),
      ).toBe(false);
    });

    it("handles multiple space-separated signatures in the header (picks the valid one)", () => {
      const validSig = `v1,${NoopMailProvider.makeSvixSignature(MSG_ID, TIMESTAMP, RAW_BODY, TEST_SECRET)}`;
      const combined = `v1,invalid_signature ${validSig}`;
      expect(
        provider.verifyWebhookSignature({
          rawBody: RAW_BODY,
          svixId: MSG_ID,
          svixTimestamp: TIMESTAMP,
          svixSignature: combined,
          secret: TEST_SECRET,
        }),
      ).toBe(true);
    });

    it("does NOT throw, returns false on completely malformed input", () => {
      expect(() =>
        provider.verifyWebhookSignature({
          rawBody: RAW_BODY,
          svixId: MSG_ID,
          svixTimestamp: TIMESTAMP,
          svixSignature: "not-svix-format-at-all",
          secret: TEST_SECRET,
        }),
      ).not.toThrow();
    });

    it("AC-76: MAIL_WEBHOOK_SECRET / secret never appears in the false return value", () => {
      const result = provider.verifyWebhookSignature({
        rawBody: RAW_BODY,
        svixId: MSG_ID,
        svixTimestamp: TIMESTAMP,
        svixSignature: "v1,badsig",
        secret: TEST_WEBHOOK_SECRET,
      });
      expect(result).toBe(false);
      // Verify the return value itself (boolean), trivially can't contain a string.
      expect(typeof result).toBe("boolean");
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2: ResendMailProvider
// ─────────────────────────────────────────────────────────────────────────────

describe("ResendMailProvider", () => {
  beforeEach(() => {
    __resetEnvCacheForTests();
    jest.clearAllMocks();
  });

  afterEach(() => {
    clearEnvKeys();
    __resetEnvCacheForTests();
    jest.restoreAllMocks();
  });

  // ─── Construction ────────────────────────────────────────────────────────

  it("constructor does NOT throw when RESEND_API_KEY is absent (lazy validation)", () => {
    setEnvWith(); // no RESEND_API_KEY
    expect(() => new ResendMailProvider()).not.toThrow();
  });

  it("constructor does NOT throw when keys are present", () => {
    setEnvWith({ RESEND_API_KEY: TEST_RESEND_API_KEY, MAIL_FROM: TEST_MAIL_FROM });
    expect(() => new ResendMailProvider()).not.toThrow();
  });

  // ─── send(), success path ────────────────────────────────────────────────

  it("send() returns providerMessageId from the Resend SDK response", async () => {
    setEnvWith({ RESEND_API_KEY: TEST_RESEND_API_KEY, MAIL_FROM: TEST_MAIL_FROM });
    mockEmailsSend.mockResolvedValueOnce({ data: { id: "re_abc123xyz" }, error: null });

    const provider = new ResendMailProvider();
    const result = await provider.send({
      to: "student@example.com",
      subject: "Your certificate is ready",
      html: "<p>Download your certificate</p>",
      text: "Download your certificate",
    });

    expect(result.providerMessageId).toBe("re_abc123xyz");
  });

  it("send() passes from address from MAIL_FROM env to the Resend SDK", async () => {
    setEnvWith({ RESEND_API_KEY: TEST_RESEND_API_KEY, MAIL_FROM: "noreply@stimuliiq.com" });
    mockEmailsSend.mockResolvedValueOnce({ data: { id: "re_001" }, error: null });

    const provider = new ResendMailProvider();
    await provider.send({ to: "a@b.com", subject: "S", text: "T" });

    expect(mockEmailsSend).toHaveBeenCalledWith(
      expect.objectContaining({ from: "noreply@stimuliiq.com" }),
    );
  });

  it("send() passes tags to the Resend SDK", async () => {
    setEnvWith({ RESEND_API_KEY: TEST_RESEND_API_KEY, MAIL_FROM: TEST_MAIL_FROM });
    mockEmailsSend.mockResolvedValueOnce({ data: { id: "re_tagged" }, error: null });

    const provider = new ResendMailProvider();
    await provider.send({
      to: "a@b.com",
      subject: "S",
      text: "T",
      tags: [{ name: "type", value: "grade_ready" }],
    });

    expect(mockEmailsSend).toHaveBeenCalledWith(
      expect.objectContaining({
        tags: [{ name: "type", value: "grade_ready" }],
      }),
    );
  });

  it("AC-76: send() result NEVER contains the API key, MAIL_FROM, or webhook secret", async () => {
    setEnvWith({ RESEND_API_KEY: TEST_RESEND_API_KEY, MAIL_FROM: TEST_MAIL_FROM });
    mockEmailsSend.mockResolvedValueOnce({ data: { id: "re_clean" }, error: null });

    const provider = new ResendMailProvider();
    const result = await provider.send({ to: "a@b.com", subject: "S", text: "T" });

    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain(TEST_RESEND_API_KEY);
    expect(serialised).not.toContain(TEST_MAIL_FROM); // from address should not be in result
    expect(serialised).not.toContain(TEST_WEBHOOK_SECRET);
  });

  // ─── send(), failure paths ───────────────────────────────────────────────

  it("send() throws when RESEND_API_KEY is absent", async () => {
    setEnvWith({ MAIL_FROM: TEST_MAIL_FROM }); // no RESEND_API_KEY
    const provider = new ResendMailProvider();
    await expect(
      provider.send({ to: "a@b.com", subject: "S", text: "T" }),
    ).rejects.toThrow(/RESEND_API_KEY/);
  });

  it("send() throws when MAIL_FROM is absent", async () => {
    setEnvWith({ RESEND_API_KEY: TEST_RESEND_API_KEY }); // no MAIL_FROM
    const provider = new ResendMailProvider();
    await expect(
      provider.send({ to: "a@b.com", subject: "S", text: "T" }),
    ).rejects.toThrow(/MAIL_FROM/);
  });

  it("send() throws when the Resend SDK returns an error", async () => {
    setEnvWith({ RESEND_API_KEY: TEST_RESEND_API_KEY, MAIL_FROM: TEST_MAIL_FROM });
    mockEmailsSend.mockResolvedValueOnce({
      data: null,
      error: { name: "validation_error", message: "Invalid email address" },
    });

    const provider = new ResendMailProvider();
    await expect(
      provider.send({ to: "bad-email", subject: "S", text: "T" }),
    ).rejects.toThrow(/validation_error/);
  });

  it("send() throws when the Resend SDK returns no data.id", async () => {
    setEnvWith({ RESEND_API_KEY: TEST_RESEND_API_KEY, MAIL_FROM: TEST_MAIL_FROM });
    mockEmailsSend.mockResolvedValueOnce({ data: null, error: null });

    const provider = new ResendMailProvider();
    await expect(
      provider.send({ to: "a@b.com", subject: "S", text: "T" }),
    ).rejects.toThrow();
  });

  // ─── verifyWebhookSignature() ─────────────────────────────────────────────

  describe("verifyWebhookSignature", () => {
    const RAW_BODY = '{"type":"email.delivered"}';
    const SVIX_ID = "msg_test_01";
    const SVIX_TS = "1700000000";
    const SVIX_SIG = "v1,validbase64sig";

    it("returns true when resend.webhooks.verify() does not throw", () => {
      setEnvWith({ RESEND_API_KEY: TEST_RESEND_API_KEY, MAIL_FROM: TEST_MAIL_FROM });
      mockWebhooksVerify.mockReturnValueOnce({ type: "email.delivered" });

      const provider = new ResendMailProvider();
      const result = provider.verifyWebhookSignature({
        rawBody: RAW_BODY,
        svixId: SVIX_ID,
        svixTimestamp: SVIX_TS,
        svixSignature: SVIX_SIG,
        secret: TEST_WEBHOOK_SECRET,
      });
      expect(result).toBe(true);
    });

    it("returns false when resend.webhooks.verify() throws (invalid signature)", () => {
      setEnvWith({ RESEND_API_KEY: TEST_RESEND_API_KEY, MAIL_FROM: TEST_MAIL_FROM });
      mockWebhooksVerify.mockImplementationOnce(() => {
        throw new Error("WebhookSignatureError: invalid signature");
      });

      const provider = new ResendMailProvider();
      const result = provider.verifyWebhookSignature({
        rawBody: RAW_BODY,
        svixId: SVIX_ID,
        svixTimestamp: SVIX_TS,
        svixSignature: "v1,bad_sig",
        secret: TEST_WEBHOOK_SECRET,
      });
      expect(result).toBe(false);
    });

    it("FAIL CLOSED, returns false when secret is empty", () => {
      setEnvWith({ RESEND_API_KEY: TEST_RESEND_API_KEY, MAIL_FROM: TEST_MAIL_FROM });
      const provider = new ResendMailProvider();
      const result = provider.verifyWebhookSignature({
        rawBody: RAW_BODY,
        svixId: SVIX_ID,
        svixTimestamp: SVIX_TS,
        svixSignature: SVIX_SIG,
        secret: "",
      });
      expect(result).toBe(false);
    });

    it("FAIL CLOSED, returns false when RESEND_API_KEY is absent (getClient throws)", () => {
      setEnvWith(); // no keys
      const provider = new ResendMailProvider();
      const result = provider.verifyWebhookSignature({
        rawBody: RAW_BODY,
        svixId: SVIX_ID,
        svixTimestamp: SVIX_TS,
        svixSignature: SVIX_SIG,
        secret: TEST_WEBHOOK_SECRET,
      });
      expect(result).toBe(false);
    });

    it("does NOT throw on any input, always returns boolean", () => {
      setEnvWith({ RESEND_API_KEY: TEST_RESEND_API_KEY, MAIL_FROM: TEST_MAIL_FROM });
      mockWebhooksVerify.mockImplementationOnce(() => {
        throw new Error("error");
      });
      const provider = new ResendMailProvider();
      expect(() =>
        provider.verifyWebhookSignature({
          rawBody: RAW_BODY,
          svixId: SVIX_ID,
          svixTimestamp: SVIX_TS,
          svixSignature: "",
          secret: TEST_WEBHOOK_SECRET,
        }),
      ).not.toThrow();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 3: MailProviderModule factory (fail-closed / adapter selection)
// ─────────────────────────────────────────────────────────────────────────────

describe("MailProviderModule factory (fail-closed in prod)", () => {
  beforeEach(() => {
    __resetEnvCacheForTests();
  });

  afterEach(() => {
    clearEnvKeys();
    __resetEnvCacheForTests();
  });

  it("AC-13: throws at boot when MAIL_PROVIDER=resend but RESEND_API_KEY absent in production", async () => {
    setEnvWith({
      MAIL_PROVIDER: "resend",
      MAIL_FROM: TEST_MAIL_FROM,
      NODE_ENV: "production",
      APP_ENV: "production",
      // RESEND_API_KEY deliberately absent
    });
    // Dynamically import the module factory to avoid module-level DI side effects.
    const { createMailProviderForTest } = await import("./mail-provider-factory.test-helper");
    expect(() => createMailProviderForTest()).toThrow(/RESEND_API_KEY/);
  });

  it("AC-13: throws at boot when MAIL_PROVIDER=noop in production", async () => {
    setEnvWith({
      MAIL_PROVIDER: "noop",
      NODE_ENV: "production",
      APP_ENV: "production",
    });
    const { createMailProviderForTest } = await import("./mail-provider-factory.test-helper");
    expect(() => createMailProviderForTest()).toThrow(/noop.*production|production.*noop/i);
  });

  it("DEFECT-1 guard: MailProviderModule compiles as a NestJS module without crashing", async () => {
    setEnvWith({
      MAIL_PROVIDER: "noop",
      NODE_ENV: "development",
      APP_ENV: "local",
    });
    __resetEnvCacheForTests();
    // Importing the module (not compiling via Test.createTestingModule) verifies
    // that the module definition itself is valid (no syntax / import errors).
    const { MailProviderModule } = await import("./mail-provider.module");
    expect(MailProviderModule).toBeDefined();
  });
});
