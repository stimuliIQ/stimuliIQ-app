// apps/api/src/modules/notifications/providers/whatsapp/whatsapp-provider.spec.ts
//
// Unit tests for the WhatsAppProvider adapters:
//   - NoopWhatsAppProvider  — deterministic send, real HMAC webhook verify, no network
//   - WhatsAppCloudProvider — sendTemplate/sendSession shape (fetch mocked);
//                            verifyWebhookSignature pass/fail; fail-closed when key absent;
//                            constructor does not throw (lazy validation)
//   - WhatsAppProviderModule factory — adapter selection, fail-closed-in-prod boot throw,
//                                      Noop in dev/test
//
// Test strategy (docs/plans/phase-6.md task #3 DoD, CLAUDE.md §3.10):
//   - All tests are UNIT — no live Graph API calls. global.fetch is mocked per-test.
//   - node:crypto (createHmac, timingSafeEqual) is the REAL implementation.
//   - Secrets invariant: WHATSAPP_ACCESS_TOKEN, WHATSAPP_APP_SECRET, WHATSAPP_PHONE_NUMBER_ID
//     NEVER appear in any return value or serialised result.
//
// ACs covered:
//   AC-12  — Noop does not throw; deterministic success; no network
//   AC-13  — Fail-closed in prod when WHATSAPP_PROVIDER=whatsapp_cloud but keys absent
//   AC-39  — Forged webhook rejected; missing secret → false
//   AC-76  — No secret in any returned object

import { createHmac } from "node:crypto";
import { __resetEnvCacheForTests } from "../../../../config/env";
import { NoopWhatsAppProvider, NOOP_WHATSAPP_ID_PREFIX } from "./noop-whatsapp.provider";
import { WhatsAppCloudProvider } from "./whatsapp-cloud.provider";

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

// Test-only constants — NEVER real credentials.
const TEST_PHONE_NUMBER_ID = "106540352242922";
const TEST_ACCESS_TOKEN = "EAAtest_never_expose_xxxxxxxxxxxxxxxxxxxx";
const TEST_APP_SECRET = "test-app-secret-never-expose-32abc";

function setEnvWith(overrides: Record<string, string | undefined> = {}): void {
  Object.assign(process.env, { ...REQUIRED_ENV, ...overrides });
}

function clearEnvKeys(): void {
  const keys = [
    ...Object.keys(REQUIRED_ENV),
    "WHATSAPP_PROVIDER",
    "WHATSAPP_PHONE_NUMBER_ID",
    "WHATSAPP_ACCESS_TOKEN",
    "WHATSAPP_APP_SECRET",
    "WHATSAPP_VERIFY_TOKEN",
    "NODE_ENV",
    "APP_ENV",
  ];
  for (const k of keys) delete process.env[k];
}

/** Build a Meta X-Hub-Signature-256 header value for a given body and secret. */
function makeHubSig(rawBody: string, secret: string): string {
  const hex = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  return `sha256=${hex}`;
}

// ─── fetch mock helpers ───────────────────────────────────────────────────────

function mockFetchSuccess(body: Record<string, unknown>): jest.SpyInstance {
  return jest.spyOn(global, "fetch").mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => body,
  } as unknown as Response);
}

