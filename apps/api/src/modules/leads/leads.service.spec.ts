// apps/api/src/modules/leads/leads.service.spec.ts
//
// Unit tests for LeadsService scope-resolution (the headline P2 deliverable — own/
// assigned/branch/all via `owner_id`), stage-move state machine, and lead->student
// conversion (REUSING StudentsRepository + CommerceService, never rebuilding them).
// Mocks all collaborators and drives scope via the real scopeContextStorage ALS, matching
// students.service.spec.ts's established pattern.

import { BadRequestException, ForbiddenException, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { LeadsService } from "./leads.service";
import { LeadsRepository, type LeadRow } from "./leads.repository";
import { ActivitiesRepository } from "./activities.repository";
import { StudentsRepository } from "../students/students.repository";
import { CommerceService } from "../commerce/commerce.service";
import { scopeContextStorage, type ScopeContext } from "../auth/lib/scope-context";

type Mocked<T> = { [K in keyof T]: T[K] extends (...args: never[]) => unknown ? jest.Mock : T[K] };

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
    isActiveUserInTenant: jest.fn(),
  } as unknown as Mocked<LeadsRepository>;
}

function mockStudentsRepository(): Mocked<StudentsRepository> {
  return {
    list: jest.fn(),
    findById: jest.fn(),
    findUserByEmail: jest.fn(),
    createStudentWithUser: jest.fn(),
    updateStudent: jest.fn(),
    softDelete: jest.fn(),
    restore: jest.fn(),
  } as unknown as Mocked<StudentsRepository>;
}

function mockCommerceService(): Mocked<CommerceService> {
  return { createOrder: jest.fn() } as unknown as Mocked<CommerceService>;
}

function mockActivitiesRepository(): Mocked<ActivitiesRepository> {
  return { create: jest.fn() } as unknown as Mocked<ActivitiesRepository>;
}

const ROW: LeadRow = {
  id: "lead-1",
  tenantId: "tenant-1",
  name: "Asha Rao",
  phone: "+919999999999",
  email: "asha@example.com",
  stage: "new",
  source: "website",
  programInterestId: null,
  programInterestTitle: null,
  branchId: "branch-a",
  branchName: "Branch A",
  ownerId: "actor-1",
  ownerName: "Counsellor One",
  score: null,
  slaDueAt: null,
  convertedStudentId: null,
  utm: null,
  courseInterest: null,
  college: null,
  language: null,
  message: null,
  activityCount: 0,
  bookingCount: 0,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  deletedAt: null,
};

function runWithScope<T>(scope: ScopeContext["scope"], fn: () => T, actorId = "actor-1"): T {
  const ctx: ScopeContext = { permissionKey: "leads.view", scope, actorId, tenantId: "tenant-1" };
  return scopeContextStorage.run(ctx, fn);
}

