// apps/api/src/modules/leave/leave.service.spec.ts
//
// Unit tests for the leave business rules, with the repository mocked (the house pattern,
// the service takes a repository and is constructed with `new`, no Nest testing module and
// no Prisma mock).
//
// The cases that matter most here are the ones where a shortcut would be invisible in
// manual testing: scope resolution, the reason for a 404 rather than a 403, pending days
// counting against the balance, and the notification never being able to fail a mutation.

import { ConflictException, ForbiddenException, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type { PermissionScope } from "@repo/types";

import { scopeContextStorage, type ScopeContext } from "../auth/lib/scope-context";
import type { LeaveNotificationService } from "./leave-notification.service";
import type { LeaveSetupService } from "./leave-setup.service";
import type { LeaveRepository, LeaveRequestRow, LeaveTypeRow } from "./leave.repository";
import { LeaveService } from "./leave.service";

type Mocked<T> = { [K in keyof T]: T[K] extends (...args: never[]) => unknown ? jest.Mock : T[K] };

const TENANT = "tenant-1";
const ACTOR = "user-actor";
const OTHER = "user-other";

/** 2026-08-17 is a Monday; 2026-08-23 is the following Sunday. */
const MONDAY = "2026-08-17";
const FRIDAY = "2026-08-21";

function makeLeaveType(overrides: Partial<LeaveTypeRow> = {}): LeaveTypeRow {
  return {
    id: "type-casual",
    key: "casual",
    name: "Casual Leave",
    description: null,
    paid: true,
    allowHalfDay: true,
    active: true,
    sortOrder: 0,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function makeRequestRow(overrides: Partial<LeaveRequestRow> = {}): LeaveRequestRow {
  return {
    id: "req-1",
    userId: ACTOR,
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

function mockRepository(): Mocked<LeaveRepository> {
  return {
    // The transaction wrapper just runs the callback, the mocked repo methods it calls do
    // not care about the client, so a bare object stands in for `tx`.
    runInTransaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})),
    lockUser: jest.fn().mockResolvedValue(undefined),
    listLeaveTypes: jest.fn().mockResolvedValue([]),
    findLeaveTypeById: jest.fn().mockResolvedValue(makeLeaveType()),
    listHolidays: jest.fn().mockResolvedValue([]),
    listHolidaysBetween: jest.fn().mockResolvedValue([]),
    listRequests: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
    findRequestById: jest.fn().mockResolvedValue(null),
    createRequestGuardingOverlap: jest.fn(),
    transitionRequestStatus: jest.fn().mockResolvedValue(1),
    sumHalfDaysByTypeAndStatus: jest.fn().mockResolvedValue([]),
    findQuotasForYear: jest.fn().mockResolvedValue([{ leaveTypeId: "type-casual", halfDays: 24 }]),
    listLeaveTypesForUserYear: jest.fn().mockResolvedValue([]),
    listCalendarWindow: jest.fn().mockResolvedValue([]),
    listApprovers: jest.fn().mockResolvedValue([]),
    findUserName: jest.fn().mockResolvedValue({ name: "Asha", email: "asha@example.com" }),
  } as unknown as Mocked<LeaveRepository>;
}

function mockSetup(): Mocked<LeaveSetupService> {
  return {
    getWeeklyOffDays: jest.fn().mockResolvedValue([0]),
  } as unknown as Mocked<LeaveSetupService>;
}

function mockNotifications(): Mocked<LeaveNotificationService> {
  return {
    notifyRequested: jest.fn().mockResolvedValue(undefined),
    notifyDecision: jest.fn().mockResolvedValue(undefined),
  } as unknown as Mocked<LeaveNotificationService>;
}

function runWithScope<T>(scope: PermissionScope, fn: () => T, actorId = ACTOR): T {
  const ctx: ScopeContext = { permissionKey: "leave.view", scope, actorId, tenantId: TENANT };
  return scopeContextStorage.run(ctx, fn);
}

describe("LeaveService", () => {
  let repo: Mocked<LeaveRepository>;
  let setup: Mocked<LeaveSetupService>;
  let notifications: Mocked<LeaveNotificationService>;
  let service: LeaveService;

  beforeEach(() => {
    repo = mockRepository();
    setup = mockSetup();
    notifications = mockNotifications();
    service = new LeaveService(
      repo as unknown as LeaveRepository,
      setup as unknown as LeaveSetupService,
      notifications as unknown as LeaveNotificationService,
    );
  });

  describe("scope resolution", () => {
    it("narrows the list to the actor at own scope", async () => {
      await runWithScope("own", () =>
        service.listRequests(TENANT, { page: 1, pageSize: 20 } as never),
      );
      expect(repo.listRequests).toHaveBeenCalledWith(expect.objectContaining({ userId: ACTOR }));
    });

    it("does not narrow the list at all scope", async () => {
      await runWithScope("all", () =>
        service.listRequests(TENANT, { page: 1, pageSize: 20 } as never),
      );
      expect(repo.listRequests).toHaveBeenCalledWith(expect.objectContaining({ userId: undefined }));
    });

    it("ignores a client-supplied userId at own scope rather than honouring it", async () => {
      await runWithScope("own", () =>
        service.listRequests(TENANT, { page: 1, pageSize: 20, userId: OTHER } as never),
      );
      expect(repo.listRequests).toHaveBeenCalledWith(expect.objectContaining({ userId: ACTOR }));
    });

    it("honours a userId filter at all scope", async () => {
      await runWithScope("all", () =>
        service.listRequests(TENANT, { page: 1, pageSize: 20, userId: OTHER } as never),
      );
      expect(repo.listRequests).toHaveBeenCalledWith(expect.objectContaining({ userId: OTHER }));
    });

    // Fails closed rather than widening: there is no coherent branch partition of a
    // company-wide leave allowance, and returning "no filter" would hand a branch manager
    // everybody's leave history including the reasons.
    it.each(["branch", "assigned"] as const)("refuses %s scope instead of widening", async (scope) => {
      await expect(
        runWithScope(scope, () => service.listRequests(TENANT, { page: 1, pageSize: 20 } as never)),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe("getRequest", () => {
    it("passes the actor down as a query filter at own scope, not a post-hoc check", async () => {
      repo.findRequestById.mockResolvedValue(makeRequestRow());
      await runWithScope("own", () => service.getRequest(TENANT, "req-1"));
      expect(repo.findRequestById).toHaveBeenCalledWith(TENANT, "req-1", ACTOR);
    });

    // A 403 would confirm the row exists, which is itself a disclosure.
    it("answers NOT FOUND for someone else's request, never forbidden", async () => {
      repo.findRequestById.mockResolvedValue(null);
      await expect(runWithScope("own", () => service.getRequest(TENANT, "req-1"))).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe("createRequest", () => {
    const body = {
      leaveTypeId: "type-casual",
      startDate: MONDAY,
      endDate: FRIDAY,
      startDayPart: "full",
      endDayPart: "full",
      reason: "Family wedding",
    } as never;

    beforeEach(() => {
      repo.createRequestGuardingOverlap.mockResolvedValue({ created: makeRequestRow(), conflict: null });
    });

    it("computes the duration server-side and persists it", async () => {
      await service.createRequest(TENANT, ACTOR, body);
      expect(repo.createRequestGuardingOverlap).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ halfDays: 10, userId: ACTOR }),
      );
    });

    it("excludes weekly offs from the duration", async () => {
      // Mon 17th → Mon 24th spans the Sunday on the 23rd: 7 working days, not 8.
      await service.createRequest(TENANT, ACTOR, { ...(body as object), endDate: "2026-08-24" } as never);
      expect(repo.createRequestGuardingOverlap).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ halfDays: 14 }),
      );
    });

    it("excludes mandatory holidays but not optional ones", async () => {
      repo.listHolidays.mockResolvedValue([
        { id: "h1", date: new Date("2026-08-19T00:00:00.000Z"), name: "Holiday", description: null, optional: false },
        { id: "h2", date: new Date("2026-08-20T00:00:00.000Z"), name: "Optional", description: null, optional: true },
      ]);
      await service.createRequest(TENANT, ACTOR, body);
      // Mon–Fri is 5 days; the mandatory holiday removes one, the optional one does not.
      expect(repo.createRequestGuardingOverlap).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ halfDays: 8 }),
      );
    });

    it("always records the actor as the applicant", async () => {
      await service.createRequest(TENANT, ACTOR, { ...(body as object), userId: OTHER } as never);
      expect(repo.createRequestGuardingOverlap).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ userId: ACTOR }),
      );
    });

    it("refuses an inactive leave type", async () => {
      repo.findLeaveTypeById.mockResolvedValue(makeLeaveType({ active: false }));
      await expect(service.createRequest(TENANT, ACTOR, body)).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
    });

    it("refuses a request that spans two calendar years", async () => {
      await expect(
        service.createRequest(TENANT, ACTOR, {
          ...(body as object),
          startDate: "2026-12-30",
          endDate: "2027-01-02",
        } as never),
      ).rejects.toMatchObject({ response: { code: "leave.cross_year" } });
    });

    it("refuses a half day on a type that forbids them", async () => {
      repo.findLeaveTypeById.mockResolvedValue(makeLeaveType({ allowHalfDay: false }));
      await expect(
        service.createRequest(TENANT, ACTOR, {
          ...(body as object),
          endDate: MONDAY,
          startDayPart: "first_half",
        } as never),
      ).rejects.toMatchObject({ response: { code: "leave.half_day_not_allowed" } });
    });

    it("refuses when the year has no allowance set, distinctly from having none left", async () => {
      repo.findQuotasForYear.mockResolvedValue([]);
      await expect(service.createRequest(TENANT, ACTOR, body)).rejects.toMatchObject({
        response: { code: "leave.quota_not_set" },
      });
    });

    // The point of counting pending: otherwise somebody queues five ten-day requests against
    // a twelve-day allowance and leaves the approver to work out which two can survive.
    it("counts PENDING days against the allowance, not just approved ones", async () => {
      repo.findQuotasForYear.mockResolvedValue([{ leaveTypeId: "type-casual", halfDays: 24 }]);
      repo.sumHalfDaysByTypeAndStatus.mockResolvedValue([
        { leaveTypeId: "type-casual", status: "approved", halfDays: 8 },
        { leaveTypeId: "type-casual", status: "pending", halfDays: 8 },
      ]);
      // 4 + 4 already spoken for out of 12; this request is another 5.
      await expect(service.createRequest(TENANT, ACTOR, body)).rejects.toMatchObject({
        response: { code: "leave.quota_exceeded" },
      });
    });

    it("skips the allowance check entirely for unpaid leave", async () => {
      repo.findLeaveTypeById.mockResolvedValue(makeLeaveType({ id: "type-unpaid", paid: false }));
      repo.findQuotasForYear.mockResolvedValue([]);
      await expect(service.createRequest(TENANT, ACTOR, body)).resolves.toBeDefined();
    });

    it("reports an overlap as a conflict, naming the dates already booked", async () => {
      repo.createRequestGuardingOverlap.mockResolvedValue({
        created: null,
        conflict: makeRequestRow({ status: "approved" }),
      });
      await expect(service.createRequest(TENANT, ACTOR, body)).rejects.toMatchObject({
        response: { code: "leave.overlapping_request", detail: expect.stringContaining("2026-08-17") },
      });
    });

    it("notifies the approvers once the request is saved", async () => {
      await service.createRequest(TENANT, ACTOR, body);
      expect(notifications.notifyRequested).toHaveBeenCalledTimes(1);
    });
  });

  describe("approveRequest", () => {
    beforeEach(() => {
      repo.findRequestById.mockResolvedValue(makeRequestRow());
    });

    it("re-checks the allowance inside the transaction, excluding this request's own days", async () => {
      await service.approveRequest(TENANT, "admin-1", "req-1", {} as never);
      expect(repo.lockUser).toHaveBeenCalledWith(expect.anything(), ACTOR);
      expect(repo.sumHalfDaysByTypeAndStatus).toHaveBeenCalledWith(
        TENANT,
        ACTOR,
        2026,
        expect.objectContaining({ excludeRequestId: "req-1" }),
      );
    });

    it("refuses when approving would overrun the allowance", async () => {
      repo.findQuotasForYear.mockResolvedValue([{ leaveTypeId: "type-casual", halfDays: 12 }]);
      repo.sumHalfDaysByTypeAndStatus.mockResolvedValue([
        { leaveTypeId: "type-casual", status: "approved", halfDays: 8 },
      ]);
      await expect(service.approveRequest(TENANT, "admin-1", "req-1", {} as never)).rejects.toMatchObject({
        response: { code: "leave.quota_exceeded" },
      });
      expect(repo.transitionRequestStatus).not.toHaveBeenCalled();
      expect(notifications.notifyDecision).not.toHaveBeenCalled();
    });

    // The zero-row update is how the service learns another approver got there first.
    it("reports a lost race as a conflict rather than deducting twice", async () => {
      repo.transitionRequestStatus.mockResolvedValue(0);
      await expect(service.approveRequest(TENANT, "admin-1", "req-1", {} as never)).rejects.toMatchObject({
        response: { code: "leave.already_reviewed" },
      });
    });

    it("refuses to re-decide a request that is already approved", async () => {
      repo.findRequestById.mockResolvedValue(makeRequestRow({ status: "approved" }));
      await expect(service.approveRequest(TENANT, "admin-1", "req-1", {} as never)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it("notifies the applicant after a successful approval", async () => {
      await service.approveRequest(TENANT, "admin-1", "req-1", {} as never);
      expect(notifications.notifyDecision).toHaveBeenCalledWith(TENANT, expect.anything(), "approved");
    });

    // The write is the contract; the email is a courtesy. Notification failures are
    // swallowed inside LeaveNotificationService (see its spec) precisely so a mail provider
    // having a bad afternoon cannot surface to the approver as a failed approval.
    it("notifies only after the status has actually changed", async () => {
      const order: string[] = [];
      repo.transitionRequestStatus.mockImplementation(async () => {
        order.push("transition");
        return 1;
      });
      notifications.notifyDecision.mockImplementation(async () => {
        order.push("notify");
      });
      await service.approveRequest(TENANT, "admin-1", "req-1", {} as never);
      expect(order).toEqual(["transition", "notify"]);
    });
  });

  describe("rejectRequest", () => {
    beforeEach(() => {
      repo.findRequestById.mockResolvedValue(makeRequestRow());
    });

    it("stores the reviewer's reason on the row", async () => {
      await service.rejectRequest(TENANT, "admin-1", "req-1", { reason: "  Too many out that week  " } as never);
      expect(repo.transitionRequestStatus).toHaveBeenCalledWith(
        expect.objectContaining({ to: "rejected", note: "Too many out that week" }),
      );
    });

    it("deducts nothing, a rejection leaves the allowance untouched", async () => {
      await service.rejectRequest(TENANT, "admin-1", "req-1", { reason: "No cover" } as never);
      expect(repo.findQuotasForYear).not.toHaveBeenCalled();
    });

    it("reports a lost race as a conflict", async () => {
      repo.transitionRequestStatus.mockResolvedValue(0);
      await expect(
        service.rejectRequest(TENANT, "admin-1", "req-1", { reason: "No cover" } as never),
      ).rejects.toMatchObject({ response: { code: "leave.already_reviewed" } });
    });
  });

  describe("cancelRequest", () => {
    it("withdraws a pending request", async () => {
      repo.findRequestById.mockResolvedValue(makeRequestRow());
      await service.cancelRequest(TENANT, ACTOR, "req-1");
      expect(repo.transitionRequestStatus).toHaveBeenCalledWith(
        expect.objectContaining({ to: "cancelled", from: ["pending", "approved"] }),
      );
    });

    it("scopes the lookup to the actor, so nobody withdraws a colleague's leave", async () => {
      repo.findRequestById.mockResolvedValue(null);
      await expect(service.cancelRequest(TENANT, ACTOR, "req-1")).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.findRequestById).toHaveBeenCalledWith(TENANT, "req-1", ACTOR);
    });

    it("withdraws approved leave that has not started yet", async () => {
      repo.findRequestById.mockResolvedValue(
        makeRequestRow({
          status: "approved",
          startDate: new Date("2099-01-01T00:00:00.000Z"),
          endDate: new Date("2099-01-02T00:00:00.000Z"),
        }),
      );
      await expect(service.cancelRequest(TENANT, ACTOR, "req-1")).resolves.toBeDefined();
    });

    // Crediting back days somebody was actually absent for would make the balance disagree
    // with reality.
    it("refuses to withdraw approved leave that has already started", async () => {
      repo.findRequestById.mockResolvedValue(
        makeRequestRow({
          status: "approved",
          startDate: new Date("2020-01-01T00:00:00.000Z"),
          endDate: new Date("2020-01-02T00:00:00.000Z"),
        }),
      );
      await expect(service.cancelRequest(TENANT, ACTOR, "req-1")).rejects.toMatchObject({
        response: { code: "leave.already_started" },
      });
    });

    it("refuses to withdraw a rejected request", async () => {
      repo.findRequestById.mockResolvedValue(makeRequestRow({ status: "rejected" }));
      await expect(service.cancelRequest(TENANT, ACTOR, "req-1")).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe("balances", () => {
    beforeEach(() => {
      repo.listLeaveTypes.mockResolvedValue([makeLeaveType()]);
      repo.findQuotasForYear.mockResolvedValue([{ leaveTypeId: "type-casual", halfDays: 24 }]);
    });

    it("holds pending days against the remaining balance", async () => {
      repo.sumHalfDaysByTypeAndStatus.mockResolvedValue([
        { leaveTypeId: "type-casual", status: "approved", halfDays: 4 },
        { leaveTypeId: "type-casual", status: "pending", halfDays: 2 },
      ]);
      const result = await runWithScope("own", () => service.getBalances(TENANT, ACTOR, {} as never));
      expect(result.balances[0]).toMatchObject({
        entitledDays: 12,
        usedDays: 2,
        pendingDays: 1,
        remainingDays: 9,
      });
    });

    it("reports a null entitlement when the year has no allowance, not a zero", async () => {
      repo.findQuotasForYear.mockResolvedValue([]);
      const result = await runWithScope("own", () => service.getBalances(TENANT, ACTOR, {} as never));
      expect(result.balances[0]?.entitledDays).toBeNull();
      expect(result.balances[0]?.remainingDays).toBeNull();
    });

    it("reports no entitlement for unpaid leave, which never runs out", async () => {
      repo.listLeaveTypes.mockResolvedValue([makeLeaveType({ id: "type-unpaid", paid: false })]);
      const result = await runWithScope("own", () => service.getBalances(TENANT, ACTOR, {} as never));
      expect(result.balances[0]?.entitledDays).toBeNull();
    });

    // Otherwise the days stay deducted while the line explaining them disappears, and the
    // allowance looks like it leaked.
    it("still lists a leave type that was deleted after being used", async () => {
      repo.listLeaveTypes.mockResolvedValue([]);
      repo.listLeaveTypesForUserYear.mockResolvedValue([makeLeaveType({ id: "type-gone", name: "Retired Leave" })]);
      repo.findQuotasForYear.mockResolvedValue([{ leaveTypeId: "type-gone", halfDays: 10 }]);
      repo.sumHalfDaysByTypeAndStatus.mockResolvedValue([
        { leaveTypeId: "type-gone", status: "approved", halfDays: 4 },
      ]);
      const result = await runWithScope("own", () => service.getBalances(TENANT, ACTOR, {} as never));
      expect(result.balances).toHaveLength(1);
      expect(result.balances[0]).toMatchObject({ leaveTypeName: "Retired Leave", usedDays: 2 });
    });

    it("ignores a client-supplied userId at own scope", async () => {
      repo.sumHalfDaysByTypeAndStatus.mockResolvedValue([]);
      const result = await runWithScope("own", () =>
        service.getBalances(TENANT, ACTOR, { userId: OTHER } as never),
      );
      expect(result.userId).toBe(ACTOR);
    });

    it("honours a userId at all scope, so an approver can look somebody up", async () => {
      repo.sumHalfDaysByTypeAndStatus.mockResolvedValue([]);
      const result = await runWithScope("all", () =>
        service.getBalances(TENANT, ACTOR, { userId: OTHER } as never),
      );
      expect(result.userId).toBe(OTHER);
    });
  });

  describe("calendar", () => {
    it("returns team-wide entries without the reason, and flags the caller's own", async () => {
      repo.listCalendarWindow.mockResolvedValue([
        {
          id: "req-1",
          userId: OTHER,
          startDate: new Date("2026-08-17T00:00:00.000Z"),
          endDate: new Date("2026-08-18T00:00:00.000Z"),
          startDayPart: "full",
          endDayPart: "full",
          status: "approved",
          user: { name: "Ravi" },
          leaveType: { name: "Sick Leave" },
        },
      ]);

      const result = await service.getCalendar(TENANT, ACTOR, { from: MONDAY, to: FRIDAY } as never);

      expect(result.entries).toHaveLength(1);
      expect(result.entries[0]).toMatchObject({ userName: "Ravi", isSelf: false });
      // The projection never fetches it, and the DTO must never grow it back.
      expect(result.entries[0]).not.toHaveProperty("reason");
    });

    it("marks the caller's own leave", async () => {
      repo.listCalendarWindow.mockResolvedValue([
        {
          id: "req-2",
          userId: ACTOR,
          startDate: new Date("2026-08-17T00:00:00.000Z"),
          endDate: new Date("2026-08-17T00:00:00.000Z"),
          startDayPart: "full",
          endDayPart: "full",
          status: "pending",
          user: { name: "Asha" },
          leaveType: { name: "Casual Leave" },
        },
      ]);
      const result = await service.getCalendar(TENANT, ACTOR, { from: MONDAY, to: FRIDAY } as never);
      expect(result.entries[0]?.isSelf).toBe(true);
    });

    it("emits calendar dates as YYYY-MM-DD, never as timestamps", async () => {
      repo.listHolidaysBetween.mockResolvedValue([
        { id: "h1", date: new Date("2026-08-19T00:00:00.000Z"), name: "Holiday", description: null, optional: false },
      ]);
      const result = await service.getCalendar(TENANT, ACTOR, { from: MONDAY, to: FRIDAY } as never);
      expect(result.holidays[0]?.date).toBe("2026-08-19");
    });

    // The calendar is deliberately not scope-filtered, it has its own permission, and
    // "who is out" is the entire point of it.
    it("does not require a scope context", async () => {
      await expect(
        service.getCalendar(TENANT, ACTOR, { from: MONDAY, to: FRIDAY } as never),
      ).resolves.toBeDefined();
    });
  });

  describe("apply context", () => {
    it("bundles the working week, mandatory holidays, types and balances", async () => {
      repo.listLeaveTypes.mockResolvedValue([makeLeaveType()]);
      repo.listHolidays.mockResolvedValue([
        { id: "h1", date: new Date("2026-08-19T00:00:00.000Z"), name: "Holiday", description: null, optional: false },
        { id: "h2", date: new Date("2026-08-20T00:00:00.000Z"), name: "Optional", description: null, optional: true },
      ]);

      const result = await service.getApplyContext(TENANT, ACTOR, { year: 2026 } as never);

      expect(result.weeklyOffDays).toEqual([0]);
      // Optional holidays are excluded: taking one costs a day like any other.
      expect(result.holidayDates).toEqual(["2026-08-19"]);
      expect(result.types).toHaveLength(1);
      expect(result.balances).toHaveLength(1);
    });
  });
});
