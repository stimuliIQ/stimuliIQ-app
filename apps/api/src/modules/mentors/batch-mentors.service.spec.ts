// apps/api/src/modules/mentors/batch-mentors.service.spec.ts
//
// Unit tests for BatchMentorsService (WS-2 batch<->mentor assignment, docs/specs/
// phase-8-mentor.md). Covers: AC-18 inactive-mentor rejection, AC-19 duplicate ->
// clean 409 (both the pre-check path and the concurrent-race P2002 path), AC-21 lead
// exclusivity, AC-26 batch-not-assignable guard, AC-27/AC-28 tenant/branch IDOR -> 404,
// AC-29 mentors.assign distinct scope from batches.view.

import { ConflictException, ForbiddenException, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { BatchMentorsService } from "./batch-mentors.service";
import { BatchMentorsRepository, type BatchScopeRow } from "./batch-mentors.repository";
import { MentorsRepository } from "./mentors.repository";
import { EnrollmentScopeRepository } from "../common-scope/enrollment-scope.repository";
import { scopeContextStorage, type ScopeContext } from "../auth/lib/scope-context";

type Mocked<T> = { [K in keyof T]: T[K] extends (...args: never[]) => unknown ? jest.Mock : T[K] };

function mockBatchMentorsRepo(): Mocked<BatchMentorsRepository> {
  return {
    findBatchScopeRow: jest.fn(),
    listCallerBranchIds: jest.fn(),
    listActiveForBatch: jest.fn().mockResolvedValue([]),
    findActiveByBatchAndMentor: jest.fn(),
    clearOtherLeads: jest.fn(),
    createAssignment: jest.fn(),
    updateIsLead: jest.fn(),
    softRemove: jest.fn(),
    findById: jest.fn(),
  } as unknown as Mocked<BatchMentorsRepository>;
}

function mockMentorsRepo(): Mocked<MentorsRepository> {
  return {
    findActiveAssignmentCandidate: jest.fn(),
  } as unknown as Mocked<MentorsRepository>;
}

function mockEnrollmentScope(): Mocked<EnrollmentScopeRepository> {
  return {
    resolveBatchIdsForMentor: jest.fn(),
  } as unknown as Mocked<EnrollmentScopeRepository>;
}

const BATCH: BatchScopeRow = {
  id: "batch-1",
  tenantId: "tenant-1",
  branchId: "branch-hyd",
  name: "Full-Stack HYD-01",
  status: "active",
};

const ASSIGNMENT_ROW = {
  batchMentorId: "bm-1",
  mentorId: "mentor-1",
  mentorFullName: "Dr. Ramesh",
  mentorEmail: "ramesh@example.test",
  mentorExternalInstitute: "IIT Hyderabad",
  mentorEngagementStatus: "active",
  isLead: false,
  assignedAt: new Date("2026-01-10T00:00:00Z"),
};

function runWithScope<T>(permissionKey: string, scope: ScopeContext["scope"], actorId: string, fn: () => T): T {
  const ctx: ScopeContext = { permissionKey, scope, actorId, tenantId: "tenant-1" };
  return scopeContextStorage.run(ctx, fn);
}

function makeP2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "5.0.0",
    meta: { target: ["batch_id", "mentor_id"] },
  });
}

