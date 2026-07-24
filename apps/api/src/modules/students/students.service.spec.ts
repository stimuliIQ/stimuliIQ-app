// apps/api/src/modules/students/students.service.spec.ts
//
// Unit tests for StudentsService scope-resolution + RBAC allow/deny, per CLAUDE.md §3 DoD
// rule 10. Mocks StudentsRepository/EnrollmentScopeRepository/FacultyRepository
// (collaborators) and drives scope via the real scopeContextStorage ALS
// (scopeContextStorage.run), matching the fail-closed contract documented in
// lib/scope-context.ts.
//
// Wave 3b closed the branch/assigned fail-closed gap (see students.service.ts file
// header) — these tests now assert the REAL branch/assigned filtering behavior instead of
// a blanket 403, while "own" (still not seeded/resolvable for students.* in P1) keeps
// failing closed.

import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { StudentsService } from "./students.service";
import { StudentsRepository, type StudentRow } from "./students.repository";
import { EnrollmentScopeRepository } from "../common-scope/enrollment-scope.repository";
import { FacultyRepository } from "../faculty/faculty.repository";
import { LmsAccountProvisioningService } from "./lms-account-provisioning.service";
import { scopeContextStorage, type ScopeContext } from "../auth/lib/scope-context";

type Mocked<T> = { [K in keyof T]: T[K] extends (...args: never[]) => unknown ? jest.Mock : T[K] };

function mockRepository(): Mocked<StudentsRepository> {
  return {
    list: jest.fn(),
    findById: jest.fn(),
    // Lifecycle-signals lookup (lifecycle-redesign P1): default to an empty Map so the
    // service's stage derivation falls back to the coarse `status`. Tests that assert on
    // a specific derived stage override this per-case.
    getLifecycleSignals: jest.fn().mockResolvedValue(new Map()),
    findUserByEmail: jest.fn(),
    findUserByEmailWithOwner: jest.fn(),
    createStudentWithUser: jest.fn(),
    updateStudent: jest.fn(),
    softDelete: jest.fn(),
    restore: jest.fn(),
  } as unknown as Mocked<StudentsRepository>;
}

function mockEnrollmentScope(): Mocked<EnrollmentScopeRepository> {
  return {
    resolveStudentIdsForBranches: jest.fn(),
    resolveStudentIdsForFaculty: jest.fn(),
    resolveBatchIdsForFaculty: jest.fn(),
    resolveProgramIdsForFaculty: jest.fn(),
  } as unknown as Mocked<EnrollmentScopeRepository>;
}

function mockFacultyRepository(): Mocked<FacultyRepository> {
  return {
    list: jest.fn(),
    findById: jest.fn(),
    findUserByEmail: jest.fn(),
    findOwnFacultyId: jest.fn(),
    listCallerBranchIds: jest.fn(),
    listAssignedBatches: jest.fn(),
    createFacultyWithUser: jest.fn(),
    updateFaculty: jest.fn(),
    softDelete: jest.fn(),
    restore: jest.fn(),
  } as unknown as Mocked<FacultyRepository>;
}

function mockLmsProvisioning(): Mocked<LmsAccountProvisioningService> {
  return {
    provisionForStudentProfile: jest.fn(),
    resendCredentials: jest.fn(),
  } as unknown as Mocked<LmsAccountProvisioningService>;
}

const ROW: StudentRow = {
  id: "student-1",
  userId: "user-1",
  name: "Asha Rao",
  email: "asha@example.com",
  phone: null,
  alternatePhone: null,
  college: null,
  courseType: "btech",
  year: null,
  city: null,
  source: null,
  status: "active",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  deletedAt: null,
};

function runWithScope<T>(scope: ScopeContext["scope"], fn: () => T): T {
  const ctx: ScopeContext = { permissionKey: "students.view", scope, actorId: "actor-1", tenantId: "tenant-1" };
  return scopeContextStorage.run(ctx, fn);
}

