// apps/api/src/modules/mentors/mentors.service.spec.ts
//
// Unit tests for MentorsService (WS-1 mentor hiring-record CRUD, docs/specs/
// phase-8-mentor.md). Covers: scope resolution (all/branch = no restriction since
// `mentors` has no branch_id column; assigned/own fail closed), AC-3 JOINED_DATE_REQUIRED,
// AC-12 soft-delete blocked by active assignments (with the batchName errors[] shape),
// AC-13 cross-tenant IDOR -> 404.

import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { MentorsService } from "./mentors.service";
import { MentorsRepository, type MentorRow } from "./mentors.repository";
import { scopeContextStorage, type ScopeContext } from "../auth/lib/scope-context";

type Mocked<T> = { [K in keyof T]: T[K] extends (...args: never[]) => unknown ? jest.Mock : T[K] };

function mockRepository(): Mocked<MentorsRepository> {
  return {
    list: jest.fn(),
    findById: jest.fn(),
    listActiveAssignedBatches: jest.fn().mockResolvedValue([]),
    listBlockingAssignments: jest.fn().mockResolvedValue([]),
    findActiveAssignmentCandidate: jest.fn(),
    findOwnProfile: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    softDelete: jest.fn(),
    restore: jest.fn(),
  } as unknown as Mocked<MentorsRepository>;
}

const ROW: MentorRow = {
  id: "mentor-1",
  tenantId: "tenant-1",
  userId: null,
  fullName: "Dr. Ramesh Kulkarni",
  email: "ramesh@example.test",
  phone: null,
  externalInstitute: "IIT Hyderabad",
  expertise: ["System Design"],
  engagementStatus: "active",
  joinedAt: new Date("2026-01-05T00:00:00Z"),
  notes: null,
  photoKey: null,
  title: null,
  bio: null,
  yearsExperience: null,
  socialLinks: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  deletedAt: null,
  assignedBatchCount: 0,
};

/** Minimal StorageProvider stub — only getSignedUploadUrl is exercised (photo-upload-url). */
function mockStorage() {
  return {
    getSignedUploadUrl: jest.fn().mockResolvedValue({
      storageKey: "mentor_photos/tenant-1/uuid-photo.jpg",
      url: "https://signed.example/put",
      expiresAt: new Date("2026-01-01T00:15:00Z"),
      requiredHeaders: { "Content-Type": "image/jpeg" },
    }),
    getSignedDownloadUrl: jest.fn(),
  } as unknown as import("../storage/providers/storage/storage-provider.interface").StorageProvider;
}

function runWithScope<T>(scope: ScopeContext["scope"], actorId: string, fn: () => T): T {
  const ctx: ScopeContext = { permissionKey: "mentors.view", scope, actorId, tenantId: "tenant-1" };
  return scopeContextStorage.run(ctx, fn);
}

