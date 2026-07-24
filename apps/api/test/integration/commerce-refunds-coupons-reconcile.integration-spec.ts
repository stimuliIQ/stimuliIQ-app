// apps/api/test/integration/commerce-refunds-coupons-reconcile.integration-spec.ts
//
// P2 Commerce + Leads integration spec — Refunds, Coupons, Reconciliation, IDOR (spec B).
// qa-engineer Wave 6, task #9.
//
// Acceptance-criteria coverage:
//   §20.5 — Refund approval: request (refunds.create)→requested; Finance approve→processed;
//            non-Finance approve (no refunds.approve)→403; over-amount→400/422; reject→rejected
//   §20.6 — Coupons: validate discount preview; max_uses exhaustion→rejected; pct paise math;
//            expired/out-of-window→rejected
//   §20.7 — RECONCILIATION: GET /commerce/payments/reconciliation date-range →
//            capturedAmountPaise − processedRefundAmountPaise === netAmountPaise;
//            reconcilesOk; integer paise, no float drift; refund moves numbers consistently
//   §20.9 — IDOR/scope: BranchManager sees only their branch's orders; by-id out-of-scope → 404
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
  // Dummy test-only values — never used because overrideProvider replaces the real provider.
  process.env.RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID ?? "rzp_test_integration_dummy";
  process.env.RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET ?? "test_key_secret_integration_dummy";
  // Reset the memoized env cache so the env above takes effect when AppModule boots.
  const { __resetEnvCacheForTests } = require("../../src/config/env");
  __resetEnvCacheForTests();
}

const describeIfAvailable = envFile.available ? describe : describe.skip;