describe("BatchMentorsService", () => {
  let service: BatchMentorsService;
  let repo: Mocked<BatchMentorsRepository>;
  let mentorsRepo: Mocked<MentorsRepository>;
  let enrollmentScope: Mocked<EnrollmentScopeRepository>;

  beforeEach(() => {
    repo = mockBatchMentorsRepo();
    mentorsRepo = mockMentorsRepo();
    enrollmentScope = mockEnrollmentScope();
    service = new BatchMentorsService(
      repo as unknown as BatchMentorsRepository,
      mentorsRepo as unknown as MentorsRepository,
      enrollmentScope as unknown as EnrollmentScopeRepository,
    );
  });

  describe("AC-18: assignment requires an active mentor", () => {
    it("422 MENTOR_NOT_ACTIVE for a prospective mentor", async () => {
      repo.findBatchScopeRow.mockResolvedValue(BATCH);
      mentorsRepo.findActiveAssignmentCandidate.mockResolvedValue({ id: "mentor-1", engagementStatus: "prospective" });

      await expect(
        runWithScope("mentors.assign", "all", "actor-1", () =>
          service.assign("tenant-1", "actor-1", "batch-1", { mentorId: "mentor-1", isLead: false }),
        ),
      ).rejects.toMatchObject({ response: { code: "MENTOR_NOT_ACTIVE" } });
    });

    it("422 MENTOR_NOT_ACTIVE for an inactive mentor", async () => {
      repo.findBatchScopeRow.mockResolvedValue(BATCH);
      mentorsRepo.findActiveAssignmentCandidate.mockResolvedValue({ id: "mentor-1", engagementStatus: "inactive" });

      await expect(
        runWithScope("mentors.assign", "all", "actor-1", () =>
          service.assign("tenant-1", "actor-1", "batch-1", { mentorId: "mentor-1", isLead: false }),
        ),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it("404 (not 422) for a mentorId that does not exist in this tenant", async () => {
      repo.findBatchScopeRow.mockResolvedValue(BATCH);
      mentorsRepo.findActiveAssignmentCandidate.mockResolvedValue(null);

      await expect(
        runWithScope("mentors.assign", "all", "actor-1", () =>
          service.assign("tenant-1", "actor-1", "batch-1", { mentorId: "does-not-exist", isLead: false }),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("AC-19: duplicate active assignment -> clean 409", () => {
    it("pre-check path: a literal repeat (same isLead) is rejected without a duplicate insert", async () => {
      repo.findBatchScopeRow.mockResolvedValue(BATCH);
      mentorsRepo.findActiveAssignmentCandidate.mockResolvedValue({ id: "mentor-1", engagementStatus: "active" });
      repo.findActiveByBatchAndMentor.mockResolvedValue({ id: "bm-1", isLead: false });

      await expect(
        runWithScope("mentors.assign", "all", "actor-1", () =>
          service.assign("tenant-1", "actor-1", "batch-1", { mentorId: "mentor-1", isLead: false }),
        ),
      ).rejects.toMatchObject({ response: { code: "ALREADY_ASSIGNED" } });
      expect(repo.createAssignment).not.toHaveBeenCalled();
    });

    it("race-condition path: a P2002 from a concurrent insert is caught as a clean 409, never a 500", async () => {
      repo.findBatchScopeRow.mockResolvedValue(BATCH);
      mentorsRepo.findActiveAssignmentCandidate.mockResolvedValue({ id: "mentor-1", engagementStatus: "active" });
      repo.findActiveByBatchAndMentor.mockResolvedValue(null); // pre-check saw nothing...
      repo.createAssignment.mockRejectedValue(makeP2002()); // ...but a concurrent request won the race.

      await expect(
        runWithScope("mentors.assign", "all", "actor-1", () =>
          service.assign("tenant-1", "actor-1", "batch-1", { mentorId: "mentor-1", isLead: false }),
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it("a non-P2002 DB error is NOT swallowed as ALREADY_ASSIGNED", async () => {
      repo.findBatchScopeRow.mockResolvedValue(BATCH);
      mentorsRepo.findActiveAssignmentCandidate.mockResolvedValue({ id: "mentor-1", engagementStatus: "active" });
      repo.findActiveByBatchAndMentor.mockResolvedValue(null);
      repo.createAssignment.mockRejectedValue(new Error("connection reset"));

      await expect(
        runWithScope("mentors.assign", "all", "actor-1", () =>
          service.assign("tenant-1", "actor-1", "batch-1", { mentorId: "mentor-1", isLead: false }),
        ),
      ).rejects.toThrow("connection reset");
    });
  });

  describe("AC-20/AC-21: multiple concurrent mentors, at most one lead", () => {
    it("designating a new lead clears every other active row's lead flag first", async () => {
      repo.findBatchScopeRow.mockResolvedValue(BATCH);
      mentorsRepo.findActiveAssignmentCandidate.mockResolvedValue({ id: "mentor-2", engagementStatus: "active" });
      repo.findActiveByBatchAndMentor.mockResolvedValue(null);
      repo.createAssignment.mockResolvedValue({ id: "bm-2" });
      repo.listActiveForBatch.mockResolvedValue([{ ...ASSIGNMENT_ROW, batchMentorId: "bm-2", mentorId: "mentor-2", isLead: true }]);

      await runWithScope("mentors.assign", "all", "actor-1", () =>
        service.assign("tenant-1", "actor-1", "batch-1", { mentorId: "mentor-2", isLead: true }),
      );

      expect(repo.clearOtherLeads).toHaveBeenCalledWith("tenant-1", "batch-1");
      expect(repo.createAssignment).toHaveBeenCalledWith(
        expect.objectContaining({ mentorId: "mentor-2", isLead: true }),
      );
    });

    it("re-assigning an already-active mentor with a DIFFERENT isLead updates the row in place (no new insert)", async () => {
      repo.findBatchScopeRow.mockResolvedValue(BATCH);
      mentorsRepo.findActiveAssignmentCandidate.mockResolvedValue({ id: "mentor-1", engagementStatus: "active" });
      repo.findActiveByBatchAndMentor.mockResolvedValue({ id: "bm-1", isLead: false });
      repo.listActiveForBatch.mockResolvedValue([{ ...ASSIGNMENT_ROW, isLead: true }]);

      await runWithScope("mentors.assign", "all", "actor-1", () =>
        service.assign("tenant-1", "actor-1", "batch-1", { mentorId: "mentor-1", isLead: true }),
      );

      expect(repo.clearOtherLeads).toHaveBeenCalledWith("tenant-1", "batch-1", "bm-1");
      expect(repo.updateIsLead).toHaveBeenCalledWith("bm-1", true);
      expect(repo.createAssignment).not.toHaveBeenCalled();
    });
  });

  describe("AC-26: assignment blocked on completed/archived batches", () => {
    it.each(["completed", "archived"] as const)("422 BATCH_NOT_ASSIGNABLE when batch.status=%s", async (status) => {
      repo.findBatchScopeRow.mockResolvedValue({ ...BATCH, status });

      await expect(
        runWithScope("mentors.assign", "all", "actor-1", () =>
          service.assign("tenant-1", "actor-1", "batch-1", { mentorId: "mentor-1", isLead: false }),
        ),
      ).rejects.toMatchObject({ response: { code: "BATCH_NOT_ASSIGNABLE" } });
      expect(mentorsRepo.findActiveAssignmentCandidate).not.toHaveBeenCalled();
    });

    it("allows assignment on a planned batch", async () => {
      repo.findBatchScopeRow.mockResolvedValue({ ...BATCH, status: "planned" });
      mentorsRepo.findActiveAssignmentCandidate.mockResolvedValue({ id: "mentor-1", engagementStatus: "active" });
      repo.findActiveByBatchAndMentor.mockResolvedValue(null);
      repo.createAssignment.mockResolvedValue({ id: "bm-1" });
      repo.listActiveForBatch.mockResolvedValue([ASSIGNMENT_ROW]);

      await expect(
        runWithScope("mentors.assign", "all", "actor-1", () =>
          service.assign("tenant-1", "actor-1", "batch-1", { mentorId: "mentor-1", isLead: false }),
        ),
      ).resolves.toMatchObject({ mentorId: "mentor-1" });
    });
  });

  describe("AC-27/AC-28: cross-tenant/branch IDOR -> 404", () => {
    it("404 when the batch does not exist for this tenant (cross-tenant)", async () => {
      repo.findBatchScopeRow.mockResolvedValue(null);

      await expect(
        runWithScope("mentors.assign", "all", "actor-1", () =>
          service.assign("tenant-1", "actor-1", "batch-in-other-tenant", { mentorId: "mentor-1", isLead: false }),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("404 when a branch-scoped caller targets a batch outside their branch (IDOR-safe, not 403)", async () => {
      repo.findBatchScopeRow.mockResolvedValue(BATCH); // branchId = "branch-hyd"
      repo.listCallerBranchIds.mockResolvedValue(["branch-blr"]);

      await expect(
        runWithScope("mentors.assign", "branch", "manager-1", () =>
          service.assign("tenant-1", "manager-1", "batch-1", { mentorId: "mentor-1", isLead: false }),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(mentorsRepo.findActiveAssignmentCandidate).not.toHaveBeenCalled();
    });

    it("succeeds when the branch-scoped caller's branch matches the batch's branch", async () => {
      repo.findBatchScopeRow.mockResolvedValue(BATCH);
      repo.listCallerBranchIds.mockResolvedValue(["branch-hyd"]);
      mentorsRepo.findActiveAssignmentCandidate.mockResolvedValue({ id: "mentor-1", engagementStatus: "active" });
      repo.findActiveByBatchAndMentor.mockResolvedValue(null);
      repo.createAssignment.mockResolvedValue({ id: "bm-1" });
      repo.listActiveForBatch.mockResolvedValue([ASSIGNMENT_ROW]);

      await expect(
        runWithScope("mentors.assign", "branch", "manager-1", () =>
          service.assign("tenant-1", "manager-1", "batch-1", { mentorId: "mentor-1", isLead: false }),
        ),
      ).resolves.toMatchObject({ mentorId: "mentor-1" });
    });
  });

  describe("AC-29: mentors.assign scope never resolves via assigned/own (fails closed)", () => {
    it("a Mentor role caller (scope=assigned on mentors.assign, which is never actually seeded) is rejected", async () => {
      repo.findBatchScopeRow.mockResolvedValue(BATCH);

      await expect(
        runWithScope("mentors.assign", "assigned", "mentor-user-1", () =>
          service.assign("tenant-1", "mentor-user-1", "batch-1", { mentorId: "mentor-1", isLead: false }),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe("AC-23: GET .../mentors reuses batches.view scope (assigned resolved via batch_mentors for a Mentor caller)", () => {
    it("a Mentor sees the assignment list for their own assigned batch", async () => {
      repo.findBatchScopeRow.mockResolvedValue(BATCH);
      enrollmentScope.resolveBatchIdsForMentor.mockResolvedValue(["batch-1"]);
      repo.listActiveForBatch.mockResolvedValue([ASSIGNMENT_ROW]);

      const result = await runWithScope("batches.view", "assigned", "mentor-user-1", () =>
        service.list("tenant-1", "mentor-user-1", "batch-1"),
      );

      expect(result).toHaveLength(1);
    });

    it("a Mentor requesting a batch they are NOT assigned to gets 404 (IDOR-safe)", async () => {
      repo.findBatchScopeRow.mockResolvedValue(BATCH);
      enrollmentScope.resolveBatchIdsForMentor.mockResolvedValue(["some-other-batch"]);

      await expect(
        runWithScope("batches.view", "assigned", "mentor-user-1", () =>
          service.list("tenant-1", "mentor-user-1", "batch-1"),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("AC-24/Rule M-5: removal is a soft-unassign", () => {
    it("calls softRemove (never a hard delete) and returns the updated list", async () => {
      repo.findBatchScopeRow.mockResolvedValue(BATCH);
      repo.findActiveByBatchAndMentor.mockResolvedValue({ id: "bm-1", isLead: false });
      repo.listActiveForBatch.mockResolvedValue([]);

      const result = await runWithScope("mentors.assign", "all", "actor-1", () =>
        service.remove("tenant-1", "actor-1", "batch-1", "mentor-1"),
      );

      expect(repo.softRemove).toHaveBeenCalledWith("bm-1");
      expect(result).toEqual([]);
    });

    it("404 when removing a mentor who is not actively assigned", async () => {
      repo.findBatchScopeRow.mockResolvedValue(BATCH);
      repo.findActiveByBatchAndMentor.mockResolvedValue(null);

      await expect(
        runWithScope("mentors.assign", "all", "actor-1", () =>
          service.remove("tenant-1", "actor-1", "batch-1", "mentor-1"),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
