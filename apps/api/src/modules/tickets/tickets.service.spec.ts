// apps/api/src/modules/tickets/tickets.service.spec.ts
//
// Unit tests for TicketsService (docs/plans/phase-9-completion.md T21). Covers: SLA
// computation on create (per-priority), isInternal message isolation (student view NEVER
// sees internal notes; student can never set isInternal=true), scope resolution
// (all/assigned/own/branch), IDOR->404, rating gated on resolved/closed status, and the
// three independently-gated mutation actions (edit/assign/close).

import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { TicketsService } from "./tickets.service";
import { TicketsRepository, type TicketRow, type TicketMessageRow } from "./tickets.repository";
import { scopeContextStorage, type ScopeContext } from "../auth/lib/scope-context";

type Mocked<T> = { [K in keyof T]: T[K] extends (...args: never[]) => unknown ? jest.Mock : T[K] };

function mockRepository(): Mocked<TicketsRepository> {
  return {
    list: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    listMessages: jest.fn().mockResolvedValue([]),
    addMessage: jest.fn(),
    listUserIdsForBranches: jest.fn().mockResolvedValue([]),
    listCallerBranchIds: jest.fn().mockResolvedValue([]),
  } as unknown as Mocked<TicketsRepository>;
}

const ROW: TicketRow = {
  id: "ticket-1",
  tenantId: "tenant-1",
  userId: "student-1",
  userName: "Student One",
  subject: "Cannot access video",
  body: "The video won't play.",
  status: "open",
  priority: "medium",
  assigneeId: null,
  assigneeName: null,
  slaDueAt: new Date("2026-01-02T00:00:00Z"),
  rating: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  deletedAt: null,
};

const INTERNAL_MESSAGE: TicketMessageRow = {
  id: "msg-internal",
  ticketId: "ticket-1",
  authorId: "staff-1",
  authorName: "Support Staff",
  body: "Internal note — escalate to L2",
  isInternal: true,
  createdAt: new Date("2026-01-01T01:00:00Z"),
};

const PUBLIC_MESSAGE: TicketMessageRow = {
  id: "msg-public",
  ticketId: "ticket-1",
  authorId: "student-1",
  authorName: "Student One",
  body: "Any update?",
  isInternal: false,
  createdAt: new Date("2026-01-01T02:00:00Z"),
};

function runWithScope<T>(scope: ScopeContext["scope"], actorId: string, fn: () => T): T {
  const ctx: ScopeContext = { permissionKey: "tickets.view", scope, actorId, tenantId: "tenant-1" };
  return scopeContextStorage.run(ctx, fn);
}