describe("StudentsService", () => {
  let service: StudentsService;
  let repo: Mocked<StudentsRepository>;
  let enrollmentScope: Mocked<EnrollmentScopeRepository>;
  let facultyRepository: Mocked<FacultyRepository>;
  let lmsProvisioning: Mocked<LmsAccountProvisioningService>;

  beforeEach(() => {
    repo = mockRepository();
    enrollmentScope = mockEnrollmentScope();
    facultyRepository = mockFacultyRepository();
    lmsProvisioning = mockLmsProvisioning();
    service = new StudentsService(
      repo as unknown as StudentsRepository,
      enrollmentScope as unknown as EnrollmentScopeRepository,
      facultyRepository as unknown as FacultyRepository,
      lmsProvisioning as unknown as LmsAccountProvisioningService,
    );
  });

  describe("scope resolution", () => {
    it("allows scope=all to list students with no id restriction", async () => {
      repo.list.mockResolvedValue({ rows: [ROW], total: 1 });

      const result = await runWithScope("all", () =>
        service.list("tenant-1", { page: 1, pageSize: 20, includeDeleted: false }),
      );

      expect(result.items).toHaveLength(1);
      expect(repo.list).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: "tenant-1", restrictToIds: undefined }),
      );
    });

    it("scope=branch restricts the list to the caller's resolved branch student ids (Wave 3b)", async () => {
      facultyRepository.listCallerBranchIds.mockResolvedValue(["branch-a"]);
      enrollmentScope.resolveStudentIdsForBranches.mockResolvedValue(["student-1"]);
      repo.list.mockResolvedValue({ rows: [ROW], total: 1 });

      const result = await runWithScope("branch", () =>
        service.list("tenant-1", { page: 1, pageSize: 20, includeDeleted: false }),
      );

      expect(facultyRepository.listCallerBranchIds).toHaveBeenCalledWith("actor-1");
      expect(enrollmentScope.resolveStudentIdsForBranches).toHaveBeenCalledWith("tenant-1", ["branch-a"]);
      expect(repo.list).toHaveBeenCalledWith(expect.objectContaining({ restrictToIds: ["student-1"] }));
      expect(result.items).toHaveLength(1);
    });

    it("scope=branch with no resolved branch ids filters to zero rows (never falls open to all)", async () => {
      facultyRepository.listCallerBranchIds.mockResolvedValue([]);
      enrollmentScope.resolveStudentIdsForBranches.mockResolvedValue([]);
      repo.list.mockResolvedValue({ rows: [], total: 0 });

      await runWithScope("branch", () => service.list("tenant-1", { page: 1, pageSize: 20, includeDeleted: false }));

      expect(repo.list).toHaveBeenCalledWith(expect.objectContaining({ restrictToIds: [] }));
    });

    it("scope=assigned restricts the list to students enrolled in the caller's taught batches (Wave 3b)", async () => {
      facultyRepository.findOwnFacultyId.mockResolvedValue("faculty-1");
      enrollmentScope.resolveStudentIdsForFaculty.mockResolvedValue(["student-1"]);
      repo.list.mockResolvedValue({ rows: [ROW], total: 1 });

      await runWithScope("assigned", () =>
        service.list("tenant-1", { page: 1, pageSize: 20, includeDeleted: false }),
      );

      expect(facultyRepository.findOwnFacultyId).toHaveBeenCalledWith("tenant-1", "actor-1");
      expect(enrollmentScope.resolveStudentIdsForFaculty).toHaveBeenCalledWith("tenant-1", "faculty-1");
      expect(repo.list).toHaveBeenCalledWith(expect.objectContaining({ restrictToIds: ["student-1"] }));
    });

    it("scope=assigned with no faculty profile filters to zero rows without calling enrollment scope", async () => {
      facultyRepository.findOwnFacultyId.mockResolvedValue(null);
      repo.list.mockResolvedValue({ rows: [], total: 0 });

      await runWithScope("assigned", () =>
        service.list("tenant-1", { page: 1, pageSize: 20, includeDeleted: false }),
      );

      expect(enrollmentScope.resolveStudentIdsForFaculty).not.toHaveBeenCalled();
      expect(repo.list).toHaveBeenCalledWith(expect.objectContaining({ restrictToIds: [] }));
    });

    it("scope=all + explicit branchId restricts to that branch's enrolled student ids (global branch scope)", async () => {
      enrollmentScope.resolveStudentIdsForBranches.mockResolvedValue(["student-1"]);
      repo.list.mockResolvedValue({ rows: [ROW], total: 1 });

      await runWithScope("all", () =>
        service.list("tenant-1", { page: 1, pageSize: 20, includeDeleted: false, branchId: "branch-b" }),
      );

      expect(enrollmentScope.resolveStudentIdsForBranches).toHaveBeenCalledWith("tenant-1", ["branch-b"]);
      expect(repo.list).toHaveBeenCalledWith(expect.objectContaining({ restrictToIds: ["student-1"] }));
    });

    it("scope=all + explicit branchId with no enrolled students filters to zero rows (never falls open)", async () => {
      enrollmentScope.resolveStudentIdsForBranches.mockResolvedValue([]);
      repo.list.mockResolvedValue({ rows: [], total: 0 });

      await runWithScope("all", () =>
        service.list("tenant-1", { page: 1, pageSize: 20, includeDeleted: false, branchId: "branch-empty" }),
      );

      expect(repo.list).toHaveBeenCalledWith(expect.objectContaining({ restrictToIds: [] }));
    });

    it("explicit branchId can only NARROW a branch-scoped caller — it intersects, never widens", async () => {
      // Caller is branch-scoped to {student-1, student-2}; the topbar picks a branch
      // whose enrolled set is {student-2, student-3}. The result must be the
      // intersection {student-2}, never student-3 (a branch the caller can't see).
      facultyRepository.listCallerBranchIds.mockResolvedValue(["branch-a"]);
      enrollmentScope.resolveStudentIdsForBranches
        .mockResolvedValueOnce(["student-1", "student-2"]) // scope restriction (branch-a)
        .mockResolvedValueOnce(["student-2", "student-3"]); // explicit topbar branch
      repo.list.mockResolvedValue({ rows: [ROW], total: 1 });

      await runWithScope("branch", () =>
        service.list("tenant-1", { page: 1, pageSize: 20, includeDeleted: false, branchId: "branch-b" }),
      );

      expect(repo.list).toHaveBeenCalledWith(expect.objectContaining({ restrictToIds: ["student-2"] }));
    });

    it("rejects scope=own with 403 (defensive — not a seeded scope for students.*)", async () => {
      await expect(
        runWithScope("own", () => service.getById("tenant-1", ROW.id)),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe("IDOR / object-level authz", () => {
    it("returns 404 (not 403) when the id does not exist in the caller's tenant", async () => {
      repo.findById.mockResolvedValue(null);

      await expect(runWithScope("all", () => service.getById("tenant-1", "missing-id"))).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("returns the detail DTO when the row exists in scope", async () => {
      repo.findById.mockResolvedValue(ROW);

      const detail = await runWithScope("all", () => service.getById("tenant-1", ROW.id));

      expect(detail.id).toBe(ROW.id);
      expect(detail.email).toBe(ROW.email);
    });

    it("returns 404 (not the row) when scope=branch resolves an id set that excludes the requested id", async () => {
      facultyRepository.listCallerBranchIds.mockResolvedValue(["branch-a"]);
      enrollmentScope.resolveStudentIdsForBranches.mockResolvedValue(["some-other-student"]);

      await expect(
        runWithScope("branch", () => service.getById("tenant-1", ROW.id)),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.findById).not.toHaveBeenCalled();
    });
  });

  describe("create", () => {
    it("rejects a duplicate email held by a live record, naming what holds it", async () => {
      repo.findUserByEmailWithOwner.mockResolvedValue({
        userId: "existing-user",
        deletedStudentProfileId: null,
        heldBy: "a faculty member",
      });

      const promise = runWithScope("all", () =>
        service.create("tenant-1", {
          name: "Dup",
          email: "asha@example.com",
          courseType: "btech",
          status: "active",
        }),
      );

      await expect(promise).rejects.toBeInstanceOf(ConflictException);
      await expect(promise).rejects.toMatchObject({
        response: {
          code: "students.email_in_use",
          detail: expect.stringContaining("a faculty member"),
        },
      });
      expect(repo.createStudentWithUser).not.toHaveBeenCalled();
    });

    it("restores (not rejects) when the email is only held by a soft-deleted student", async () => {
      repo.findUserByEmailWithOwner.mockResolvedValue({
        userId: "user-1",
        deletedStudentProfileId: "student-1",
        heldBy: "a deleted student record",
      });
      repo.findById.mockResolvedValue(ROW);

      const detail = await runWithScope("all", () =>
        service.create("tenant-1", {
          name: "Asha Returns",
          email: "asha@example.com",
          courseType: "btech",
          status: "active",
        }),
      );

      expect(repo.restore).toHaveBeenCalledWith("student-1");
      expect(repo.updateStudent).toHaveBeenCalledWith(
        "tenant-1",
        "student-1",
        "user-1",
        expect.objectContaining({ name: "Asha Returns", status: "active" }),
      );
      expect(repo.createStudentWithUser).not.toHaveBeenCalled();
      expect(detail.id).toBe(ROW.id);
    });

    it("rejects create with 403 for scope=own (not seeded/resolvable)", async () => {
      await expect(
        runWithScope("own", () =>
          service.create("tenant-1", {
            name: "Asha",
            email: "new@example.com",
            courseType: "btech",
            status: "active",
          }),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.createStudentWithUser).not.toHaveBeenCalled();
    });
  });

  describe("resendCredentials (gap-closing pass: CRM 'resend credentials' action)", () => {
    it("delegates to LmsAccountProvisioningService.resendCredentials and returns its result", async () => {
      lmsProvisioning.resendCredentials.mockResolvedValue({ email: "asha@example.com" });

      const result = await runWithScope("all", () => service.resendCredentials("tenant-1", ROW.id));

      expect(lmsProvisioning.resendCredentials).toHaveBeenCalledWith("tenant-1", ROW.id);
      expect(result).toEqual({ email: "asha@example.com" });
    });

    it("returns 404 (not 403) when the id is out of the caller's resolved scope — never calls the provisioning service", async () => {
      facultyRepository.listCallerBranchIds.mockResolvedValue(["branch-a"]);
      enrollmentScope.resolveStudentIdsForBranches.mockResolvedValue(["some-other-student"]);

      await expect(
        runWithScope("branch", () => service.resendCredentials("tenant-1", ROW.id)),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(lmsProvisioning.resendCredentials).not.toHaveBeenCalled();
    });

    it("returns 404 when LmsAccountProvisioningService.resendCredentials returns null (missing/out-of-tenant)", async () => {
      lmsProvisioning.resendCredentials.mockResolvedValue(null);

      await expect(
        runWithScope("all", () => service.resendCredentials("tenant-1", ROW.id)),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("rejects with 403 for scope=own (not seeded/resolvable) — never calls the provisioning service", async () => {
      await expect(
        runWithScope("own", () => service.resendCredentials("tenant-1", ROW.id)),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(lmsProvisioning.resendCredentials).not.toHaveBeenCalled();
    });
  });
});
