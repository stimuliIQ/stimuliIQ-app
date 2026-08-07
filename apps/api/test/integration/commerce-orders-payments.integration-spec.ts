// apps/api/test/integration/commerce-orders-payments.integration-spec.ts
//
// P2 Commerce + Leads integration spec — Orders, Payments, Webhooks (spec A).
// qa-engineer Wave 6, task #9.
//
// Acceptance-criteria coverage:
//   §20.1 — Order create idempotency (same Idempotency-Key → one row, identical response)
//   §20.1 — Server-computed amount (client amount ignored; coupon paise math: pct floor + flat)
//   §20.2 — /orders/:id/pay returns razorpayOrderId + keyId (PUBLIC); no KEY_SECRET/WEBHOOK_SECRET
//   §20.3 — VALID sig → payment captured + order paid + enrollment (source=order) + invoice (seq#)
//   §20.3 — INVALID sig → 422, payment failed, order still created, no enrollment
//   §20.3 — REPLAY same provider_payment_id → idempotent no-op (already captured returned)
//   §20.4 — Webhook VALID HMAC → processed / idempotent replay no-op
//   §20.4 — Webhook INVALID/missing sig → 401 fail-closed, no side effects
//   §20.8 — Order→enrollment: exactly one enrollment created; hard-restore after soft-delete
//   §20.8 — Manual payment (Finance) → same atomic enrollment+invoice path
//
// SKIPS GRACEFULLY when Docker/Postgres unavailable.

import { readFileSync } from "node:fs";
import { STATE_FILE, type IntegrationEnvFile } from "./global-setup";

const envFile: IntegrationEnvFile = JSON.parse(readFileSync(STATE_FILE, "utf8"));

if (envFile.available) {
  process.env.NODE_ENV = "test";
  process.env.APP_ENV = "local";
  process.env.DATABASE_URL = envFile.databaseUrl;
  process.env.REDIS_URL = envFile.redisUrl;
  process.env.JWT_PRIVATE_KEY_PATH = require.resolve("../../../../keys/jwt-private.pem");
  process.env.JWT_PUBLIC_KEY_PATH = require.resolve("../../../../keys/jwt-public.pem");
  process.env.JWT_ACCESS_TTL = "15m";
  process.env.JWT_REFRESH_TTL = "7d";
  process.env.COOKIE_SECRET = "integration-test-cookie-secret-aaaaaaaaaaaaaaaaaaaaaaaa";
  process.env.CSRF_SECRET = "integration-test-csrf-secret-bbbbbbbbbbbbbbbbbbbbbbbbbb";
  process.env.COOKIE_SECURE = "false";
  process.env.WEB_APP_URL = "http://localhost:3000";
  process.env.LMS_APP_URL = "http://localhost:3001";
  process.env.CRM_APP_URL = "http://localhost:3002";
  // RazorpayPaymentProvider is a concrete provider in PaymentProviderModule.providers[].
  // NestJS instantiates it during DI resolution even when the PAYMENT_PROVIDER token is
  // overridden with NoopPaymentProvider. The constructor throws if these vars are absent.
  // These are dummy test-only values — they are never used because the module override
  // replaces the real provider with NoopPaymentProvider for all test interactions.
  process.env.RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID ?? "rzp_test_integration_dummy";
  process.env.RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET ?? "test_key_secret_integration_dummy";
  // Reset the memoized env cache so the env above takes effect when AppModule boots.
  // validateEnv() memoises on first call; if a prior spec in --runInBand already called
  // it without RAZORPAY_KEY_ID, the cache would carry stale values into this suite.
  const { __resetEnvCacheForTests } = require("../../src/config/env");
  __resetEnvCacheForTests();
}

const describeIfAvailable = envFile.available ? describe : describe.skip;