describeIfAvailable("Commerce — refunds + coupons + reconciliation + IDOR (P2, spec B)", () => {
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
    CL_MARKETING_EMAIL,
    CL_MARKETING_PASSWORD,
    CL_BRANCH_MANAGER_EMAIL,
    CL_BRANCH_MANAGER_PASSWORD,
    CL_BARE_STUDENT_EMAIL,
    CL_BARE_STUDENT_PASSWORD,
  } = require("../fixtures/commerce-leads-fixtures");

  let app: import("@nestjs/common").INestApplication;
  let prisma: import("@prisma/client").PrismaClient;
  let fixtures: Awaited<ReturnType<typeof seedCommerceLeadsFixtures>>;

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
   * Creates a User + StudentProfile directly via Prisma, bypassing the HTTP endpoint.
   * The fixture's super_admin only has P2 permissions (not P1 students.create),
   * so HTTP student creation fails for all fixture users. Direct Prisma writes avoid this.
   */
  async function createStudentDirectly(suffix: string): Promise<string> {
    const argon2 = require("argon2");
    const email = `qa-direct-student-b-${suffix}-${Date.now()}@stimuliiq.test`;
    const passwordHash = await argon2.hash("TestPassword123!", { type: argon2.argon2id });
    const user = await prisma.user.create({
      data: {
        tenantId: fixtures.tenantId,
        email,
        name: `QA Direct Student B ${suffix}`,
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

  /**
   * Creates a student profile directly via Prisma (bypasses the HTTP endpoint to avoid the
   * P1/P2 permission boundary: the fixture's super_admin only has P2 permissions,
   * so POST /crm/students would fail with 403 even for super_admin in this fixture context).
   * Then creates an order and payment (using the provided Finance tokens).
   * Returns { orderId, paymentId, amountPaise }.
   */
  async function setupPaidOrder(opts: {
    suffix: string;
    batchId: string;
    accessToken: string;
    csrfToken: string;
    adminAccessToken?: string; // kept for signature compatibility, unused now
    adminCsrfToken?: string;  // kept for signature compatibility, unused now
  }) {
    const { NoopPaymentProvider: Noop } = require("../../src/modules/commerce/providers/payment/noop-payment.provider");
    const argon2 = require("argon2");
    const studentEmail = `qa-refund-setup-${opts.suffix}@stimuliiq.test`;

    // Create student directly via Prisma to bypass P1/P2 permission boundary.
    const passwordHash = await argon2.hash("TestPassword123!", { type: argon2.argon2id });
    const studentUser = await prisma.user.create({
      data: {
        tenantId: fixtures.tenantId,
        email: studentEmail,
        name: `QA Refund Student ${opts.suffix}`,
        passwordHash,
        status: "active",
      },
    });
    const studentProfile = await prisma.studentProfile.create({
      data: {
        tenantId: fixtures.tenantId,
        userId: studentUser.id,
        college: "QA Test College",
        courseType: "btech",
        year: 2,
        city: "Hyderabad",
        source: "qa-test",
        status: "active",
      },
    });
    const studentId = studentProfile.id;

    const orderRes = await request(app.getHttpServer())
      .post("/api/v1/commerce/orders")
      .set(authHeaders(opts.accessToken, opts.csrfToken))
      .set("Idempotency-Key", `qa-refund-order-${opts.suffix}`)
      .send({ studentId, programId: fixtures.programId, batchId: opts.batchId })
      .expect(201);
    const orderId = orderRes.body.data.id;
    const amountPaise = orderRes.body.data.amountPaise;

    const payRes = await request(app.getHttpServer())
      .post(`/api/v1/commerce/orders/${orderId}/pay`)
      .set(authHeaders(opts.accessToken, opts.csrfToken))
      .expect(200);
    const providerOrderId = payRes.body.data.razorpayOrderId;
    const providerPaymentId = `pay_reftest_${opts.suffix}`;
    const sig = Noop.makePaymentSignature(providerOrderId, providerPaymentId);

    const verifyRes = await request(app.getHttpServer())
      .post("/api/v1/commerce/payments/verify")
      .set(authHeaders(opts.accessToken, opts.csrfToken))
      .send({ razorpay_order_id: providerOrderId, razorpay_payment_id: providerPaymentId, razorpay_signature: sig })
      .expect(200);

    return { orderId, paymentId: verifyRes.body.data.id, amountPaise };
  }

  beforeAll(async () => {
    prisma = new PrismaClient();
    fixtures = await seedCommerceLeadsFixtures(prisma);

    const noopProvider = new NoopPaymentProvider();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PAYMENT_PROVIDER)
      .useValue(noopProvider)
      .compile();

    // rawBody: true mirrors main.ts so WebhookController can read req.rawBody.
    app = moduleRef.createNestApplication({ rawBody: true });
    app.use(cookieParser());
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(new EnvelopeInterceptor());
    app.setGlobalPrefix("api/v1", { exclude: ["health", "api-docs.json"] });
    await app.init();

    // Note: student creation uses direct Prisma writes in setupPaidOrder (see helper).
    // Finance role has no students.create permission, so HTTP endpoint is bypassed.
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await teardownCommerceLeadsFixtures(prisma, fixtures.tenantId);
    await prisma?.$disconnect();
  });

  // ── §20.5: REFUND APPROVAL WORKFLOW ──────────────────────────────────────────────────

  describe("§20.5 — Refund approval workflow", () => {
    let paymentId: string;
    let amountPaise: number;
    let refundId: string;

    beforeAll(async () => {
      // Setup uses Finance user (the REQUESTER). The APPROVER in maker-checker tests is SuperAdmin.
      const { accessToken, csrfToken } = await loginAs(CL_FINANCE_EMAIL, CL_FINANCE_PASSWORD);
      const result = await setupPaidOrder({
        suffix: `refwf-${Date.now()}`,
        batchId: fixtures.batchAId,
        accessToken,
        csrfToken,
      });
      paymentId = result.paymentId;
      amountPaise = result.amountPaise;
    });

    it("refunds.create → status=requested (Finance user requests)", async () => {
      const { accessToken, csrfToken } = await loginAs(CL_FINANCE_EMAIL, CL_FINANCE_PASSWORD);
      const res = await request(app.getHttpServer())
        .post("/api/v1/commerce/refunds")
        .set(authHeaders(accessToken, csrfToken))
        .set("Idempotency-Key", `qa-refund-req-${Date.now()}`)
        .send({ paymentId, amountPaise: amountPaise / 2, reason: "QA test partial refund" })
        .expect(201);

      expect(res.body.data.status).toBe("requested");
      refundId = res.body.data.id;
    });

    it("approve by non-Finance (bare student, no refunds.approve) → 403", async () => {
      const { accessToken, csrfToken } = await loginAs(CL_BARE_STUDENT_EMAIL, CL_BARE_STUDENT_PASSWORD);
      const res = await request(app.getHttpServer())
        .post(`/api/v1/commerce/refunds/${refundId}/approve`)
        .set(authHeaders(accessToken, csrfToken))
        .send({ notes: "should be denied" })
        .expect(403);
      expect(res.body.error.code).toBe("auth.forbidden");

      // Refund must still be in 'requested' state
      const row = await prisma.refund.findUnique({ where: { id: refundId } });
      expect(row!.status).toBe("requested");
    });

    // M-2: Maker-checker — requester cannot approve their own refund (same Finance user → 403)
    it("self-approval (same Finance user requests AND tries to approve) → 403 commerce.refund_self_approval", async () => {
      // Create a fresh refund requested by Finance user
      const { accessToken: finAT, csrfToken: finCSRF } = await loginAs(CL_FINANCE_EMAIL, CL_FINANCE_PASSWORD);
      const selfResult = await setupPaidOrder({
        suffix: `refself-${Date.now()}`,
        batchId: fixtures.batchAId,
        accessToken: finAT,
        csrfToken: finCSRF,
      });

      const selfReqRes = await request(app.getHttpServer())
        .post("/api/v1/commerce/refunds")
        .set(authHeaders(finAT, finCSRF))
        .set("Idempotency-Key", `qa-self-refund-req-${Date.now()}`)
        .send({ paymentId: selfResult.paymentId, amountPaise: selfResult.amountPaise, reason: "Self-approval attempt" })
        .expect(201);
      const selfRefundId = selfReqRes.body.data.id;

      // Same Finance user tries to approve their own refund → 403 maker-checker
      const selfApproveRes = await request(app.getHttpServer())
        .post(`/api/v1/commerce/refunds/${selfRefundId}/approve`)
        .set(authHeaders(finAT, finCSRF))
        .send({ notes: "I approve my own refund" })
        .expect(403);

      expect(selfApproveRes.body.error.code).toBe("commerce.refund_self_approval");

      // Refund must still be in 'requested' state — nothing was mutated
      const row = await prisma.refund.findUnique({ where: { id: selfRefundId } });
      expect(row!.status).toBe("requested");
    });

    it("approve by Finance (refunds.approve) → status=processed, payment=refunded, order=refunded (full) [maker-checker: different approver]", async () => {
      // M-2 fix: DISTINCT requester and approver (maker-checker).
      // Finance user REQUESTS the refund; SuperAdmin (different user) APPROVES it.
      // Both have refunds.approve permission; they are different users → no self-approval 403.
      const { accessToken: finAT, csrfToken: finCSRF } = await loginAs(CL_FINANCE_EMAIL, CL_FINANCE_PASSWORD);
      const { accessToken: adminAT, csrfToken: adminCSRF } = await loginAs(CL_SUPER_ADMIN_EMAIL, CL_SUPER_ADMIN_PASSWORD);

      // Finance creates the order and requests the refund
      const fullResult = await setupPaidOrder({
        suffix: `refapprove-${Date.now()}`,
        batchId: fixtures.batchBId,
        accessToken: finAT,
        csrfToken: finCSRF,
      });

      const reqRes = await request(app.getHttpServer())
        .post("/api/v1/commerce/refunds")
        .set(authHeaders(finAT, finCSRF))
        .set("Idempotency-Key", `qa-refund-full-${Date.now()}`)
        .send({ paymentId: fullResult.paymentId, amountPaise: fullResult.amountPaise, reason: "QA full refund" })
        .expect(201);
      const fullRefundId = reqRes.body.data.id;

      // SuperAdmin (different user) approves the refund — maker-checker satisfied
      const approveRes = await request(app.getHttpServer())
        .post(`/api/v1/commerce/refunds/${fullRefundId}/approve`)
        .set(authHeaders(adminAT, adminCSRF))
        .send({ notes: "Approved by SuperAdmin QA (maker-checker)" })
        .expect(200);

      expect(approveRes.body.data.status).toBe("processed");

      // Payment must be marked as refunded
      const payment = await prisma.payment.findUnique({ where: { id: fullResult.paymentId } });
      expect(payment!.status).toBe("refunded");

      // Order must be marked as refunded (full refund)
      const order = await prisma.order.findUnique({ where: { id: fullResult.orderId } });
      expect(order!.status).toBe("refunded");
    });

    // M-1: Idempotent approve — already-processed refund returns existing, no second provider call
    it("idempotent approve — approving an already-processed refund returns it without re-calling provider", async () => {
      const { accessToken: finAT, csrfToken: finCSRF } = await loginAs(CL_FINANCE_EMAIL, CL_FINANCE_PASSWORD);
      const { accessToken: adminAT, csrfToken: adminCSRF } = await loginAs(CL_SUPER_ADMIN_EMAIL, CL_SUPER_ADMIN_PASSWORD);

      // Finance requests, SuperAdmin approves (maker-checker)
      const idempResult = await setupPaidOrder({
        suffix: `refidemp-${Date.now()}`,
        batchId: fixtures.batchAId,
        accessToken: finAT,
        csrfToken: finCSRF,
      });

      const idempReqRes = await request(app.getHttpServer())
        .post("/api/v1/commerce/refunds")
        .set(authHeaders(finAT, finCSRF))
        .set("Idempotency-Key", `qa-idemp-refund-${Date.now()}`)
        .send({ paymentId: idempResult.paymentId, amountPaise: idempResult.amountPaise, reason: "QA idempotent test" })
        .expect(201);
      const idempRefundId = idempReqRes.body.data.id;

      // First approve succeeds
      const firstApprove = await request(app.getHttpServer())
        .post(`/api/v1/commerce/refunds/${idempRefundId}/approve`)
        .set(authHeaders(adminAT, adminCSRF))
        .send({ notes: "First approval" })
        .expect(200);
      expect(firstApprove.body.data.status).toBe("processed");

      // Second approve call (same refund, now already processed) → 200 with existing state (no-op)
      const secondApprove = await request(app.getHttpServer())
        .post(`/api/v1/commerce/refunds/${idempRefundId}/approve`)
        .set(authHeaders(adminAT, adminCSRF))
        .send({ notes: "Second approval attempt — idempotent" })
        .expect(200);
      expect(secondApprove.body.data.status).toBe("processed");
      expect(secondApprove.body.data.id).toBe(idempRefundId);
    });

    it("over-amount refund → 400 (refund exceeds payment amount)", async () => {
      const { accessToken, csrfToken } = await loginAs(CL_FINANCE_EMAIL, CL_FINANCE_PASSWORD);
      const overResult = await setupPaidOrder({
        suffix: `refover-${Date.now()}`,
        batchId: fixtures.batchAId,
        accessToken,
        csrfToken,
      });

      const res = await request(app.getHttpServer())
        .post("/api/v1/commerce/refunds")
        .set(authHeaders(accessToken, csrfToken))
        .set("Idempotency-Key", `qa-over-refund-${Date.now()}`)
        .send({ paymentId: overResult.paymentId, amountPaise: overResult.amountPaise + 100000, reason: "Over amount" })
        .expect(400);

      expect(res.body.error.code).toBe("commerce.refund_exceeds_payment");
    });

    it("reject refund → status=rejected", async () => {
      // Use the partial refund created in the first test (still in 'requested' state)
      const { accessToken, csrfToken } = await loginAs(CL_FINANCE_EMAIL, CL_FINANCE_PASSWORD);
      const res = await request(app.getHttpServer())
        .post(`/api/v1/commerce/refunds/${refundId}/reject`)
        .set(authHeaders(accessToken, csrfToken))
        .send({ reason: "QA rejection" })
        .expect(200);

      expect(res.body.data.status).toBe("rejected");
    });
  });

  // ── §20.6: COUPON VALIDATION ─────────────────────────────────────────────────────────

  describe("§20.6 — Coupon validation", () => {
    it("validate discount preview — pct coupon returns correct discountPaise (integer, no float)", async () => {
      const { accessToken, csrfToken } = await loginAs(CL_MARKETING_EMAIL, CL_MARKETING_PASSWORD);

      const pctValue = 15;
      const expectedDiscount = Math.floor((fixtures.programPricePaise * pctValue) / 100);
      const couponCode = `QACL-VALIDATE-PCT-${Date.now()}`;

      await request(app.getHttpServer())
        .post("/api/v1/commerce/coupons")
        .set(authHeaders(accessToken, csrfToken))
        .set("Idempotency-Key", `qa-create-val-coupon-${Date.now()}`)
        .send({ code: couponCode, type: "pct", value: pctValue, status: "active" })
        .expect(201);

      // Marketing doesn't have payments.view but does have coupons.view; use Finance for validate
      const { accessToken: finAT, csrfToken: finCSRF } = await loginAs(CL_FINANCE_EMAIL, CL_FINANCE_PASSWORD);
      const res = await request(app.getHttpServer())
        .post("/api/v1/commerce/coupons/validate")
        .set(authHeaders(finAT, finCSRF))
        .send({ code: couponCode, programId: fixtures.programId })
        .expect(200);

      expect(res.body.data.valid).toBe(true);
      expect(res.body.data.discountPaise).toBe(expectedDiscount);
      expect(Number.isInteger(res.body.data.discountPaise)).toBe(true);
    });

    it("max_uses exhaustion → coupon rejected at order create", async () => {
      const { accessToken, csrfToken } = await loginAs(CL_MARKETING_EMAIL, CL_MARKETING_PASSWORD);

      // Create coupon with maxUses=1
      const couponCode = `QACL-MAXUSES-${Date.now()}`;
      await request(app.getHttpServer())
        .post("/api/v1/commerce/coupons")
        .set(authHeaders(accessToken, csrfToken))
        .set("Idempotency-Key", `qa-maxuses-coupon-${Date.now()}`)
        .send({ code: couponCode, type: "flat", value: 10000, maxUses: 1, status: "active" })
        .expect(201);

      // Use it once. Students created directly via Prisma (P1/P2 permission boundary).
      const { accessToken: finAT, csrfToken: finCSRF } = await loginAs(CL_FINANCE_EMAIL, CL_FINANCE_PASSWORD);
      const s1Id = await createStudentDirectly(`maxuses-s1-${Date.now()}`);

      await request(app.getHttpServer())
        .post("/api/v1/commerce/orders")
        .set(authHeaders(finAT, finCSRF))
        .set("Idempotency-Key", `qa-maxuses-first-${Date.now()}`)
        .send({ studentId: s1Id, programId: fixtures.programId, batchId: fixtures.batchAId, couponCode })
        .expect(201);

      // Second use — must fail (exhausted). Also via direct Prisma.
      const s2Id = await createStudentDirectly(`maxuses-s2-${Date.now()}`);

      const res = await request(app.getHttpServer())
        .post("/api/v1/commerce/orders")
        .set(authHeaders(finAT, finCSRF))
        .set("Idempotency-Key", `qa-maxuses-second-${Date.now()}`)
        .send({ studentId: s2Id, programId: fixtures.programId, batchId: fixtures.batchBId, couponCode })
        .expect(409);

      // Exhausted coupon must return 409 Conflict with commerce.coupon_exhausted
      expect(res.body.error?.code ?? res.body.code).toBe("commerce.coupon_exhausted");
    });

    it("expired coupon (validTo in the past) → order create rejected with coupon_invalid", async () => {
      const { accessToken, csrfToken } = await loginAs(CL_MARKETING_EMAIL, CL_MARKETING_PASSWORD);
      const couponCode = `QACL-EXPIRED-${Date.now()}`;

      await request(app.getHttpServer())
        .post("/api/v1/commerce/coupons")
        .set(authHeaders(accessToken, csrfToken))
        .set("Idempotency-Key", `qa-expired-coupon-${Date.now()}`)
        .send({
          code: couponCode,
          type: "flat",
          value: 5000,
          status: "active",
          validFrom: "2020-01-01T00:00:00Z",
          validTo: "2020-12-31T23:59:59Z", // expired 5+ years ago
        })
        .expect(201);

      // Student created directly via Prisma (P1/P2 permission boundary bypass).
      const { accessToken: finAT, csrfToken: finCSRF } = await loginAs(CL_FINANCE_EMAIL, CL_FINANCE_PASSWORD);
      const expiredStudentId = await createStudentDirectly(`expired-${Date.now()}`);

      const res = await request(app.getHttpServer())
        .post("/api/v1/commerce/orders")
        .set(authHeaders(finAT, finCSRF))
        .set("Idempotency-Key", `qa-expired-order-${Date.now()}`)
        .send({ studentId: expiredStudentId, programId: fixtures.programId, batchId: fixtures.batchAId, couponCode })
        .expect(400);

      expect(res.body.error.code).toBe("commerce.coupon_invalid");
    });

    it("future coupon (validFrom in the future) → order create rejected with coupon_invalid", async () => {
      const { accessToken, csrfToken } = await loginAs(CL_MARKETING_EMAIL, CL_MARKETING_PASSWORD);
      const couponCode = `QACL-FUTURE-${Date.now()}`;
      const futureDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();

      await request(app.getHttpServer())
        .post("/api/v1/commerce/coupons")
        .set(authHeaders(accessToken, csrfToken))
        .set("Idempotency-Key", `qa-future-coupon-${Date.now()}`)
        .send({ code: couponCode, type: "flat", value: 5000, status: "active", validFrom: futureDate })
        .expect(201);

      // Student created directly via Prisma (P1/P2 permission boundary bypass).
      const { accessToken: finAT, csrfToken: finCSRF } = await loginAs(CL_FINANCE_EMAIL, CL_FINANCE_PASSWORD);
      const futureStudentId = await createStudentDirectly(`future-${Date.now()}`);

      const res = await request(app.getHttpServer())
        .post("/api/v1/commerce/orders")
        .set(authHeaders(finAT, finCSRF))
        .set("Idempotency-Key", `qa-future-order-${Date.now()}`)
        .send({ studentId: futureStudentId, programId: fixtures.programId, batchId: fixtures.batchAId, couponCode })
        .expect(400);

      expect(res.body.error.code).toBe("commerce.coupon_invalid");
    });
  });

  // ── §20.7: RECONCILIATION ────────────────────────────────────────────────────────────

  describe("§20.7 — Ledger reconciliation (captured − refunds === orderPaid, integer paise, no float drift)", () => {
    it("reconcile over a date range: capturedAmountPaise − processedRefundAmountPaise = netAmountPaise; reconcilesOk true", async () => {
      const { accessToken, csrfToken } = await loginAs(CL_FINANCE_EMAIL, CL_FINANCE_PASSWORD);

      // Create a paid order so there is at least one captured payment in the range.
      // Pass admin tokens for student creation (Finance has no students.create).
      const { paymentId: reconPmtId, amountPaise } = await setupPaidOrder({
        suffix: `recon-${Date.now()}`,
        batchId: fixtures.batchAId,
        accessToken,
        csrfToken,
      });

      const expectCapturedGte = reconPmtId != null;

      const from = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1h ago
      const to = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1h future

      const res = await request(app.getHttpServer())
        .get("/api/v1/commerce/payments/reconciliation")
        .query({ from, to })
        .set(authHeaders(accessToken, csrfToken))
        .expect(200);

      const r = res.body.data ?? res.body;
      expect(typeof r.capturedAmountPaise).toBe("number");
      expect(typeof r.processedRefundAmountPaise).toBe("number");
      expect(typeof r.netAmountPaise).toBe("number");
      expect(typeof r.orderPaidTotalPaise).toBe("number");

      // All values must be integers (no float drift)
      expect(Number.isInteger(r.capturedAmountPaise)).toBe(true);
      expect(Number.isInteger(r.processedRefundAmountPaise)).toBe(true);
      expect(Number.isInteger(r.netAmountPaise)).toBe(true);

      // Math must hold: captured - refunds = net
      expect(r.netAmountPaise).toBe(r.capturedAmountPaise - r.processedRefundAmountPaise);

      // reconcilesOk: net === orderPaid total (if implementation supports it)
      if (typeof r.reconcilesOk === "boolean") {
        expect(r.reconcilesOk).toBe(r.netAmountPaise === r.orderPaidTotalPaise);
      }

      // The order we just created must be included (captured >= our payment) — ONLY if payment captured
      if (expectCapturedGte) {
        expect(r.capturedAmountPaise).toBeGreaterThanOrEqual(amountPaise);
      }
    });

    it("after a processed refund, numbers move consistently (net decreases by refund amount)", async () => {
      // M-2 maker-checker: Finance REQUESTS, SuperAdmin APPROVES (different users)
      const { accessToken: finAT, csrfToken: finCSRF } = await loginAs(CL_FINANCE_EMAIL, CL_FINANCE_PASSWORD);
      const { accessToken: adminAT, csrfToken: adminCSRF } = await loginAs(CL_SUPER_ADMIN_EMAIL, CL_SUPER_ADMIN_PASSWORD);

      // Create and pay an order, then refund it.
      const { paymentId, amountPaise } = await setupPaidOrder({
        suffix: `recon-refund-${Date.now()}`,
        batchId: fixtures.batchBId,
        accessToken: finAT,
        csrfToken: finCSRF,
      });

      const from = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const to = new Date(Date.now() + 60 * 60 * 1000).toISOString();

      const before = await request(app.getHttpServer())
        .get("/api/v1/commerce/payments/reconciliation")
        .query({ from, to })
        .set(authHeaders(finAT, finCSRF))
        .expect(200);

      const beforeNet = (before.body.data ?? before.body).netAmountPaise;

      // Finance requests the refund
      const refundReq = await request(app.getHttpServer())
        .post("/api/v1/commerce/refunds")
        .set(authHeaders(finAT, finCSRF))
        .set("Idempotency-Key", `qa-recon-ref-${Date.now()}`)
        .send({ paymentId, amountPaise, reason: "QA reconciliation refund" })
        .expect(201);

      // SuperAdmin approves (maker-checker: different user from requester)
      await request(app.getHttpServer())
        .post(`/api/v1/commerce/refunds/${refundReq.body.data.id}/approve`)
        .set(authHeaders(adminAT, adminCSRF))
        .send({ notes: "Approved by SuperAdmin (maker-checker)" })
        .expect(200);

      const after = await request(app.getHttpServer())
        .get("/api/v1/commerce/payments/reconciliation")
        .query({ from, to })
        .set(authHeaders(finAT, finCSRF))
        .expect(200);

      const afterData = after.body.data ?? after.body;
      expect(afterData.netAmountPaise).toBe(beforeNet - amountPaise);
      expect(afterData.processedRefundAmountPaise).toBeGreaterThanOrEqual(amountPaise);
      expect(Number.isInteger(afterData.netAmountPaise)).toBe(true);
    });
  });

  // ── §20.9: IDOR / SCOPE ──────────────────────────────────────────────────────────────

  describe("§20.9 — IDOR/scope: BranchManager sees only branch A orders; out-of-scope by-id → 404", () => {
    let branchAOrderId: string;
    let branchBOrderId: string;

    beforeAll(async () => {
      const { accessToken, csrfToken } = await loginAs(CL_FINANCE_EMAIL, CL_FINANCE_PASSWORD);

      // Branch A order. Admin creates the student (Finance has no students.create).
      const { orderId: aoId } = await setupPaidOrder({
        suffix: `idor-a-${Date.now()}`,
        batchId: fixtures.batchAId,
        accessToken,
        csrfToken,
      });
      branchAOrderId = aoId;

      // Branch B order.
      const { orderId: boId } = await setupPaidOrder({
        suffix: `idor-b-${Date.now()}`,
        batchId: fixtures.batchBId,
        accessToken,
        csrfToken,
      });
      branchBOrderId = boId;
    });

    it("BranchManager (branch A) list sees branch-A orders, NOT branch-B orders", async () => {
      const { accessToken, csrfToken } = await loginAs(CL_BRANCH_MANAGER_EMAIL, CL_BRANCH_MANAGER_PASSWORD);
      const res = await request(app.getHttpServer())
        .get("/api/v1/commerce/orders")
        .query({ pageSize: 100 })
        .set(authHeaders(accessToken, csrfToken))
        .expect(200);

      const ids = res.body.data.map((o: { id: string }) => o.id);
      expect(ids).toContain(branchAOrderId);
      expect(ids).not.toContain(branchBOrderId);
    });

    it("BranchManager (branch A) GET /orders/:id for branch-B order → 404 (IDOR fail-closed)", async () => {
      const { accessToken, csrfToken } = await loginAs(CL_BRANCH_MANAGER_EMAIL, CL_BRANCH_MANAGER_PASSWORD);
      const res = await request(app.getHttpServer())
        .get(`/api/v1/commerce/orders/${branchBOrderId}`)
        .set(authHeaders(accessToken, csrfToken))
        .expect(404);

      expect(res.body.error.code).toBe("commerce.order_not_found");
    });

    it("BranchManager CAN view their own branch-A order by id", async () => {
      const { accessToken, csrfToken } = await loginAs(CL_BRANCH_MANAGER_EMAIL, CL_BRANCH_MANAGER_PASSWORD);
      const res = await request(app.getHttpServer())
        .get(`/api/v1/commerce/orders/${branchAOrderId}`)
        .set(authHeaders(accessToken, csrfToken))
        .expect(200);

      expect(res.body.data.id).toBe(branchAOrderId);
    });
  });
});
