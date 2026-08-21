// apps/api/src/modules/commerce/providers/payment/razorpay-payment.provider.spec.ts
//
// Unit tests for RazorpayPaymentProvider and the NoopPaymentProvider test double.
//
// Test strategy (docs/plans/phase-2.md task #4 DoD, CLAUDE.md §3.10):
//   - All tests are UNIT tests, no live network calls, no real Razorpay keys.
//   - fetch() is mocked globally; the real `node:crypto` is used for HMAC verification
//     so that signature correctness is truly tested.
//   - Tests cover:
//       1. verifyPaymentSignature: known vector passes; tampered fails; wrong length fails.
//       2. verifyWebhookSignature: correct HMAC passes; wrong HMAC fails; absent secret
//          fails closed (returns false, no throw).
//       3. createOrder: asserts correct HTTP call shape (amount in paise, Basic auth header
//          present, body shape correct); maps response correctly; KEY_SECRET absent in result.
//       4. refund: asserts correct endpoint + body (amount paise); idempotency key header
//          forwarded; maps response correctly; KEY_SECRET absent in result.
//       5. fetchPayment: asserts correct GET endpoint; maps response correctly.
//       6. Error handling: HTTP 4xx/5xx from provider throws a safe error (no secret leakage).
//       7. NoopPaymentProvider: makePaymentSignature/makeWebhookSignature helpers produce
//          valid and intentionally-broken vectors for test fixture derivation.
//       8. timingSafeEqualStrings: length mismatch returns false without timing attack.
//
// Secrets invariant: KEY_SECRET ("test-secret-key") and WEBHOOK_SECRET ("test-wh-secret")
// are defined in this file and NEVER asserted to appear in any return value or log.

import { createHmac } from "node:crypto";
import { __resetEnvCacheForTests } from "../../../../config/env";
import { RazorpayPaymentProvider, timingSafeEqualStrings } from "./razorpay-payment.provider";
import { NoopPaymentProvider } from "./noop-payment.provider";

// ─────────────────────────────────────────────────────────────────────────────
// Test constants (never real values, isolated from any real env)
// ─────────────────────────────────────────────────────────────────────────────

const TEST_KEY_ID = "rzp_test_TESTKEYID00001";
const TEST_KEY_SECRET = "test-secret-key-do-not-use-in-prod";
const TEST_WEBHOOK_SECRET = "test-wh-secret-do-not-use-in-prod";

// ─────────────────────────────────────────────────────────────────────────────
// HMAC helpers (mirrors the production logic for fixture generation)
// ─────────────────────────────────────────────────────────────────────────────

function makePaymentHmac(orderId: string, paymentId: string, secret: string = TEST_KEY_SECRET): string {
  return createHmac("sha256", secret).update(`${orderId}|${paymentId}`, "utf8").digest("hex");
}

function makeWebhookHmac(body: string | Buffer, secret: string = TEST_WEBHOOK_SECRET): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

// ─────────────────────────────────────────────────────────────────────────────
// Env + fetch mocking utilities
// ─────────────────────────────────────────────────────────────────────────────

function setTestEnv(overrides: Record<string, string | undefined> = {}): void {
  process.env["RAZORPAY_KEY_ID"] = TEST_KEY_ID;
  process.env["RAZORPAY_KEY_SECRET"] = TEST_KEY_SECRET;
  process.env["RAZORPAY_WEBHOOK_SECRET"] = TEST_WEBHOOK_SECRET;
  // Minimal required vars so validateEnv doesn't throw on missing required fields
  process.env["DATABASE_URL"] = "postgresql://test:test@localhost:5432/test";
  process.env["REDIS_URL"] = "redis://localhost:6379";
  process.env["JWT_PRIVATE_KEY_PATH"] = "./keys/jwt-private.pem";
  process.env["JWT_PUBLIC_KEY_PATH"] = "./keys/jwt-public.pem";
  process.env["COOKIE_SECRET"] = "test-cookie-secret-at-least-32-chars-long!!";
  process.env["CSRF_SECRET"] = "test-csrf-secret-at-least-32-chars-long!!!";
  Object.assign(process.env, overrides);
}

