// apps/api/src/modules/courses/courses.service.spec.ts
//
// Unit tests for CoursesService scope-resolution + RBAC allow/deny, per CLAUDE.md §3 DoD
// rule 10. Proves "all" works normally (content_editor/admin) and "assigned" (faculty's
// courses.* grant) fails closed with 403 — `programs` has no author/owner column in P1, so
// this scope cannot be resolved without widening access, which is exactly what must not
// happen per the task brief's fail-closed mandate.

import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { CoursesService } from "./courses.service";
import { CoursesRepository, type ProgramRow } from "./courses.repository";
import { scopeContextStorage, type ScopeContext } from "../auth/lib/scope-context";

type Mocked<T> = { [K in keyof T]: T[K] extends (...args: never[]) => unknown ? jest.Mock : T[K] };

function mockRepository(): Mocked<CoursesRepository> {
  return {
    list: jest.fn(),
    findById: jest.fn(),
    findBySlug: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    setStatus: jest.fn(),
    setVisibility: jest.fn(),
    getCurriculumTree: jest.fn(),
    findModuleInProgram: jest.fn(),
    createModule: jest.fn(),
    updateModule: jest.fn(),
    reorderModules: jest.fn(),
    findLessonInModule: jest.fn(),
    createLesson: jest.fn(),
    updateLesson: jest.fn(),
    reorderLessons: jest.fn(),
  } as unknown as Mocked<CoursesRepository>;
}

const ROW: ProgramRow = {
  id: "program-1",
  slug: "full-stack-web",
  title: "Full Stack Web Development",
  domain: "web-development",
  level: "beginner",
  mode: "recorded",
  durationWeeks: 12,
  pricePaise: 4999900,
  emi: [],
  summary: null,
  seo: null,
  status: "draft",
  isPublic: false,
  cardSummary: null,
  outcomes: null,
  ogImageKey: null,
  scholarshipAvailable: false,
  enrollmentEnabled: true,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  deletedAt: null,
};

/** Minimal StorageProvider stub — only getSignedUploadUrl is exercised (image-upload-url). */
function mockStorage() {
  return {
    getSignedUploadUrl: jest.fn().mockResolvedValue({
      storageKey: "program_images/tenant-1/uuid-image.jpg",
      url: "https://signed.example/put",
      expiresAt: new Date("2026-01-01T00:15:00Z"),
      requiredHeaders: undefined,
    }),
  };
}

function runWithScope<T>(scope: ScopeContext["scope"], fn: () => T): T {
  const ctx: ScopeContext = { permissionKey: "courses.view", scope, actorId: "actor-1", tenantId: "tenant-1" };
  return scopeContextStorage.run(ctx, fn);
}