describe("MentorsService", () => {
  let service: MentorsService;
  let repo: Mocked<MentorsRepository>;

  beforeEach(() => {
    repo = mockRepository();
    service = new MentorsService(repo as unknown as MentorsRepository, mockStorage());
  });

  describe("scope resolution", () => {
    it("allows scope=all (no branch_id column -> no restriction)", async () => {
      repo.list.mockResolvedValue({ rows: [ROW], total: 1 });

      const result = await runWithScope("all", "actor-1", () =>
        service.list("tenant-1", { page: 1, pageSize: 20, includeDeleted: false }),
      );

      expect(result.items).toHaveLength(1);
    });

    it("allows scope=branch (flagged gap: also no restriction — mentors has no branch_id)", async () => {
      repo.list.mockResolvedValue({ rows: [ROW], total: 1 });

      const result = await runWithScope("branch", "manager-1", () =>
        service.list("tenant-1", { page: 1, pageSize: 20, includeDeleted: false }),
      );

      expect(result.items).toHaveLength(1);
    });

    it("fails closed (403) for scope=assigned — never seeded for mentors.* per Rule M-3", async () => {
      await expect(
        runWithScope("assigned", "mentor-user-1", () =>
          service.list("tenant-1", { page: 1, pageSize: 20, includeDeleted: false }),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("fails closed (403) for scope=own", async () => {
      await expect(
        runWithScope("own", "user-1", () => service.getById("tenant-1", "mentor-1")),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe("AC-8 empty filter result", () => {
    it("returns 200 with an empty array, never throws, for a zero-match filter", async () => {
      repo.list.mockResolvedValue({ rows: [], total: 0 });

      const result = await runWithScope("all", "actor-1", () =>
        service.list("tenant-1", { page: 1, pageSize: 20, includeDeleted: false, engagementStatus: "inactive" }),
      );

      expect(result.items).toEqual([]);
    });
  });

  describe("AC-3: engagementStatus='active' requires a joinedAt", () => {
    it("create: rejects active with no joinedAt (422 JOINED_DATE_REQUIRED)", async () => {
      await expect(
        runWithScope("all", "actor-1", () =>
          service.create("tenant-1", {
            fullName: "New Mentor",
            email: "new@example.test",
            externalInstitute: "XYZ",
            expertise: [],
            engagementStatus: "active",
          }),
        ),
      ).rejects.toMatchObject({ response: { code: "JOINED_DATE_REQUIRED" } });
      expect(repo.create).not.toHaveBeenCalled();
    });

    it("create: allows prospective with no joinedAt", async () => {
      repo.create.mockResolvedValue({ id: "mentor-2" });
      repo.findById.mockResolvedValue({ ...ROW, id: "mentor-2", engagementStatus: "prospective", joinedAt: null });

      const result = await runWithScope("all", "actor-1", () =>
        service.create("tenant-1", {
          fullName: "New Mentor",
          email: "new@example.test",
          externalInstitute: "XYZ",
          expertise: [],
          engagementStatus: "prospective",
        }),
      );

      expect(result.id).toBe("mentor-2");
      expect(repo.create).toHaveBeenCalled();
    });

    it("create: allows active WITH a joinedAt", async () => {
      repo.create.mockResolvedValue({ id: "mentor-3" });
      repo.findById.mockResolvedValue({ ...ROW, id: "mentor-3" });

      const result = await runWithScope("all", "actor-1", () =>
        service.create("tenant-1", {
          fullName: "New Mentor",
          email: "new@example.test",
          externalInstitute: "XYZ",
          expertise: [],
          engagementStatus: "active",
          joinedAt: "2026-01-05",
        }),
      );

      expect(result.id).toBe("mentor-3");
    });

    it("update: rejects flipping to active with no existing/new joinedAt", async () => {
      repo.findById.mockResolvedValue({ ...ROW, engagementStatus: "prospective", joinedAt: null });

      await expect(
        runWithScope("all", "actor-1", () =>
          service.update("tenant-1", "mentor-1", { engagementStatus: "active" }),
        ),
      ).rejects.toMatchObject({ response: { code: "JOINED_DATE_REQUIRED" } });
      expect(repo.update).not.toHaveBeenCalled();
    });

    it("update: allows flipping to active when the EXISTING row already has a joinedAt", async () => {
      repo.findById.mockResolvedValue(ROW); // already active + joinedAt set
      repo.listActiveAssignedBatches.mockResolvedValue([]);

      await runWithScope("all", "actor-1", () => service.update("tenant-1", "mentor-1", { notes: "updated" }));

      expect(repo.update).toHaveBeenCalledWith("mentor-1", { notes: "updated" });
    });
  });

  describe("AC-9: partial update only changes supplied fields", () => {
    it("PATCH with only {notes} does not touch expertise/fullName/etc.", async () => {
      repo.findById.mockResolvedValue(ROW);

      await runWithScope("all", "actor-1", () => service.update("tenant-1", "mentor-1", { notes: "New note" }));

      expect(repo.update).toHaveBeenCalledWith("mentor-1", { notes: "New note" });
    });
  });

  describe("AC-12: soft-delete blocked by active batch assignments", () => {
    it("returns 409 MENTOR_HAS_ACTIVE_ASSIGNMENTS with batch names in errors[]", async () => {
      repo.findById.mockResolvedValue(ROW);
      repo.listBlockingAssignments.mockResolvedValue([
        { batchMentorId: "bm-1", batchName: "Full-Stack HYD-01" },
        { batchMentorId: "bm-2", batchName: "Data Science BLR-02" },
      ]);

      await expect(
        runWithScope("all", "actor-1", () => service.softDelete("tenant-1", "mentor-1")),
      ).rejects.toMatchObject({
        response: {
          code: "MENTOR_HAS_ACTIVE_ASSIGNMENTS",
          errors: [
            { path: "batchMentorId", message: "Full-Stack HYD-01" },
            { path: "batchMentorId", message: "Data Science BLR-02" },
          ],
        },
      });
      expect(repo.softDelete).not.toHaveBeenCalled();
    });

    it("succeeds when there are zero active assignments", async () => {
      repo.findById.mockResolvedValueOnce(ROW).mockResolvedValueOnce({ ...ROW, deletedAt: new Date() });
      repo.listBlockingAssignments.mockResolvedValue([]);

      const result = await runWithScope("all", "actor-1", () => service.softDelete("tenant-1", "mentor-1"));

      expect(repo.softDelete).toHaveBeenCalledWith("mentor-1");
      expect(result.deletedAt).not.toBeNull();
    });
  });

  describe("AC-13: cross-tenant IDOR", () => {
    it("getById returns 404 (not 403/leak) when the row is not found for this tenant", async () => {
      repo.findById.mockResolvedValue(null);

      await expect(
        runWithScope("all", "tenant-b-admin", () => service.getById("tenant-b", "mentor-in-tenant-a")),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("softDelete returns 404 for a cross-tenant id", async () => {
      repo.findById.mockResolvedValue(null);

      await expect(
        runWithScope("all", "tenant-b-admin", () => service.softDelete("tenant-b", "mentor-in-tenant-a")),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
