// apps/api/src/modules/referrals/referrals.service.spec.ts
//
// Unit tests for ReferralsService: own/all scope resolution, status state machine
// (legal transitions + idempotent same-status replay + invalid transition -> 422),
// redeem() anti-self-referral guard, idempotent redeem replay, invalid code -> 422,
// already-redeemed-by-another-lead -> 422.

import { ForbiddenException, HttpException, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type { Referral as ReferralRow } from "@prisma/client";
import { ReferralsService } from "./referrals.service";
import { ReferralsRepository } from "./referrals.repository";
import { scopeContextStorage, type ScopeContext } from "../auth/lib/scope-context";
import type { CaptchaProvider } from "../captcha/providers/captcha/captcha-provider.interface";
import type { PublicReferralRateLimiter } from "./lib/public-referral-rate-limiter";

type Mocked<T> = { [K in keyof T]: T[K] extends (...args: never[]) => unknown ? jest.Mock : T[K] };

function mockRepository(): Mocked<ReferralsRepository> {
  return {
    list: jest.fn(),
    findById: jest.fn(),
    findByCode: jest.fn(),
    createForUser: jest.fn(),
    attachLead: jest.fn(),
    updateStatus: jest.fn(),
    getTenantIdBySlug: jest.fn(),
    findLeadContact: jest.fn(),
    findReferrerContact: jest.fn(),
  } as unknown as Mocked<ReferralsRepository>;
}

const ROW: ReferralRow & { referrer: { name: string } } = {
  id: "referral-1",
  tenantId: "tenant-1",
  referrerUserId: "user-1",
  referredLeadId: null,
  code: "ABCD1234",
  reward: null,
  status: "pending",
  rewardedAt: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  deletedAt: null,
  referrer: { name: "Asha Student" },
};

function runWithScope<T>(scope: ScopeContext["scope"], permissionKey: string, fn: () => T): T {
  const ctx: ScopeContext = { permissionKey, scope, actorId: "user-1", tenantId: "tenant-1" };
  return scopeContextStorage.run(ctx, fn);
}

describe("ReferralsService", () => {
  let service: ReferralsService;
  let repo: Mocked<ReferralsRepository>;
  let captcha: { verify: jest.Mock };
  let rateLimiter: { hit: jest.Mock };

  beforeEach(() => {
    repo = mockRepository();
    captcha = { verify: jest.fn().mockResolvedValue({ success: true }) };
    rateLimiter = { hit: jest.fn().mockResolvedValue(false) };
    service = new ReferralsService(
      repo as unknown as ReferralsRepository,
      captcha as unknown as CaptchaProvider,
      rateLimiter as unknown as PublicReferralRateLimiter,
    );
  });

  describe("createOwn / listOwn scope", () => {
    it("createOwn succeeds at scope=own", async () => {
      repo.createForUser.mockResolvedValue(ROW);
      repo.findById.mockResolvedValue(ROW);
      const result = await runWithScope("own", "referrals.create", () => service.createOwn("tenant-1", "user-1", {}));
      expect(result.code).toBe("ABCD1234");
    });

    it("createOwn rejects scope=all (own-scope endpoint)", async () => {
      await expect(runWithScope("all", "referrals.create", () => service.createOwn("tenant-1", "user-1", {}))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it("listOwn forces referrerUserId to the caller regardless of query.referrerUserId", async () => {
      repo.list.mockResolvedValue({ rows: [ROW], total: 1 });
      await runWithScope("own", "referrals.view", () =>
        service.listOwn("tenant-1", "user-1", { referrerUserId: "someone-else", page: 1, pageSize: 20 }),
      );
      expect(repo.list).toHaveBeenCalledWith(expect.objectContaining({ referrerUserId: "user-1" }));
    });
  });

  describe("updateStatus() state machine", () => {
    it("allows pending -> converted", async () => {
      repo.findById.mockResolvedValueOnce(ROW).mockResolvedValueOnce({ ...ROW, status: "converted" });
      repo.updateStatus.mockResolvedValue({ ...ROW, status: "converted" });
      const result = await runWithScope("all", "referrals.approve", () =>
        service.updateStatus("tenant-1", "referral-1", { status: "converted" }),
      );
      expect(result.status).toBe("converted");
    });

    it("rejects rewarded -> pending (terminal state, no transitions out)", async () => {
      repo.findById.mockResolvedValue({ ...ROW, status: "rewarded" });
      await expect(
        runWithScope("all", "referrals.approve", () => service.updateStatus("tenant-1", "referral-1", { status: "pending" })),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it("is idempotent — setting the same status again is a no-op", async () => {
      repo.findById.mockResolvedValue(ROW);
      const result = await runWithScope("all", "referrals.approve", () =>
        service.updateStatus("tenant-1", "referral-1", { status: "pending" }),
      );
      expect(result.status).toBe("pending");
      expect(repo.updateStatus).not.toHaveBeenCalled();
    });

    it("404s on an unknown referral id", async () => {
      repo.findById.mockResolvedValue(null);
      await expect(
        runWithScope("all", "referrals.approve", () => service.updateStatus("tenant-1", "missing", { status: "converted" })),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("redeem() (public, unauthenticated)", () => {
    beforeEach(() => {
      repo.getTenantIdBySlug.mockResolvedValue("tenant-1");
    });

    it("attaches the code to the lead on first redeem", async () => {
      repo.findByCode.mockResolvedValue(ROW);
      repo.findLeadContact.mockResolvedValue({ id: "lead-1", email: "prospect@example.test", phone: "9990001111" });
      repo.findReferrerContact.mockResolvedValue({ id: "user-1", email: "referrer@example.test", phone: "8880002222" });
      repo.attachLead.mockResolvedValue({ ...ROW, referredLeadId: "lead-1" });

      const result = await service.redeem({ code: "ABCD1234", leadId: "lead-1", captchaToken: "tok" }, "1.2.3.4");
      expect(result).toEqual({ referralId: "referral-1", status: "pending" });
      expect(repo.attachLead).toHaveBeenCalledWith("referral-1", "lead-1");
    });

    it("is idempotent — replaying against the SAME lead returns current state without re-attaching", async () => {
      repo.findByCode.mockResolvedValue({ ...ROW, referredLeadId: "lead-1" });
      repo.findLeadContact.mockResolvedValue({ id: "lead-1", email: "prospect@example.test", phone: "9990001111" });

      const result = await service.redeem({ code: "ABCD1234", leadId: "lead-1", captchaToken: "tok" }, "1.2.3.4");
      expect(result).toEqual({ referralId: "referral-1", status: "pending" });
      expect(repo.attachLead).not.toHaveBeenCalled();
    });

    it("422s when the code is invalid", async () => {
      repo.findByCode.mockResolvedValue(null);
      await expect(service.redeem({ code: "NOPE0000", leadId: "lead-1", captchaToken: "tok" }, "1.2.3.4")).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
    });

    it("422s when the code was already redeemed by a DIFFERENT lead", async () => {
      repo.findByCode.mockResolvedValue({ ...ROW, referredLeadId: "lead-other" });
      repo.findLeadContact.mockResolvedValue({ id: "lead-1", email: "prospect@example.test", phone: "9990001111" });
      await expect(service.redeem({ code: "ABCD1234", leadId: "lead-1", captchaToken: "tok" }, "1.2.3.4")).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it("422s on self-referral (lead email matches the referrer's own email)", async () => {
      repo.findByCode.mockResolvedValue(ROW);
      repo.findLeadContact.mockResolvedValue({ id: "lead-1", email: "Referrer@Example.test", phone: "9990001111" });
      repo.findReferrerContact.mockResolvedValue({ id: "user-1", email: "referrer@example.test", phone: "8880002222" });

      await expect(service.redeem({ code: "ABCD1234", leadId: "lead-1", captchaToken: "tok" }, "1.2.3.4")).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(repo.attachLead).not.toHaveBeenCalled();
    });

    it("422s on self-referral (lead phone matches the referrer's own phone)", async () => {
      repo.findByCode.mockResolvedValue(ROW);
      repo.findLeadContact.mockResolvedValue({ id: "lead-1", email: null, phone: "8880002222" });
      repo.findReferrerContact.mockResolvedValue({ id: "user-1", email: "referrer@example.test", phone: "8880002222" });

      await expect(service.redeem({ code: "ABCD1234", leadId: "lead-1", captchaToken: "tok" }, "1.2.3.4")).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it("404s when the lead does not exist", async () => {
      repo.findByCode.mockResolvedValue(ROW);
      repo.findLeadContact.mockResolvedValue(null);
      await expect(service.redeem({ code: "ABCD1234", leadId: "missing-lead", captchaToken: "tok" }, "1.2.3.4")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("429s when the per-IP rate limit is exceeded (before any DB read)", async () => {
      rateLimiter.hit.mockResolvedValue(true);
      await expect(service.redeem({ code: "ABCD1234", leadId: "lead-1", captchaToken: "tok" }, "9.9.9.9")).rejects.toBeInstanceOf(
        HttpException,
      );
      expect(repo.findByCode).not.toHaveBeenCalled();
    });

    it("422s when captcha verification fails (before any DB read)", async () => {
      captcha.verify.mockResolvedValue({ success: false, errorCodes: ["invalid-input-response"] });
      await expect(service.redeem({ code: "ABCD1234", leadId: "lead-1", captchaToken: "bad" }, "1.2.3.4")).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
      expect(repo.findByCode).not.toHaveBeenCalled();
    });
  });
});