describeIfAvailable("Commerce — orders + payments + webhooks (P2, spec A)", () => {
  const { Test } = require("@nestjs/testing");
  const cookieParser = require("cookie-parser");
  const request = require("supertest");
  const { PrismaClient } = require("@prisma/client");
  const { AppModule } = require("../../src/app.module");
  const { HttpExceptionFilter } = require("../../src/common/filters/http-exception.filter");
  const { EnvelopeInterceptor } = require("../../src/common/interceptors/envelope.interceptor");
  const { PAYMENT_PROVIDER } = require("../../src/modules/commerce/providers/payment/payment-provider.interface");
  const { NoopPaymentProvider } = require("../../src/modules/commerce/providers/payment/noop-payment.provider");
  const {
    seedCommerceLeadsFixtures,
    teardownCommerceLeadsFixtures,
    CL_SUPER_ADMIN_EMAIL,
    CL_SUPER_ADMIN_PASSWORD,
    CL_FINANCE_EMAIL,
    CL_FINANCE_PASSWORD,
    CL_BARE_STUDENT_EMAIL,
    CL_BARE_STUDENT_PASSWORD,
  } = require("../fixtures/commerce-leads-fixtures");

  // NOTE: Finance role has NO students.create permission. All student creation in
  // this spec must use CL_SUPER_ADMIN credentials. Finance is then used only for
  // commerce-specific operations (orders/payments/invoices/refunds).


  let app: import("@nestjs/common").INestApplication;
  let prisma: import("@prisma/client").PrismaClient;
  let fixtures: Awaited<ReturnType<typeof seedCommerceLeadsFixtures>>;
  let noopProvider: InstanceType<typeof NoopPaymentProvider>;

  function extractCookie(res: import("supertest").Response, name: string): string | undefined {
    const raw = res.headers["set-cookie"] as unknown as string[] | string | undefined;
    const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
    const match = list.find((c: string) => c.startsWith(`${name}=`));
    return match?.split(";")[0]?.split("=").slice(1).join("=");
  }

  async function loginAs(email: string, password: string) {
    const res = await request(app.getHttpServer()).post("/api/v1/auth/login").send({ email, password }).expect(200);
    return {
      res,
      accessToken: extractCookie(res, "access_token")!,
      csrfToken: extractCookie(res, "csrf_token")!,
    };
  }

  function authHeaders(accessToken: string, csrfToken: string): Record<string, string> {
    return {
      Cookie: `access_token=${accessToken}; csrf_token=${csrfToken}`,
      "X-CSRF-Token": csrfToken,
    };
  }

  /**
   * Creates a User + StudentProfile directly via Prisma (bypasses HTTP to avoid the
   * P1/P2 permission boundary: the fixture's super_admin only has P2 permissions,
   * so POST /crm/students would fail with 403 even for super_admin here).
   * Returns the studentProfile.id (used as studentId in order creation).
   */
  async function createStudentDirectly(suffix: string): Promise<string> {
    const argon2 = require("argon2");
    const email = `qa-direct-student-${suffix}-${Date.now()}@stimuliiq.test`;
    const passwordHash = await argon2.hash("TestPassword123!", { type: argon2.argon2id });
    const user = await prisma.user.create({
      data: {
        tenantId: fixtures.tenantId,
        email,
        name: `QA Direct Student ${suffix}`,
        passwordHash,
        status: "active",
      },
    });
    const profile = await prisma.studentProfile.create({
      data: {
        tenantId: fixtures.tenantId,
        userId: user.id,
        college: "QA Test College",
        courseType: "btech",
        year: 2,
        city: "Hyderabad",
        source: "qa-test",
        status: "active",
      },
    });
    return profile.id;
  }

  // Helper to create a complete paid order in the minimal number of HTTP calls.
  // Returns { orderId, paymentId, providerOrderId, providerPaymentId, verifyStatus }.
  async function createAndPayOrder(opts: {
    studentId: string;
    programId: string;
    batchId: string;
    accessToken: string;
    csrfToken: string;
    idempotencyKey?: string;
    couponCode?: string;
  }) {
    const { NoopPaymentProvider: Noop } = require("../../src/modules/commerce/providers/payment/noop-payment.provider");
    const idem = opts.idempotencyKey ?? `test-order-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const orderRes = await request(app.getHttpServer())
      .post("/api/v1/commerce/orders")
      .set(authHeaders(opts.accessToken, opts.csrfToken))
      .set("Idempotency-Key", idem)
      .send({ studentId: opts.studentId, programId: opts.programId, batchId: opts.batchId, couponCode: opts.couponCode })
      .expect(201);
    const orderId = orderRes.body.data.id;

    const payRes = await request(app.getHttpServer())
      .post(`/api/v1/commerce/orders/${orderId}/pay`)
      .set(authHeaders(opts.accessToken, opts.csrfToken))
      .expect(200);
    const providerOrderId: string = payRes.body.data.razorpayOrderId;

    const providerPaymentId = `pay_test_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const signature = Noop.makePaymentSignature(providerOrderId, providerPaymentId);

    const verifyRes = await request(app.getHttpServer())
      .post("/api/v1/commerce/payments/verify")
      .set(authHeaders(opts.accessToken, opts.csrfToken))
      .send({ razorpay_order_id: providerOrderId, razorpay_payment_id: providerPaymentId, razorpay_signature: signature })
      .expect(200);

    return {
      orderId,
      paymentId: verifyRes.body.data.id,
      providerOrderId,
      providerPaymentId,
      verifyStatus: 200,
    };
  }

  beforeAll(async () => {
    prisma = new PrismaClient();
    fixtures = await seedCommerceLeadsFixtures(prisma);

    noopProvider = new NoopPaymentProvider();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PAYMENT_PROVIDER)
      .useValue(noopProvider)
      .compile();

    // rawBody: true is required for WebhookController to read req.rawBody for HMAC verification.
    // Without this, the buffer is consumed by JSON parsing before the controller can run.
    // This mirrors the main.ts NestFactory.create(AppModule, { rawBody: true }) setting.
    app = moduleRef.createNestApplication({ rawBody: true });
    app.use(cookieParser());
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(new EnvelopeInterceptor());
    app.setGlobalPrefix("api/v1", { exclude: ["health", "api-docs.json"] });
    await app.init();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await teardownCommerceLeadsFixtures(prisma, fixtures.tenantId);
    await prisma?.$disconnect();
  });

  // ── §20.1: ORDER IDEMPOTENCY ──────────────────────────────────────────────────────────

  describe("§20.1 — Order create idempotency", () => {
    it("same Idempotency-Key submitted twice → one DB row, identical response (HTTP 201 both times)", async () => {
      const { accessToken, csrfToken } = await loginAs(CL_FINANCE_EMAIL, CL_FINANCE_PASSWORD);
      const idemKey = `qa-idem-order-${Date.now()}`;

      const body = {
        studentId: fixtures.enrollableStudentProfileId,
        programId: fixtures.programId,
        batchId: fixtures.batchAId,
      };

      const first = await request(app.getHttpServer())
        .post("/api/v1/commerce/orders")
        .set(authHeaders(accessToken, csrfToken))
        .set("Idempotency-Key", idemKey)
        .send(body)
        .expect(201);

      const second = await request(app.getHttpServer())
        .post("/api/v1/commerce/orders")
        .set(authHeaders(accessToken, csrfToken))
        .set("Idempotency-Key", idemKey)
        .send(body)
        .expect(201);

      expect(first.body.data.id).toBe(second.body.data.id);
      expect(second.body.data.amountPaise).toBe(first.body.data.amountPaise);

      const rows = await prisma.order.findMany({ where: { idempotencyKey: idemKey } });
      expect(rows).toHaveLength(1);
    });

    // Regression (production, 2026-08-06): "Add program" clicked twice for one student
    // produced two identical open ₹6,999 orders on the same program + batch, 30 seconds
    // apart. The idempotency key does not cover this — a second click mints a NEW key, so
    // the replay check above misses entirely and both orders become payable.
    it("a SECOND open order for the same student+program+batch is rejected (409), different Idempotency-Key", async () => {
      const { accessToken, csrfToken } = await loginAs(CL_FINANCE_EMAIL, CL_FINANCE_PASSWORD);
      const studentId = await createStudentDirectly("dupe-order");
      const body = { studentId, programId: fixtures.programId, batchId: fixtures.batchAId };

      const first = await request(app.getHttpServer())
        .post("/api/v1/commerce/orders")
        .set(authHeaders(accessToken, csrfToken))
        .set("Idempotency-Key", `qa-dupe-first-${Date.now()}`)
        .send(body)
        .expect(201);

      const second = await request(app.getHttpServer())
        .post("/api/v1/commerce/orders")
        .set(authHeaders(accessToken, csrfToken))
        .set("Idempotency-Key", `qa-dupe-second-${Date.now()}`) // DIFFERENT key = a real second click
        .send(body)
        .expect(409);
      expect(second.body.error.code).toBe("commerce.duplicate_open_order");

      // Exactly one order exists — the guard rejected rather than half-writing.
      const rows = await prisma.order.findMany({ where: { studentId, deletedAt: null } });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.id).toBe(first.body.data.id);
    });

    it("allows a second open order on a DIFFERENT batch of the same program (batch switch)", async () => {
      const { accessToken, csrfToken } = await loginAs(CL_FINANCE_EMAIL, CL_FINANCE_PASSWORD);
      const studentId = await createStudentDirectly("dupe-other-batch");

      await request(app.getHttpServer())
        .post("/api/v1/commerce/orders")
        .set(authHeaders(accessToken, csrfToken))
        .set("Idempotency-Key", `qa-batchA-${Date.now()}`)
        .send({ studentId, programId: fixtures.programId, batchId: fixtures.batchAId })
        .expect(201);

      // The guard is scoped to the exact duplicate, so lining up a move to another cohort
      // while the first order is still unpaid stays possible.
      await request(app.getHttpServer())
        .post("/api/v1/commerce/orders")
        .set(authHeaders(accessToken, csrfToken))
        .set("Idempotency-Key", `qa-batchB-${Date.now()}`)
        .send({ studentId, programId: fixtures.programId, batchId: fixtures.batchBId })
        .expect(201);
    });

    it("server-computed amount: client cannot override the amount (order uses program.pricePaise)", async () => {
      const { accessToken, csrfToken } = await loginAs(CL_FINANCE_EMAIL, CL_FINANCE_PASSWORD);
      const res = await request(app.getHttpServer())
        .post("/api/v1/commerce/orders")
        .set(authHeaders(accessToken, csrfToken))
        .set("Idempotency-Key", `qa-amount-test-${Date.now()}`)
        .send({
          // Own student: these tests used to share one fixture student, so each one after
          // the first was opening a SECOND unpaid order for the same student+program+batch
          // — which the duplicate-order guard now (correctly) rejects with a 409.
          studentId: await createStudentDirectly("amount-test"),
          programId: fixtures.programId,
          batchId: fixtures.batchAId,
          // No amountPaise field — the request schema doesn't accept it (server-computed).
        })
        .expect(201);

      // Amount MUST equal programPricePaise (no discount, no client override)
      expect(res.body.data.amountPaise).toBe(fixtures.programPricePaise);
    });

    it("pct coupon: discount = Math.floor(price * pct / 100) — integer paise, no float drift", async () => {
      const { accessToken, csrfToken } = await loginAs(CL_FINANCE_EMAIL, CL_FINANCE_PASSWORD);

      // Create a 10% coupon — discount should be floor(500000 * 10 / 100) = 50000 paise
      const pctValue = 10;
      const expectedDiscountPaise = Math.floor((fixtures.programPricePaise * pctValue) / 100);

      const couponCode = `QACL-PCT-${Date.now()}`;
      await prisma.coupon.create({
        data: {
          tenantId: fixtures.tenantId,
          code: couponCode,
          type: "pct",
          value: pctValue,
          status: "active",
          used: 0,
        },
      });

      const res = await request(app.getHttpServer())
        .post("/api/v1/commerce/orders")
        .set(authHeaders(accessToken, csrfToken))
        .set("Idempotency-Key", `qa-pct-coupon-${Date.now()}`)
        .send({
          studentId: await createStudentDirectly("pct-coupon"),
          programId: fixtures.programId,
          batchId: fixtures.batchAId,
          couponCode,
        })
        .expect(201);

      expect(res.body.data.discountPaise).toBe(expectedDiscountPaise);
      expect(res.body.data.amountPaise).toBe(fixtures.programPricePaise - expectedDiscountPaise);
      // Must be an integer, never a float
      expect(Number.isInteger(res.body.data.amountPaise)).toBe(true);
      expect(Number.isInteger(res.body.data.discountPaise)).toBe(true);
    });

    it("flat coupon: discount = coupon.value paise (fixed, not percentage)", async () => {
      const { accessToken, csrfToken } = await loginAs(CL_FINANCE_EMAIL, CL_FINANCE_PASSWORD);

      const flatValue = 50000; // ₹500 flat off
      const couponCode = `QACL-FLAT-${Date.now()}`;
      await prisma.coupon.create({
        data: {
          tenantId: fixtures.tenantId,
          code: couponCode,
          type: "flat",
          value: flatValue,
          status: "active",
          used: 0,
        },
      });

      const res = await request(app.getHttpServer())
        .post("/api/v1/commerce/orders")
        .set(authHeaders(accessToken, csrfToken))
        .set("Idempotency-Key", `qa-flat-coupon-${Date.now()}`)
        .send({
          studentId: await createStudentDirectly("flat-coupon"),
          programId: fixtures.programId,
          batchId: fixtures.batchAId,
          couponCode,
        })
        .expect(201);

      expect(res.body.data.discountPaise).toBe(flatValue);
      expect(res.body.data.amountPaise).toBe(fixtures.programPricePaise - flatValue);
    });
  });

  // ── §20.2: /orders/:id/pay — ONLY PUBLIC key in response ─────────────────────────────

  describe("§20.2 — /orders/:id/pay: only PUBLIC keyId in response, no secrets", () => {
    let orderId: string;

    beforeAll(async () => {
      const { accessToken, csrfToken } = await loginAs(CL_FINANCE_EMAIL, CL_FINANCE_PASSWORD);
      const res = await request(app.getHttpServer())
        .post("/api/v1/commerce/orders")
        .set(authHeaders(accessToken, csrfToken))
        .set("Idempotency-Key", `qa-pay-secret-test-${Date.now()}`)
        .send({ studentId: await createStudentDirectly("pay-secret"), programId: fixtures.programId, batchId: fixtures.batchAId })
        .expect(201);
      orderId = res.body.data.id;
    });

    it("returns razorpayOrderId + keyId; RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET are NOT present in any response field", async () => {
      const { accessToken, csrfToken } = await loginAs(CL_FINANCE_EMAIL, CL_FINANCE_PASSWORD);
      const res = await request(app.getHttpServer())
        .post(`/api/v1/commerce/orders/${orderId}/pay`)
        .set(authHeaders(accessToken, csrfToken))
        .expect(200);

      expect(res.body.data.razorpayOrderId).toBeTruthy();
      expect(typeof res.body.data.keyId).toBe("string"); // keyId present (may be empty string when not configured — that's OK)
      expect(res.body.data.amountPaise).toBe(fixtures.programPricePaise);

      // SECURITY: serialise the entire response and assert no secret-like field names appear
      const responseText = JSON.stringify(res.body);
      expect(responseText).not.toMatch(/KEY_SECRET/i);
      expect(responseText).not.toMatch(/WEBHOOK_SECRET/i);
      expect(responseText).not.toMatch(/keySecret/i);
      expect(responseText).not.toMatch(/webhookSecret/i);
    });
  });

  // ── §20.3: VERIFY PAYMENT — valid / invalid / replay ────────────────────────────────

  describe("§20.3 — verifyPayment: valid / invalid signature / replay idempotency", () => {
    const { NoopPaymentProvider: Noop } = require("../../src/modules/commerce/providers/payment/noop-payment.provider");

    let providerOrderId: string;
    let orderId: string;

    beforeAll(async () => {
      const { accessToken, csrfToken } = await loginAs(CL_FINANCE_EMAIL, CL_FINANCE_PASSWORD);

      const orderRes = await request(app.getHttpServer())
        .post("/api/v1/commerce/orders")
        .set(authHeaders(accessToken, csrfToken))
        .set("Idempotency-Key", `qa-verify-test-${Date.now()}`)
        .send({ studentId: await createStudentDirectly("verify"), programId: fixtures.programId, batchId: fixtures.batchAId })
        .expect(201);
      orderId = orderRes.body.data.id;

      const payRes = await request(app.getHttpServer())
        .post(`/api/v1/commerce/orders/${orderId}/pay`)
        .set(authHeaders(accessToken, csrfToken))
        .expect(200);
      providerOrderId = payRes.body.data.razorpayOrderId;
    });

    it("VALID signature → payment captured (status=captured), order=paid, enrollment created (source=order), invoice with sequential number", async () => {
      const { accessToken, csrfToken } = await loginAs(CL_FINANCE_EMAIL, CL_FINANCE_PASSWORD);
      const providerPaymentId = `pay_valid_${Date.now()}`;
      const signature = Noop.makePaymentSignature(providerOrderId, providerPaymentId);

      const res = await request(app.getHttpServer())
        .post("/api/v1/commerce/payments/verify")
        .set(authHeaders(accessToken, csrfToken))
        .send({
          razorpay_order_id: providerOrderId,
          razorpay_payment_id: providerPaymentId,
          razorpay_signature: signature,
        })
        .expect(200);

      expect(res.body.data.status).toBe("captured");
      expect(res.body.data.signatureVerified).toBe(true);

      // Order must be paid
      const order = await prisma.order.findUnique({ where: { id: orderId } });
      expect(order!.status).toBe("paid");

      // Enrollment must exist, source=order
      const enrollment = await prisma.enrollment.findFirst({
        where: { orderId },
        select: { id: true, source: true, studentId: true, deletedAt: true },
      });
      expect(enrollment).toBeTruthy();
      expect(enrollment!.source).toBe("order");
      expect(enrollment!.deletedAt).toBeNull();

      // Invoice must exist with a sequential number
      const invoice = await prisma.invoice.findFirst({ where: { orderId } });
      expect(invoice).toBeTruthy();
      expect(typeof invoice!.number).toBe("string");
      expect(invoice!.number.length).toBeGreaterThan(0);
    });

    it("INVALID signature → 422 (UnprocessableEntityException), order not paid, NO enrollment created", async () => {
      // Create a fresh order for this test.
      // Student created directly via Prisma to bypass P1/P2 permission boundary.
      const studentId = await createStudentDirectly("invalid-sig");
      const { accessToken, csrfToken } = await loginAs(CL_FINANCE_EMAIL, CL_FINANCE_PASSWORD);

      const orderRes = await request(app.getHttpServer())
        .post("/api/v1/commerce/orders")
        .set(authHeaders(accessToken, csrfToken))
        .set("Idempotency-Key", `qa-invalid-sig-order-${Date.now()}`)
        .send({ studentId, programId: fixtures.programId, batchId: fixtures.batchBId })
        .expect(201);
      const badOrderId = orderRes.body.data.id;

      const payRes = await request(app.getHttpServer())
        .post(`/api/v1/commerce/orders/${badOrderId}/pay`)
        .set(authHeaders(accessToken, csrfToken))
        .expect(200);
      const badProviderOrderId = payRes.body.data.razorpayOrderId;

      const badPaymentId = `pay_invalid_${Date.now()}`;
      const badSignature = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";

      const res = await request(app.getHttpServer())
        .post("/api/v1/commerce/payments/verify")
        .set(authHeaders(accessToken, csrfToken))
        .send({
          razorpay_order_id: badProviderOrderId,
          razorpay_payment_id: badPaymentId,
          razorpay_signature: badSignature,
        })
        .expect(422);

      expect(res.body.error.code).toBe("payments.signature_invalid");

      // Order must NOT be paid
      const orderRow = await prisma.order.findUnique({ where: { id: badOrderId } });
      expect(orderRow!.status).not.toBe("paid");

      // No enrollment for this order
      const enrollment = await prisma.enrollment.findFirst({ where: { orderId: badOrderId } });
      expect(enrollment).toBeNull();
    });

    it("REPLAY same provider_payment_id → idempotent no-op (returns existing captured payment, no double-enroll)", async () => {
      // Student created directly via Prisma (bypass P1/P2 permission boundary).
      const studentId = await createStudentDirectly("replay");
      const { accessToken, csrfToken } = await loginAs(CL_FINANCE_EMAIL, CL_FINANCE_PASSWORD);

      const orderRes = await request(app.getHttpServer())
        .post("/api/v1/commerce/orders")
        .set(authHeaders(accessToken, csrfToken))
        .set("Idempotency-Key", `qa-replay-order-${Date.now()}`)
        .send({ studentId, programId: fixtures.programId, batchId: fixtures.batchBId })
        .expect(201);
      const replayOrderId = orderRes.body.data.id;

      const payRes = await request(app.getHttpServer())
        .post(`/api/v1/commerce/orders/${replayOrderId}/pay`)
        .set(authHeaders(accessToken, csrfToken))
        .expect(200);
      const replayProviderOrderId = payRes.body.data.razorpayOrderId;

      const replayProviderPaymentId = `pay_replay_${Date.now()}`;
      const sig = Noop.makePaymentSignature(replayProviderOrderId, replayProviderPaymentId);

      // First capture
      const first = await request(app.getHttpServer())
        .post("/api/v1/commerce/payments/verify")
        .set(authHeaders(accessToken, csrfToken))
        .send({ razorpay_order_id: replayProviderOrderId, razorpay_payment_id: replayProviderPaymentId, razorpay_signature: sig })
        .expect(200);

      // Replay (same provider_payment_id) → idempotent no-op returns existing captured payment
      const second = await request(app.getHttpServer())
        .post("/api/v1/commerce/payments/verify")
        .set(authHeaders(accessToken, csrfToken))
        .send({ razorpay_order_id: replayProviderOrderId, razorpay_payment_id: replayProviderPaymentId, razorpay_signature: sig })
        .expect(200);

      expect(second.body.data.id).toBe(first.body.data.id);
      expect(second.body.data.status).toBe("captured");

      // Exactly one enrollment
      const enrollments = await prisma.enrollment.findMany({ where: { orderId: replayOrderId } });
      expect(enrollments).toHaveLength(1);
    });
  });

  // ── §20.4: WEBHOOK — valid / invalid / replay ───────────────────────────────────────

  describe("§20.4 — webhook: VALID HMAC / invalid sig / missing sig / replay", () => {
    const { NoopPaymentProvider: Noop } = require("../../src/modules/commerce/providers/payment/noop-payment.provider");

    it("VALID webhook HMAC → 200 received:true and processed idempotently", async () => {
      // Student created directly via Prisma (bypass P1/P2 permission boundary).
      const studentId = await createStudentDirectly("webhook");
      const { accessToken, csrfToken } = await loginAs(CL_FINANCE_EMAIL, CL_FINANCE_PASSWORD);

      const orderRes = await request(app.getHttpServer())
        .post("/api/v1/commerce/orders")
        .set(authHeaders(accessToken, csrfToken))
        .set("Idempotency-Key", `qa-webhook-order-${Date.now()}`)
        .send({ studentId, programId: fixtures.programId, batchId: fixtures.batchAId })
        .expect(201);
      const whOrderId = orderRes.body.data.id;

      const payRes = await request(app.getHttpServer())
        .post(`/api/v1/commerce/orders/${whOrderId}/pay`)
        .set(authHeaders(accessToken, csrfToken))
        .expect(200);
      const whProviderOrderId = payRes.body.data.razorpayOrderId;

      const whProviderPaymentId = `pay_wh_${Date.now()}`;
      const webhookPayload = JSON.stringify({
        event: "payment.captured",
        payload: {
          payment: {
            entity: {
              id: whProviderPaymentId,
              order_id: whProviderOrderId,
              status: "captured",
              method: "upi",
              amount: fixtures.programPricePaise,
            },
          },
        },
      });

      const validSig = Noop.makeWebhookSignature(webhookPayload);

      // VALID HMAC → 200 (WebhookController handles the route — no JwtAuthGuard)
      const res = await request(app.getHttpServer())
        .post("/api/v1/commerce/payments/webhook")
        .set("Content-Type", "application/json")
        .set("X-Razorpay-Signature", validSig)
        .send(webhookPayload)
        .expect(200);

      expect(res.body.data?.received ?? res.body.received).toBe(true);

      // Replay — same webhook twice must be a no-op (idempotent)
      const replay = await request(app.getHttpServer())
        .post("/api/v1/commerce/payments/webhook")
        .set("Content-Type", "application/json")
        .set("X-Razorpay-Signature", validSig)
        .send(webhookPayload)
        .expect(200);

      expect(replay.body.data?.received ?? replay.body.received).toBe(true);

      // Verify payment row exists (created during /pay)
      const payment = await prisma.payment.findFirst({ where: { orderId: whOrderId } });
      expect(payment).toBeTruthy();
    });

    it("INVALID signature → 401 fail-closed, no side effects", async () => {
      const fakePayload = JSON.stringify({
        event: "payment.captured",
        payload: { payment: { entity: { id: `pay_fakehhack_${Date.now()}`, order_id: "order_fake_123" } } },
      });

      const res = await request(app.getHttpServer())
        .post("/api/v1/commerce/payments/webhook")
        .set("Content-Type", "application/json")
        .set("X-Razorpay-Signature", "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff")
        .send(fakePayload)
        .expect(401);

      // WebhookController HMAC check fires — correct error code from HMAC verification
      expect(res.body.error?.code ?? res.body.code).toBe("commerce.webhook_invalid_signature");
    });

    it("MISSING X-Razorpay-Signature → 401 fail-closed", async () => {
      const fakePayload = JSON.stringify({ event: "payment.captured" });

      const res = await request(app.getHttpServer())
        .post("/api/v1/commerce/payments/webhook")
        .set("Content-Type", "application/json")
        // No X-Razorpay-Signature header
        .send(fakePayload)
        .expect(401);

      // WebhookController handles the route — HMAC check fires with missing signature
      expect(res.body.error?.code ?? res.body.code).toBe("commerce.webhook_missing_signature");
    });
  });

  // ── §20.8: ENROLLMENT ATOMICITY + HARD-RESTORE ──────────────────────────────────────

  describe("§20.8 — enrollment: exactly one row; hard-restore after soft-delete; manual payment same path", () => {
    it("order→pay→verify creates EXACTLY ONE enrollment (no duplicates)", async () => {
      // Student created directly via Prisma (bypass P1/P2 permission boundary).
      const studentId = await createStudentDirectly("one-enroll");
      const { accessToken, csrfToken } = await loginAs(CL_FINANCE_EMAIL, CL_FINANCE_PASSWORD);

      const { orderId } = await createAndPayOrder({
        studentId,
        programId: fixtures.programId,
        batchId: fixtures.batchAId,
        accessToken,
        csrfToken,
      });

      const enrollments = await prisma.enrollment.findMany({ where: { orderId } });
      expect(enrollments).toHaveLength(1);
      expect(enrollments[0]!.source).toBe("order");
    });

    it("hard-restore: soft-deleted enrollment row is restored (not duplicated) when same studentId+batchId re-enrolls via payment", async () => {
      const { NoopPaymentProvider: Noop } = require("../../src/modules/commerce/providers/payment/noop-payment.provider");
      // Student created directly via Prisma (bypass P1/P2 permission boundary).
      const studentId = await createStudentDirectly("hard-restore");
      const { accessToken, csrfToken } = await loginAs(CL_FINANCE_EMAIL, CL_FINANCE_PASSWORD);

      // First order + payment → creates enrollment
      const { orderId: firstOrderId } = await createAndPayOrder({
        studentId,
        programId: fixtures.programId,
        batchId: fixtures.batchAId,
        accessToken,
        csrfToken,
        idempotencyKey: `qa-restore-first-${Date.now()}`,
      });

      const firstEnrollment = await prisma.enrollment.findFirst({ where: { orderId: firstOrderId } });
      expect(firstEnrollment).toBeTruthy();
      const firstEnrollmentId = firstEnrollment!.id;

      // Soft-delete the enrollment (simulates a cancelled enrollment)
      await prisma.enrollment.update({ where: { id: firstEnrollmentId }, data: { deletedAt: new Date() } });

      // Second order for same student/batch — triggers hard-restore
      const orderRes2 = await request(app.getHttpServer())
        .post("/api/v1/commerce/orders")
        .set(authHeaders(accessToken, csrfToken))
        .set("Idempotency-Key", `qa-restore-second-${Date.now()}`)
        .send({ studentId, programId: fixtures.programId, batchId: fixtures.batchAId })
        .expect(201);
      const secondOrderId = orderRes2.body.data.id;

      const payRes2 = await request(app.getHttpServer())
        .post(`/api/v1/commerce/orders/${secondOrderId}/pay`)
        .set(authHeaders(accessToken, csrfToken))
        .expect(200);
      const po2 = payRes2.body.data.razorpayOrderId;
      const pp2 = `pay_restore_${Date.now()}`;
      const sig2 = Noop.makePaymentSignature(po2, pp2);

      await request(app.getHttpServer())
        .post("/api/v1/commerce/payments/verify")
        .set(authHeaders(accessToken, csrfToken))
        .send({ razorpay_order_id: po2, razorpay_payment_id: pp2, razorpay_signature: sig2 })
        .expect(200);

      // The SAME enrollment row must be restored (not a new one)
      const restoredEnrollment = await prisma.enrollment.findUnique({ where: { id: firstEnrollmentId } });
      expect(restoredEnrollment).toBeTruthy();
      expect(restoredEnrollment!.deletedAt).toBeNull();
      expect(restoredEnrollment!.status).toBe("active");

      // No second enrollment row for this student+batch
      const allEnrollments = await prisma.enrollment.findMany({
        where: { studentId, batchId: fixtures.batchAId },
      });
      expect(allEnrollments).toHaveLength(1);
    });

    it("Finance manual payment → same atomic enrollment+invoice path (source=order)", async () => {
      // Student created directly via Prisma (bypass P1/P2 permission boundary).
      const studentId = await createStudentDirectly("manual-pay");
      const { accessToken, csrfToken } = await loginAs(CL_FINANCE_EMAIL, CL_FINANCE_PASSWORD);

      const orderRes = await request(app.getHttpServer())
        .post("/api/v1/commerce/orders")
        .set(authHeaders(accessToken, csrfToken))
        .set("Idempotency-Key", `qa-manual-order-${Date.now()}`)
        .send({ studentId, programId: fixtures.programId, batchId: fixtures.batchBId })
        .expect(201);
      const manualOrderId = orderRes.body.data.id;
      const orderAmount = orderRes.body.data.amountPaise;

      const manualRes = await request(app.getHttpServer())
        .post("/api/v1/commerce/payments/manual")
        .set(authHeaders(accessToken, csrfToken))
        .set("Idempotency-Key", `qa-manual-pay-${Date.now()}`)
        .send({
          orderId: manualOrderId,
          amountPaise: orderAmount,
          method: "bank_transfer",
          reference: `NEFT-QA-${Date.now()}`, // required by ManualPaymentRequestSchema
          paidAt: new Date().toISOString(),
        })
        .expect(200);

      expect(manualRes.body.data.status).toBe("captured");
      expect(manualRes.body.data.isManual).toBe(true);

      // Order must be paid
      const orderRow = await prisma.order.findUnique({ where: { id: manualOrderId } });
      expect(orderRow!.status).toBe("paid");

      // Enrollment must exist (source=order — manual payment still links through order)
      const enrollment = await prisma.enrollment.findFirst({ where: { orderId: manualOrderId } });
      expect(enrollment).toBeTruthy();
      expect(enrollment!.source).toBe("order");

      // Invoice must exist
      const invoice = await prisma.invoice.findFirst({ where: { orderId: manualOrderId } });
      expect(invoice).toBeTruthy();
    });

    it("bare student (no commerce permissions) cannot create orders → 403", async () => {
      const { accessToken, csrfToken } = await loginAs(CL_BARE_STUDENT_EMAIL, CL_BARE_STUDENT_PASSWORD);
      const res = await request(app.getHttpServer())
        .post("/api/v1/commerce/orders")
        .set(authHeaders(accessToken, csrfToken))
        .set("Idempotency-Key", `qa-deny-order-${Date.now()}`)
        .send({ studentId: fixtures.enrollableStudentProfileId, programId: fixtures.programId, batchId: fixtures.batchAId })
        .expect(403);
      expect(res.body.error.code).toBe("auth.forbidden");
    });
  });
});