function clearTestEnv(): void {
  delete process.env["RAZORPAY_KEY_ID"];
  delete process.env["RAZORPAY_KEY_SECRET"];
  delete process.env["RAZORPAY_WEBHOOK_SECRET"];
  delete process.env["DATABASE_URL"];
  delete process.env["REDIS_URL"];
  delete process.env["JWT_PRIVATE_KEY_PATH"];
  delete process.env["JWT_PUBLIC_KEY_PATH"];
  delete process.env["COOKIE_SECRET"];
  delete process.env["CSRF_SECRET"];
}

type FetchMock = jest.MockedFunction<typeof fetch>;

function mockFetchOk(body: unknown): FetchMock {
  const mockFn = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Response);
  global.fetch = mockFn;
  return mockFn;
}

function mockFetchError(status: number, errorBody: unknown): FetchMock {
  const mockFn = jest.fn().mockResolvedValue({
    ok: false,
    status,
    statusText: "Bad Request",
    json: jest.fn().mockResolvedValue(errorBody),
  } as unknown as Response);
  global.fetch = mockFn;
  return mockFn;
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite: timingSafeEqualStrings (exported helper)
// ─────────────────────────────────────────────────────────────────────────────

describe("timingSafeEqualStrings", () => {
  it("returns true for identical strings", () => {
    expect(timingSafeEqualStrings("abc123", "abc123")).toBe(true);
  });

  it("returns false for strings with different content but same length", () => {
    expect(timingSafeEqualStrings("abc123", "xyz789")).toBe(false);
  });

  it("returns false when lengths differ (shorter b)", () => {
    expect(timingSafeEqualStrings("abc123", "abc12")).toBe(false);
  });

  it("returns false when lengths differ (longer b)", () => {
    expect(timingSafeEqualStrings("abc", "abcdef")).toBe(false);
  });

  it("returns true for empty strings", () => {
    expect(timingSafeEqualStrings("", "")).toBe(true);
  });

  it("returns false for empty vs non-empty", () => {
    expect(timingSafeEqualStrings("", "a")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite: RazorpayPaymentProvider
// ─────────────────────────────────────────────────────────────────────────────

describe("RazorpayPaymentProvider", () => {
  let provider: RazorpayPaymentProvider;
  const originalFetch = global.fetch;

  beforeEach(() => {
    __resetEnvCacheForTests();
    setTestEnv();
    provider = new RazorpayPaymentProvider();
  });

  afterEach(() => {
    clearTestEnv();
    __resetEnvCacheForTests();
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // verifyPaymentSignature
  // ─────────────────────────────────────────────────────────────────────────

  describe("verifyPaymentSignature", () => {
    const ORDER_ID = "order_test_AbCdEf1234";
    const PAYMENT_ID = "pay_test_XyZ9876543";

    it("returns true for a correct HMAC-SHA256 signature", () => {
      const sig = makePaymentHmac(ORDER_ID, PAYMENT_ID);
      expect(
        provider.verifyPaymentSignature({
          providerOrderId: ORDER_ID,
          providerPaymentId: PAYMENT_ID,
          signature: sig,
        }),
      ).toBe(true);
    });

    it("returns false for a tampered signature (single char changed)", () => {
      const sig = makePaymentHmac(ORDER_ID, PAYMENT_ID);
      // Flip the first hex char
      const tampered = (sig[0] === "a" ? "b" : "a") + sig.slice(1);
      expect(
        provider.verifyPaymentSignature({
          providerOrderId: ORDER_ID,
          providerPaymentId: PAYMENT_ID,
          signature: tampered,
        }),
      ).toBe(false);
    });

    it("returns false for an all-zeros signature", () => {
      const zeros = "0".repeat(64);
      expect(
        provider.verifyPaymentSignature({
          providerOrderId: ORDER_ID,
          providerPaymentId: PAYMENT_ID,
          signature: zeros,
        }),
      ).toBe(false);
    });

    it("returns false when orderId is swapped (message order matters)", () => {
      // A signature for (paymentId|orderId) instead of (orderId|paymentId) must fail
      const wrongOrderSig = createHmac("sha256", TEST_KEY_SECRET)
        .update(`${PAYMENT_ID}|${ORDER_ID}`, "utf8")
        .digest("hex");
      expect(
        provider.verifyPaymentSignature({
          providerOrderId: ORDER_ID,
          providerPaymentId: PAYMENT_ID,
          signature: wrongOrderSig,
        }),
      ).toBe(false);
    });

    it("returns false for a signature with wrong length (length leak protection)", () => {
      const shortSig = "abc123";
      expect(
        provider.verifyPaymentSignature({
          providerOrderId: ORDER_ID,
          providerPaymentId: PAYMENT_ID,
          signature: shortSig,
        }),
      ).toBe(false);
    });

    it("returns false for signature computed with a different secret", () => {
      const wrongSecretSig = makePaymentHmac(ORDER_ID, PAYMENT_ID, "wrong-secret");
      expect(
        provider.verifyPaymentSignature({
          providerOrderId: ORDER_ID,
          providerPaymentId: PAYMENT_ID,
          signature: wrongSecretSig,
        }),
      ).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // verifyWebhookSignature
  // ─────────────────────────────────────────────────────────────────────────

  describe("verifyWebhookSignature", () => {
    const RAW_BODY_STRING = '{"event":"payment.captured","payload":{"payment":{"entity":{"id":"pay_abc"}}}}';
    const RAW_BODY_BUFFER = Buffer.from(RAW_BODY_STRING, "utf8");

    it("returns true for a correct HMAC-SHA256 webhook signature (string body)", () => {
      const sig = makeWebhookHmac(RAW_BODY_STRING);
      expect(
        provider.verifyWebhookSignature({ rawBody: RAW_BODY_STRING, signature: sig }),
      ).toBe(true);
    });

    it("returns true for a correct HMAC-SHA256 webhook signature (Buffer body)", () => {
      const sig = makeWebhookHmac(RAW_BODY_BUFFER);
      expect(
        provider.verifyWebhookSignature({ rawBody: RAW_BODY_BUFFER, signature: sig }),
      ).toBe(true);
    });

    it("returns false for an incorrect webhook signature", () => {
      const wrongSig = makeWebhookHmac(RAW_BODY_STRING, "wrong-secret");
      expect(
        provider.verifyWebhookSignature({ rawBody: RAW_BODY_STRING, signature: wrongSig }),
      ).toBe(false);
    });

    it("returns false for a tampered body (HMAC no longer matches)", () => {
      const sig = makeWebhookHmac(RAW_BODY_STRING);
      const tamperedBody = RAW_BODY_STRING.replace("payment.captured", "payment.HACKED");
      expect(
        provider.verifyWebhookSignature({ rawBody: tamperedBody, signature: sig }),
      ).toBe(false);
    });

    it("FAIL CLOSED, returns false (not throw) when WEBHOOK_SECRET is not configured", () => {
      // Re-create the provider without WEBHOOK_SECRET
      __resetEnvCacheForTests();
      setTestEnv({ RAZORPAY_WEBHOOK_SECRET: undefined });
      delete process.env["RAZORPAY_WEBHOOK_SECRET"];
      __resetEnvCacheForTests();
      const providerNoSecret = new RazorpayPaymentProvider();

      const sig = makeWebhookHmac(RAW_BODY_STRING);
      // Must return false, not throw
      expect(
        providerNoSecret.verifyWebhookSignature({ rawBody: RAW_BODY_STRING, signature: sig }),
      ).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // createOrder
  // ─────────────────────────────────────────────────────────────────────────

  describe("createOrder", () => {
    it("calls the Razorpay /orders endpoint with correct body (amount in paise)", async () => {
      const mockResponse: Record<string, unknown> = {
        id: "order_test_CREATED001",
        amount: 49900,
        currency: "INR",
        receipt: "rcpt-order-uuid",
        status: "created",
      };
      const fetchMock = mockFetchOk(mockResponse);

      const result = await provider.createOrder({
        amountPaise: 49900,
        currency: "INR",
        receipt: "rcpt-order-uuid",
        notes: { orderId: "internal-order-uuid" },
      });

      // Verify fetch was called once
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Extract and validate the call arguments
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://api.razorpay.com/v1/orders");
      expect(init.method).toBe("POST");

      // Auth header MUST be present and MUST use Basic scheme
      const headers = init.headers as Record<string, string>;
      expect(headers["Authorization"]).toMatch(/^Basic /);

      // Auth header MUST encode key_id:key_secret, but we only verify the format,
      // not decode the base64, since KEY_SECRET must never be asserted on in tests.
      const authB64 = (headers["Authorization"] as string).replace("Basic ", "");
      const decoded = Buffer.from(authB64, "base64").toString("utf8");
      expect(decoded).toMatch(/^rzp_test_TESTKEYID00001:/);
      // The part after ":" must NOT be empty (secret is present), but we do NOT
      // assert on the secret value itself.
      const [, secretPart] = decoded.split(":");
      expect(secretPart).toBeTruthy();

      // Body shape: amount in paise, currency, receipt, notes
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body["amount"]).toBe(49900);
      expect(body["currency"]).toBe("INR");
      expect(body["receipt"]).toBe("rcpt-order-uuid");
      expect(body["notes"]).toEqual({ orderId: "internal-order-uuid" });

      // Result mapping
      expect(result.providerOrderId).toBe("order_test_CREATED001");
      expect(result.amountPaise).toBe(49900);
      expect(result.currency).toBe("INR");

      // KEY_SECRET must NOT appear in the result
      expect(JSON.stringify(result)).not.toContain(TEST_KEY_SECRET);
    });

    it("truncates receipt to 40 chars (Razorpay limit)", async () => {
      const longReceipt = "a".repeat(80);
      mockFetchOk({ id: "order_x", amount: 100, currency: "INR", receipt: "a".repeat(40), status: "created" });

      await provider.createOrder({ amountPaise: 100, currency: "INR", receipt: longReceipt });

      const [, init] = (global.fetch as FetchMock).mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect((body["receipt"] as string).length).toBe(40);
    });

    it("throws a safe error on Razorpay API HTTP 4xx (no secret in error message)", async () => {
      mockFetchError(400, { error: { description: "Invalid amount" } });

      await expect(
        provider.createOrder({ amountPaise: -1, currency: "INR", receipt: "bad" }),
      ).rejects.toThrow(/Razorpay API returned HTTP 400/);

      // Ensure the thrown error does not contain the secret
      try {
        await provider.createOrder({ amountPaise: -1, currency: "INR", receipt: "bad" });
      } catch (err) {
        expect(String(err)).not.toContain(TEST_KEY_SECRET);
        expect(String(err)).not.toContain(TEST_WEBHOOK_SECRET);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // refund
  // ─────────────────────────────────────────────────────────────────────────

  describe("refund", () => {
    it("calls the correct Razorpay endpoint with amount in paise and idempotency key", async () => {
      const mockResponse = {
        id: "rfnd_test_001",
        payment_id: "pay_test_001",
        amount: 25000,
        status: "processed",
      };
      const fetchMock = mockFetchOk(mockResponse);

      const result = await provider.refund({
        providerPaymentId: "pay_test_001",
        amountPaise: 25000,
        notes: { reason: "Customer request" },
        idempotencyKey: "refund-row-uuid-here",
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://api.razorpay.com/v1/payments/pay_test_001/refund");
      expect(init.method).toBe("POST");

      // Auth header present
      const headers = init.headers as Record<string, string>;
      expect(headers["Authorization"]).toMatch(/^Basic /);

      // Idempotency key forwarded
      expect(headers["X-Razorpay-Idempotency-Key"]).toBe("refund-row-uuid-here");

      // Body: amount in paise, notes
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body["amount"]).toBe(25000);
      expect(body["notes"]).toEqual({ reason: "Customer request" });

      // Result mapping
      expect(result.providerRefundId).toBe("rfnd_test_001");
      expect(result.status).toBe("processed");
      expect(result.amountPaise).toBe(25000);

      // KEY_SECRET must NOT appear in the result
      expect(JSON.stringify(result)).not.toContain(TEST_KEY_SECRET);
    });

    it("omits amount field when amountPaise is not provided (full refund)", async () => {
      mockFetchOk({ id: "rfnd_full_001", payment_id: "pay_001", amount: 50000, status: "processed" });

      await provider.refund({ providerPaymentId: "pay_001" });

      const [, init] = (global.fetch as FetchMock).mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      // amount should NOT be present for full refund
      expect("amount" in body).toBe(false);
    });

    it("does not include idempotency header when no key provided", async () => {
      mockFetchOk({ id: "rfnd_002", payment_id: "pay_002", amount: 10000, status: "processed" });

      await provider.refund({ providerPaymentId: "pay_002", amountPaise: 10000 });

      const [, init] = (global.fetch as FetchMock).mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers["X-Razorpay-Idempotency-Key"]).toBeUndefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // fetchPayment
  // ─────────────────────────────────────────────────────────────────────────

  describe("fetchPayment", () => {
    it("calls the correct GET endpoint and maps the response", async () => {
      const mockResponse = {
        id: "pay_test_888",
        amount: 99900,
        status: "captured",
        method: "upi",
      };
      const fetchMock = mockFetchOk(mockResponse);

      const result = await provider.fetchPayment("pay_test_888");

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://api.razorpay.com/v1/payments/pay_test_888");
      expect(init.method).toBe("GET");

      expect(result.status).toBe("captured");
      expect(result.amountPaise).toBe(99900);
      expect(result.method).toBe("upi");

      // Secret not in result
      expect(JSON.stringify(result)).not.toContain(TEST_KEY_SECRET);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Boot-time config errors
  // ─────────────────────────────────────────────────────────────────────────

  describe("constructor, config validation (boots without keys, validates lazily)", () => {
    // The provider must NOT throw at construction when keys are absent: the app has
    // to boot in envs without payment configured (dev, Phase-0, integration tests of
    // unrelated modules that build the full AppModule). Instead it warns at construction
    // and validates LAZILY, payment operations throw at call time, signature checks
    // fail closed.

    it("does NOT throw at construction when RAZORPAY_KEY_ID is absent, but createOrder throws lazily", async () => {
      __resetEnvCacheForTests();
      setTestEnv({ RAZORPAY_KEY_ID: undefined });
      delete process.env["RAZORPAY_KEY_ID"];
      __resetEnvCacheForTests();

      let providerNoKey!: RazorpayPaymentProvider;
      expect(() => {
        providerNoKey = new RazorpayPaymentProvider();
      }).not.toThrow();

      await expect(
        providerNoKey.createOrder({ amountPaise: 100, currency: "INR", receipt: "r" }),
      ).rejects.toThrow(/RAZORPAY_KEY_ID\/RAZORPAY_KEY_SECRET not configured/);
    });

    it("does NOT throw at construction when RAZORPAY_KEY_SECRET is absent; verifyPaymentSignature fails closed", () => {
      __resetEnvCacheForTests();
      setTestEnv({ RAZORPAY_KEY_SECRET: undefined });
      delete process.env["RAZORPAY_KEY_SECRET"];
      __resetEnvCacheForTests();

      let providerNoSecret!: RazorpayPaymentProvider;
      expect(() => {
        providerNoSecret = new RazorpayPaymentProvider();
      }).not.toThrow();

      // Fail closed: without the secret we cannot verify, so reject rather than accept.
      expect(
        providerNoSecret.verifyPaymentSignature({
          providerOrderId: "order_test123",
          providerPaymentId: "pay_test123",
          signature: "anything",
        }),
      ).toBe(false);
    });

    it("does NOT throw when RAZORPAY_WEBHOOK_SECRET is absent (optional)", () => {
      __resetEnvCacheForTests();
      setTestEnv({ RAZORPAY_WEBHOOK_SECRET: undefined });
      delete process.env["RAZORPAY_WEBHOOK_SECRET"];
      __resetEnvCacheForTests();

      expect(() => new RazorpayPaymentProvider()).not.toThrow();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite: NoopPaymentProvider (test double)
// ─────────────────────────────────────────────────────────────────────────────

describe("NoopPaymentProvider", () => {
  describe("makePaymentSignature (static helper)", () => {
    it("produces a hex string usable as a valid signature for verifyPaymentSignature", () => {
      const ORDER_ID = "order_noop_001";
      const PAYMENT_ID = "pay_noop_001";
      const provider = new NoopPaymentProvider();

      const sig = NoopPaymentProvider.makePaymentSignature(ORDER_ID, PAYMENT_ID);
      expect(provider.verifyPaymentSignature({
        providerOrderId: ORDER_ID,
        providerPaymentId: PAYMENT_ID,
        signature: sig,
      })).toBe(true);
    });

    it("produces a signature that FAILS verification with a different secret", () => {
      const ORDER_ID = "order_noop_002";
      const PAYMENT_ID = "pay_noop_002";
      // Default noop uses "test-key-secret"; build a provider with a different secret
      const providerDifferentSecret = new NoopPaymentProvider({ signatureSecret: "different" });
      const sig = NoopPaymentProvider.makePaymentSignature(ORDER_ID, PAYMENT_ID);
      expect(providerDifferentSecret.verifyPaymentSignature({
        providerOrderId: ORDER_ID,
        providerPaymentId: PAYMENT_ID,
        signature: sig,
      })).toBe(false);
    });
  });

  describe("makeWebhookSignature (static helper)", () => {
    it("produces a valid webhook signature for verifyWebhookSignature", () => {
      const provider = new NoopPaymentProvider();
      const rawBody = '{"event":"payment.captured"}';
      const sig = NoopPaymentProvider.makeWebhookSignature(rawBody);

      expect(provider.verifyWebhookSignature({ rawBody, signature: sig })).toBe(true);
    });

    it("produces a valid signature for a Buffer body", () => {
      const provider = new NoopPaymentProvider();
      const rawBody = Buffer.from('{"event":"payment.captured"}', "utf8");
      const sig = NoopPaymentProvider.makeWebhookSignature(rawBody);

      expect(provider.verifyWebhookSignature({ rawBody, signature: sig })).toBe(true);
    });
  });

  describe("verifyWebhookSignature, FAIL CLOSED when secret absent", () => {
    it("returns false (not throw) when simulateWebhookSecretAbsent is true", () => {
      const provider = new NoopPaymentProvider({ simulateWebhookSecretAbsent: true });
      const rawBody = '{"event":"payment.captured"}';
      // Even a "valid" signature for the default secret must be rejected
      const sig = NoopPaymentProvider.makeWebhookSignature(rawBody);

      expect(provider.verifyWebhookSignature({ rawBody, signature: sig })).toBe(false);
    });
  });

  describe("createOrder", () => {
    it("returns a fake order id and echoes amount/currency without network calls", async () => {
      const provider = new NoopPaymentProvider();
      const result = await provider.createOrder({
        amountPaise: 10000,
        currency: "INR",
        receipt: "rcpt-test",
      });

      expect(result.providerOrderId).toMatch(/^order_test_/);
      expect(result.amountPaise).toBe(10000);
      expect(result.currency).toBe("INR");
    });
  });

  describe("refund", () => {
    it("returns a fake refund id with 'processed' status", async () => {
      const provider = new NoopPaymentProvider();
      const result = await provider.refund({
        providerPaymentId: "pay_noop_999",
        amountPaise: 5000,
        idempotencyKey: "idempotency-key-for-test",
      });

      expect(result.providerRefundId).toMatch(/^rfnd_test_/);
      expect(result.status).toBe("processed");
      expect(result.amountPaise).toBe(5000);
    });
  });
});