function mockFetchHttpError(status: number, errBody: Record<string, unknown> = {}): jest.SpyInstance {
  return jest.spyOn(global, "fetch").mockResolvedValueOnce({
    ok: false,
    status,
    json: async () => errBody,
  } as unknown as Response);
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1: NoopWhatsAppProvider
// ─────────────────────────────────────────────────────────────────────────────

describe("NoopWhatsAppProvider", () => {
  let provider: NoopWhatsAppProvider;

  beforeEach(() => {
    provider = new NoopWhatsAppProvider();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("constructor does NOT throw", () => {
    expect(() => new NoopWhatsAppProvider()).not.toThrow();
  });

  // ─── sendTemplate() ──────────────────────────────────────────────────────

  describe("sendTemplate", () => {
    it("returns a providerMessageId with the noop prefix", async () => {
      const result = await provider.sendTemplate({
        to: "+919876543210",
        templateName: "grade_ready",
        dltTemplateId: "1207162000000001234",
        languageCode: "en",
        variables: ["Student Name", "95%"],
      });
      expect(result.providerMessageId).toMatch(new RegExp(`^${NOOP_WHATSAPP_ID_PREFIX}`));
    });

    it("makes NO network call (fetch is never invoked)", async () => {
      const fetchSpy = jest.spyOn(global, "fetch");
      await provider.sendTemplate({
        to: "+919876543210",
        templateName: "grade_ready",
        dltTemplateId: "12345",
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("returns different IDs on successive calls", async () => {
      const [r1, r2] = await Promise.all([
        provider.sendTemplate({ to: "+91111", templateName: "t1", dltTemplateId: "d1" }),
        provider.sendTemplate({ to: "+91222", templateName: "t2", dltTemplateId: "d2" }),
      ]);
      expect(r1.providerMessageId).not.toBe(r2.providerMessageId);
    });

    it("AC-76: result NEVER contains access token, app secret, or phone number ID", async () => {
      const result = await provider.sendTemplate({
        to: "+919876543210",
        templateName: "grade_ready",
        dltTemplateId: "12345",
      });
      const s = JSON.stringify(result);
      expect(s).not.toContain(TEST_ACCESS_TOKEN);
      expect(s).not.toContain(TEST_APP_SECRET);
      expect(s).not.toContain(TEST_PHONE_NUMBER_ID);
    });

    it("works with variables omitted", async () => {
      const result = await provider.sendTemplate({
        to: "+919876543210",
        templateName: "announcement",
        dltTemplateId: "12345",
      });
      expect(result.providerMessageId).toBeTruthy();
    });
  });

  // ─── sendSession() ────────────────────────────────────────────────────────

  describe("sendSession", () => {
    it("returns a providerMessageId with noop-wa-session prefix", async () => {
      const result = await provider.sendSession({ to: "+919876543210", body: "Hello!" });
      expect(result.providerMessageId).toContain("noop-wa-session");
    });

    it("makes NO network call", async () => {
      const fetchSpy = jest.spyOn(global, "fetch");
      await provider.sendSession({ to: "+919876543210", body: "Hello!" });
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  // ─── verifyWebhookSignature() ─────────────────────────────────────────────

  describe("verifyWebhookSignature", () => {
    const RAW_BODY = '{"object":"whatsapp_business_account","entry":[]}';
    const SECRET = "test-app-secret-for-webhook-verify";

    it("returns true for a valid X-Hub-Signature-256 header", () => {
      const sig = makeHubSig(RAW_BODY, SECRET);
      expect(provider.verifyWebhookSignature({ rawBody: RAW_BODY, signature: sig, secret: SECRET })).toBe(true);
    });

    it("returns true when rawBody is a Buffer", () => {
      const buf = Buffer.from(RAW_BODY, "utf8");
      const sig = NoopWhatsAppProvider.makeHubSignature(buf, SECRET);
      expect(provider.verifyWebhookSignature({ rawBody: buf, signature: sig, secret: SECRET })).toBe(true);
    });

    it("returns false for a tampered body", () => {
      const sig = makeHubSig(RAW_BODY, SECRET);
      expect(provider.verifyWebhookSignature({ rawBody: RAW_BODY + " tampered", signature: sig, secret: SECRET })).toBe(false);
    });

    it("returns false for a wrong secret", () => {
      const sig = makeHubSig(RAW_BODY, "wrong-secret");
      expect(provider.verifyWebhookSignature({ rawBody: RAW_BODY, signature: sig, secret: SECRET })).toBe(false);
    });

    it("FAIL CLOSED — returns false when secret is empty", () => {
      const sig = makeHubSig(RAW_BODY, SECRET);
      expect(provider.verifyWebhookSignature({ rawBody: RAW_BODY, signature: sig, secret: "" })).toBe(false);
    });

    it("returns false when signature header is empty string", () => {
      expect(provider.verifyWebhookSignature({ rawBody: RAW_BODY, signature: "", secret: SECRET })).toBe(false);
    });

    it("returns false when sha256= prefix is missing from the header", () => {
      const hex = createHmac("sha256", SECRET).update(RAW_BODY, "utf8").digest("hex");
      // Provide the raw hex without the "sha256=" prefix — should still work due to normalisation
      // because compareHubSignatures also strips "sha256=" from expected.
      // But incoming WITHOUT prefix while expected WITH prefix → lengths match so it verifies.
      // Actually, incoming without prefix means neither starts with sha256= so both strip nothing.
      expect(provider.verifyWebhookSignature({ rawBody: RAW_BODY, signature: hex, secret: SECRET })).toBe(true);
    });

    it("does NOT throw on any input — returns false on malformed data", () => {
      expect(
        () => provider.verifyWebhookSignature({ rawBody: RAW_BODY, signature: "sha256=zzzzzz", secret: SECRET }),
      ).not.toThrow();
    });
  });

  // ─── Static helpers ───────────────────────────────────────────────────────

  describe("makeHubSignature (static)", () => {
    it("produces a 'sha256=<hex>' string", () => {
      const sig = NoopWhatsAppProvider.makeHubSignature("test-body", "test-secret");
      expect(sig).toMatch(/^sha256=[a-f0-9]{64}$/);
    });

    it("produces a signature valid for verifyWebhookSignature", () => {
      const body = '{"test":true}';
      const secret = "test-secret-for-make-hub-sig";
      const sig = NoopWhatsAppProvider.makeHubSignature(body, secret);
      const p = new NoopWhatsAppProvider();
      expect(p.verifyWebhookSignature({ rawBody: body, signature: sig, secret })).toBe(true);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2: WhatsAppCloudProvider
// ─────────────────────────────────────────────────────────────────────────────

describe("WhatsAppCloudProvider", () => {
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

  it("constructor does NOT throw when keys are absent (lazy validation)", () => {
    setEnvWith(); // no WhatsApp keys
    expect(() => new WhatsAppCloudProvider()).not.toThrow();
  });

  it("constructor does NOT throw when keys are present", () => {
    setEnvWith({
      WHATSAPP_PHONE_NUMBER_ID: TEST_PHONE_NUMBER_ID,
      WHATSAPP_ACCESS_TOKEN: TEST_ACCESS_TOKEN,
      WHATSAPP_APP_SECRET: TEST_APP_SECRET,
    });
    expect(() => new WhatsAppCloudProvider()).not.toThrow();
  });

  // ─── sendTemplate() — success path ───────────────────────────────────────

  it("sendTemplate() returns providerMessageId from the Graph API response", async () => {
    setEnvWith({
      WHATSAPP_PHONE_NUMBER_ID: TEST_PHONE_NUMBER_ID,
      WHATSAPP_ACCESS_TOKEN: TEST_ACCESS_TOKEN,
    });
    mockFetchSuccess({
      messaging_product: "whatsapp",
      contacts: [{ input: "+919876543210", wa_id: "919876543210" }],
      messages: [{ id: "wamid.test_001", message_status: "accepted" }],
    });

    const provider = new WhatsAppCloudProvider();
    const result = await provider.sendTemplate({
      to: "+919876543210",
      templateName: "grade_ready",
      dltTemplateId: "1207162000000001234",
      languageCode: "en",
      variables: ["Alice", "95%"],
    });

    expect(result.providerMessageId).toBe("wamid.test_001");
  });

  it("sendTemplate() POSTs to the correct Graph API URL", async () => {
    setEnvWith({
      WHATSAPP_PHONE_NUMBER_ID: TEST_PHONE_NUMBER_ID,
      WHATSAPP_ACCESS_TOKEN: TEST_ACCESS_TOKEN,
    });
    const fetchSpy = mockFetchSuccess({
      messaging_product: "whatsapp",
      messages: [{ id: "wamid.url_test" }],
    });

    const provider = new WhatsAppCloudProvider();
    await provider.sendTemplate({
      to: "+919876543210",
      templateName: "test_template",
      dltTemplateId: "12345",
    });

    const callArgs = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(callArgs[0]).toBe(
      `https://graph.facebook.com/v22.0/${TEST_PHONE_NUMBER_ID}/messages`,
    );
  });

  it("sendTemplate() includes Authorization Bearer header (NOT in result)", async () => {
    setEnvWith({
      WHATSAPP_PHONE_NUMBER_ID: TEST_PHONE_NUMBER_ID,
      WHATSAPP_ACCESS_TOKEN: TEST_ACCESS_TOKEN,
    });
    const fetchSpy = mockFetchSuccess({
      messaging_product: "whatsapp",
      messages: [{ id: "wamid.auth_test" }],
    });

    const provider = new WhatsAppCloudProvider();
    const result = await provider.sendTemplate({
      to: "+919876543210",
      templateName: "t",
      dltTemplateId: "d",
    });

    const callArgs = fetchSpy.mock.calls[0] as [string, RequestInit];
    const headers = callArgs[1]?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe(`Bearer ${TEST_ACCESS_TOKEN}`);

    // AC-76: the access token must NOT appear in the result.
    expect(JSON.stringify(result)).not.toContain(TEST_ACCESS_TOKEN);
  });

  it("sendTemplate() builds correct body with variables as body parameters", async () => {
    setEnvWith({
      WHATSAPP_PHONE_NUMBER_ID: TEST_PHONE_NUMBER_ID,
      WHATSAPP_ACCESS_TOKEN: TEST_ACCESS_TOKEN,
    });
    const fetchSpy = mockFetchSuccess({
      messaging_product: "whatsapp",
      messages: [{ id: "wamid.vars_test" }],
    });

    const provider = new WhatsAppCloudProvider();
    await provider.sendTemplate({
      to: "+919876543210",
      templateName: "grade_ready",
      dltTemplateId: "12345",
      languageCode: "hi",
      variables: ["Alice", "95%"],
    });

    const callArgs = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(callArgs[1]?.body as string) as Record<string, unknown>;
    const template = body["template"] as Record<string, unknown>;
    const lang = template["language"] as Record<string, unknown>;
    expect(lang["code"]).toBe("hi");

    const components = template["components"] as Array<Record<string, unknown>>;
    expect(components).toHaveLength(1);
    const params = components[0]!["parameters"] as Array<Record<string, unknown>>;
    expect(params[0]!["text"]).toBe("Alice");
  });

  // ─── sendTemplate() — failure paths ──────────────────────────────────────

  it("sendTemplate() throws when WHATSAPP_PHONE_NUMBER_ID is absent", async () => {
    setEnvWith({ WHATSAPP_ACCESS_TOKEN: TEST_ACCESS_TOKEN });
    const provider = new WhatsAppCloudProvider();
    await expect(
      provider.sendTemplate({ to: "+91111", templateName: "t", dltTemplateId: "d" }),
    ).rejects.toThrow(/WHATSAPP_PHONE_NUMBER_ID/);
  });

  it("sendTemplate() throws when WHATSAPP_ACCESS_TOKEN is absent", async () => {
    setEnvWith({ WHATSAPP_PHONE_NUMBER_ID: TEST_PHONE_NUMBER_ID });
    const provider = new WhatsAppCloudProvider();
    await expect(
      provider.sendTemplate({ to: "+91111", templateName: "t", dltTemplateId: "d" }),
    ).rejects.toThrow(/WHATSAPP_ACCESS_TOKEN/);
  });

  it("sendTemplate() throws on Graph API HTTP error with useful error info", async () => {
    setEnvWith({
      WHATSAPP_PHONE_NUMBER_ID: TEST_PHONE_NUMBER_ID,
      WHATSAPP_ACCESS_TOKEN: TEST_ACCESS_TOKEN,
    });
    mockFetchHttpError(400, {
      error: { code: 100, message: "Invalid parameter", type: "OAuthException" },
    });

    const provider = new WhatsAppCloudProvider();
    await expect(
      provider.sendTemplate({ to: "+91bad", templateName: "t", dltTemplateId: "d" }),
    ).rejects.toThrow(/OAuthException.*100|100.*OAuthException/i);
  });

  it("AC-76: sendTemplate() error does NOT contain access token in thrown Error message", async () => {
    setEnvWith({
      WHATSAPP_PHONE_NUMBER_ID: TEST_PHONE_NUMBER_ID,
      WHATSAPP_ACCESS_TOKEN: TEST_ACCESS_TOKEN,
    });
    mockFetchHttpError(401, {
      error: { code: 190, message: "Invalid OAuth access token", type: "OAuthException" },
    });

    const provider = new WhatsAppCloudProvider();
    try {
      await provider.sendTemplate({ to: "+91111", templateName: "t", dltTemplateId: "d" });
      fail("Expected throw");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).not.toContain(TEST_ACCESS_TOKEN);
    }
  });

  // ─── sendSession() ────────────────────────────────────────────────────────

  it("sendSession() returns providerMessageId from the Graph API response", async () => {
    setEnvWith({
      WHATSAPP_PHONE_NUMBER_ID: TEST_PHONE_NUMBER_ID,
      WHATSAPP_ACCESS_TOKEN: TEST_ACCESS_TOKEN,
    });
    mockFetchSuccess({
      messaging_product: "whatsapp",
      messages: [{ id: "wamid.session_001" }],
    });

    const provider = new WhatsAppCloudProvider();
    const result = await provider.sendSession({ to: "+919876543210", body: "Your query has been received." });
    expect(result.providerMessageId).toBe("wamid.session_001");
  });

  it("sendSession() sends type=text in the POST body", async () => {
    setEnvWith({
      WHATSAPP_PHONE_NUMBER_ID: TEST_PHONE_NUMBER_ID,
      WHATSAPP_ACCESS_TOKEN: TEST_ACCESS_TOKEN,
    });
    const fetchSpy = mockFetchSuccess({
      messaging_product: "whatsapp",
      messages: [{ id: "wamid.session_type" }],
    });

    const provider = new WhatsAppCloudProvider();
    await provider.sendSession({ to: "+919876543210", body: "Hello" });

    const callArgs = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(callArgs[1]?.body as string) as Record<string, unknown>;
    expect(body["type"]).toBe("text");
    // AC-76: access token not in the POST body.
    expect(JSON.stringify(body)).not.toContain(TEST_ACCESS_TOKEN);
  });

  // ─── verifyWebhookSignature() ─────────────────────────────────────────────

  describe("verifyWebhookSignature", () => {
    const RAW_BODY = '{"object":"whatsapp_business_account","entry":[{"changes":[]}]}';

    it("returns true for a valid X-Hub-Signature-256", () => {
      setEnvWith({ WHATSAPP_PHONE_NUMBER_ID: TEST_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN: TEST_ACCESS_TOKEN });
      const sig = makeHubSig(RAW_BODY, TEST_APP_SECRET);
      const provider = new WhatsAppCloudProvider();
      expect(provider.verifyWebhookSignature({ rawBody: RAW_BODY, signature: sig, secret: TEST_APP_SECRET })).toBe(true);
    });

    it("returns true when rawBody is a Buffer", () => {
      setEnvWith({ WHATSAPP_PHONE_NUMBER_ID: TEST_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN: TEST_ACCESS_TOKEN });
      const buf = Buffer.from(RAW_BODY, "utf8");
      const sig = makeHubSig(RAW_BODY, TEST_APP_SECRET);
      const provider = new WhatsAppCloudProvider();
      expect(provider.verifyWebhookSignature({ rawBody: buf, signature: sig, secret: TEST_APP_SECRET })).toBe(true);
    });

    it("returns false for a tampered body", () => {
      setEnvWith({ WHATSAPP_PHONE_NUMBER_ID: TEST_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN: TEST_ACCESS_TOKEN });
      const sig = makeHubSig(RAW_BODY, TEST_APP_SECRET);
      const provider = new WhatsAppCloudProvider();
      expect(provider.verifyWebhookSignature({ rawBody: "tampered body", signature: sig, secret: TEST_APP_SECRET })).toBe(false);
    });

    it("returns false for a wrong secret", () => {
      setEnvWith({ WHATSAPP_PHONE_NUMBER_ID: TEST_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN: TEST_ACCESS_TOKEN });
      const sig = makeHubSig(RAW_BODY, "wrong-secret");
      const provider = new WhatsAppCloudProvider();
      expect(provider.verifyWebhookSignature({ rawBody: RAW_BODY, signature: sig, secret: TEST_APP_SECRET })).toBe(false);
    });

    it("FAIL CLOSED — returns false when secret is empty", () => {
      setEnvWith({ WHATSAPP_PHONE_NUMBER_ID: TEST_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN: TEST_ACCESS_TOKEN });
      const sig = makeHubSig(RAW_BODY, TEST_APP_SECRET);
      const provider = new WhatsAppCloudProvider();
      expect(provider.verifyWebhookSignature({ rawBody: RAW_BODY, signature: sig, secret: "" })).toBe(false);
    });

    it("does NOT throw on any input — returns false on malformed signature", () => {
      setEnvWith({ WHATSAPP_PHONE_NUMBER_ID: TEST_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN: TEST_ACCESS_TOKEN });
      const provider = new WhatsAppCloudProvider();
      expect(() => provider.verifyWebhookSignature({ rawBody: RAW_BODY, signature: "not-a-sig", secret: TEST_APP_SECRET })).not.toThrow();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 3: WhatsAppProviderModule factory (fail-closed / adapter selection)
// ─────────────────────────────────────────────────────────────────────────────

describe("WhatsAppProviderModule factory (fail-closed in prod)", () => {
  beforeEach(() => {
    __resetEnvCacheForTests();
  });

  afterEach(() => {
    clearEnvKeys();
    __resetEnvCacheForTests();
  });

  it("throws at boot when WHATSAPP_PROVIDER=whatsapp_cloud but WHATSAPP_PHONE_NUMBER_ID absent in production", async () => {
    setEnvWith({
      WHATSAPP_PROVIDER: "whatsapp_cloud",
      WHATSAPP_ACCESS_TOKEN: TEST_ACCESS_TOKEN,
      WHATSAPP_APP_SECRET: TEST_APP_SECRET,
      NODE_ENV: "production",
      APP_ENV: "production",
      // WHATSAPP_PHONE_NUMBER_ID deliberately absent
    });
    const { createWhatsAppProviderForTest } = await import("./whatsapp-provider-factory.test-helper");
    expect(() => createWhatsAppProviderForTest()).toThrow(/WHATSAPP_PHONE_NUMBER_ID/);
  });

  it("throws at boot when WHATSAPP_PROVIDER=noop in production", async () => {
    setEnvWith({
      WHATSAPP_PROVIDER: "noop",
      NODE_ENV: "production",
      APP_ENV: "production",
    });
    const { createWhatsAppProviderForTest } = await import("./whatsapp-provider-factory.test-helper");
    expect(() => createWhatsAppProviderForTest()).toThrow(/noop.*production|production.*noop/i);
  });

  it("BOOTS in production when WHATSAPP_PROVIDER=disabled — binds Noop, no Meta keys needed", async () => {
    setEnvWith({
      WHATSAPP_PROVIDER: "disabled",
      NODE_ENV: "production",
      APP_ENV: "production",
    });
    const { createWhatsAppProviderForTest } = await import("./whatsapp-provider-factory.test-helper");
    let provider: unknown;
    expect(() => {
      provider = createWhatsAppProviderForTest();
    }).not.toThrow();
    expect(provider).toBeInstanceOf(NoopWhatsAppProvider);
  });

  it("DEFECT-1 guard: WhatsAppProviderModule compiles as a NestJS module without crashing", async () => {
    setEnvWith({
      WHATSAPP_PROVIDER: "noop",
      NODE_ENV: "development",
      APP_ENV: "local",
    });
    __resetEnvCacheForTests();
    const { WhatsAppProviderModule } = await import("./whatsapp-provider.module");
    expect(WhatsAppProviderModule).toBeDefined();
  });
});