describe("TicketsService", () => {
  let service: TicketsService;
  let repo: Mocked<TicketsRepository>;

  beforeEach(() => {
    repo = mockRepository();
    service = new TicketsService(repo as unknown as TicketsRepository);
  });

  describe("SLA computation on create", () => {
    it.each([
      ["urgent", 4],
      ["high", 8],
      ["medium", 24],
      ["low", 48],
    ] as const)("priority=%s -> slaDueAt is ~%d hours from now", async (priority, hours) => {
      repo.create.mockResolvedValue({ id: "ticket-new" });
      repo.findById.mockResolvedValue({ ...ROW, id: "ticket-new", priority });

      const before = Date.now();
      await service.create("tenant-1", "student-1", { subject: "S", body: "B", priority });
      const after = Date.now();

      const createCall = repo.create.mock.calls[0][1];
      const expectedMs = hours * 60 * 60_000;
      expect(createCall.slaDueAt.getTime()).toBeGreaterThanOrEqual(before + expectedMs);
      expect(createCall.slaDueAt.getTime()).toBeLessThanOrEqual(after + expectedMs);
    });
  });

  describe("isInternal message isolation (headline T21 rule)", () => {
    it("getMine (student) NEVER includes isInternal=true messages — repository is called with includeInternal=false", async () => {
      repo.findById.mockResolvedValue(ROW);
      repo.listMessages.mockResolvedValue([PUBLIC_MESSAGE]);

      const result = await service.getMine("tenant-1", "student-1", "ticket-1");

      expect(repo.listMessages).toHaveBeenCalledWith("ticket-1", false);
      expect(result.messages).toHaveLength(1);
      expect(result.messages.every((m) => !m.isInternal)).toBe(true);
    });

    it("getById (staff, CRM) includes isInternal=true messages — repository is called with includeInternal=true", async () => {
      repo.findById.mockResolvedValue(ROW);
      repo.listMessages.mockResolvedValue([INTERNAL_MESSAGE, PUBLIC_MESSAGE]);

      const result = await runWithScope("all", "staff-1", () => service.getById("tenant-1", "staff-1", "ticket-1", true));

      expect(repo.listMessages).toHaveBeenCalledWith("ticket-1", true);
      expect(result.messages).toHaveLength(2);
    });

    it("addMyMessage FORCES isInternal=false regardless of the request body", async () => {
      repo.findById.mockResolvedValue(ROW);
      repo.addMessage.mockResolvedValue({ id: "msg-new" });
      repo.listMessages.mockResolvedValue([{ ...PUBLIC_MESSAGE, id: "msg-new" }]);

      // A malicious/buggy client sends isInternal:true — the service must ignore it.
      await service.addMyMessage("tenant-1", "student-1", "ticket-1", { body: "hi", isInternal: true });

      expect(repo.addMessage).toHaveBeenCalledWith("tenant-1", expect.objectContaining({ isInternal: false }));
    });

    // Regression: addMyMessage used to return the created message while the
    // OpenAPI spec, the api-client and every sibling route (create/getMine/rate)
    // said TicketDetail. The LMS cached that message under the ticket-detail key
    // and then crashed on `ticket.messages.map` — after the reply had already
    // been written. The 201 made it look like a send failure.
    it("addMyMessage returns the full TicketDetail, not the created message", async () => {
      repo.findById.mockResolvedValue(ROW);
      repo.addMessage.mockResolvedValue({ id: "msg-new" });
      repo.listMessages.mockResolvedValue([PUBLIC_MESSAGE, { ...PUBLIC_MESSAGE, id: "msg-new" }]);

      const result = await service.addMyMessage("tenant-1", "student-1", "ticket-1", {
        body: "hi",
        isInternal: false,
      });

      expect(result.id).toBe(ROW.id);
      expect(result.userId).toBe(ROW.userId);
      expect(Array.isArray(result.messages)).toBe(true);
      expect(result.messages).toHaveLength(2);
      // Student view must never include internal staff notes.
      expect(repo.listMessages).toHaveBeenCalledWith("ticket-1", false);
    });

    it("addStaffMessage may set isInternal=true (staff notes)", async () => {
      repo.findById.mockResolvedValue(ROW);
      repo.addMessage.mockResolvedValue({ id: "msg-new" });
      repo.listMessages.mockResolvedValue([{ ...INTERNAL_MESSAGE, id: "msg-new" }]);

      await runWithScope("all", "staff-1", () =>
        service.addStaffMessage("tenant-1", "staff-1", "ticket-1", { body: "internal note", isInternal: true }),
      );

      expect(repo.addMessage).toHaveBeenCalledWith("tenant-1", expect.objectContaining({ isInternal: true }));
    });
  });

  describe("own-scope IDOR (student)", () => {
    it("getMine for another user's ticket -> 404 (IDOR fail-closed, no existence leak)", async () => {
      repo.findById.mockResolvedValue(ROW); // ROW.userId === "student-1"
      await expect(service.getMine("tenant-1", "student-OTHER", "ticket-1")).rejects.toBeInstanceOf(NotFoundException);
    });

    it("addMyMessage for another user's ticket -> 404", async () => {
      repo.findById.mockResolvedValue(ROW);
      await expect(
        service.addMyMessage("tenant-1", "student-OTHER", "ticket-1", { body: "x", isInternal: false }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("CRM scope resolution", () => {
    it("scope=assigned restricts to the caller's own assignee queue", async () => {
      repo.list.mockResolvedValue({ rows: [ROW], total: 1 });
      await runWithScope("assigned", "staff-1", () =>
        service.list("tenant-1", "staff-1", { page: 1, pageSize: 20 }),
      );
      expect(repo.list).toHaveBeenCalledWith(expect.objectContaining({ restrictToAssigneeId: "staff-1" }));
    });

    it("scope=branch resolves the raiser-userIds set and restricts to it", async () => {
      repo.listCallerBranchIds.mockResolvedValue(["branch-1"]);
      repo.listUserIdsForBranches.mockResolvedValue(["student-1", "student-2"]);
      repo.list.mockResolvedValue({ rows: [ROW], total: 1 });

      await runWithScope("branch", "bm-1", () => service.list("tenant-1", "bm-1", { page: 1, pageSize: 20 }));

      expect(repo.list).toHaveBeenCalledWith(
        expect.objectContaining({ restrictToUserIds: expect.arrayContaining(["student-1", "student-2"]) }),
      );
    });

    it("a resolved ticket outside the caller's assigned queue -> 404", async () => {
      repo.findById.mockResolvedValue({ ...ROW, assigneeId: "someone-else" });
      await expect(
        runWithScope("assigned", "staff-1", () => service.getById("tenant-1", "staff-1", "ticket-1", true)),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("rating (T21: only after resolved|closed)", () => {
    it("rating an open ticket -> 409", async () => {
      repo.findById.mockResolvedValue(ROW); // status: open
      await expect(
        service.rate("tenant-1", "student-1", "ticket-1", { rating: 5 }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it("rating a resolved ticket succeeds", async () => {
      repo.findById
        .mockResolvedValueOnce({ ...ROW, status: "resolved" })
        .mockResolvedValueOnce({ ...ROW, status: "resolved", rating: 5 });
      repo.listMessages.mockResolvedValue([]);

      const result = await service.rate("tenant-1", "student-1", "ticket-1", { rating: 5 });
      expect(repo.update).toHaveBeenCalledWith("ticket-1", { rating: 5 });
      expect(result.rating).toBe(5);
    });
  });

  describe("three independently-gated mutation actions", () => {
    it("update() only ever touches status/priority — never assigneeId", async () => {
      repo.findById.mockResolvedValueOnce(ROW).mockResolvedValueOnce(ROW);
      repo.listMessages.mockResolvedValue([]);
      await runWithScope("all", "staff-1", () =>
        service.update("tenant-1", "staff-1", "ticket-1", { status: "in_progress", priority: "high" }),
      );
      expect(repo.update).toHaveBeenCalledWith("ticket-1", { status: "in_progress", priority: "high" });
    });

    it("assign() only ever touches assigneeId", async () => {
      repo.findById.mockResolvedValueOnce(ROW).mockResolvedValueOnce(ROW);
      repo.listMessages.mockResolvedValue([]);
      await runWithScope("all", "staff-1", () => service.assign("tenant-1", "staff-1", "ticket-1", "staff-2"));
      expect(repo.update).toHaveBeenCalledWith("ticket-1", { assigneeId: "staff-2" });
    });

    it("close() is idempotency-guarded — an already-closed ticket -> 409", async () => {
      repo.findById.mockResolvedValue({ ...ROW, status: "closed" });
      await expect(
        runWithScope("all", "staff-1", () => service.close("tenant-1", "staff-1", "ticket-1")),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  it("an unresolvable scope fails closed (403)", async () => {
    await expect(
      // @ts-expect-error — deliberately passing an invalid scope literal to exercise the default branch.
      runWithScope("bogus", "actor-1", () => service.list("tenant-1", "actor-1", { page: 1, pageSize: 20 })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
