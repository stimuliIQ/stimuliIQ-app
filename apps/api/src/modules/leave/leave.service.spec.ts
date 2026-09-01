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
import type { OrgService } from "../org/org.service";

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
    // Two-step chain (ADR-0070). Null on a single-step one, which is what these fixtures
    // model unless a test says otherwise.
    leadApprovedById: null,
    leadApprovedAt: null,
    leadApprovalNote: null,
    leadApprovedBy: null,
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
    // Step one of the two-step chain — tells the manager it is now waiting on them.
    notifyLeadApproved: jest.fn().mockResolvedValue(undefined),
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
  let org: Mocked<OrgService>;
  let service: LeaveService;

  beforeEach(() => {
    repo = mockRepository();
    setup = mockSetup();
    notifications = mockNotifications();
    // No org chart by default — the state every tenant is in until somebody builds one.
    // The chain therefore falls back to the owner, which is a SINGLE step, which is why
    // every pre-existing test in this file keeps passing unchanged: that is exactly the
    // behaviour that shipped before the hierarchy existed.
    org = {
      resolveApprovalChain: jest.fn().mockResolvedValue({
        steps: ["owner"], firstApproverId: null, finalApproverId: null, fallbackToOwner: true,
      }),
      // The actor in these tests is the SUPER ADMIN — the only person who could approve
      // anything before the hierarchy existed. `isOwner` is what carries that now, so every
      // pre-existing test in this file keeps testing the behaviour it was written for.
      getPosition: jest.fn().mockResolvedValue({
        teamId: null, teamName: null, leadUserId: null, leadName: null,
        managerUserId: null, managerName: null,
        leadsTeamIds: [], managesTeamIds: [], isHr: false, isOwner: true,
      }),
      listFallbackApprovers: jest.fn().mockResolvedValue([]),
      listSubordinateUserIds: jest.fn().mockResolvedValue([]),
    } as unknown as Mocked<OrgService>;

    service = new LeaveService(
      repo as unknown as LeaveRepository,
      setup as unknown as LeaveSetupService,
      notifications as unknown as LeaveNotificationService,
      org as unknown as OrgService,
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
    it("lets somebody open their own request at own scope", async () => {
      repo.findRequestById.mockResolvedValue(makeRequestRow({ userId: ACTOR }));
      await expect(runWithScope("own", () => service.getRequest(TENANT, "req-1"))).resolves.toBeDefined();
    });

    // The scoping moved OUT of the WHERE clause when the org hierarchy landed, because
    // "may I see this?" now has two answers — it is mine, or I approve for whoever filed
    // it — and a single id in the WHERE cannot express the second. What matters is the
    // OUTCOME, which is unchanged and asserted here and below: somebody else's request is
    // NOT FOUND at own scope.
    it("hides a colleague's request from somebody who does not approve for them", async () => {
      repo.findRequestById.mockResolvedValue(makeRequestRow({ userId: "somebody-else" }));
      org.listSubordinateUserIds.mockResolvedValue([]);

      await expect(runWithScope("own", () => service.getRequest(TENANT, "req-1"))).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("lets a team lead open a request filed by somebody they approve for", async () => {
      repo.findRequestById.mockResolvedValue(makeRequestRow({ userId: "team-member-1" }));
      org.listSubordinateUserIds.mockResolvedValue(["team-member-1"]);

      await expect(runWithScope("own", () => service.getRequest(TENANT, "req-1"))).resolves.toBeDefined();
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
        // Includes lead_approved: a request the team lead has approved but the manager has
        // not yet confirmed is still the applicant's to withdraw.
        expect.objectContaining({ to: "cancelled", from: ["pending", "lead_approved", "approved"] }),
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

      const result = await runWithScope("all", () =>
        service.getCalendar(TENANT, ACTOR, { from: MONDAY, to: FRIDAY } as never),
      );

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
      const result = await runWithScope("all", () =>
        service.getCalendar(TENANT, ACTOR, { from: MONDAY, to: FRIDAY } as never),
      );
      expect(result.entries[0]?.isSelf).toBe(true);
    });

    it("emits calendar dates as YYYY-MM-DD, never as timestamps", async () => {
      repo.listHolidaysBetween.mockResolvedValue([
        { id: "h1", date: new Date("2026-08-19T00:00:00.000Z"), name: "Holiday", description: null, optional: false },
      ]);
      const result = await runWithScope("all", () =>
        service.getCalendar(TENANT, ACTOR, { from: MONDAY, to: FRIDAY } as never),
      );
      expect(result.holidays[0]?.date).toBe("2026-08-19");
    });

    // REVERSED on 2026-09-01, deliberately.
    //
    // The calendar used to bypass scope entirely: it was company-wide for everybody, and
    // privacy rested solely on the projection never fetching `reason`. That answered "can
    // you read why somebody is off" but not "whose absences can you see at all", and the
    // answer to the second was everyone's.
    //
    // WHO you see is now resolved from the scope context, so the calendar must have one.
    // Failing closed here is the point: a missing context previously meant "show the whole
    // company", which is the one outcome that must never happen by accident.
    it("REFUSES to render without a scope context, rather than falling open to everybody", async () => {
      await expect(
        service.getCalendar(TENANT, ACTOR, { from: MONDAY, to: FRIDAY } as never),
      ).rejects.toThrow();
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

// ── Two-step approval (ADR-0070) ──────────────────────────────────────────────────────
//
// The chain is the whole point of the org hierarchy, and these are the cases that decide
// real behaviour: who may act at which step, that the lead's step commits nothing, that the
// manager's step is the one that deducts, and that nobody — not even the owner — decides
// their own request.
describe("LeaveService, two-step approval", () => {
  const LEAD = "lead-1";
  const MANAGER = "manager-1";
  const APPLICANT = "applicant-1";

  /** A repo/org pair modelling a real two-step chain rather than the empty-org default. */
  function twoStepOrg(overrides: Record<string, unknown> = {}) {
    return {
      resolveApprovalChain: jest.fn().mockResolvedValue({
        steps: ["lead", "manager"],
        firstApproverId: LEAD,
        finalApproverId: MANAGER,
        fallbackToOwner: false,
      }),
      getPosition: jest.fn().mockResolvedValue({
        teamId: "team-1", teamName: "Sales", leadUserId: LEAD, leadName: "Priya",
        managerUserId: MANAGER, managerName: "Ravi",
        leadsTeamIds: [], managesTeamIds: [], isHr: false, isOwner: false,
      }),
      listFallbackApprovers: jest.fn().mockResolvedValue([]),
      listSubordinateUserIds: jest.fn().mockResolvedValue([APPLICANT]),
      ...overrides,
    };
  }

  function serviceWith(orgMock: Record<string, unknown>) {
    const repo = mockRepository();
    repo.findRequestById.mockResolvedValue(makeRequestRow({ userId: APPLICANT, status: "pending" }));
    repo.transitionRequestStatus.mockResolvedValue(1);
    const notifications = mockNotifications();
    const svc = new LeaveService(
      repo as unknown as LeaveRepository,
      mockSetup() as unknown as LeaveSetupService,
      notifications as unknown as LeaveNotificationService,
      orgMock as unknown as OrgService,
    );
    return { svc, repo, notifications };
  }

  it("moves a request to lead_approved when the team lead approves — it does NOT go straight through", () => {
    const { svc, repo } = serviceWith(twoStepOrg());

    return svc.approveRequest(TENANT, LEAD, "req-1", {} as never).then(() => {
      expect(repo.transitionRequestStatus).toHaveBeenCalledWith(
        expect.objectContaining({ from: ["pending"], to: "lead_approved", leadStep: true }),
      );
    });
  });

  it("takes no lock and does no allowance arithmetic on the lead's step", async () => {
    // The lead's approval commits nothing, so there is nothing to double-charge. Deducting
    // here and again on confirmation is the bug this asymmetry exists to prevent.
    const { svc, repo } = serviceWith(twoStepOrg());

    await svc.approveRequest(TENANT, LEAD, "req-1", {} as never);

    expect(repo.lockUser).not.toHaveBeenCalled();
    expect(repo.runInTransaction).not.toHaveBeenCalled();
  });

  it("tells the manager once the lead has approved", async () => {
    // Without this hop the two-step chain would be strictly worse than the one it replaced:
    // the request would sit silently until somebody happened to open the queue.
    const { svc, notifications } = serviceWith(twoStepOrg());

    await svc.approveRequest(TENANT, LEAD, "req-1", {} as never);

    expect(notifications.notifyLeadApproved).toHaveBeenCalled();
  });

  it("refuses to let the team lead confirm what they themselves approved", async () => {
    const org = twoStepOrg();
    const { svc, repo } = serviceWith(org);
    repo.findRequestById.mockResolvedValue(
      makeRequestRow({ userId: APPLICANT, status: "lead_approved" }),
    );

    // At `lead_approved` the lead is no longer the eligible actor, and has no other standing.
    await expect(svc.approveRequest(TENANT, LEAD, "req-1", {} as never)).rejects.toMatchObject({
      response: { code: "leave.request_not_found" },
    });
  });

  it("404s somebody with no standing over the request, rather than 403ing", async () => {
    // A 403 would confirm the request exists — and its dates and applicant are exactly what
    // must not be confirmed to a stranger.
    const { svc } = serviceWith(twoStepOrg());

    await expect(
      svc.approveRequest(TENANT, "somebody-else", "req-1", {} as never),
    ).rejects.toMatchObject({ response: { code: "leave.request_not_found" } });
  });

  it("refuses to let anyone decide their own request, including the owner", async () => {
    // Closes a hole that existed before the hierarchy: the super admin's scope=all covered
    // their own row. Enforced here rather than by a permission, which cannot express it.
    const org = twoStepOrg({
      getPosition: jest.fn().mockResolvedValue({
        teamId: null, teamName: null, leadUserId: null, leadName: null,
        managerUserId: null, managerName: null,
        leadsTeamIds: [], managesTeamIds: [], isHr: false, isOwner: true,
      }),
    });
    const { svc, repo } = serviceWith(org);
    repo.findRequestById.mockResolvedValue(makeRequestRow({ userId: "owner-1", status: "pending" }));

    await expect(svc.approveRequest(TENANT, "owner-1", "req-1", {} as never)).rejects.toMatchObject({
      response: { code: "leave.self_review" },
    });
  });

  it("lets the team lead turn a request down outright, without waiting for the manager", async () => {
    // Deliberately asymmetric with approval: a "no" should not need a second signature,
    // because the applicant needs to re-plan. Same call P4 makes on grading.
    const { svc, repo } = serviceWith(twoStepOrg());

    await svc.rejectRequest(TENANT, LEAD, "req-1", { reason: "No cover that week" } as never);

    expect(repo.transitionRequestStatus).toHaveBeenCalledWith(
      expect.objectContaining({ from: ["pending", "lead_approved"], to: "rejected" }),
    );
  });

  it("narrows the final approval to the state it actually read, so a concurrent lead step 409s", async () => {
    // Accepting both openings here would let the manager's id overwrite the lead trio and
    // erase who performed step one.
    const org = twoStepOrg();
    const { svc, repo } = serviceWith(org);
    repo.findRequestById.mockResolvedValue(
      makeRequestRow({ userId: APPLICANT, status: "lead_approved" }),
    );

    await svc.approveRequest(TENANT, MANAGER, "req-1", {} as never);

    expect(repo.transitionRequestStatus).toHaveBeenCalledWith(
      expect.objectContaining({ from: ["lead_approved"], to: "approved", alsoRecordAsLead: false }),
    );
  });

  it("records a direct approval as both steps, so the trail says one person did both", async () => {
    const org = twoStepOrg({
      resolveApprovalChain: jest.fn().mockResolvedValue({
        steps: ["owner"], firstApproverId: null, finalApproverId: null, fallbackToOwner: true,
      }),
      getPosition: jest.fn().mockResolvedValue({
        teamId: null, teamName: null, leadUserId: null, leadName: null,
        managerUserId: null, managerName: null,
        leadsTeamIds: [], managesTeamIds: [], isHr: true, isOwner: false,
      }),
    });
    const { svc, repo } = serviceWith(org);

    await svc.approveRequest(TENANT, "hr-1", "req-1", {} as never);

    expect(repo.transitionRequestStatus).toHaveBeenCalledWith(
      expect.objectContaining({ from: ["pending"], to: "approved", alsoRecordAsLead: true }),
    );
  });
});

// Regression: a manager must not be able to approve straight from `pending`.
//
// Caught by the Playwright journey (leave-two-step.e2e.spec.ts), not by a unit test — the
// original rule matched on "are you the final approver?" without asking whether the request
// had reached the final step, so the manager could skip the team lead entirely. It fails
// invisibly: the row simply comes back approved, and nothing on screen says a step was
// missed.
describe("LeaveService, the manager cannot skip the lead's step", () => {
  const LEAD = "lead-1";
  const MANAGER = "manager-1";
  const APPLICANT = "applicant-1";

  function twoStepService(status: "pending" | "lead_approved") {
    const repo = mockRepository();
    repo.findRequestById.mockResolvedValue(makeRequestRow({ userId: APPLICANT, status }));
    repo.transitionRequestStatus.mockResolvedValue(1);
    const org = {
      resolveApprovalChain: jest.fn().mockResolvedValue({
        steps: ["lead", "manager"],
        firstApproverId: LEAD,
        finalApproverId: MANAGER,
        fallbackToOwner: false,
      }),
      getPosition: jest.fn().mockResolvedValue({
        teamId: "team-1", teamName: "Sales", leadUserId: LEAD, leadName: "Priya",
        managerUserId: MANAGER, managerName: "Ravi",
        leadsTeamIds: [], managesTeamIds: ["team-1"], isHr: false, isOwner: false,
      }),
      listFallbackApprovers: jest.fn().mockResolvedValue([]),
      listSubordinateUserIds: jest.fn().mockResolvedValue([APPLICANT]),
    };
    const svc = new LeaveService(
      repo as unknown as LeaveRepository,
      mockSetup() as unknown as LeaveSetupService,
      mockNotifications() as unknown as LeaveNotificationService,
      org as unknown as OrgService,
    );
    return { svc, repo };
  }

  it("404s the manager on a request still awaiting the team lead", async () => {
    const { svc } = twoStepService("pending");

    await expect(svc.approveRequest(TENANT, MANAGER, "req-1", {} as never)).rejects.toMatchObject({
      response: { code: "leave.request_not_found" },
    });
  });

  it("lets the manager confirm once the lead has approved", async () => {
    const { svc, repo } = twoStepService("lead_approved");

    await svc.approveRequest(TENANT, MANAGER, "req-1", {} as never);

    expect(repo.transitionRequestStatus).toHaveBeenCalledWith(
      expect.objectContaining({ from: ["lead_approved"], to: "approved" }),
    );
  });
});

// ── Calendar visibility is ENFORCED, not chosen (2026-09-01) ──────────────────────────
//
// The calendar used to be company-wide for every staff role, with a client-side filter on
// top. A filter over a view that shows everything is not a boundary: anyone could switch
// back to "Everyone" and read the whole company's absence pattern.
//
// It is now resolved server-side from the actor's scope and their place on the org chart,
// and there is NO request a member can send that widens it. These tests are the pin.
describe("LeaveService, who the calendar shows", () => {
  const LEAD = "lead-1";
  const MEMBER_A = "member-a";
  const MEMBER_B = "member-b";

  function calendarService(subordinates: string[], circle: string[] = []) {
    const repo = mockRepository();
    repo.listCalendarWindow.mockResolvedValue([]);
    repo.listHolidaysBetween.mockResolvedValue([]);
    const org = {
      listSubordinateUserIds: jest.fn().mockResolvedValue(subordinates),
      listTeamCircleUserIds: jest.fn().mockResolvedValue(circle),
      resolveApprovalChain: jest.fn(),
      getPosition: jest.fn(),
      listFallbackApprovers: jest.fn(),
    };
    const svc = new LeaveService(
      repo as unknown as LeaveRepository,
      mockSetup() as unknown as LeaveSetupService,
      mockNotifications() as unknown as LeaveNotificationService,
      org as unknown as OrgService,
    );
    return { svc, repo, org };
  }

  /** The id set the repository was asked for — null means "the whole company". */
  function windowUserIds(repo: ReturnType<typeof mockRepository>): string[] | null {
    return repo.listCalendarWindow.mock.calls[0]![4] ?? null;
  }

  const range = { from: "2026-11-01", to: "2026-11-30", scope: "company" } as const;

  it("shows a rank-and-file member STRICTLY their own leave", async () => {
    // They approve for nobody, so there is nobody else on their calendar.
    const { svc, repo } = calendarService([]);

    await runWithScope("own", () => svc.getCalendar(TENANT, MEMBER_A, range as never), MEMBER_A);

    expect(windowUserIds(repo)).toEqual([MEMBER_A]);
  });

  it("ignores a member asking for the company-wide view", async () => {
    // THE LOAD-BEARING ASSERTION. The old filter was client-side, so this request would have
    // been honoured. There must be no query a member can send that widens what they see.
    const { svc, repo } = calendarService([]);

    await runWithScope(
      "own",
      () => svc.getCalendar(TENANT, MEMBER_A, { ...range, scope: "company" } as never),
      MEMBER_A,
    );

    expect(windowUserIds(repo)).toEqual([MEMBER_A]);
  });

  it("shows a team lead their own leave plus everyone they approve for", async () => {
    const { svc, repo } = calendarService([MEMBER_A, MEMBER_B]);

    await runWithScope("own", () => svc.getCalendar(TENANT, LEAD, range as never), LEAD);

    expect(windowUserIds(repo)).toEqual([LEAD, MEMBER_A, MEMBER_B]);
  });

  it("resolves DOWN the chart, never sideways — a member must not see their team-mates", async () => {
    // `listTeamCircleUserIds` looks sideways and up (team-mates AND the lead), which is the
    // wrong question here. Reaching for it would quietly restore the old behaviour for
    // everybody on a team.
    const { svc, org } = calendarService([], [MEMBER_B, LEAD]);

    await runWithScope("own", () => svc.getCalendar(TENANT, MEMBER_A, range as never), MEMBER_A);

    expect(org.listSubordinateUserIds).toHaveBeenCalled();
    expect(org.listTeamCircleUserIds).not.toHaveBeenCalled();
  });

  it("still shows the whole company to somebody holding it at scope=all", async () => {
    const { svc, repo } = calendarService([]);

    await runWithScope("all", () => svc.getCalendar(TENANT, "owner-1", range as never), "owner-1");

    // null = no id filter = every absence in the window.
    expect(windowUserIds(repo)).toBeNull();
  });

  it("lets a company-wide holder narrow to their own circle as a convenience", async () => {
    const { svc, repo } = calendarService([], [MEMBER_A]);

    await runWithScope(
      "all",
      () => svc.getCalendar(TENANT, LEAD, { ...range, scope: "team" } as never),
      LEAD,
    );

    expect(windowUserIds(repo)).toEqual([LEAD, MEMBER_A]);
  });
});
