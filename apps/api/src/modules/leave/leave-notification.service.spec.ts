// apps/api/src/modules/leave/leave-notification.service.spec.ts
//
// The one property that matters here: NOTHING IN THIS SERVICE CAN FAIL A MUTATION. Every
// send runs past the commit point, so a mail provider having a bad afternoon must never
// surface to the approver as a failed approval or to the applicant as a lost request. These
// tests exist because "it throws" and "it logs and returns" look identical in manual testing
// right up until the day the provider is down.

import type { NotificationsService } from "../notifications/notifications.service";
import { LeaveNotificationService } from "./leave-notification.service";
import type { LeaveRepository, LeaveRequestRow } from "./leave.repository";

type Mocked<T> = { [K in keyof T]: T[K] extends (...args: never[]) => unknown ? jest.Mock : T[K] };

const TENANT = "tenant-1";

function makeRequestRow(overrides: Partial<LeaveRequestRow> = {}): LeaveRequestRow {
  return {
    id: "req-1",
    userId: "user-actor",
    leaveTypeId: "type-casual",
    startDate: new Date("2026-08-17T00:00:00.000Z"),
    endDate: new Date("2026-08-21T00:00:00.000Z"),
    startDayPart: "full",
    endDayPart: "full",
    halfDays: 10,
    reason: "Family wedding",
    status: "pending",
    reviewedById: null,
    reviewedAt: null,
    reviewNote: null,
    cancelledAt: null,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    user: { name: "Asha", email: "asha@example.com" },
    leaveType: { name: "Casual Leave" },
    reviewedBy: null,
    ...overrides,
  };
}

describe("LeaveNotificationService", () => {
  let repo: Mocked<LeaveRepository>;
  let notifications: Mocked<NotificationsService>;
  let service: LeaveNotificationService;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    repo = {
      listApprovers: jest.fn().mockResolvedValue([
        { id: "admin-1", name: "Owner", email: "owner@example.com" },
        { id: "admin-2", name: "Second Owner", email: "second@example.com" },
      ]),
    } as unknown as Mocked<LeaveRepository>;

    notifications = {
      notify: jest.fn().mockResolvedValue(undefined),
    } as unknown as Mocked<NotificationsService>;

    service = new LeaveNotificationService(
      repo as unknown as LeaveRepository,
      notifications as unknown as NotificationsService,
    );
    warn = jest.spyOn(service["logger"], "warn").mockImplementation(() => undefined);
  });

  afterEach(() => warn.mockRestore());

  describe("notifyRequested", () => {
    it("tells every active super admin", async () => {
      await service.notifyRequested(TENANT, makeRequestRow());
      expect(notifications.notify).toHaveBeenCalledTimes(2);
      expect(notifications.notify).toHaveBeenCalledWith(
        "admin-1",
        TENANT,
        "leave_requested",
        expect.objectContaining({ applicantName: "Asha", leaveTypeName: "Casual Leave", days: "5 days" }),
        { toEmail: "owner@example.com" },
      );
    });

    it("carries the applicant's reason, which is the point of the approval email", async () => {
      await service.notifyRequested(TENANT, makeRequestRow({ reason: "Family wedding" }));
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.anything(),
        TENANT,
        "leave_requested",
        expect.objectContaining({ reason: "Family wedding" }),
        expect.anything(),
      );
    });

    it("formats a half-day request as half a day rather than 0.5 days", async () => {
      await service.notifyRequested(
        TENANT,
        makeRequestRow({ halfDays: 1, endDate: new Date("2026-08-17T00:00:00.000Z") }),
      );
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.anything(),
        TENANT,
        "leave_requested",
        expect.objectContaining({ days: "half a day", dateRange: "17 Aug 2026" }),
        expect.anything(),
      );
    });

    it("keeps going when one approver's send fails", async () => {
      notifications.notify.mockRejectedValueOnce(new Error("mail down"));
      await expect(service.notifyRequested(TENANT, makeRequestRow())).resolves.toBeUndefined();
      // The second approver is still told.
      expect(notifications.notify).toHaveBeenCalledTimes(2);
      expect(warn).toHaveBeenCalled();
    });

    // An unwatched approval queue is a problem to fix, not a reason to refuse somebody's
    // application, so this logs loudly and returns.
    it("warns but does not throw when the tenant has no active super admin", async () => {
      repo.listApprovers.mockResolvedValue([]);
      await expect(service.notifyRequested(TENANT, makeRequestRow())).resolves.toBeUndefined();
      expect(notifications.notify).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("no active super_admin"));
    });

    it("swallows a failure to even look up the approvers", async () => {
      repo.listApprovers.mockRejectedValue(new Error("db down"));
      await expect(service.notifyRequested(TENANT, makeRequestRow())).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalled();
    });
  });

  describe("notifyDecision", () => {
    it("tells the applicant their leave was approved, naming the reviewer", async () => {
      await service.notifyDecision(
        TENANT,
        makeRequestRow({ status: "approved", reviewedBy: { name: "Owner" } }),
        "approved",
      );
      expect(notifications.notify).toHaveBeenCalledWith(
        "user-actor",
        TENANT,
        "leave_approved",
        expect.objectContaining({ reviewerName: "Owner" }),
        { toEmail: "asha@example.com" },
      );
    });

    it("carries the rejection reason verbatim", async () => {
      await service.notifyDecision(
        TENANT,
        makeRequestRow({ status: "rejected", reviewNote: "Too many people out that week" }),
        "rejected",
      );
      expect(notifications.notify).toHaveBeenCalledWith(
        "user-actor",
        TENANT,
        "leave_rejected",
        expect.objectContaining({ reason: "Too many people out that week" }),
        expect.anything(),
      );
    });

    it("falls back to a neutral reviewer name when the approver's account is gone", async () => {
      // reviewed_by_id is ON DELETE SET NULL, so an offboarded approver leaves this null.
      await service.notifyDecision(TENANT, makeRequestRow({ reviewedBy: null }), "approved");
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.anything(),
        TENANT,
        "leave_approved",
        expect.objectContaining({ reviewerName: "your admin" }),
        expect.anything(),
      );
    });

    // The decision is already durable by the time this runs.
    it("never throws when the send fails", async () => {
      notifications.notify.mockRejectedValue(new Error("mail down"));
      await expect(
        service.notifyDecision(TENANT, makeRequestRow(), "approved"),
      ).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalled();
    });
  });
});
