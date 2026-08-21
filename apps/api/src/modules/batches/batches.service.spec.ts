// apps/api/src/modules/batches/batches.service.spec.ts
//
// Unit tests for BatchesService scope-resolution + RBAC allow/deny, per CLAUDE.md §3 DoD
// rule 10. Batches is the module where "branch" AND "assigned" are BOTH fully resolvable
// (unlike students/courses/faculty in Wave 3a), these tests prove the positive paths for
// each, the fail-closed "own" rejection, and the 404-for-IDOR pattern.

import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { BatchesService } from "./batches.service";
import { BatchesRepository, type BatchRow } from "./batches.repository";
import { scopeContextStorage, type ScopeContext } from "../auth/lib/scope-context";

type Mocked<T> = { [K in keyof T]: T[K] extends (...args: never[]) => unknown ? jest.Mock : T[K] };

function mockRepository(): Mocked<BatchesRepository> {
  return {
    list: jest.fn(),
    findById: jest.fn(),
    listCallerBranchIds: jest.fn(),
    findOwnFacultyProfileId: jest.fn(),
    programExists: jest.fn(),
    branchExists: jest.fn(),
    facultyExists: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    assignFaculty: jest.fn(),
    softDelete: jest.fn(),
    restore: jest.fn(),
    countActiveEnrollments: jest.fn(),
    roster: jest.fn(),
  } as unknown as Mocked<BatchesRepository>;
}

const ROW: BatchRow = {
  id: "batch-1",
  programId: "program-1",
  programTitle: "Full Stack",
  branchId: "branch-hyderabad",
  branchName: "Hyderabad",
  facultyId: "faculty-1",
  facultyName: "Dr. Mehta",
  name: "FS-2026-A",
  startDate: new Date("2026-01-01T00:00:00Z"),
  endDate: null,
  capacity: 30,
  enrolledCount: 5,
  mode: "hybrid",
  schedule: [],
  status: "active",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  deletedAt: null,
};

function runWithScope<T>(scope: ScopeContext["scope"], actorId: string, fn: () => T): T {
  const ctx: ScopeContext = { permissionKey: "batches.view", scope, actorId, tenantId: "tenant-1" };
  return scopeContextStorage.run(ctx, fn);
}

