// apps/api/src/modules/mentors/batch-completion.service.spec.ts
//
// Unit tests for BatchCompletionService (WS-3, docs/specs/phase-8-mentor.md). Covers:
//   AC-31/AC-34/AC-35 — the rollup reconciles exactly with a direct recomputation over
//     mocked enrollment/certificate rows (never a parallel progress system).
//   AC-33 — per-student eligibility calls CertificatesService.isEligible verbatim (the P4
//     engine), never a re-derived formula.
//   AC-36 — a zero-enrollment batch is a valid 200 (never 404/500).
//   AC-37/AC-45 — scope resolution: a Mentor requesting an unassigned batch gets 404.
//   AC-38/39/40 — mark-complete: guard (only from 'active'), idempotent 409 on replay,
//     sets status/completedAt.
//   AC-41 — Rule M-2: completion numbers are always computed/returned, never gate the
//     transition.
//   AC-42 — mark-complete performs a pure status/timestamp write.

import { ConflictException, ForbiddenException, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { BatchCompletionService } from "./batch-completion.service";
import { BatchCompletionRepository, type CompletionBatchRow, type CompletionEnrollmentRow } from "./batch-completion.repository";
import { CertificatesService } from "../certificates/certificates.service";
import { EnrollmentScopeRepository } from "../common-scope/enrollment-scope.repository";
import { scopeContextStorage, type ScopeContext } from "../auth/lib/scope-context";

type Mocked<T> = { [K in keyof T]: T[K] extends (...args: never[]) => unknown ? jest.Mock : T[K] };

function mockRepo(): Mocked<BatchCompletionRepository> {
  return {
    findBatchRow: jest.fn(),
    listCallerBranchIds: jest.fn(),
    listEnrollments: jest.fn(),
    findCertificatesForEnrollments: jest.fn().mockResolvedValue(new Map()),
    countNonProjectAssignments: jest.fn(),
    listNonProjectAssignmentIds: jest.fn().mockResolvedValue([]),
    countDistinctSubmittedPairs: jest.fn().mockResolvedValue(0),
    markComplete: jest.fn(),
  } as unknown as Mocked<BatchCompletionRepository>;
}

function mockCertificatesService(): Mocked<CertificatesService> {
  return { isEligible: jest.fn() } as unknown as Mocked<CertificatesService>;
}

function mockEnrollmentScope(): Mocked<EnrollmentScopeRepository> {
  return { resolveBatchIdsForMentor: jest.fn() } as unknown as Mocked<EnrollmentScopeRepository>;
}

const BATCH: CompletionBatchRow = {
  id: "batch-1",
  tenantId: "tenant-1",
  branchId: "branch-hyd",
  programId: "program-1",
  name: "Full-Stack HYD-01",
  status: "active",
  completedAt: null,
};

function enrollment(overrides: Partial<CompletionEnrollmentRow> = {}): CompletionEnrollmentRow {
  return {
    id: `enr-${Math.random()}`,
    studentId: "student-1",
    studentName: "Ananya",
    status: "active",
    progressPct: 50,
    ...overrides,
  };
}

function eligibilityResult(overrides: Partial<{
  eligible: boolean;
  completionPct: number;
  completionPassed: boolean;
  requiredAssessmentsPassed: boolean;
  finalProjectApproved: boolean;
}> = {}) {
  return {
    eligible: overrides.eligible ?? false,
    reasons: {
      completionPct: overrides.completionPct ?? 50,
      completionPassed: overrides.completionPassed ?? false,
      requiredAssessmentsPassed: overrides.requiredAssessmentsPassed ?? false,
      finalProjectApproved: overrides.finalProjectApproved ?? false,
    },
    recommendedAt: null as Date | null,
  };
}

function runWithScope<T>(permissionKey: string, scope: ScopeContext["scope"], actorId: string, fn: () => T): T {
  const ctx: ScopeContext = { permissionKey, scope, actorId, tenantId: "tenant-1" };
  return scopeContextStorage.run(ctx, fn);
}

describe("BatchCompletionService", () => {
  let service: BatchCompletionService;
  let repo: Mocked<BatchCompletionRepository>;
  let certs: Mocked<CertificatesService>;
  let enrollmentScope: Mocked<EnrollmentScopeRepository>;

  beforeEach(() => {
    repo = mockRepo();
    certs = mockCertificatesService();
    enrollmentScope = mockEnrollmentScope();
    service = new BatchCompletionService(
      repo as unknown as BatchCompletionRepository,
      certs as unknown as CertificatesService,
      enrollmentScope as unknown as EnrollmentScopeRepository,
    );
  });

  describe("AC-36: empty batch rollup is a valid zero result", () => {
    it("returns 200 with all buckets 0 and percentComplete null — never 404/500", async () => {
      repo.findBatchRow.mockResolvedValue(BATCH);
      repo.listEnrollments.mockResolvedValue([]);

      const summary = await runWithScope("batches.view", "all", "actor-1", () =>
        service.getSummary("tenant-1", "actor-1", "batch-1"),
      );

      expect(summary.totalActive).toBe(0);
      expect(summary.certified).toBe(0);
      expect(summary.eligibleNotIssued).toBe(0);
      expect(summary.inProgress).toBe(0);
      expect(summary.dropped).toBe(0);
      expect(summary.percentComplete).toBeNull();
      expect(certs.isEligible).not.toHaveBeenCalled();
    });
  });

  describe("AC-31/AC-33/AC-34/AC-35: rollup reconciles with a direct recomputation", () => {
    it("buckets students into certified/eligibleNotIssued/inProgress/dropped via the P4 eligibility engine", async () => {
      const certifiedEnr = enrollment({ id: "enr-certified", progressPct: 100, status: "completed" });
      const eligibleNotIssuedEnr = enrollment({ id: "enr-eligible", progressPct: 95, status: "active" });
      const inProgressEnr = enrollment({ id: "enr-inprogress", progressPct: 40, status: "active" });
      const droppedEnr = enrollment({ id: "enr-dropped", progressPct: 20, status: "dropped" });

      repo.findBatchRow.mockResolvedValue(BATCH);
      repo.listEnrollments.mockResolvedValue([certifiedEnr, eligibleNotIssuedEnr, inProgressEnr, droppedEnr]);
      repo.findCertificatesForEnrollments.mockResolvedValue(
        new Map([["enr-certified", { id: "cert-1", status: "valid" }]]),
      );
      repo.listNonProjectAssignmentIds.mockResolvedValue([]);

      certs.isEligible.mockImplementation(async (_tenantId: string, enrollmentId: string) => {
        if (enrollmentId === "enr-certified") return eligibilityResult({ eligible: true, requiredAssessmentsPassed: true, finalProjectApproved: true });
        if (enrollmentId === "enr-eligible") return eligibilityResult({ eligible: true, requiredAssessmentsPassed: true, finalProjectApproved: true });
        if (enrollmentId === "enr-inprogress") return eligibilityResult({ eligible: false });
        // dropped row still gets a real eligibility computation (schema requires it on
        // the per-student endpoint) even though the aggregate bucket is 'dropped'.
        return eligibilityResult({ eligible: false });
      });

      const summary = await runWithScope("batches.view", "all", "actor-1", () =>
        service.getSummary("tenant-1", "actor-1", "batch-1"),
      );

      expect(summary.totalActive).toBe(3); // completed/active only — dropped excluded
      expect(summary.certified).toBe(1);
      expect(summary.eligibleNotIssued).toBe(1);
      expect(summary.inProgress).toBe(1);
      expect(summary.dropped).toBe(1);
      // AC-35: average of progress_pct across ACTIVE (non-dropped) enrollments only.
      expect(summary.percentComplete).toBeCloseTo((100 + 95 + 40) / 3, 1);
      expect(certs.isEligible).toHaveBeenCalledWith("tenant-1", "enr-certified");
      expect(certs.isEligible).toHaveBeenCalledWith("tenant-1", "enr-eligible");
      expect(certs.isEligible).toHaveBeenCalledWith("tenant-1", "enr-inprogress");
    });

    it("AC-32: per-student progress % is the exact enrollments.progress_pct value (via completion/students)", async () => {
      const enr = enrollment({ id: "enr-1", progressPct: 62, status: "active" });
      repo.findBatchRow.mockResolvedValue(BATCH);
      repo.listEnrollments.mockResolvedValue([enr]);
      repo.findCertificatesForEnrollments.mockResolvedValue(new Map());
      certs.isEligible.mockResolvedValue(eligibilityResult({ completionPct: 62 }));

      const page = await runWithScope("batches.view", "all", "actor-1", () =>
        service.listStudents("tenant-1", "actor-1", "batch-1", { page: 1, pageSize: 20 }),
      );

      expect(page.items[0]!.eligibility.reasons.completionPct).toBe(62);
    });
  });

  describe("AC-37/AC-45: scope resolution — Mentor requesting an unassigned batch gets 404", () => {
    it("a Mentor assigned to the batch succeeds", async () => {
      repo.findBatchRow.mockResolvedValue(BATCH);
      repo.listEnrollments.mockResolvedValue([]);
      enrollmentScope.resolveBatchIdsForMentor.mockResolvedValue(["batch-1"]);

      await expect(
        runWithScope("batches.view", "assigned", "mentor-user-1", () =>
          service.getSummary("tenant-1", "mentor-user-1", "batch-1"),
        ),
      ).resolves.toMatchObject({ batchId: "batch-1" });
    });

    it("a Mentor NOT assigned to the batch gets 404", async () => {
      repo.findBatchRow.mockResolvedValue(BATCH);
      enrollmentScope.resolveBatchIdsForMentor.mockResolvedValue(["some-other-batch"]);

      await expect(
        runWithScope("batches.view", "assigned", "mentor-user-1", () =>
          service.getSummary("tenant-1", "mentor-user-1", "batch-1"),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("a Branch Manager targeting another branch's batch gets 404", async () => {
      repo.findBatchRow.mockResolvedValue(BATCH);
      repo.listCallerBranchIds.mockResolvedValue(["branch-blr"]);

      await expect(
        runWithScope("batches.view", "branch", "manager-1", () =>
          service.getSummary("tenant-1", "manager-1", "batch-1"),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("scope=own fails closed (never seeded for batches.view)", async () => {
      repo.findBatchRow.mockResolvedValue(BATCH);

      await expect(
        runWithScope("batches.view", "own", "user-1", () => service.getSummary("tenant-1", "user-1", "batch-1")),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe("AC-38/39/40: mark-complete transition", () => {
    it("422 BATCH_NOT_ACTIVE from status='planned'", async () => {
      repo.findBatchRow.mockResolvedValue({ ...BATCH, status: "planned" });

      await expect(
        runWithScope("batches.markComplete", "all", "actor-1", () =>
          service.markComplete("tenant-1", "actor-1", "batch-1"),
        ),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(repo.markComplete).not.toHaveBeenCalled();
    });

    it("succeeds from status='active' — sets status+completedAt via a pure write (AC-42)", async () => {
      repo.findBatchRow.mockResolvedValue(BATCH);
      repo.listEnrollments.mockResolvedValue([]);
      repo.markComplete.mockResolvedValue(1); // F2 compare-and-set: 1 row affected = we won

      const result = await runWithScope("batches.markComplete", "all", "actor-1", () =>
        service.markComplete("tenant-1", "actor-1", "batch-1"),
      );

      expect(repo.markComplete).toHaveBeenCalledWith("tenant-1", "batch-1", "actor-1", expect.any(Date));
      expect(result.status).toBe("completed");
      expect(result.completedByUserId).toBe("actor-1");
      expect(result.summary.totalActive).toBe(0); // AC-41: informational rollup returned alongside
    });

    it("F2: loses the compare-and-set race (0 rows affected) → 409 ALREADY_COMPLETED, no duplicate transition", async () => {
      // Batch reads as 'active' (passes the pre-check), but a concurrent completer already flipped
      // it before our conditional updateMany ran → 0 rows affected.
      repo.findBatchRow.mockResolvedValue(BATCH);
      repo.listEnrollments.mockResolvedValue([]);
      repo.markComplete.mockResolvedValue(0);

      await expect(
        runWithScope("batches.markComplete", "all", "actor-1", () =>
          service.markComplete("tenant-1", "actor-1", "batch-1"),
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it.each(["completed", "archived"] as const)(
      "409 ALREADY_COMPLETED (idempotent, no double-write) from status=%s",
      async (status) => {
        repo.findBatchRow.mockResolvedValue({ ...BATCH, status });

        await expect(
          runWithScope("batches.markComplete", "all", "actor-1", () =>
            service.markComplete("tenant-1", "actor-1", "batch-1"),
          ),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(repo.markComplete).not.toHaveBeenCalled();
      },
    );

    it("AC-41: an actively-assigned Mentor (not just the lead) can mark their own batch complete", async () => {
      repo.findBatchRow.mockResolvedValue(BATCH);
      repo.listEnrollments.mockResolvedValue([]);
      enrollmentScope.resolveBatchIdsForMentor.mockResolvedValue(["batch-1"]);

      const result = await runWithScope("batches.markComplete", "assigned", "mentor-user-1", () =>
        service.markComplete("tenant-1", "mentor-user-1", "batch-1"),
      );

      expect(result.status).toBe("completed");
    });

    it("AC-44/45: an unassigned Mentor cannot mark a batch complete (404, fail-closed)", async () => {
      repo.findBatchRow.mockResolvedValue(BATCH);
      enrollmentScope.resolveBatchIdsForMentor.mockResolvedValue([]);

      await expect(
        runWithScope("batches.markComplete", "assigned", "mentor-user-1", () =>
          service.markComplete("tenant-1", "mentor-user-1", "batch-1"),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.markComplete).not.toHaveBeenCalled();
    });
  });
});
