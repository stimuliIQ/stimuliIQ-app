// apps/api/test/integration/phase-9-emi-referrals.integration-spec.ts
//
// Phase-9 Completion T24/T25 QA gate: EMI plans + dunning, and referrals/affiliates —
// integration tests against the REAL NestJS application (supertest + real Nest app)
// over a real Postgres + Redis DB, matching the pattern of phase-9-content /
// phase-9-tickets / phase-9-live-classes. Self-contained: creates its own tenant-scoped
// users/program/order fixtures with a unique per-run suffix and cleans up only what it
// created (see p4-learning-depth-journey.integration-spec.ts's teardown-scoping fix for
// why "only what you created" matters when the tenant is the SHARED "stimuliiq" one).
//
// COVERAGE:
//   EMI — money in paise; schedule split server-side; idempotent mark-paid (replaying an
//     already-paid installment is a 200 no-op, not a double-charge); Idempotency-Key
//     reuse against a DIFFERENT installment -> 422; RBAC (student cannot create a plan);
//     student self-view is scoped to their OWN order only (IDOR -> empty list, not leak).
//   Referrals — own-scope create/list; PUBLIC redeem attaches a lead; ANTI-SELF-REFERRAL
//     -> 422 SELF_REFERRAL_NOT_ALLOWED; invalid code -> 422 REFERRAL_CODE_INVALID;
//     re-redeeming the SAME lead is idempotent; redeeming an already-attributed code
//     against a DIFFERENT lead -> 422 REFERRAL_ALREADY_REDEEMED; CRM status transitions
//     (pending -> converted -> rewarded) + invalid transition -> 422; non-privileged role
//     cannot approve.

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
  process.env.JWT_AUDIENCE = "stimuliiq-clients";
  process.env.COOKIE_SECRET = "integration-test-cookie-secret-aaaaaaaaaaaaaaaaaaaaaaaa";
  process.env.CSRF_SECRET = "integration-test-csrf-secret-bbbbbbbbbbbbbbbbbbbbbbbbbb";
  process.env.COOKIE_SECURE = "false";
  process.env.WEB_APP_URL = "http://localhost:3000";
  process.env.LMS_APP_URL = "http://localhost:3001";
  process.env.CRM_APP_URL = "http://localhost:3002";
  process.env.STORAGE_PROVIDER = "noop";
  process.env.MAIL_PROVIDER = "noop";
  process.env.WHATSAPP_PROVIDER = "noop";
  process.env.CAPTCHA_PROVIDER = "noop";
  // "disabled", not "noop": the payment enum is ["razorpay", "disabled"] — unlike the
  // providers above, which do accept "noop". `disabled` binds NoopPaymentProvider without the
  // production boot-throw for missing RAZORPAY_* keys, which is exactly what this suite wants.
  // An invalid value here is not a soft fallback: validateEnv() throws during DI resolution, so
  // the whole suite fails to boot and every test in it reports as a failure.
  process.env.PAYMENT_PROVIDER = "disabled";
}

const describeIfAvailable = envFile.available ? describe : describe.skip;

function cookieHeader(cookies: string[]): string {
  return cookies.map((c) => c.split(";")[0]!).join("; ");
}

function extractCsrfToken(cookies: string[]): string | undefined {
  const csrfCookie = cookies.find((c) => c.startsWith("csrf_token="));
  return csrfCookie?.split("=")[1]?.split(";")[0];
}

