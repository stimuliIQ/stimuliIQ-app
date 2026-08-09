// apps/api/src/modules/leads/activities.service.spec.ts
//
// Unit tests for ActivitiesService — scope inheritance via parent lead, and the
// "complete task" state transition (sets done_at, rejects non-task types and
// already-completed tasks).

import { NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { ActivitiesService } from "./activities.service";
import { ActivitiesRepository, type ActivityRow } from "./activities.repository";
import { LeadsRepository } from "./leads.repository";
import { scopeContextStorage, type ScopeContext } from "../auth/lib/scope-context";

type Mocked<T> = { [K in keyof T]: T[K] extends (...args: never[]) => unknown ? jest.Mock : T[K] };

function mockActivitiesRepository(): Mocked<ActivitiesRepository> {
  return {
    list: jest.fn(),
    findById: jest.fn(),
    findParentLeadScopeFields: jest.fn(),
    create: jest.fn(),
    updatePayload: jest.fn(),
  } as unknown as Mocked<ActivitiesRepository>;
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
    // Logging an activity stamps the parent lead's first/last contact timestamps —
    // the write that makes first-response-time measurable at all.
    touchLeadContact: jest.fn(),
  } as unknown as Mocked<LeadsRepository>;
}

const TASK_ROW: ActivityRow = {
  id: "activity-1",
  tenantId: "tenant-1",
  leadId: "lead-1",
  studentId: null,
  userId: "actor-1",
  userName: "Counsellor One",
  type: "task",
  payload: { note: "follow up" },
  dueAt: new Date("2026-01-02T00:00:00Z"),
  doneAt: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  deletedAt: null,
};

function runWithScope<T>(scope: ScopeContext["scope"], fn: () => T): T {
  const ctx: ScopeContext = { permissionKey: "activities.view", scope, actorId: "actor-1", tenantId: "tenant-1" };
  return scopeContextStorage.run(ctx, fn);
}

describe("ActivitiesService", () => {
  let service: ActivitiesService;
  let repo: Mocked<ActivitiesRepository>;
  let leadsRepo: Mocked<LeadsRepository>;

  beforeEach(() => {
    repo = mockActivitiesRepository();
    leadsRepo = mockLeadsRepository();
    service = new ActivitiesService(repo as unknown as ActivitiesRepository, leadsRepo as unknown as LeadsRepository);
  });

  describe("create", () => {
    it("validates the parent lead is within the caller's scope before logging the activity", async () => {
      leadsRepo.findById.mockResolvedValue(null); // out of scope -> not found.

      await expect(
        runWithScope("own", () =>
          service.create("tenant-1", "actor-1", { type: "note", payload: {}, leadId: "some-lead" }),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it("logs the activity once the parent lead is confirmed in scope", async () => {
      leadsRepo.findById.mockResolvedValue({ id: "lead-1" });
      repo.create.mockResolvedValue({ id: "activity-1" });
      repo.findById.mockResolvedValue(TASK_ROW);

      const result = await runWithScope("own", () =>
        service.create("tenant-1", "actor-1", { type: "task", payload: {}, leadId: "lead-1", dueAt: "2026-01-02T00:00:00Z" }),
      );

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ leadId: "lead-1", userId: "actor-1", type: "task" }),
      );
      expect(result.id).toBe("activity-1");
    });
  });

  describe("completeTask", () => {
    it("sets done_at and merges completion notes into the existing payload", async () => {
      repo.findById
        .mockResolvedValueOnce(TASK_ROW)
        .mockResolvedValueOnce({ ...TASK_ROW, doneAt: new Date("2026-01-02T10:00:00Z") });

      await runWithScope("own", () => service.completeTask("tenant-1", TASK_ROW.id, { notes: "Called, interested" }));

      expect(repo.updatePayload).toHaveBeenCalledWith(
        TASK_ROW.id,
        expect.objectContaining({ note: "follow up", completionNotes: "Called, interested" }),
        expect.any(Date),
      );
    });

    it("rejects completing a non-task activity with 422", async () => {
      repo.findById.mockResolvedValue({ ...TASK_ROW, type: "call" });

      await expect(
        runWithScope("own", () => service.completeTask("tenant-1", TASK_ROW.id, {})),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(repo.updatePayload).not.toHaveBeenCalled();
    });

    it("rejects completing an already-done task with 422", async () => {
      repo.findById.mockResolvedValue({ ...TASK_ROW, doneAt: new Date("2026-01-01T12:00:00Z") });

      await expect(
        runWithScope("own", () => service.completeTask("tenant-1", TASK_ROW.id, {})),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it("404s for an out-of-scope activity", async () => {
      repo.findById.mockResolvedValue(null);

      await expect(
        runWithScope("own", () => service.completeTask("tenant-1", "other-activity", {})),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