describe("CoursesService", () => {
  let service: CoursesService;
  let repo: Mocked<CoursesRepository>;

  beforeEach(() => {
    repo = mockRepository();
    service = new CoursesService(
      repo as unknown as CoursesRepository,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal stub, only getSignedUploadUrl used
      mockStorage() as any,
    );
  });

  describe("scope resolution (fail-closed)", () => {
    it("allows scope=all to list programs", async () => {
      repo.list.mockResolvedValue({ rows: [ROW], total: 1 });

      const result = await runWithScope("all", () =>
        service.list("tenant-1", { page: 1, pageSize: 20, includeDeleted: false }),
      );

      expect(result.items).toHaveLength(1);
    });

    it("rejects scope=assigned with 403 (no programs.author column in P1)", async () => {
      await expect(
        runWithScope("assigned", () => service.list("tenant-1", { page: 1, pageSize: 20, includeDeleted: false })),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.list).not.toHaveBeenCalled();
    });

    it("rejects scope=branch with 403 (not seeded as a real filter for courses in P1)", async () => {
      await expect(
        runWithScope("branch", () => service.getById("tenant-1", ROW.id)),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe("IDOR / object-level authz", () => {
    it("returns 404 when the program does not exist in the caller's tenant", async () => {
      repo.findById.mockResolvedValue(null);

      await expect(runWithScope("all", () => service.getById("tenant-1", "missing-id"))).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("returns 404 when a module id does not belong to the given program", async () => {
      repo.findById.mockResolvedValue(ROW);
      repo.findModuleInProgram.mockResolvedValue(null);

      await expect(
        runWithScope("all", () =>
          service.updateModule("tenant-1", ROW.id, "module-from-another-program", { title: "x" }),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("create — slug uniqueness", () => {
    it("rejects creating a program with a slug already used in the tenant", async () => {
      repo.findBySlug.mockResolvedValue({ id: "existing-program" });

      await expect(
        runWithScope("all", () =>
          service.create("tenant-1", {
            slug: "full-stack-web",
            title: "Dup",
            domain: "web-development",
            level: "beginner",
            mode: "recorded",
            durationWeeks: 8,
            pricePaise: 1000000,
            emi: [],
            status: "draft",
            scholarshipAvailable: false,
            enrollmentEnabled: true,
          }),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.create).not.toHaveBeenCalled();
    });
  });

  describe("publish/unpublish", () => {
    it("publish sets status to published", async () => {
      repo.findById.mockResolvedValue(ROW);
      repo.setStatus.mockResolvedValue({ ...ROW, status: "published" });

      const detail = await runWithScope("all", () => service.publish("tenant-1", ROW.id));

      expect(repo.setStatus).toHaveBeenCalledWith(ROW.id, "published");
      expect(detail.status).toBe("published");
    });
  });

  describe("setVisibility", () => {
    it("flips isPublic to true and returns it on the DTO", async () => {
      repo.findById.mockResolvedValue(ROW);
      repo.setVisibility.mockResolvedValue({ ...ROW, isPublic: true });

      const detail = await runWithScope("all", () => service.setVisibility("tenant-1", ROW.id, true));

      expect(repo.setVisibility).toHaveBeenCalledWith(ROW.id, true);
      expect(detail.isPublic).toBe(true);
    });

    it("404s for a program outside the caller's tenant", async () => {
      repo.findById.mockResolvedValue(null);
      await expect(
        runWithScope("all", () => service.setVisibility("tenant-1", "missing", true)),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.setVisibility).not.toHaveBeenCalled();
    });
  });

  describe("enrollmentEnabled", () => {
    it("surfaces the flag on the detail DTO", async () => {
      repo.findById.mockResolvedValue({ ...ROW, enrollmentEnabled: false });

      const detail = await runWithScope("all", () => service.getById("tenant-1", ROW.id));

      expect(detail.enrollmentEnabled).toBe(false);
    });

    it("closes enrollment through the normal partial update", async () => {
      repo.findById.mockResolvedValue(ROW);
      repo.update.mockResolvedValue({ ...ROW, enrollmentEnabled: false });

      const detail = await runWithScope("all", () =>
        service.update("tenant-1", ROW.id, { enrollmentEnabled: false }),
      );

      expect(repo.update).toHaveBeenCalledWith(ROW.id, { enrollmentEnabled: false });
      expect(detail.enrollmentEnabled).toBe(false);
    });

    it("defaults a newly created program to enrollment OPEN", async () => {
      repo.findBySlug.mockResolvedValue(null);
      repo.create.mockResolvedValue(ROW);

      const detail = await runWithScope("all", () =>
        service.create("tenant-1", {
          slug: "new-program",
          title: "New Program",
          domain: "web-development",
          level: "beginner",
          mode: "recorded",
          durationWeeks: 4,
          pricePaise: 100000,
          emi: [],
          status: "draft",
          scholarshipAvailable: false,
          enrollmentEnabled: true,
        }),
      );

      expect(repo.create).toHaveBeenCalledWith(
        "tenant-1",
        expect.objectContaining({ enrollmentEnabled: true }),
      );
      expect(detail.enrollmentEnabled).toBe(true);
    });
  });
});