describeIfAvailable("Phase-9 EMI + Referrals — integration (real Postgres + Redis)", () => {
  const { Test } = require("@nestjs/testing");
  const cookieParser = require("cookie-parser");
  const request = require("supertest");
  const { PrismaClient } = require("@prisma/client");
  const argon2 = require("argon2");
  const { AppModule } = require("../../src/app.module");
  const { HttpExceptionFilter } = require("../../src/common/filters/http-exception.filter");
  const { EnvelopeInterceptor } = require("../../src/common/interceptors/envelope.interceptor");
  // RazorpayPaymentProvider makes a REAL `fetch()` to the live Razorpay API with no
  // NODE_ENV=test short-circuit (unlike Storage/Mail/WhatsApp/Captcha's Noop-selection-
  // by-env convention) — EmiService.markInstallmentPaid()'s "server initiates a charge"
  // path (no paymentId in the request body) calls `PAYMENT_PROVIDER.createOrder()`
  // directly, so this suite must override the binding with NoopPaymentProvider exactly
  // like commerce-orders-payments.integration-spec.ts does, or that path 500s offline.
  const { PAYMENT_PROVIDER } = require("../../src/modules/commerce/providers/payment/payment-provider.interface");
  const { NoopPaymentProvider } = require("../../src/modules/commerce/providers/payment/noop-payment.provider");

  let app: import("@nestjs/common").INestApplication;
  let httpServer: ReturnType<typeof app.getHttpServer>;
  let prisma: InstanceType<typeof PrismaClient>;

  const PASSWORD = "P@ssword123!";
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;

  let tenantId: string;
  let financeCookies: string[], csrfFinance: string;
  let studentACookies: string[], csrfStudentA: string;
  let studentBCookies: string[], csrfStudentB: string;
  let marketingCookies: string[], csrfMarketing: string;

  const fixtureUserIds: string[] = [];
  let programId: string;
  let orderAId: string;
  let orderBId: string;
  let studentAUserId: string;
  let studentAProfileId: string;

  async function login(email: string, password: string): Promise<{ cookies: string[]; csrf: string }> {
    const res = await request(httpServer).post("/api/v1/auth/login").send({ email, password });
    if (res.status !== 200 && res.status !== 201) {
      throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
    }
    const cookies = res.headers["set-cookie"] as string[];
    return { cookies, csrf: extractCsrfToken(cookies) ?? "" };
  }

  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: envFile.databaseUrl });
    await prisma.$connect();

    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PAYMENT_PROVIDER)
      .useValue(new NoopPaymentProvider())
      .compile();
    app = moduleFixture.createNestApplication();
    app.use(cookieParser(process.env.COOKIE_SECRET));
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(new EnvelopeInterceptor());
    app.setGlobalPrefix("api/v1");
    await app.init();
    httpServer = app.getHttpServer();

    const tenant = await prisma.tenant.findFirst({ where: { deletedAt: null } });
    if (!tenant) throw new Error("No tenant found — run `pnpm db:seed` first.");
    tenantId = tenant.id;

    const financeRole = await prisma.role.findFirst({ where: { tenantId, key: "finance", deletedAt: null } });
    const studentRole = await prisma.role.findFirst({ where: { tenantId, key: "student", deletedAt: null } });
    const marketingRole = await prisma.role.findFirst({ where: { tenantId, key: "marketing", deletedAt: null } });
    if (!financeRole || !studentRole || !marketingRole) {
      throw new Error("Roles not seeded — run `pnpm db:seed` first.");
    }

    const pwHash = await argon2.hash(PASSWORD);

    async function createUser(label: string, roleId: string): Promise<string> {
      const email = `p9er.${label}.${suffix}@test.com`;
      const user = await prisma.user.create({ data: { tenantId, email, name: `P9 ER ${label}`, passwordHash: pwHash, status: "active" } });
      await prisma.userRole.create({ data: { userId: user.id, roleId, branchId: null } });
      fixtureUserIds.push(user.id);
      return user.id;
    }

    const financeUserId = await createUser("finance", financeRole.id);
    void financeUserId;
    studentAUserId = await createUser("studentA", studentRole.id);
    const studentBUserId = await createUser("studentB", studentRole.id);
    const marketingUserId = await createUser("marketing", marketingRole.id);
    void marketingUserId;

    const studentAProfile = await prisma.studentProfile.create({ data: { tenantId, userId: studentAUserId, courseType: "btech" } });
    studentAProfileId = studentAProfile.id;
    const studentBProfile = await prisma.studentProfile.create({ data: { tenantId, userId: studentBUserId, courseType: "btech" } });

    const program = await prisma.program.create({
      data: {
        tenantId,
        slug: `p9-er-prog-${suffix}`,
        title: `P9 ER Program ${suffix}`,
        domain: "Engineering",
        durationWeeks: 8,
        pricePaise: 60000_00,
        status: "published",
      },
    });
    programId = program.id;

    const orderA = await prisma.order.create({
      data: {
        tenantId,
        studentId: studentAProfileId,
        programId,
        amountPaise: 60000_00,
        idempotencyKey: `p9-er-order-a-${suffix}`,
        status: "paid",
      },
    });
    orderAId = orderA.id;

    const orderB = await prisma.order.create({
      data: {
        tenantId,
        studentId: studentBProfile.id,
        programId,
        amountPaise: 60000_00,
        idempotencyKey: `p9-er-order-b-${suffix}`,
        status: "paid",
      },
    });
    orderBId = orderB.id;

    ({ cookies: financeCookies, csrf: csrfFinance } = await login(`p9er.finance.${suffix}@test.com`, PASSWORD));
    ({ cookies: studentACookies, csrf: csrfStudentA } = await login(`p9er.studentA.${suffix}@test.com`, PASSWORD));
    ({ cookies: studentBCookies, csrf: csrfStudentB } = await login(`p9er.studentB.${suffix}@test.com`, PASSWORD));
    ({ cookies: marketingCookies, csrf: csrfMarketing } = await login(`p9er.marketing.${suffix}@test.com`, PASSWORD));
  }, 120_000);

  afterAll(async () => {
    if (prisma) {
      await prisma.referral.deleteMany({ where: { referrerUserId: { in: fixtureUserIds } } }).catch(() => {});
      await prisma.emiInstallment.deleteMany({ where: { emiPlan: { orderId: { in: [orderAId, orderBId] } } } }).catch(() => {});
      await prisma.emiPlan.deleteMany({ where: { orderId: { in: [orderAId, orderBId] } } }).catch(() => {});
      await prisma.payment.deleteMany({ where: { orderId: { in: [orderAId, orderBId] } } }).catch(() => {});
      await prisma.order.deleteMany({ where: { id: { in: [orderAId, orderBId] } } }).catch(() => {});
      await prisma.studentProfile.deleteMany({ where: { userId: { in: fixtureUserIds } } }).catch(() => {});
      await prisma.program.deleteMany({ where: { id: programId } }).catch(() => {});
      await prisma.session.deleteMany({ where: { userId: { in: fixtureUserIds } } }).catch(() => {});
      await prisma.userRole.deleteMany({ where: { userId: { in: fixtureUserIds } } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: { in: fixtureUserIds } } }).catch(() => {});
      await prisma.$disconnect();
    }
    if (app) await app.close();
  }, 30_000);

  // ═══════════════════════════════════════════════════════════════════════
  // EMI plans + dunning
  // ═══════════════════════════════════════════════════════════════════════

  describe("EMI: create plan, money-in-paise schedule, idempotent mark-paid, dunning, scope", () => {
    let planId: string;
    let installment1Id: string;
    let installment2Id: string;

    it("student (no emi.create) -> 403 creating a plan", async () => {
      const res = await request(httpServer)
        .post("/api/v1/crm/emi-plans")
        .set("Cookie", cookieHeader(studentACookies))
        .set("X-CSRF-Token", csrfStudentA)
        .send({ orderId: orderAId, totalAmountPaise: 60000_00, numInstallments: 3, startDate: "2026-08-01" });
      expect(res.status).toBe(403);
    });

    it("finance creates a plan — schedule is computed server-side in paise, every paise accounted for", async () => {
      const res = await request(httpServer)
        .post("/api/v1/crm/emi-plans")
        .set("Cookie", cookieHeader(financeCookies))
        .set("X-CSRF-Token", csrfFinance)
        .send({ orderId: orderAId, totalAmountPaise: 60000_01, numInstallments: 3, startDate: "2026-08-01" });
      expect(res.status).toBe(201);
      planId = res.body.data.id;
      expect(res.body.data.installments).toHaveLength(3);
      const total = res.body.data.installments.reduce((sum: number, i: { amountPaise: number }) => sum + i.amountPaise, 0);
      expect(total).toBe(60000_01); // every paise accounted for (remainder distributed, not dropped/floated)
      installment1Id = res.body.data.installments[0].id;
      installment2Id = res.body.data.installments[1].id;
    });

    it("creating a SECOND active plan for the same order -> 409/422 EMI_PLAN_ALREADY_EXISTS", async () => {
      const res = await request(httpServer)
        .post("/api/v1/crm/emi-plans")
        .set("Cookie", cookieHeader(financeCookies))
        .set("X-CSRF-Token", csrfFinance)
        .send({ orderId: orderAId, totalAmountPaise: 100000, numInstallments: 2, startDate: "2026-09-01" });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("EMI_PLAN_ALREADY_EXISTS");
    });

    it("mark-paid WITHOUT a paymentId initiates a server-side charge (installment stays pending, a Payment row is created)", async () => {
      const res = await request(httpServer)
        .post(`/api/v1/crm/emi-plans/${planId}/installments/${installment1Id}/mark-paid`)
        .set("Cookie", cookieHeader(financeCookies))
        .set("X-CSRF-Token", csrfFinance)
        .set("Idempotency-Key", `p9-er-idem-${suffix}-1`)
        .send({});
      expect(res.status).toBe(200);
      const inst = res.body.data.installments.find((i: { id: string }) => i.id === installment1Id);
      expect(inst.status).toBe("pending"); // no synchronous capture primitive — see emi.service.ts file header
      expect(inst.paymentId).not.toBeNull();
    });

    // DEFECT (qa-engineer Wave 5 finding, filed against emi.service.ts — see the QA
    // report): `markInstallmentPaid()`'s Redis idempotency guard
    // (apps/api/src/modules/emi/emi.service.ts ~L228-238) only rejects a Idempotency-Key
    // REUSE against a DIFFERENT installment (`cachedInstallmentId !== installmentId`).
    // It never short-circuits a replay against the SAME still-pending installment with
    // the SAME key — the DB-state check just above it only catches an ALREADY-PAID
    // installment (`installment.status === "paid"`), so a same-key retry of the
    // "no paymentId" ("server initiates a charge") branch re-runs Path B in full: a
    // SECOND `PAYMENT_PROVIDER.createOrder()` call + a SECOND `payments` row is created
    // for the same installment on every retry. This violates the file's OWN documented
    // intent ("guards against a same-key retry ... from creating a second provider
    // order") and CLAUDE.md's "idempotent payment (no double-charge/enroll)" journey.
    // Skipped (not deleted) so it stays a live, named regression check once fixed —
    // remove `.skip` when the guard is corrected to short-circuit on
    // `cachedInstallmentId === installmentId` too, not just persist a mismatch check.
    it("replaying the SAME Idempotency-Key does not create a second payment row for this installment (FIXED)", async () => {
      const before = await prisma.payment.count({ where: { orderId: orderAId } });
      const res = await request(httpServer)
        .post(`/api/v1/crm/emi-plans/${planId}/installments/${installment1Id}/mark-paid`)
        .set("Cookie", cookieHeader(financeCookies))
        .set("X-CSRF-Token", csrfFinance)
        .set("Idempotency-Key", `p9-er-idem-${suffix}-1`)
        .send({});
      expect(res.status).toBe(200);
      const after = await prisma.payment.count({ where: { orderId: orderAId } });
      expect(after).toBe(before);
    });

    it("reusing the SAME Idempotency-Key against a DIFFERENT installment -> 422 EMI_IDEMPOTENCY_KEY_REUSED", async () => {
      const res = await request(httpServer)
        .post(`/api/v1/crm/emi-plans/${planId}/installments/${installment2Id}/mark-paid`)
        .set("Cookie", cookieHeader(financeCookies))
        .set("X-CSRF-Token", csrfFinance)
        .set("Idempotency-Key", `p9-er-idem-${suffix}-1`)
        .send({});
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("EMI_IDEMPOTENCY_KEY_REUSED");
    });

    it("mark-paid WITH a captured paymentId settles the installment (status=paid) — then replay is an idempotent no-op", async () => {
      const capturedPayment = await prisma.payment.create({
        data: {
          tenantId,
          orderId: orderAId,
          provider: "razorpay",
          providerPaymentId: `pay_p9er_${suffix}`,
          amountPaise: 20000_01, // installment 2's amount (first installment got the +1 remainder paise -> 20000_01 for inst 1, so inst 2/3 = 20000_00 each; recompute below via actual fixture data instead of a hardcoded guess)
          status: "captured",
          signatureVerified: true,
        },
      });
      // Fetch the real installment amount rather than assume the split (defensive
      // against a schedule-split rounding change) — re-issue the payment with the exact
      // matching amount so the service's amount-match guard (EMI_PAYMENT_AMOUNT_MISMATCH)
      // passes deterministically.
      const detail = await request(httpServer)
        .get(`/api/v1/crm/emi-plans/${planId}`)
        .set("Cookie", cookieHeader(financeCookies));
      const inst2 = detail.body.data.installments.find((i: { id: string }) => i.id === installment2Id);
      await prisma.payment.update({ where: { id: capturedPayment.id }, data: { amountPaise: inst2.amountPaise } });

      const markPaid = await request(httpServer)
        .post(`/api/v1/crm/emi-plans/${planId}/installments/${installment2Id}/mark-paid`)
        .set("Cookie", cookieHeader(financeCookies))
        .set("X-CSRF-Token", csrfFinance)
        .set("Idempotency-Key", `p9-er-idem-${suffix}-2`)
        .send({ paymentId: capturedPayment.id });
      expect(markPaid.status).toBe(200);
      const paidInst = markPaid.body.data.installments.find((i: { id: string }) => i.id === installment2Id);
      expect(paidInst.status).toBe("paid");
      expect(paidInst.paidAt).not.toBeNull();

      // Replay with a DIFFERENT idempotency key but the SAME already-paid installment ->
      // still a no-op 200 (DB-state check is the primary guard, not just the Redis key).
      const replay = await request(httpServer)
        .post(`/api/v1/crm/emi-plans/${planId}/installments/${installment2Id}/mark-paid`)
        .set("Cookie", cookieHeader(financeCookies))
        .set("X-CSRF-Token", csrfFinance)
        .set("Idempotency-Key", `p9-er-idem-${suffix}-3`)
        .send({ paymentId: capturedPayment.id });
      expect(replay.status).toBe(200);
      expect(replay.body.data.installments.find((i: { id: string }) => i.id === installment2Id).status).toBe("paid");
    });

    it("manual dunning trigger increments dunningAttempts on the still-pending installment", async () => {
      const res = await request(httpServer)
        .post(`/api/v1/crm/emi-plans/${planId}/installments/${installment1Id}/dunning`)
        .set("Cookie", cookieHeader(financeCookies))
        .set("X-CSRF-Token", csrfFinance)
        .send({});
      expect(res.status).toBe(200);
      const inst = res.body.data.installments.find((i: { id: string }) => i.id === installment1Id);
      expect(inst.dunningAttempts).toBeGreaterThanOrEqual(1);
      expect(inst.lastDunningAt).not.toBeNull();
    });

    it("student A self-view (/me/emi-plans) sees only their OWN order's plan", async () => {
      const res = await request(httpServer).get("/api/v1/me/emi-plans").set("Cookie", cookieHeader(studentACookies));
      expect(res.status).toBe(200);
      expect(res.body.data.every((p: { orderId: string }) => p.orderId === orderAId)).toBe(true);
    });

    it("student B self-view sees NO plans (their order has none) — no cross-student leak", async () => {
      const res = await request(httpServer).get("/api/v1/me/emi-plans").set("Cookie", cookieHeader(studentBCookies));
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Referrals / affiliates
  // ═══════════════════════════════════════════════════════════════════════

  describe("Referrals: own-scope create, public redeem, anti-self-referral, status machine", () => {
    let referralCode: string;
    let referralId: string;
    let leadId: string;
    let otherLeadId: string;

    it("student A creates their own referral link", async () => {
      const res = await request(httpServer)
        .post("/api/v1/me/referrals")
        .set("Cookie", cookieHeader(studentACookies))
        .set("X-CSRF-Token", csrfStudentA)
        .send({});
      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe("pending");
      expect(res.body.data.referrerUserId).toBe(studentAUserId);
      referralCode = res.body.data.code;
      referralId = res.body.data.id;
    });

    it("student B cannot see student A's referral in their own list (own-scope isolation)", async () => {
      const res = await request(httpServer).get("/api/v1/me/referrals").set("Cookie", cookieHeader(studentBCookies));
      expect(res.status).toBe(200);
      expect(res.body.data.some((r: { id: string }) => r.id === referralId)).toBe(false);
    });

    it("redeeming with an INVALID code -> 422 REFERRAL_CODE_INVALID", async () => {
      const lead = await prisma.lead.create({
        data: { tenantId, name: "P9 Redeem Lead Bad Code", phone: `9${suffix}`.slice(0, 10).padEnd(10, "1"), source: "referral" },
      });
      const res = await request(httpServer).post("/api/v1/public/referrals/redeem").send({ code: "NOPE-DOES-NOT-EXIST", leadId: lead.id, captchaToken: "test-captcha-token" });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("REFERRAL_CODE_INVALID");
      await prisma.lead.delete({ where: { id: lead.id } }).catch(() => {});
    });

    it("ANTI-SELF-REFERRAL: a lead sharing student A's own email -> 422 SELF_REFERRAL_NOT_ALLOWED", async () => {
      const selfEmail = `p9er.studentA.${suffix}@test.com`; // exact match to student A's own login email
      const selfLead = await prisma.lead.create({
        data: { tenantId, name: "Self Referral Attempt", phone: `9${suffix}x`.slice(0, 10).padEnd(10, "2"), email: selfEmail, source: "referral" },
      });
      const res = await request(httpServer).post("/api/v1/public/referrals/redeem").send({ code: referralCode, leadId: selfLead.id, captchaToken: "test-captcha-token" });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("SELF_REFERRAL_NOT_ALLOWED");

      const row = await prisma.referral.findUnique({ where: { id: referralId } });
      expect(row.referredLeadId).toBeNull(); // rejected attempt never attaches
      await prisma.lead.delete({ where: { id: selfLead.id } }).catch(() => {});
    });

    it("a genuine (non-self) lead redeems successfully -> referral attached, status stays pending", async () => {
      const lead = await prisma.lead.create({
        data: { tenantId, name: "P9 Genuine Referred Lead", phone: `8${suffix}`.slice(0, 10).padEnd(10, "3"), email: `p9er.referred.${suffix}@test.com`, source: "referral" },
      });
      leadId = lead.id;
      const res = await request(httpServer).post("/api/v1/public/referrals/redeem").send({ code: referralCode, leadId, captchaToken: "test-captcha-token" });
      expect(res.status).toBe(200);
      expect(res.body.data.referralId).toBe(referralId);
      expect(res.body.data.status).toBe("pending");
    });

    it("re-redeeming for the SAME lead is idempotent (200, same result, no error)", async () => {
      const res = await request(httpServer).post("/api/v1/public/referrals/redeem").send({ code: referralCode, leadId, captchaToken: "test-captcha-token" });
      expect(res.status).toBe(200);
      expect(res.body.data.referralId).toBe(referralId);
    });

    it("redeeming the SAME code against a DIFFERENT lead -> 422 REFERRAL_ALREADY_REDEEMED", async () => {
      const otherLead = await prisma.lead.create({
        data: { tenantId, name: "P9 Other Lead", phone: `7${suffix}`.slice(0, 10).padEnd(10, "4"), source: "referral" },
      });
      otherLeadId = otherLead.id;
      const res = await request(httpServer).post("/api/v1/public/referrals/redeem").send({ code: referralCode, leadId: otherLeadId, captchaToken: "test-captcha-token" });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("REFERRAL_ALREADY_REDEEMED");
    });

    it("non-privileged role (student) cannot approve/transition a referral's status", async () => {
      const res = await request(httpServer)
        .patch(`/api/v1/crm/referrals/${referralId}`)
        .set("Cookie", cookieHeader(studentACookies))
        .set("X-CSRF-Token", csrfStudentA)
        .send({ status: "converted" });
      expect(res.status).toBe(403);
    });

    it("marketing (referrals.approve) transitions pending -> converted -> rewarded", async () => {
      const toConverted = await request(httpServer)
        .patch(`/api/v1/crm/referrals/${referralId}`)
        .set("Cookie", cookieHeader(marketingCookies))
        .set("X-CSRF-Token", csrfMarketing)
        .send({ status: "converted" });
      expect(toConverted.status).toBe(200);
      expect(toConverted.body.data.status).toBe("converted");

      const toRewarded = await request(httpServer)
        .patch(`/api/v1/crm/referrals/${referralId}`)
        .set("Cookie", cookieHeader(marketingCookies))
        .set("X-CSRF-Token", csrfMarketing)
        .send({ status: "rewarded" });
      expect(toRewarded.status).toBe(200);
      expect(toRewarded.body.data.status).toBe("rewarded");
      expect(toRewarded.body.data.rewardedAt).not.toBeNull();
    });

    it("an INVALID transition from a terminal state (rewarded -> pending) -> 422 REFERRAL_INVALID_STATUS_TRANSITION", async () => {
      const res = await request(httpServer)
        .patch(`/api/v1/crm/referrals/${referralId}`)
        .set("Cookie", cookieHeader(marketingCookies))
        .set("X-CSRF-Token", csrfMarketing)
        .send({ status: "pending" });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("REFERRAL_INVALID_STATUS_TRANSITION");
    });

    afterAll(async () => {
      await prisma.lead.deleteMany({ where: { id: { in: [leadId, otherLeadId].filter(Boolean) } } }).catch(() => {});
    });
  });
});
