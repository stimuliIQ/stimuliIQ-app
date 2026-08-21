// apps/api/src/modules/enrollments/enrollments.service.spec.ts
//
// Unit tests for EnrollmentsService, scope allow/deny, capacity checks, and the critical
// re-enrollment hard-restore contract (a student withdrawn (soft-deleted) from a batch and
// re-enrolled into the SAME batch must restore the existing row, never insert a second
// one, since `enrollments` has a FULL-COLUMN unique on (studentId, batchId)).

import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { EnrollmentsService } from "./enrollments.service";
import { EnrollmentsRepository, type EnrollmentRow } from "./enrollments.repository";
import { scopeContextStorage, type ScopeContext } from "../auth/lib/scope-context";

type Mocked<T> = { [K in keyof T]: T[K] extends (...args: never[]) => unknown ? jest.Mock : T[K] };

function mockRepository(): Mocked<EnrollmentsRepository> {
  return {
    list: jest.fn(),
    findById: jest.fn(),
    findExisting: jest.fn(),
    create: jest.fn(),
    restoreAsActive: jest.fn(),
    enrollOrRestore: jest.fn(),
    updateBatch: jest.fn(),
    updateStatus: jest.fn(),
    softDelete: jest.fn(),
    listCallerBranchIds: jest.fn(),
    findOwnFacultyProfileId: jest.fn(),
    listBatchIdsForBranches: jest.fn(),
    listBatchIdsForFaculty: jest.fn(),
    studentExists: jest.fn(),
    hasPaidOrderForProgram: jest.fn(),
    findBatchForEnrollment: jest.fn(),
    countActiveEnrollments: jest.fn(),
    // lifecycle-redesign P4 auto-spill helpers.
    findBatchTemplate: jest.fn(),
    listSiblingBatchesWithLoad: jest.fn(),
    countSiblingBatches: jest.fn(),
    createSpilloverBatch: jest.fn(),
  } as unknown as Mocked<EnrollmentsRepository>;
}

const ROW: EnrollmentRow = {
  id: "enrollment-1",
  studentId: "student-1",
  studentName: "Asha Rao",
  batchId: "batch-1",
  batchName: "FS-2026-A",
  programId: "program-1",
  programTitle: "Full Stack",
  status: "active",
  progressPct: 0,
  enrolledAt: new Date("2026-01-01T00:00:00Z"),
  completedAt: null,
  deletedAt: null,
};

const BATCH = {
  id: "batch-1",
  programId: "program-1",
  branchId: "branch-hyderabad",
  facultyId: "faculty-1",
  capacity: 30,
  status: "active" as const,
  endDate: null as Date | null,
};

function runWithScope<T>(scope: ScopeContext["scope"], actorId: string, fn: () => T): T {
  const ctx: ScopeContext = { permissionKey: "enrollments.view", scope, actorId, tenantId: "tenant-1" };
  return scopeContextStorage.run(ctx, fn);
}

