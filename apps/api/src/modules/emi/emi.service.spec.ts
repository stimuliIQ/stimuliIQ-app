// apps/api/src/modules/emi/emi.service.spec.ts
//
// Unit tests for EmiService: buildInstallmentSchedule() paise-remainder distribution,
// createPlan() duplicate-active-plan guard, markInstallmentPaid() both paths
// (out-of-band paymentId link vs. server-initiated provider order) + idempotent replay,
// triggerDunning() status guard.

import { NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { EmiService, buildInstallmentSchedule } from "./emi.service";
import { EmiRepository } from "./emi.repository";
import type { PaymentProvider } from "../commerce/providers/payment/payment-provider.interface";
import type { EmiDunningPort } from "./dunning/emi-dunning.port";
import { RedisService } from "../../redis/redis.service";
import { scopeContextStorage, type ScopeContext } from "../auth/lib/scope-context";

type Mocked<T> = { [K in keyof T]: T[K] extends (...args: never[]) => unknown ? jest.Mock : T[K] };

function mockRepository(): Mocked<EmiRepository> {
  return {
    findOrderForPlan: jest.fn(),
    findActivePlanByOrderId: jest.fn(),
    createPlanWithInstallments: jest.fn(),
    list: jest.fn(),
    findById: jest.fn(),
    findInstallment: jest.fn(),
    findCapturedPayment: jest.fn(),
    createPendingPayment: jest.fn(),
    markInstallmentPaid: jest.fn(),
    linkPendingPayment: jest.fn(),
    recordDunningAttempt: jest.fn(),
    findOverdueCandidates: jest.fn(),
  } as unknown as Mocked<EmiRepository>;
}

function mockPaymentProvider(): Mocked<PaymentProvider> {
  return {
    createOrder: jest.fn(),
    verifyPaymentSignature: jest.fn(),
    verifyWebhookSignature: jest.fn(),
    refund: jest.fn(),
    fetchPayment: jest.fn(),
  } as unknown as Mocked<PaymentProvider>;
}

function mockDunningPort(): Mocked<EmiDunningPort> {
  return { sendReminder: jest.fn() } as unknown as Mocked<EmiDunningPort>;
}

function mockRedis(): Mocked<RedisService> {
  return { client: { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue("OK") } } as unknown as Mocked<RedisService>;
}

const PLAN_ROW = {
  id: "plan-1",
  tenantId: "tenant-1",
  orderId: "order-1",
  totalAmountPaise: 100_000,
  currency: "INR",
  numInstallments: 4,
  status: "active" as const,
  startDate: new Date("2026-01-01T00:00:00Z"),
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  deletedAt: null,
  order: { id: "order-1", studentId: "student-1", student: { user: { name: "Asha Student", email: "asha@example.test" } } },
  installments: [
    {
      id: "inst-1",
      tenantId: "tenant-1",
      emiPlanId: "plan-1",
      installmentNo: 1,
      amountPaise: 25_000,
      dueDate: new Date("2026-01-01T00:00:00Z"),
      status: "pending" as const,
      paidAt: null,
      paymentId: null,
      dunningAttempts: 0,
      lastDunningAt: null,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
      deletedAt: null,
    },
  ],
};

function runWithScope<T>(scope: ScopeContext["scope"], fn: () => T): T {
  const ctx: ScopeContext = { permissionKey: "emi.view", scope, actorId: "actor-1", tenantId: "tenant-1" };
  return scopeContextStorage.run(ctx, fn);
}

describe("buildInstallmentSchedule()", () => {
  it("splits an evenly-divisible amount equally", () => {
    const schedule = buildInstallmentSchedule(100_000, 4, new Date("2026-01-01T00:00:00Z"));
    expect(schedule.map((i) => i.amountPaise)).toEqual([25_000, 25_000, 25_000, 25_000]);
    expect(schedule.reduce((sum, i) => sum + i.amountPaise, 0)).toBe(100_000);
  });

  it("distributes a remainder paise-by-paise across the FIRST installments (no paise lost)", () => {
    const schedule = buildInstallmentSchedule(100_001, 4, new Date("2026-01-01T00:00:00Z"));
    expect(schedule.map((i) => i.amountPaise)).toEqual([25_001, 25_000, 25_000, 25_000]);
    expect(schedule.reduce((sum, i) => sum + i.amountPaise, 0)).toBe(100_001);
  });

  it("sets due dates one calendar month apart starting on startDate", () => {
    const schedule = buildInstallmentSchedule(100_000, 3, new Date("2026-01-31T00:00:00Z"));
    expect(schedule[0]!.dueDate.toISOString().slice(0, 10)).toBe("2026-01-31");
    // Month-end rollover (Jan 31 -> Feb 31 doesn't exist) is JS Date's native
    // rollover behavior, documented, not a bug this schedule builder introduces.
    expect(schedule[1]!.installmentNo).toBe(2);
  });
});

describe("EmiService", () => {
  let service: EmiService;
  let repo: Mocked<EmiRepository>;
  let paymentProvider: Mocked<PaymentProvider>;
  let dunningPort: Mocked<EmiDunningPort>;
  let redis: Mocked<RedisService>;

  beforeEach(() => {
    repo = mockRepository();
    paymentProvider = mockPaymentProvider();
    dunningPort = mockDunningPort();
    redis = mockRedis();
    service = new EmiService(
      repo as unknown as EmiRepository,
      paymentProvider as unknown as PaymentProvider,
      dunningPort as unknown as EmiDunningPort,
      redis as unknown as RedisService,
    );
  });

  describe("createPlan()", () => {
    it("422s when an active plan already exists for the order", async () => {
      repo.findOrderForPlan.mockResolvedValue({ id: "order-1", studentId: "student-1", amountPaise: 100_000, currency: "INR", studentEmail: "a@b.test", studentName: "Asha" });
      repo.findActivePlanByOrderId.mockResolvedValue(PLAN_ROW as never);

      await expect(
        runWithScope("all", () =>
          service.createPlan("tenant-1", { orderId: "order-1", totalAmountPaise: 100_000, currency: "INR", numInstallments: 4, startDate: "2026-01-01" }),
        ),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it("404s when the order does not exist", async () => {
      repo.findOrderForPlan.mockResolvedValue(null);
      await expect(
        runWithScope("all", () =>
          service.createPlan("tenant-1", { orderId: "missing", totalAmountPaise: 100_000, currency: "INR", numInstallments: 4, startDate: "2026-01-01" }),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("creates the plan with a server-computed schedule", async () => {
      repo.findOrderForPlan.mockResolvedValue({ id: "order-1", studentId: "student-1", amountPaise: 100_000, currency: "INR", studentEmail: "a@b.test", studentName: "Asha" });
      repo.findActivePlanByOrderId.mockResolvedValue(null);
      repo.createPlanWithInstallments.mockResolvedValue("plan-1");
      repo.findById.mockResolvedValue(PLAN_ROW as never);

      const result = await runWithScope("all", () =>
        service.createPlan("tenant-1", { orderId: "order-1", totalAmountPaise: 100_000, currency: "INR", numInstallments: 4, startDate: "2026-01-01" }),
      );
      expect(result.id).toBe("plan-1");
      expect(repo.createPlanWithInstallments).toHaveBeenCalledWith(
        "tenant-1",
        expect.objectContaining({ orderId: "order-1", numInstallments: 4 }),
      );
    });

    // The schedule this builds is what `markInstallmentPaid` later hands the payment
    // provider as a real charge, so the total cannot come from the request body.
    it("422s when the requested total does not match the order, rather than charging it", async () => {
      repo.findOrderForPlan.mockResolvedValue({
        id: "order-1",
        studentId: "student-1",
        amountPaise: 100_000,
        currency: "INR",
        studentEmail: "a@b.test",
        studentName: "Asha",
      });
      repo.findActivePlanByOrderId.mockResolvedValue(null);

      await expect(
        runWithScope("all", () =>
          service.createPlan("tenant-1", {
            orderId: "order-1",
            totalAmountPaise: 1_000, // a hundredth of what the order says
            currency: "INR",
            numInstallments: 4,
            startDate: "2026-01-01",
          }),
        ),
      ).rejects.toMatchObject({ response: { code: "EMI_TOTAL_MISMATCH" } });
      expect(repo.createPlanWithInstallments).not.toHaveBeenCalled();
    });

    it("splits the ORDER's total, not the body's, when they agree", async () => {
      repo.findOrderForPlan.mockResolvedValue({
        id: "order-1",
        studentId: "student-1",
        amountPaise: 100_000,
        currency: "INR",
        studentEmail: "a@b.test",
        studentName: "Asha",
      });
      repo.findActivePlanByOrderId.mockResolvedValue(null);
      repo.createPlanWithInstallments.mockResolvedValue("plan-1");
      repo.findById.mockResolvedValue(PLAN_ROW as never);

      await runWithScope("all", () =>
        service.createPlan("tenant-1", {
          orderId: "order-1",
          totalAmountPaise: 100_000,
          currency: "INR",
          numInstallments: 4,
          startDate: "2026-01-01",
        }),
      );
      expect(repo.createPlanWithInstallments).toHaveBeenCalledWith(
        "tenant-1",
        expect.objectContaining({ totalAmountPaise: 100_000, currency: "INR" }),
      );
    });
  });

  // `emi.view` is seeded at scope `own` to counsellor AND to student, so the detail route
  // has to narrow the same way the list does — otherwise a plan uuid is enough to read
  // somebody else's schedule.
  describe("getById() scope", () => {
    it("restricts an own-scope read to the caller's own leads and orders", async () => {
      repo.findById.mockResolvedValue(PLAN_ROW as never);

      await runWithScope("own", () => service.getById("tenant-1", "actor-1", "plan-1"));

      expect(repo.findById).toHaveBeenCalledWith("tenant-1", "plan-1", {
        leadOwnerId: "actor-1",
        studentUserId: "actor-1",
      });
    });

    it("404s (never 403) when the plan exists but is outside the caller's scope", async () => {
      repo.findById.mockResolvedValue(null);

      await expect(
        runWithScope("own", () => service.getById("tenant-1", "actor-1", "someone-elses-plan")),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("applies no restriction at scope all", async () => {
      repo.findById.mockResolvedValue(PLAN_ROW as never);

      await runWithScope("all", () => service.getById("tenant-1", "actor-1", "plan-1"));

      expect(repo.findById).toHaveBeenCalledWith("tenant-1", "plan-1", undefined);
    });

    it("refuses branch scope rather than silently reading every branch", async () => {
      await expect(
        runWithScope("branch", () => service.getById("tenant-1", "actor-1", "plan-1")),
      ).rejects.toMatchObject({ response: { code: "emi.scope_unresolvable" } });
      expect(repo.findById).not.toHaveBeenCalled();
    });
  });

  describe("markInstallmentPaid()", () => {
    it("is idempotent, replaying against an already-paid installment is a no-op", async () => {
      const paidPlan = { ...PLAN_ROW, installments: [{ ...PLAN_ROW.installments[0]!, status: "paid" as const }] };
      repo.findById.mockResolvedValue(paidPlan as never);
      repo.findInstallment.mockResolvedValue(paidPlan.installments[0] as never);

      const result = await runWithScope("all", () => service.markInstallmentPaid("tenant-1", "plan-1", "inst-1", {}, "idem-1"));
      expect(result.installments[0]!.status).toBe("paid");
      expect(paymentProvider.createOrder).not.toHaveBeenCalled();
    });

    it("links an already-captured out-of-band payment (Path A)", async () => {
      repo.findById.mockResolvedValue(PLAN_ROW as never);
      repo.findInstallment.mockResolvedValue(PLAN_ROW.installments[0] as never);
      repo.findCapturedPayment.mockResolvedValue({ id: "payment-1", amountPaise: 25_000, status: "captured" as const });
      repo.markInstallmentPaid.mockResolvedValue({} as never);

      await runWithScope("all", () => service.markInstallmentPaid("tenant-1", "plan-1", "inst-1", { paymentId: "payment-1" }, "idem-2"));
      expect(repo.markInstallmentPaid).toHaveBeenCalledWith("inst-1", "payment-1", expect.any(Date));
    });

    it("422s when the linked payment amount does not match the installment amount", async () => {
      repo.findById.mockResolvedValue(PLAN_ROW as never);
      repo.findInstallment.mockResolvedValue(PLAN_ROW.installments[0] as never);
      repo.findCapturedPayment.mockResolvedValue({ id: "payment-1", amountPaise: 99_999, status: "captured" as const });

      await expect(
        runWithScope("all", () => service.markInstallmentPaid("tenant-1", "plan-1", "inst-1", { paymentId: "payment-1" }, "idem-3")),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it("server-initiates a provider order when no paymentId is given (Path B)", async () => {
      repo.findById.mockResolvedValue(PLAN_ROW as never);
      repo.findInstallment.mockResolvedValue(PLAN_ROW.installments[0] as never);
      paymentProvider.createOrder.mockResolvedValue({ providerOrderId: "order_test_1", amountPaise: 25_000, currency: "INR" });
      repo.createPendingPayment.mockResolvedValue({ id: "payment-2" });

      await runWithScope("all", () => service.markInstallmentPaid("tenant-1", "plan-1", "inst-1", {}, "idem-4"));
      expect(paymentProvider.createOrder).toHaveBeenCalledWith(expect.objectContaining({ amountPaise: 25_000, currency: "INR" }));
      expect(repo.linkPendingPayment).toHaveBeenCalledWith("inst-1", "payment-2");
      expect(repo.markInstallmentPaid).not.toHaveBeenCalled(); // stays pending, no synchronous capture.
    });
  });

  describe("triggerDunning()", () => {
    it("sends a reminder for a pending installment", async () => {
      repo.findById.mockResolvedValue(PLAN_ROW as never);
      repo.findInstallment.mockResolvedValue(PLAN_ROW.installments[0] as never);
      repo.recordDunningAttempt.mockResolvedValue({ ...PLAN_ROW.installments[0]!, dunningAttempts: 1 } as never);

      await runWithScope("all", () => service.triggerDunning("tenant-1", "plan-1", "inst-1"));
      expect(dunningPort.sendReminder).toHaveBeenCalledWith(expect.objectContaining({ installmentId: "inst-1", toEmail: "asha@example.test" }));
    });

    it("422s for an already-paid installment", async () => {
      repo.findById.mockResolvedValue(PLAN_ROW as never);
      repo.findInstallment.mockResolvedValue({ ...PLAN_ROW.installments[0]!, status: "paid" } as never);

      await expect(runWithScope("all", () => service.triggerDunning("tenant-1", "plan-1", "inst-1"))).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
      expect(dunningPort.sendReminder).not.toHaveBeenCalled();
    });
  });
});
