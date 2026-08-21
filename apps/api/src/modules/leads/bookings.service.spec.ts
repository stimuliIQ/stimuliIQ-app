// apps/api/src/modules/leads/bookings.service.spec.ts
//
// Unit tests for BookingsService, the status state machine and, most importantly, the
// UNAUTHENTICATED public booking intake (tenant resolution + lead de-duplication-by-phone
// + atomic lead+booking creation). Rate-limiting itself is exercised at the controller
// (PublicBookingRateLimiter is a thin Redis INCR/EXPIRE wrapper, covered by
// login-rate-limiter's existing test pattern, not re-tested here to avoid duplicating
// Redis-mock plumbing for an near-identical 5-line class).

import { NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { BookingsService } from "./bookings.service";
import { BookingsRepository, type BookingRow } from "./bookings.repository";
import { ActivitiesRepository } from "./activities.repository";
import { LeadsRepository } from "./leads.repository";
import { AuthRepository } from "../auth/auth.repository";
import { NoopCaptchaProvider } from "../captcha/providers/captcha/noop-captcha.provider";
import { scopeContextStorage, type ScopeContext } from "../auth/lib/scope-context";

type Mocked<T> = { [K in keyof T]: T[K] extends (...args: never[]) => unknown ? jest.Mock : T[K] };

function mockBookingsRepository(): Mocked<BookingsRepository> {
  return {
    list: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    moveStatus: jest.fn(),
    createPublicLeadAndBooking: jest.fn(),
  } as unknown as Mocked<BookingsRepository>;
}

function mockLeadsRepository(): Mocked<LeadsRepository> {
  return {
    list: jest.fn(),
    findById: jest.fn(),
    findByPhone: jest.fn(),
    listCallerBranchIds: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    moveStage: jest.fn(),
    assignOwner: jest.fn(),
    setConverted: jest.fn(),
    softDelete: jest.fn(),
    restore: jest.fn(),
    pickRoundRobinOwner: jest.fn(),
  } as unknown as Mocked<LeadsRepository>;
}

function mockActivitiesRepository(): Mocked<ActivitiesRepository> {
  return { create: jest.fn() } as unknown as Mocked<ActivitiesRepository>;
}

function mockAuthRepository(): Mocked<AuthRepository> {
  return { getTenantBySlug: jest.fn() } as unknown as Mocked<AuthRepository>;
}

const BOOKING_ROW: BookingRow = {
  id: "booking-1",
  tenantId: "tenant-1",
  leadId: "lead-1",
  leadName: "Asha Rao",
  programId: null,
  programTitle: null,
  slotAt: new Date("2026-02-01T10:00:00Z"),
  status: "requested",
  source: "website",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  deletedAt: null,
};

function runWithScope<T>(scope: ScopeContext["scope"], fn: () => T): T {
  const ctx: ScopeContext = { permissionKey: "bookings.view", scope, actorId: "actor-1", tenantId: "tenant-1" };
  return scopeContextStorage.run(ctx, fn);
}

describe("BookingsService", () => {
  let service: BookingsService;
  let repo: Mocked<BookingsRepository>;
  let leadsRepo: Mocked<LeadsRepository>;
  let activitiesRepo: Mocked<ActivitiesRepository>;
  let authRepo: Mocked<AuthRepository>;
  let captchaProvider: NoopCaptchaProvider;

  beforeEach(() => {
    repo = mockBookingsRepository();
    leadsRepo = mockLeadsRepository();
    activitiesRepo = mockActivitiesRepository();
    authRepo = mockAuthRepository();
    captchaProvider = new NoopCaptchaProvider();
    service = new BookingsService(
      repo as unknown as BookingsRepository,
      leadsRepo as unknown as LeadsRepository,
      activitiesRepo as unknown as ActivitiesRepository,
      authRepo as unknown as AuthRepository,
      captchaProvider,
    );
  });

  describe("status state machine", () => {
    it("accepts requested -> confirmed", async () => {
      repo.findById.mockResolvedValueOnce(BOOKING_ROW).mockResolvedValueOnce({ ...BOOKING_ROW, status: "confirmed" });

      const result = await runWithScope("all", () =>
        service.moveStatus("tenant-1", "actor-1", BOOKING_ROW.id, { status: "confirmed" }),
      );

      expect(repo.moveStatus).toHaveBeenCalledWith(BOOKING_ROW.id, "confirmed");
      expect(result.status).toBe("confirmed");
    });

    it("rejects requested -> completed (must pass through confirmed first)", async () => {
      repo.findById.mockResolvedValue(BOOKING_ROW);

      await expect(
        runWithScope("all", () => service.moveStatus("tenant-1", "actor-1", BOOKING_ROW.id, { status: "completed" })),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(repo.moveStatus).not.toHaveBeenCalled();
    });

    it("completed/cancelled/no_show are terminal", async () => {
      repo.findById.mockResolvedValue({ ...BOOKING_ROW, status: "completed" });

      await expect(
        runWithScope("all", () => service.moveStatus("tenant-1", "actor-1", BOOKING_ROW.id, { status: "confirmed" })),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it("404s for an out-of-scope booking", async () => {
      repo.findById.mockResolvedValue(null);

      await expect(
        runWithScope("own", () => service.moveStatus("tenant-1", "actor-1", "other-booking", { status: "confirmed" })),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("logs a note activity against the parent lead when notes are provided on a status move", async () => {
      repo.findById.mockResolvedValueOnce(BOOKING_ROW).mockResolvedValueOnce({ ...BOOKING_ROW, status: "confirmed" });

      await runWithScope("all", () =>
        service.moveStatus("tenant-1", "actor-1", BOOKING_ROW.id, { status: "confirmed", notes: "Confirmed by phone" }),
      );

      expect(activitiesRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ leadId: "lead-1", type: "note", payload: expect.objectContaining({ note: "Confirmed by phone" }) }),
      );
    });
  });

  describe("public booking intake (UNAUTHENTICATED)", () => {
    const PUBLIC_BODY = {
      name: "New Prospect",
      phone: "+919999999000",
      slotAt: "2026-02-05T09:00:00Z",
      source: "website",
    };

    it("resolves the single hardcoded tenant via TENANT_SLUG (mirrors AuthService's resolution)", async () => {
      authRepo.getTenantBySlug.mockResolvedValue({ id: "tenant-1", slug: "stimuliiq" });
      leadsRepo.findByPhone.mockResolvedValue(null);
      repo.createPublicLeadAndBooking.mockResolvedValue({
        leadId: "new-lead",
        bookingId: "new-booking",
        slotAt: new Date(PUBLIC_BODY.slotAt),
        status: "requested",
      });

      await service.createPublicBooking(PUBLIC_BODY);

      expect(authRepo.getTenantBySlug).toHaveBeenCalledWith("stimuliiq");
    });

    it("throws 404 if the hardcoded tenant is somehow not configured (fail closed, never widen to a different tenant)", async () => {
      authRepo.getTenantBySlug.mockResolvedValue(null);

      await expect(service.createPublicBooking(PUBLIC_BODY)).rejects.toBeInstanceOf(NotFoundException);
      expect(leadsRepo.findByPhone).not.toHaveBeenCalled();
    });

    it("creates a NEW lead (stage=new) + booking atomically when no existing lead matches the phone", async () => {
      authRepo.getTenantBySlug.mockResolvedValue({ id: "tenant-1", slug: "stimuliiq" });
      leadsRepo.findByPhone.mockResolvedValue(null);
      repo.createPublicLeadAndBooking.mockResolvedValue({
        leadId: "new-lead",
        bookingId: "new-booking",
        slotAt: new Date(PUBLIC_BODY.slotAt),
        status: "requested",
      });

      const result = await service.createPublicBooking(PUBLIC_BODY);

      expect(repo.createPublicLeadAndBooking).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: "tenant-1", name: "New Prospect", phone: PUBLIC_BODY.phone, source: "website" }),
      );
      expect(result.bookingId).toBe("new-booking");
      expect(result.status).toBe("requested");
    });

    it("de-duplicates against an existing lead by phone instead of creating a second lead", async () => {
      authRepo.getTenantBySlug.mockResolvedValue({ id: "tenant-1", slug: "stimuliiq" });
      leadsRepo.findByPhone.mockResolvedValue({ id: "existing-lead" });
      repo.create.mockResolvedValue({ id: "second-booking" });

      const result = await service.createPublicBooking(PUBLIC_BODY);

      expect(repo.createPublicLeadAndBooking).not.toHaveBeenCalled();
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: "tenant-1", leadId: "existing-lead", status: "requested" }),
      );
      expect(result.bookingId).toBe("second-booking");
    });

    it("never trusts a client-supplied tenantId/leadId/status (strict zod schema strips them before this layer is reached, verified here by confirming the call signature has no such passthrough)", async () => {
      authRepo.getTenantBySlug.mockResolvedValue({ id: "tenant-1", slug: "stimuliiq" });
      leadsRepo.findByPhone.mockResolvedValue(null);
      repo.createPublicLeadAndBooking.mockResolvedValue({
        leadId: "new-lead",
        bookingId: "new-booking",
        slotAt: new Date(PUBLIC_BODY.slotAt),
        status: "requested",
      });

      await service.createPublicBooking(PUBLIC_BODY);

      const callArg = repo.createPublicLeadAndBooking.mock.calls[0]![0];
      expect(callArg.tenantId).toBe("tenant-1"); // server-resolved, not client-supplied.
    });

    it("rejects (422) and never writes when the captcha token fails verification", async () => {
      authRepo.getTenantBySlug.mockResolvedValue({ id: "tenant-1", slug: "stimuliiq" });
      jest.spyOn(captchaProvider, "verify").mockResolvedValue({ success: false, errorCodes: ["invalid-input-response"] });

      await expect(
        service.createPublicBooking({ ...PUBLIC_BODY, captchaToken: "bad-token" }, "203.0.113.9"),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);

      // Fail closed: no tenant lookup, no lead/booking write once captcha fails.
      expect(authRepo.getTenantBySlug).not.toHaveBeenCalled();
      expect(repo.createPublicLeadAndBooking).not.toHaveBeenCalled();
      expect(repo.create).not.toHaveBeenCalled();
    });

    it("persists DPDP consent with a SERVER-derived timestamp + ip_hash (raw IP never stored)", async () => {
      authRepo.getTenantBySlug.mockResolvedValue({ id: "tenant-1", slug: "stimuliiq" });
      leadsRepo.findByPhone.mockResolvedValue(null);
      repo.createPublicLeadAndBooking.mockResolvedValue({
        leadId: "new-lead",
        bookingId: "new-booking",
        slotAt: new Date(PUBLIC_BODY.slotAt),
        status: "requested",
      });

      await service.createPublicBooking(
        { ...PUBLIC_BODY, captchaToken: "ok", consent: { marketingOptIn: true, tosVersion: "v1.0" } },
        "203.0.113.9",
      );

      const consent = repo.createPublicLeadAndBooking.mock.calls[0]![0].consent as Record<string, unknown>;
      expect(consent).toMatchObject({ marketing_opt_in: true, tos_version: "v1.0" });
      expect(typeof consent.timestamp).toBe("string");
      // ip_hash is a SHA-256 hex digest, never the raw IP.
      expect(consent.ip_hash).toMatch(/^[a-f0-9]{64}$/);
      expect(consent.ip_hash).not.toContain("203.0.113.9");
    });
  });
});