describe("EnrollmentsService", () => {
  let service: EnrollmentsService;
  let repo: Mocked<EnrollmentsRepository>;

  beforeEach(() => {
    repo = mockRepository();
    // lifecycle-redesign P3: LMS provisioning is best-effort on enroll; a resolved no-op
    // stub keeps these scope-resolution tests focused (provisioning has its own spec).
    const lmsProvisioning = {
      provisionForStudentProfile: jest.fn().mockResolvedValue(false),
    } as unknown as import("../students/lms-account-provisioning.service").LmsAccountProvisioningService;
    service = new EnrollmentsService(repo as unknown as EnrollmentsRepository, lmsProvisioning);
    // Entitlement gate: enroll() now requires a PAID order for the batch's program. Default
    // the happy-path mock to "entitled" so the scope/capacity/hard-restore tests below stay
    // focused; the dedicated test overrides this to false to prove the 409 gate.
    repo.hasPaidOrderForProgram.mockResolvedValue(true);
  });

  describe("scope resolution, list", () => {
    it("allows scope=all with no extra restriction", async () => {
      repo.list.mockResolvedValue({ rows: [ROW], total: 1 });

      await runWithScope("all", "actor-1", () =>
        service.list("tenant-1", "actor-1", { page: 1, pageSize: 20 }),
      );

      expect(repo.list).toHaveBeenCalledWith(
        expect.not.objectContaining({ restrictToBatchIds: expect.anything() }),
      );
    });

    it("resolves scope=branch via a batches join", async () => {
      repo.listCallerBranchIds.mockResolvedValue(["branch-hyderabad"]);
      repo.listBatchIdsForBranches.mockResolvedValue(["batch-1"]);
      repo.list.mockResolvedValue({ rows: [ROW], total: 1 });

      await runWithScope("branch", "manager-1", () =>
        service.list("tenant-1", "manager-1", { page: 1, pageSize: 20 }),
      );

      expect(repo.listBatchIdsForBranches).toHaveBeenCalledWith("tenant-1", ["branch-hyderabad"]);
      expect(repo.list).toHaveBeenCalledWith(expect.objectContaining({ restrictToBatchIds: ["batch-1"] }));
    });

    it("resolves scope=assigned via the caller's faculty profile", async () => {
      repo.findOwnFacultyProfileId.mockResolvedValue("faculty-1");
      repo.listBatchIdsForFaculty.mockResolvedValue(["batch-1"]);
      repo.list.mockResolvedValue({ rows: [ROW], total: 1 });

      await runWithScope("assigned", "faculty-user-1", () =>
        service.list("tenant-1", "faculty-user-1", { page: 1, pageSize: 20 }),
      );

      expect(repo.list).toHaveBeenCalledWith(expect.objectContaining({ restrictToBatchIds: ["batch-1"] }));
    });

    it("fails closed for scope=assigned with no faculty profile", async () => {
      repo.findOwnFacultyProfileId.mockResolvedValue(null);
      repo.list.mockResolvedValue({ rows: [], total: 0 });

      await runWithScope("assigned", "no-faculty-user", () =>
        service.list("tenant-1", "no-faculty-user", { page: 1, pageSize: 20 }),
      );

      expect(repo.list).toHaveBeenCalledWith(expect.objectContaining({ restrictToBatchIds: [] }));
    });

    it("rejects scope=own with 403", async () => {
      await expect(
        runWithScope("own", "actor-1", () => service.list("tenant-1", "actor-1", { page: 1, pageSize: 20 })),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.list).not.toHaveBeenCalled();
    });
  });

  describe("IDOR / object-level authz", () => {
    it("returns 404 when the row's batch is outside the caller's branch scope", async () => {
      repo.findById.mockResolvedValue(ROW);
      repo.listCallerBranchIds.mockResolvedValue(["branch-bengaluru"]);
      repo.listBatchIdsForBranches.mockResolvedValue([]);

      await expect(
        runWithScope("branch", "manager-1", () => service.getById("tenant-1", "manager-1", ROW.id)),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("returns the DTO when the row's batch is within the caller's branch scope", async () => {
      repo.findById.mockResolvedValue(ROW);
      repo.listCallerBranchIds.mockResolvedValue(["branch-hyderabad"]);
      repo.listBatchIdsForBranches.mockResolvedValue(["batch-1"]);

      const dto = await runWithScope("branch", "manager-1", () => service.getById("tenant-1", "manager-1", ROW.id));
      expect(dto.id).toBe(ROW.id);
    });
  });

  // CLOSED-BATCH gate: the CRM's pickers already hide finished batches, but the rule has
  // to hold server-side or a direct API call still lands a student in a finished cohort.
  describe("enroll, closed/expired batch gate", () => {
    beforeEach(() => {
      repo.studentExists.mockResolvedValue(true);
      repo.countActiveEnrollments.mockResolvedValue(0);
    });

    const enroll = () =>
      runWithScope("all", "admin-1", () =>
        service.enroll("tenant-1", "admin-1", { studentId: "student-1", batchId: "batch-1", autoSpillOnFull: false }),
      );

    it.each(["completed", "archived"] as const)("rejects a %s batch", async (status) => {
      repo.findBatchForEnrollment.mockResolvedValue({ ...BATCH, status });

      await expect(enroll()).rejects.toBeInstanceOf(ConflictException);
      expect(repo.enrollOrRestore).not.toHaveBeenCalled();
    });

    it("rejects a batch still marked active whose end date has passed (the window before the sweep runs)", async () => {
      repo.findBatchForEnrollment.mockResolvedValue({
        ...BATCH,
        status: "active",
        endDate: new Date("2020-01-01T00:00:00Z"),
      });

      await expect(enroll()).rejects.toBeInstanceOf(ConflictException);
      expect(repo.enrollOrRestore).not.toHaveBeenCalled();
    });

    it("allows an open-ended batch (no end date)", async () => {
      repo.findBatchForEnrollment.mockResolvedValue({ ...BATCH, status: "active", endDate: null });
      repo.enrollOrRestore.mockResolvedValue({ id: "enrollment-1", restored: false });
      repo.findById.mockResolvedValue(ROW);

      await expect(enroll()).resolves.toBeDefined();
      expect(repo.enrollOrRestore).toHaveBeenCalled();
    });

    it("allows a batch whose end date is still in the future", async () => {
      repo.findBatchForEnrollment.mockResolvedValue({
        ...BATCH,
        status: "active",
        endDate: new Date("2099-01-01T00:00:00Z"),
      });
      repo.enrollOrRestore.mockResolvedValue({ id: "enrollment-1", restored: false });
      repo.findById.mockResolvedValue(ROW);

      await expect(enroll()).resolves.toBeDefined();
    });

    it("allows a PLANNED batch, not yet started is not the same as closed", async () => {
      repo.findBatchForEnrollment.mockResolvedValue({ ...BATCH, status: "planned", endDate: null });
      repo.enrollOrRestore.mockResolvedValue({ id: "enrollment-1", restored: false });
      repo.findById.mockResolvedValue(ROW);

      await expect(enroll()).resolves.toBeDefined();
    });
  });

  describe("enroll, capacity + scope validation", () => {
    it("rejects enrolling into a full batch", async () => {
      repo.studentExists.mockResolvedValue(true);
      repo.findBatchForEnrollment.mockResolvedValue(BATCH);
      repo.countActiveEnrollments.mockResolvedValue(30);

      await expect(
        runWithScope("all", "admin-1", () =>
          service.enroll("tenant-1", "admin-1", { studentId: "student-1", batchId: "batch-1", autoSpillOnFull: false }),
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(repo.enrollOrRestore).not.toHaveBeenCalled();
    });

    // ENTITLEMENT gate: a student may only be placed into a batch whose PROGRAM they have a
    // paid order for. Without one, enroll() must 409 (enrollments.payment_required) and never
    // write, this is the server-side enforcement of "always require a paid order", closing
    // the manual roster path's payment-bypass hole.
    it("rejects enrolling a student with no paid order for the batch's program", async () => {
      repo.studentExists.mockResolvedValue(true);
      repo.findBatchForEnrollment.mockResolvedValue(BATCH);
      repo.hasPaidOrderForProgram.mockResolvedValue(false);

      await expect(
        runWithScope("all", "admin-1", () =>
          service.enroll("tenant-1", "admin-1", { studentId: "student-1", batchId: "batch-1", autoSpillOnFull: false }),
        ),
      ).rejects.toMatchObject({ response: { code: "enrollments.payment_required" } });
      expect(repo.hasPaidOrderForProgram).toHaveBeenCalledWith("tenant-1", "student-1", "program-1");
      expect(repo.countActiveEnrollments).not.toHaveBeenCalled();
      expect(repo.enrollOrRestore).not.toHaveBeenCalled();
    });

    // ── lifecycle-redesign P4: batch auto-spill ──────────────────────────────
    it("auto-spills into an existing non-full sibling batch when the target is full and autoSpillOnFull=true", async () => {
      repo.studentExists.mockResolvedValue(true);
      repo.findBatchForEnrollment.mockResolvedValue(BATCH); // capacity 30
      repo.countActiveEnrollments.mockResolvedValue(30); // full
      repo.listSiblingBatchesWithLoad.mockResolvedValue([
        { id: "batch-2", capacity: 30, load: 30 }, // also full, skipped
        { id: "batch-3", capacity: 30, load: 12 }, // has room, chosen
      ]);
      repo.enrollOrRestore.mockResolvedValue({ id: "enrollment-spill", restored: false });
      repo.findById.mockResolvedValue({ ...ROW, id: "enrollment-spill", batchId: "batch-3" });

      const dto = await runWithScope("all", "admin-1", () =>
        service.enroll("tenant-1", "admin-1", { studentId: "student-1", batchId: "batch-1", autoSpillOnFull: true }),
      );

      // Enrolled into the sibling with room, NOT the full requested batch; no new batch created.
      expect(repo.enrollOrRestore).toHaveBeenCalledWith("tenant-1", {
        studentId: "student-1",
        batchId: "batch-3",
        programId: "program-1",
      });
      expect(repo.createSpilloverBatch).not.toHaveBeenCalled();
      expect(dto.id).toBe("enrollment-spill");
    });

    it("auto-creates the next batch (cloning the full one as a template) when no sibling has room", async () => {
      repo.studentExists.mockResolvedValue(true);
      repo.findBatchForEnrollment.mockResolvedValue(BATCH);
      repo.countActiveEnrollments.mockResolvedValue(30); // full
      repo.listSiblingBatchesWithLoad.mockResolvedValue([{ id: "batch-2", capacity: 30, load: 30 }]); // all full
      repo.findBatchTemplate.mockResolvedValue({
        id: "batch-1",
        programId: "program-1",
        branchId: "branch-hyderabad",
        facultyId: "faculty-1",
        capacity: 30,
        mode: "recorded",
        schedule: null,
        name: "Hyderabad Cohort",
        startDate: new Date("2026-08-01"),
        endDate: null,
      });
      repo.countSiblingBatches.mockResolvedValue(2);
      repo.createSpilloverBatch.mockResolvedValue({ id: "batch-new" });
      repo.enrollOrRestore.mockResolvedValue({ id: "enrollment-new-batch", restored: false });
      repo.findById.mockResolvedValue({ ...ROW, id: "enrollment-new-batch", batchId: "batch-new" });

      const dto = await runWithScope("all", "admin-1", () =>
        service.enroll("tenant-1", "admin-1", { studentId: "student-1", batchId: "batch-1", autoSpillOnFull: true }),
      );

      // Cloned the template with a derived "Section N" name (siblingCount 2 → Section 3).
      expect(repo.createSpilloverBatch).toHaveBeenCalledWith(
        "tenant-1",
        expect.objectContaining({ id: "batch-1", capacity: 30 }),
        "Hyderabad Cohort · Section 3",
      );
      // Enrolled into the freshly-created batch.
      expect(repo.enrollOrRestore).toHaveBeenCalledWith("tenant-1", {
        studentId: "student-1",
        batchId: "batch-new",
        programId: "program-1",
      });
      expect(dto.id).toBe("enrollment-new-batch");
    });

    it("rejects a branch-scoped caller enrolling into a batch outside their branch", async () => {
      repo.studentExists.mockResolvedValue(true);
      repo.findBatchForEnrollment.mockResolvedValue(BATCH);
      repo.listCallerBranchIds.mockResolvedValue(["branch-bengaluru"]);

      await expect(
        runWithScope("branch", "manager-1", () =>
          service.enroll("tenant-1", "manager-1", { studentId: "student-1", batchId: "batch-1", autoSpillOnFull: false }),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.enrollOrRestore).not.toHaveBeenCalled();
    });

    it("rejects an assigned-scope caller (faculty) enrolling into a batch not theirs", async () => {
      repo.studentExists.mockResolvedValue(true);
      repo.findBatchForEnrollment.mockResolvedValue(BATCH);
      repo.findOwnFacultyProfileId.mockResolvedValue("faculty-2");

      await expect(
        runWithScope("assigned", "faculty-user-1", () =>
          service.enroll("tenant-1", "faculty-user-1", { studentId: "student-1", batchId: "batch-1", autoSpillOnFull: false }),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.enrollOrRestore).not.toHaveBeenCalled();
    });

    it("creates a new enrollment when none exists (delegates to the atomic enrollOrRestore repository method)", async () => {
      repo.studentExists.mockResolvedValue(true);
      repo.findBatchForEnrollment.mockResolvedValue(BATCH);
      repo.countActiveEnrollments.mockResolvedValue(5);
      repo.enrollOrRestore.mockResolvedValue({ id: "enrollment-new", restored: false });
      repo.findById.mockResolvedValue({ ...ROW, id: "enrollment-new" });

      const dto = await runWithScope("all", "admin-1", () =>
        service.enroll("tenant-1", "admin-1", { studentId: "student-1", batchId: "batch-1", autoSpillOnFull: false }),
      );

      expect(repo.enrollOrRestore).toHaveBeenCalledWith("tenant-1", {
        studentId: "student-1",
        batchId: "batch-1",
        programId: "program-1",
      });
      expect(dto.id).toBe("enrollment-new");
    });

    // CRITICAL: re-enrollment hard-restore contract. `enrollments` has a FULL-COLUMN
    // unique on (studentId, batchId), re-enrolling a student previously withdrawn
    // (soft-deleted) from the SAME batch MUST hard-restore that existing row, never
    // attempt a second insert (which would violate the unique constraint at the DB
    // level). The service delegates this decision entirely to the repository's
    // `enrollOrRestore()` (tested at the repository/integration level for the actual
    // transactional restore-vs-create branching); this test proves the SERVICE always
    // calls that single atomic method rather than ever calling `create()` directly,
    // which is exactly what prevents the service layer from re-introducing a
    // check-then-insert race/bug.
    it("re-enrolling a previously withdrawn student into the same batch goes through enrollOrRestore (restore path), not a raw create", async () => {
      repo.studentExists.mockResolvedValue(true);
      repo.findBatchForEnrollment.mockResolvedValue(BATCH);
      repo.countActiveEnrollments.mockResolvedValue(5);
      // Simulates the repository detecting the soft-deleted row and restoring it.
      repo.enrollOrRestore.mockResolvedValue({ id: ROW.id, restored: true });
      repo.findById.mockResolvedValue(ROW);

      const dto = await runWithScope("all", "admin-1", () =>
        service.enroll("tenant-1", "admin-1", { studentId: "student-1", batchId: "batch-1", autoSpillOnFull: false }),
      );

      expect(repo.create).not.toHaveBeenCalled();
      expect(repo.enrollOrRestore).toHaveBeenCalledTimes(1);
      expect(dto.id).toBe(ROW.id);
      expect(dto.status).toBe("active");
    });
  });

  describe("withdraw", () => {
    it("sets status to dropped", async () => {
      repo.findById.mockResolvedValueOnce(ROW).mockResolvedValueOnce({ ...ROW, status: "dropped" });

      const dto = await runWithScope("all", "admin-1", () =>
        service.withdraw("tenant-1", "admin-1", ROW.id, {}),
      );

      expect(repo.updateStatus).toHaveBeenCalledWith(ROW.id, "dropped");
      expect(dto.status).toBe("dropped");
    });
  });

  describe("move, re-enrollment collision on the target batch", () => {
    const TARGET_BATCH = { id: "batch-2", programId: "program-1", branchId: "branch-hyderabad", facultyId: "faculty-1", capacity: 30 };

    it("hard-restores a previously soft-deleted row for the target batch instead of inserting a second row", async () => {
      repo.findById.mockResolvedValue(ROW);
      repo.findBatchForEnrollment.mockResolvedValue(TARGET_BATCH);
      repo.findExisting.mockResolvedValue({ ...ROW, id: "enrollment-old-2", batchId: "batch-2", deletedAt: new Date() });
      repo.countActiveEnrollments.mockResolvedValue(5);
      repo.findById.mockResolvedValueOnce(ROW).mockResolvedValueOnce({ ...ROW, id: "enrollment-old-2", batchId: "batch-2" });

      const dto = await runWithScope("all", "admin-1", () =>
        service.move("tenant-1", "admin-1", ROW.id, { toBatchId: "batch-2" }),
      );

      expect(repo.restoreAsActive).toHaveBeenCalledWith("enrollment-old-2");
      expect(repo.softDelete).toHaveBeenCalledWith(ROW.id);
      expect(dto.id).toBe("enrollment-old-2");
    });

    it("rejects moving into a batch the student is already actively enrolled in", async () => {
      repo.findById.mockResolvedValue(ROW);
      repo.findBatchForEnrollment.mockResolvedValue(TARGET_BATCH);
      repo.findExisting.mockResolvedValue({ ...ROW, id: "enrollment-active-2", batchId: "batch-2", deletedAt: null });

      await expect(
        runWithScope("all", "admin-1", () => service.move("tenant-1", "admin-1", ROW.id, { toBatchId: "batch-2" })),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    // ENTITLEMENT gate on cross-program moves: moving a student into a batch of a DIFFERENT
    // program changes their program, so it needs a paid order for that new program, else
    // move() is a back door around the enroll() payment guard. (Same-program moves, tested
    // above, never hit this check.)
    it("rejects moving into a batch of a DIFFERENT program with no paid order for that program", async () => {
      const OTHER_PROGRAM_BATCH = { id: "batch-9", programId: "program-2", branchId: "branch-hyderabad", facultyId: "faculty-1", capacity: 30 };
      repo.findById.mockResolvedValue(ROW); // ROW.programId = "program-1"
      repo.findBatchForEnrollment.mockResolvedValue(OTHER_PROGRAM_BATCH);
      repo.hasPaidOrderForProgram.mockResolvedValue(false);

      await expect(
        runWithScope("all", "admin-1", () => service.move("tenant-1", "admin-1", ROW.id, { toBatchId: "batch-9" })),
      ).rejects.toMatchObject({ response: { code: "enrollments.payment_required" } });
      expect(repo.hasPaidOrderForProgram).toHaveBeenCalledWith("tenant-1", "student-1", "program-2");
      expect(repo.updateBatch).not.toHaveBeenCalled();
    });
  });
});