describe("BatchesService", () => {
  let service: BatchesService;
  let repo: Mocked<BatchesRepository>;

  beforeEach(() => {
    repo = mockRepository();
    service = new BatchesService(repo as unknown as BatchesRepository);
  });

  describe("scope resolution, list", () => {
    it("allows scope=all with no extra restriction", async () => {
      repo.list.mockResolvedValue({ rows: [ROW], total: 1 });

      const result = await runWithScope("all", "actor-1", () =>
        service.list("tenant-1", "actor-1", { page: 1, pageSize: 20, includeDeleted: false }),
      );

      expect(result.items).toHaveLength(1);
      expect(repo.list).toHaveBeenCalledWith(
        expect.not.objectContaining({ restrictToBranchIds: expect.anything() }),
      );
    });

    it("resolves scope=branch by filtering to the caller's branch ids", async () => {
      repo.listCallerBranchIds.mockResolvedValue(["branch-hyderabad"]);
      repo.list.mockResolvedValue({ rows: [ROW], total: 1 });

      await runWithScope("branch", "manager-1", () =>
        service.list("tenant-1", "manager-1", { page: 1, pageSize: 20, includeDeleted: false }),
      );

      expect(repo.listCallerBranchIds).toHaveBeenCalledWith("manager-1");
      expect(repo.list).toHaveBeenCalledWith(
        expect.objectContaining({ restrictToBranchIds: ["branch-hyderabad"] }),
      );
    });

    it("resolves scope=assigned by filtering to the caller's faculty profile id", async () => {
      repo.findOwnFacultyProfileId.mockResolvedValue("faculty-1");
      repo.list.mockResolvedValue({ rows: [ROW], total: 1 });

      await runWithScope("assigned", "faculty-user-1", () =>
        service.list("tenant-1", "faculty-user-1", { page: 1, pageSize: 20, includeDeleted: false }),
      );

      expect(repo.list).toHaveBeenCalledWith(expect.objectContaining({ facultyId: "faculty-1" }));
    });

    it("fails closed for scope=assigned when caller has no faculty profile (never falls back to 'all')", async () => {
      repo.findOwnFacultyProfileId.mockResolvedValue(null);
      repo.list.mockResolvedValue({ rows: [], total: 0 });

      await runWithScope("assigned", "no-faculty-user", () =>
        service.list("tenant-1", "no-faculty-user", { page: 1, pageSize: 20, includeDeleted: false }),
      );

      expect(repo.list).toHaveBeenCalledWith(
        expect.objectContaining({ facultyId: "00000000-0000-0000-0000-000000000000" }),
      );
    });

    it("rejects scope=own with 403 (not seeded/resolvable for batches.* in P1)", async () => {
      await expect(
        runWithScope("own", "actor-1", () =>
          service.list("tenant-1", "actor-1", { page: 1, pageSize: 20, includeDeleted: false }),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.list).not.toHaveBeenCalled();
    });
  });

  describe("IDOR / object-level authz", () => {
    it("returns 404 when the row exists but is outside the caller's branch scope", async () => {
      repo.findById.mockResolvedValue(ROW);
      repo.listCallerBranchIds.mockResolvedValue(["branch-bengaluru"]);

      await expect(
        runWithScope("branch", "manager-1", () => service.getById("tenant-1", "manager-1", ROW.id)),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("returns the detail DTO when the row is within the caller's branch scope", async () => {
      repo.findById.mockResolvedValue(ROW);
      repo.listCallerBranchIds.mockResolvedValue(["branch-hyderabad"]);

      const detail = await runWithScope("branch", "manager-1", () =>
        service.getById("tenant-1", "manager-1", ROW.id),
      );

      expect(detail.id).toBe(ROW.id);
    });

    it("returns 404 when the row exists but is assigned to a different faculty", async () => {
      repo.findById.mockResolvedValue(ROW);
      repo.findOwnFacultyProfileId.mockResolvedValue("faculty-2");

      await expect(
        runWithScope("assigned", "other-faculty-user", () =>
          service.getById("tenant-1", "other-faculty-user", ROW.id),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("returns 404 when the id does not exist in the tenant at all", async () => {
      repo.findById.mockResolvedValue(null);

      await expect(
        runWithScope("all", "actor-1", () => service.getById("tenant-1", "actor-1", "missing-id")),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("create, branch-scoped creators restricted to their own branch", () => {
    it("rejects creating a batch in a branch the caller does not manage", async () => {
      repo.listCallerBranchIds.mockResolvedValue(["branch-hyderabad"]);

      await expect(
        runWithScope("branch", "manager-1", () =>
          service.create("tenant-1", "manager-1", {
            programId: "program-1",
            branchId: "branch-pune",
            name: "FS-2026-B",
            startDate: "2026-02-01",
            capacity: 30,
            mode: "hybrid",
            schedule: [],
            status: "planned",
          }),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it("rejects scope=assigned from creating batches entirely", async () => {
      await expect(
        runWithScope("assigned", "faculty-user-1", () =>
          service.create("tenant-1", "faculty-user-1", {
            programId: "program-1",
            branchId: "branch-hyderabad",
            name: "FS-2026-B",
            startDate: "2026-02-01",
            capacity: 30,
            mode: "hybrid",
            schedule: [],
            status: "planned",
          }),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it("creates within the caller's own branch when scope=branch", async () => {
      repo.listCallerBranchIds.mockResolvedValue(["branch-hyderabad"]);
      repo.programExists.mockResolvedValue(true);
      repo.branchExists.mockResolvedValue(true);
      repo.create.mockResolvedValue({ id: "batch-new" });
      repo.findById.mockResolvedValue({ ...ROW, id: "batch-new" });

      const result = await runWithScope("branch", "manager-1", () =>
        service.create("tenant-1", "manager-1", {
          programId: "program-1",
          branchId: "branch-hyderabad",
          name: "FS-2026-B",
          startDate: "2026-02-01",
          capacity: 30,
          mode: "hybrid",
          schedule: [],
          status: "planned",
        }),
      );

      expect(result.id).toBe("batch-new");
      expect(repo.create).toHaveBeenCalled();
    });
  });

  describe("assignFaculty, cross-branch mismatch guard", () => {
    it("rejects assigning a faculty member from a different branch", async () => {
      repo.findById.mockResolvedValue(ROW);
      repo.facultyExists.mockResolvedValue({ id: "faculty-2", branchId: "branch-bengaluru" });

      await expect(
        runWithScope("all", "admin-1", () =>
          service.assignFaculty("tenant-1", "admin-1", ROW.id, { facultyId: "faculty-2" }),
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(repo.assignFaculty).not.toHaveBeenCalled();
    });

    it("allows assigning a faculty member from the same branch", async () => {
      repo.findById.mockResolvedValueOnce(ROW).mockResolvedValueOnce(ROW);
      repo.facultyExists.mockResolvedValue({ id: "faculty-2", branchId: "branch-hyderabad" });

      await runWithScope("all", "admin-1", () =>
        service.assignFaculty("tenant-1", "admin-1", ROW.id, { facultyId: "faculty-2" }),
      );

      expect(repo.assignFaculty).toHaveBeenCalledWith(ROW.id, "faculty-2");
    });
  });
});