describe("LeadsService", () => {
  let service: LeadsService;
  let repo: Mocked<LeadsRepository>;
  let studentsRepo: Mocked<StudentsRepository>;
  let commerce: Mocked<CommerceService>;
  let activitiesRepo: Mocked<ActivitiesRepository>;

  beforeEach(() => {
    repo = mockLeadsRepository();
    studentsRepo = mockStudentsRepository();
    commerce = mockCommerceService();
    activitiesRepo = mockActivitiesRepository();
    service = new LeadsService(
      repo as unknown as LeadsRepository,
      studentsRepo as unknown as StudentsRepository,
      commerce as unknown as CommerceService,
      activitiesRepo as unknown as ActivitiesRepository,
    );
  });

  describe("scope resolution", () => {
    it("scope=all applies no extra filter", async () => {
      repo.list.mockResolvedValue({ rows: [ROW], total: 1 });

      await runWithScope("all", () =>
        service.list("tenant-1", { page: 1, pageSize: 20 }),
      );

      expect(repo.list).toHaveBeenCalledWith(expect.objectContaining({ scopeWhere: {} }));
    });

    it("scope=own restricts to ownerId = actorId ONLY", async () => {
      repo.list.mockResolvedValue({ rows: [ROW], total: 1 });

      await runWithScope("own", () => service.list("tenant-1", { page: 1, pageSize: 20 }));

      expect(repo.list).toHaveBeenCalledWith(expect.objectContaining({ scopeWhere: { ownerId: "actor-1" } }));
      expect(repo.listCallerBranchIds).not.toHaveBeenCalled();
    });

    it("scope=branch restricts to branchId IN caller's branches", async () => {
      repo.listCallerBranchIds.mockResolvedValue(["branch-a"]);
      repo.list.mockResolvedValue({ rows: [ROW], total: 1 });

      await runWithScope("branch", () => service.list("tenant-1", { page: 1, pageSize: 20 }));

      expect(repo.listCallerBranchIds).toHaveBeenCalledWith("actor-1");
      expect(repo.list).toHaveBeenCalledWith(
        expect.objectContaining({ scopeWhere: { branchId: { in: ["branch-a"] } } }),
      );
    });

    it("scope=branch with no resolved branches filters to zero rows (never falls open)", async () => {
      repo.listCallerBranchIds.mockResolvedValue([]);
      repo.list.mockResolvedValue({ rows: [], total: 0 });

      await runWithScope("branch", () => service.list("tenant-1", { page: 1, pageSize: 20 }));

      expect(repo.list).toHaveBeenCalledWith(
        expect.objectContaining({ scopeWhere: { branchId: { in: [] } } }),
      );
    });

    it("scope=assigned restricts to ownerId=me OR branchId IN caller's territory", async () => {
      repo.listCallerBranchIds.mockResolvedValue(["branch-a"]);
      repo.list.mockResolvedValue({ rows: [ROW], total: 1 });

      await runWithScope("assigned", () => service.list("tenant-1", { page: 1, pageSize: 20 }));

      expect(repo.list).toHaveBeenCalledWith(
        expect.objectContaining({
          scopeWhere: { OR: [{ ownerId: "actor-1" }, { branchId: { in: ["branch-a"] } }] },
        }),
      );
    });
  });

  describe("IDOR / object-level authz", () => {
    it("returns 404 (not 403) when the lead is outside the resolved scope", async () => {
      repo.findById.mockResolvedValue(null); // repository applies scopeWhere — returns null when out of scope.

      await expect(
        runWithScope("own", () => service.getById("tenant-1", "some-other-lead")),
      ).rejects.toBeInstanceOf(NotFoundException);

      // The scope fragment (ownerId = actor-1) was passed down to the repository's by-id lookup.
      expect(repo.findById).toHaveBeenCalledWith("tenant-1", "some-other-lead", { ownerId: "actor-1" });
    });

    it("a counsellor (own scope) sees their own lead", async () => {
      repo.findById.mockResolvedValue(ROW);

      const detail = await runWithScope("own", () => service.getById("tenant-1", ROW.id));

      expect(detail.id).toBe(ROW.id);
    });
  });

  describe("default owner assignment on create", () => {
    it("uses the explicit ownerId when provided (no round-robin call)", async () => {
      repo.isActiveUserInTenant.mockResolvedValue(true);
      repo.create.mockResolvedValue({ id: "new-lead" });
      repo.findById.mockResolvedValue({ ...ROW, id: "new-lead" });

      await service.create("tenant-1", {
        name: "New Lead",
        phone: "+919999999998",
        source: "website",
        ownerId: "explicit-owner",
      });

      expect(repo.isActiveUserInTenant).toHaveBeenCalledWith("tenant-1", "explicit-owner");
      expect(repo.pickRoundRobinOwner).not.toHaveBeenCalled();
      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ ownerId: "explicit-owner" }));
    });

    // P2 M-5 fix (Phase-7 Wave 2 security hardening batch B, item 4).
    it("rejects an explicit ownerId that is not an active user in this tenant", async () => {
      repo.isActiveUserInTenant.mockResolvedValue(false);

      await expect(
        service.create("tenant-1", {
          name: "New Lead",
          phone: "+919999999998",
          source: "website",
          ownerId: "out-of-tenant-or-bogus-id",
        }),
      ).rejects.toThrow(BadRequestException);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it("round-robins to a counsellor when ownerId is omitted", async () => {
      repo.pickRoundRobinOwner.mockResolvedValue("rr-counsellor");
      repo.create.mockResolvedValue({ id: "new-lead" });
      repo.findById.mockResolvedValue({ ...ROW, id: "new-lead" });

      await service.create("tenant-1", { name: "New Lead", phone: "+919999999998", source: "website" });

      expect(repo.pickRoundRobinOwner).toHaveBeenCalledWith("tenant-1");
      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ ownerId: "rr-counsellor" }));
    });

    it("creates the lead UNASSIGNED when no counsellor exists (never fails the request)", async () => {
      repo.pickRoundRobinOwner.mockResolvedValue(null);
      repo.create.mockResolvedValue({ id: "new-lead" });
      repo.findById.mockResolvedValue({ ...ROW, id: "new-lead", ownerId: null });

      await service.create("tenant-1", { name: "New Lead", phone: "+919999999998", source: "website" });

      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ ownerId: null }));
    });
  });

  describe("stage move (4-stage model: new → follow_up → won | lost)", () => {
    it("moves new → follow_up and sets a follow-up SLA date (callback surfaces on the SLA/tasks queue)", async () => {
      repo.findById.mockResolvedValueOnce(ROW).mockResolvedValueOnce({ ...ROW, stage: "follow_up" });

      const result = await runWithScope("own", () =>
        service.moveStage("tenant-1", ROW.id, { stage: "follow_up" }),
      );

      expect(repo.moveStage).toHaveBeenCalledWith(ROW.id, "follow_up", expect.any(Date));
      expect(result.stage).toBe("follow_up");
    });

    it("uses the caller-supplied followUpAt datetime when moving to follow_up", async () => {
      repo.findById.mockResolvedValueOnce(ROW).mockResolvedValueOnce({ ...ROW, stage: "follow_up" });
      const followUpAt = "2026-08-01T09:30:00.000Z";

      await runWithScope("own", () => service.moveStage("tenant-1", ROW.id, { stage: "follow_up", followUpAt }));

      expect(repo.moveStage).toHaveBeenCalledWith(ROW.id, "follow_up", new Date(followUpAt));
    });

    it("creates a follow-up TASK (owned by the lead owner) so the callback shows in the tasks queue", async () => {
      repo.findById.mockResolvedValueOnce(ROW).mockResolvedValueOnce({ ...ROW, stage: "follow_up" });
      const followUpAt = "2026-08-01T09:30:00.000Z";

      await runWithScope("own", () => service.moveStage("tenant-1", ROW.id, { stage: "follow_up", followUpAt }));

      expect(activitiesRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: "tenant-1",
          leadId: ROW.id,
          userId: ROW.ownerId, // lands in the owner's "My Work"
          type: "task",
          dueAt: new Date(followUpAt),
        }),
      );
    });

    it("does NOT create a task for non-follow_up moves", async () => {
      repo.findById.mockResolvedValueOnce(ROW).mockResolvedValueOnce({ ...ROW, stage: "won" });

      await runWithScope("own", () => service.moveStage("tenant-1", ROW.id, { stage: "won" }));

      expect(activitiesRepo.create).not.toHaveBeenCalled();
    });

    it("clears the SLA date on terminal stages (won/lost)", async () => {
      repo.findById.mockResolvedValueOnce(ROW).mockResolvedValueOnce({ ...ROW, stage: "won" });

      await runWithScope("own", () => service.moveStage("tenant-1", ROW.id, { stage: "won" }));

      expect(repo.moveStage).toHaveBeenCalledWith(ROW.id, "won", null);
    });

    it("allows reopening a lost lead back to new", async () => {
      repo.findById.mockResolvedValueOnce({ ...ROW, stage: "lost" }).mockResolvedValueOnce({ ...ROW, stage: "new" });

      const result = await runWithScope("own", () => service.moveStage("tenant-1", ROW.id, { stage: "new" }));

      expect(result.stage).toBe("new");
    });

    it("rejects an invalid transition (lost → won) with 422", async () => {
      repo.findById.mockResolvedValue({ ...ROW, stage: "lost" });

      await expect(
        runWithScope("own", () => service.moveStage("tenant-1", ROW.id, { stage: "won" })),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(repo.moveStage).not.toHaveBeenCalled();
    });

    it("rejects moving a converted lead's stage", async () => {
      repo.findById.mockResolvedValue({ ...ROW, convertedStudentId: "student-1" });

      await expect(
        runWithScope("own", () => service.moveStage("tenant-1", ROW.id, { stage: "lost" })),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it("404s for an out-of-scope lead before evaluating the transition", async () => {
      repo.findById.mockResolvedValue(null);

      await expect(
        runWithScope("own", () => service.moveStage("tenant-1", "other-lead", { stage: "follow_up" })),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("owner assignment", () => {
    it("reassigns the owner and is audited automatically via the Prisma extension", async () => {
      repo.isActiveUserInTenant.mockResolvedValue(true);
      repo.findById.mockResolvedValueOnce(ROW).mockResolvedValueOnce({ ...ROW, ownerId: "new-owner" });

      const result = await runWithScope("branch", () =>
        service.assignOwner("tenant-1", ROW.id, { ownerId: "new-owner" }),
      );

      expect(repo.isActiveUserInTenant).toHaveBeenCalledWith("tenant-1", "new-owner");
      expect(repo.assignOwner).toHaveBeenCalledWith(ROW.id, "new-owner");
      expect(result.ownerId).toBe("new-owner");
    });

    it("supports unassigning (ownerId: null) without a tenant-membership check", async () => {
      repo.findById.mockResolvedValueOnce(ROW).mockResolvedValueOnce({ ...ROW, ownerId: null });

      await runWithScope("branch", () => service.assignOwner("tenant-1", ROW.id, { ownerId: null }));

      expect(repo.isActiveUserInTenant).not.toHaveBeenCalled();
      expect(repo.assignOwner).toHaveBeenCalledWith(ROW.id, null);
    });

    // P2 M-5 fix (Phase-7 Wave 2 security hardening batch B, item 4).
    it("rejects reassigning to an ownerId that is not an active user in this tenant", async () => {
      repo.isActiveUserInTenant.mockResolvedValue(false);
      repo.findById.mockResolvedValueOnce(ROW);

      await expect(
        runWithScope("branch", () =>
          service.assignOwner("tenant-1", ROW.id, { ownerId: "out-of-tenant-or-bogus-id" }),
        ),
      ).rejects.toThrow(BadRequestException);
      expect(repo.assignOwner).not.toHaveBeenCalled();
    });
  });

  describe("convert (from any non-lost stage, one click)", () => {
    const followUpRow: LeadRow = { ...ROW, stage: "follow_up" };

    it("rejects conversion of a LOST lead (reopen it first)", async () => {
      repo.findById.mockResolvedValue({ ...ROW, stage: "lost" });

      await expect(
        runWithScope("own", () =>
          service.convert("tenant-1", "actor-1", ROW.id, {
            studentFields: { name: "Asha", email: "asha@new.com", courseType: "btech", status: "lead" },
          }),
        ),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(studentsRepo.createStudentWithUser).not.toHaveBeenCalled();
    });

    it("converts a brand-new lead in one click (no stepping through stages)", async () => {
      repo.findById.mockResolvedValue(ROW); // stage = "new"
      studentsRepo.findUserByEmail.mockResolvedValue(null);
      studentsRepo.createStudentWithUser.mockResolvedValue({ id: "student-new", userId: "user-new" });
      repo.setConverted.mockResolvedValue(undefined);

      const result = await runWithScope("own", () =>
        service.convert("tenant-1", "actor-1", ROW.id, {
          studentFields: { name: "Asha", email: "asha@new.com", courseType: "btech", status: "lead" },
        }),
      );

      expect(studentsRepo.createStudentWithUser).toHaveBeenCalled();
      expect(result.studentId).toBe("student-new");
    });

    it("rejects converting an already-converted lead", async () => {
      repo.findById.mockResolvedValue({ ...followUpRow, convertedStudentId: "existing-student" });

      await expect(
        runWithScope("own", () =>
          service.convert("tenant-1", "actor-1", ROW.id, {
            studentFields: { name: "Asha", email: "asha@new.com", courseType: "btech", status: "lead" },
          }),
        ),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it("creates a student, sets converted_student_id + stage=won, and does NOT create an order when programId/batchId are omitted", async () => {
      repo.findById.mockResolvedValue(followUpRow);
      studentsRepo.findUserByEmail.mockResolvedValue(null);
      studentsRepo.createStudentWithUser.mockResolvedValue({ id: "new-student", userId: "new-user" });

      const result = await runWithScope("own", () =>
        service.convert("tenant-1", "actor-1", ROW.id, {
          studentFields: { name: "Asha", email: "asha@new.com", courseType: "btech", status: "lead" },
        }),
      );

      expect(studentsRepo.createStudentWithUser).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: "tenant-1", email: "asha@new.com" }),
      );
      expect(repo.setConverted).toHaveBeenCalledWith(ROW.id, "new-student");
      expect(commerce.createOrder).not.toHaveBeenCalled();
      expect(result).toEqual({ leadId: ROW.id, studentId: "new-student", orderId: null, enrollmentId: null });
    });

    it("creates an order via the REUSED CommerceService when programId+batchId are provided, using a lead-derived idempotency key (never double-charges on retry)", async () => {
      repo.findById.mockResolvedValue(followUpRow);
      studentsRepo.findUserByEmail.mockResolvedValue(null);
      studentsRepo.createStudentWithUser.mockResolvedValue({ id: "new-student", userId: "new-user" });
      commerce.createOrder.mockResolvedValue({ id: "order-1" });

      const result = await runWithScope("own", () =>
        service.convert("tenant-1", "actor-1", ROW.id, {
          studentFields: { name: "Asha", email: "asha@new.com", courseType: "btech", status: "lead" },
          programId: "program-1",
          batchId: "batch-1",
        }),
      );

      expect(commerce.createOrder).toHaveBeenCalledWith(
        "tenant-1",
        "actor-1",
        `lead:${ROW.id}:order`,
        expect.objectContaining({ studentId: "new-student", programId: "program-1", batchId: "batch-1" }),
      );
      expect(result.orderId).toBe("order-1");
      expect(result.enrollmentId).toBeNull(); // enrollment completes later via pay/verify or manual-payment flow.
    });

    it("rejects conversion when the email is already in use (no orphan student created)", async () => {
      repo.findById.mockResolvedValue(followUpRow);
      studentsRepo.findUserByEmail.mockResolvedValue({ id: "existing-user" });

      await expect(
        runWithScope("own", () =>
          service.convert("tenant-1", "actor-1", ROW.id, {
            studentFields: { name: "Asha", email: "taken@example.com", courseType: "btech", status: "lead" },
          }),
        ),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(studentsRepo.createStudentWithUser).not.toHaveBeenCalled();
    });

    it("404s converting an out-of-scope lead", async () => {
      repo.findById.mockResolvedValue(null);

      await expect(
        runWithScope("own", () =>
          service.convert("tenant-1", "actor-1", "other-lead", {
            studentFields: { name: "Asha", email: "asha@new.com", courseType: "btech", status: "lead" },
          }),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("scope fail-closed", () => {
    it("throws ForbiddenException for an unresolvable scope value rather than falling open", async () => {
      await expect(
        runWithScope("bogus" as ScopeContext["scope"], () => service.list("tenant-1", { page: 1, pageSize: 20 })),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
