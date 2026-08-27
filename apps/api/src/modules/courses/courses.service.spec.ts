// apps/api/src/modules/courses/courses.service.spec.ts
//
// Unit tests for CoursesService scope-resolution + RBAC allow/deny, per CLAUDE.md §3 DoD
// rule 10. Proves "all" works normally (content_editor/admin) and "assigned" (faculty's
// courses.* grant) fails closed with 403, `programs` has no author/owner column in P1, so
// this scope cannot be resolved without widening access, which is exactly what must not
// happen per the task brief's fail-closed mandate.

import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { CoursesService } from "./courses.service";
import { CoursesRepository, type ProgramRow } from "./courses.repository";
import { scopeContextStorage, type ScopeContext } from "../auth/lib/scope-context";
import { LmsProgressService } from "../lms/lms-progress.service";

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
    findMaxOrder: jest.fn().mockResolvedValue(-1),
    findManyByIds: jest.fn(),
    reorderPrograms: jest.fn(),
    findLessonInModule: jest.fn(),
    createLesson: jest.fn(),
    updateLesson: jest.fn(),
    softDeleteModule: jest.fn(),
    softDeleteLesson: jest.fn(),
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
  compareAtPricePaise: null,
  emi: [],
  summary: null,
  seo: null,
  status: "draft",
  isPublic: false,
  cardSummary: null,
  outcomes: null,
  ogImageKey: null,
  brochureKey: null,
  scholarshipAvailable: false,
  enrollmentEnabled: true,
  enrollmentPaymentUrl: null,
  order: 0,
  badgeColor: null,
  badgeLabel: null,
  badgeEnabled: false,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  deletedAt: null,
};

/** Minimal StorageProvider stub, only getSignedUploadUrl is exercised (image-upload-url). */
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

function mockProgress(): LmsProgressService {
  return {
    resyncProgramProgress: jest.fn().mockResolvedValue({ scanned: 0, updated: 0, reopened: 0 }),
  } as unknown as LmsProgressService;
}

function runWithScope<T>(scope: ScopeContext["scope"], fn: () => T): T {
  const ctx: ScopeContext = { permissionKey: "courses.view", scope, actorId: "actor-1", tenantId: "tenant-1" };
  return scopeContextStorage.run(ctx, fn);
}

describe("CoursesService", () => {
  let service: CoursesService;
  let repo: Mocked<CoursesRepository>;
  let progress: LmsProgressService;

  beforeEach(() => {
    repo = mockRepository();
    service = new CoursesService(
      repo as unknown as CoursesRepository,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal stub, only getSignedUploadUrl used
      mockStorage() as any,
      // Curriculum edits resync enrolled students' progress; these tests assert routing and
      // scope, not the sweep, so it is a no-op that records nothing.
      (progress = mockProgress()),
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

  describe("course brochure (PDF)", () => {
    /** Own storage stub so the minted key/TTL can be asserted, not just the response. */
    function serviceWithStorage() {
      const storage = {
        getSignedUploadUrl: jest.fn().mockResolvedValue({
          storageKey: "program_brochures/tenant-1/uuid-syllabus.pdf",
          url: "https://signed.example/put",
          expiresAt: new Date("2026-01-01T00:15:00Z"),
          requiredHeaders: undefined,
        }),
      };
      const svc = new CoursesService(
        repo as unknown as CoursesRepository,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal stub, only getSignedUploadUrl used
        storage as any,
        mockProgress(),
      );
      return { svc, storage };
    }

    it("mints the signed PUT under the program_brochures namespace, tenant-scoped", async () => {
      const { svc, storage } = serviceWithStorage();

      const result = await runWithScope("all", () =>
        svc.getBrochureUploadUrl("tenant-1", {
          contentType: "application/pdf",
          fileName: "syllabus.pdf",
          sizeBytes: 1024,
        }),
      );

      expect(storage.getSignedUploadUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          key: expect.stringMatching(/^program_brochures\/tenant-1\//),
          contentType: "application/pdf",
          maxBytes: 1024,
        }),
      );
      // The response carries the opaque key + presigned URL only, never the bucket URL.
      expect(result.storageKey).toBe("program_brochures/tenant-1/uuid-syllabus.pdf");
      expect(result.uploadUrl).toBe("https://signed.example/put");
    });

    it("rejects an unresolvable scope before touching storage (fail-closed)", async () => {
      const { svc, storage } = serviceWithStorage();

      await expect(
        runWithScope("assigned", () =>
          svc.getBrochureUploadUrl("tenant-1", {
            contentType: "application/pdf",
            fileName: "syllabus.pdf",
            sizeBytes: 1024,
          }),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(storage.getSignedUploadUrl).not.toHaveBeenCalled();
    });

    it("returns brochureUrl (minted) and never the raw brochureKey on the detail DTO", async () => {
      repo.findById.mockResolvedValue({ ...ROW, brochureKey: "program_brochures/tenant-1/uuid-syllabus.pdf" });

      const detail = await runWithScope("all", () => service.getById("tenant-1", ROW.id));

      expect(detail.brochureUrl).toContain("program_brochures/tenant-1/uuid-syllabus.pdf");
      expect(detail).not.toHaveProperty("brochureKey");
    });

    it("returns a null brochureUrl when no brochure has been uploaded", async () => {
      repo.findById.mockResolvedValue(ROW);

      const detail = await runWithScope("all", () => service.getById("tenant-1", ROW.id));

      expect(detail.brochureUrl).toBeNull();
    });
  });

  describe("create, slug uniqueness", () => {
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
            enrollmentPaymentUrl: null,
            badgeEnabled: false,
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

  describe("curriculum delete + lesson detail", () => {
    const MODULE = { id: "module-1", programId: ROW.id, title: "Week 1", order: 0 };
    const LESSON = {
      id: "lesson-1",
      moduleId: MODULE.id,
      title: "Semantic HTML",
      type: "reading",
      order: 0,
      isPreview: false,
      content: "<p>Hello</p>",
    };

    it("getLesson returns the body the tree deliberately omits", async () => {
      repo.findLessonInModule.mockResolvedValue(LESSON);

      const detail = await runWithScope("all", () => service.getLesson("tenant-1", ROW.id, MODULE.id, LESSON.id));

      expect(detail.content).toBe("<p>Hello</p>");
      expect(detail.type).toBe("reading");
    });

    it("deleteLesson soft-deletes and resyncs enrolled progress", async () => {
      repo.findLessonInModule.mockResolvedValue(LESSON);
      repo.softDeleteLesson.mockResolvedValue(undefined);

      await runWithScope("all", () => service.deleteLesson("tenant-1", ROW.id, MODULE.id, LESSON.id));

      expect(repo.softDeleteLesson).toHaveBeenCalledWith(LESSON.id);
      expect(progress.resyncProgramProgress).toHaveBeenCalledWith(ROW.id);
    });

    // IDOR: the tenant/program/module join is the authorisation; a miss is a 404, not a delete.
    it("deleteLesson 404s (and deletes nothing) when the lesson is not in this module", async () => {
      repo.findLessonInModule.mockResolvedValue(null);

      await expect(
        runWithScope("all", () => service.deleteLesson("tenant-1", ROW.id, MODULE.id, "other-lesson")),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.softDeleteLesson).not.toHaveBeenCalled();
    });

    it("deleteModule soft-deletes the module (with its lessons) and resyncs progress", async () => {
      repo.findModuleInProgram.mockResolvedValue(MODULE);
      repo.softDeleteModule.mockResolvedValue(undefined);

      await runWithScope("all", () => service.deleteModule("tenant-1", ROW.id, MODULE.id));

      expect(repo.softDeleteModule).toHaveBeenCalledWith(MODULE.id);
      expect(progress.resyncProgramProgress).toHaveBeenCalledWith(ROW.id);
    });

    it("deleteModule 404s when the module is not in this program", async () => {
      repo.findModuleInProgram.mockResolvedValue(null);

      await expect(
        runWithScope("all", () => service.deleteModule("tenant-1", ROW.id, "other-module")),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.softDeleteModule).not.toHaveBeenCalled();
    });
  });

  describe("enrollmentPaymentUrl", () => {
    const LINK = "https://rzp.io/l/neurology-workshop";

    it("surfaces the stored link on the detail DTO", async () => {
      repo.findById.mockResolvedValue({ ...ROW, enrollmentPaymentUrl: LINK });

      const detail = await runWithScope("all", () => service.getById("tenant-1", ROW.id));

      expect(detail.enrollmentPaymentUrl).toBe(LINK);
    });

    it("stores the link through the normal partial update", async () => {
      repo.findById.mockResolvedValue(ROW);
      repo.update.mockResolvedValue({ ...ROW, enrollmentPaymentUrl: LINK });

      const detail = await runWithScope("all", () =>
        service.update("tenant-1", ROW.id, { enrollmentPaymentUrl: LINK }),
      );

      expect(repo.update).toHaveBeenCalledWith(ROW.id, { enrollmentPaymentUrl: LINK });
      expect(detail.enrollmentPaymentUrl).toBe(LINK);
    });

    // null is the "back to the in-app checkout" instruction, so it has to reach the
    // repository as null rather than being dropped as a missing field.
    it("clears the link when null is sent", async () => {
      repo.findById.mockResolvedValue({ ...ROW, enrollmentPaymentUrl: LINK });
      repo.update.mockResolvedValue({ ...ROW, enrollmentPaymentUrl: null });

      const detail = await runWithScope("all", () =>
        service.update("tenant-1", ROW.id, { enrollmentPaymentUrl: null }),
      );

      expect(repo.update).toHaveBeenCalledWith(ROW.id, { enrollmentPaymentUrl: null });
      expect(detail.enrollmentPaymentUrl).toBeNull();
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
          enrollmentPaymentUrl: null,
          badgeEnabled: false,
        }),
      );

      expect(repo.create).toHaveBeenCalledWith(
        "tenant-1",
        expect.objectContaining({ enrollmentEnabled: true }),
      );
      expect(detail.enrollmentEnabled).toBe(true);
    });
  });

  // A compare-at price is a public claim about a saving. If it is not strictly above the
  // charged price the claim is false (equal → "₹X ₹X"; below → a saving that runs
  // backwards), so it is rejected at write time rather than filtered at render time.
  describe("compareAtPricePaise validation", () => {
    const baseCreate = {
      slug: "new-program",
      title: "New Program",
      domain: "web-development",
      level: "beginner" as const,
      mode: "recorded" as const,
      durationWeeks: 4,
      pricePaise: 699900,
      emi: [],
      status: "draft" as const,
      scholarshipAvailable: false,
      enrollmentEnabled: true,
      enrollmentPaymentUrl: null,
      badgeEnabled: false,
    };

    it("accepts a compare-at price strictly above the price", async () => {
      repo.findBySlug.mockResolvedValue(null);
      repo.create.mockResolvedValue(ROW);

      await runWithScope("all", () =>
        service.create("tenant-1", { ...baseCreate, compareAtPricePaise: 1499900 }),
      );

      expect(repo.create).toHaveBeenCalledWith(
        "tenant-1",
        expect.objectContaining({ compareAtPricePaise: 1499900 }),
      );
    });

    it("rejects a compare-at price equal to the price", async () => {
      repo.findBySlug.mockResolvedValue(null);

      await expect(
        runWithScope("all", () =>
          service.create("tenant-1", { ...baseCreate, compareAtPricePaise: 699900 }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it("rejects a compare-at price below the price", async () => {
      repo.findBySlug.mockResolvedValue(null);

      await expect(
        runWithScope("all", () =>
          service.create("tenant-1", { ...baseCreate, compareAtPricePaise: 100000 }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it("treats a null compare-at as valid (single price, no strike)", async () => {
      repo.findBySlug.mockResolvedValue(null);
      repo.create.mockResolvedValue(ROW);

      await runWithScope("all", () =>
        service.create("tenant-1", { ...baseCreate, compareAtPricePaise: null }),
      );

      expect(repo.create).toHaveBeenCalledWith(
        "tenant-1",
        expect.objectContaining({ compareAtPricePaise: null }),
      );
    });

    // The cross-field check can't live in zod: a PATCH may carry only one of the two, so
    // the missing half has to be read back off the stored row.
    it("on update, compares a new compare-at against the STORED price", async () => {
      repo.findById.mockResolvedValue({ ...ROW, pricePaise: 699900, compareAtPricePaise: null });

      await expect(
        runWithScope("all", () =>
          service.update("tenant-1", "program-1", { compareAtPricePaise: 500000 }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it("on update, compares a new price against the STORED compare-at", async () => {
      repo.findById.mockResolvedValue({ ...ROW, pricePaise: 699900, compareAtPricePaise: 1499900 });

      await expect(
        runWithScope("all", () => service.update("tenant-1", "program-1", { pricePaise: 1600000 })),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.update).not.toHaveBeenCalled();
    });
  });

  // `order` is server-owned: it is absent from the create/update contracts entirely, so
  // the only ways it moves are "appended on create" and "rewritten by reorder".
  describe("program order", () => {
    const baseCreate = {
      slug: "ordered-program",
      title: "Ordered Program",
      domain: "web-development",
      level: "beginner" as const,
      mode: "recorded" as const,
      durationWeeks: 4,
      pricePaise: 100000,
      emi: [],
      status: "draft" as const,
      scholarshipAvailable: false,
      enrollmentEnabled: true,
      enrollmentPaymentUrl: null,
      badgeEnabled: false,
    };

    it("appends a new program after the tenant's current highest order", async () => {
      repo.findBySlug.mockResolvedValue(null);
      repo.findMaxOrder.mockResolvedValue(4);
      repo.create.mockResolvedValue(ROW);

      await runWithScope("all", () => service.create("tenant-1", baseCreate));

      expect(repo.create).toHaveBeenCalledWith("tenant-1", expect.objectContaining({ order: 5 }));
    });

    it("gives the tenant's first program order 0", async () => {
      repo.findBySlug.mockResolvedValue(null);
      repo.findMaxOrder.mockResolvedValue(-1);
      repo.create.mockResolvedValue(ROW);

      await runWithScope("all", () => service.create("tenant-1", baseCreate));

      expect(repo.create).toHaveBeenCalledWith("tenant-1", expect.objectContaining({ order: 0 }));
    });

    it("derives order from array position, ignoring any client-supplied numbering", async () => {
      repo.findManyByIds.mockResolvedValue([{ id: "p-a" }, { id: "p-b" }, { id: "p-c" }]);

      await runWithScope("all", () =>
        service.reorderPrograms("tenant-1", { programIds: ["p-c", "p-a", "p-b"] }),
      );

      expect(repo.reorderPrograms).toHaveBeenCalledWith(["p-c", "p-a", "p-b"]);
    });

    // Tenant isolation: without this check a caller could splice a foreign program id into
    // the array and have its `order` silently rewritten.
    it("rejects the whole reorder when any id belongs to another tenant", async () => {
      repo.findManyByIds.mockResolvedValue([{ id: "p-a" }]);

      await expect(
        runWithScope("all", () =>
          service.reorderPrograms("tenant-1", { programIds: ["p-a", "other-tenant-program"] }),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.reorderPrograms).not.toHaveBeenCalled();
    });
  });

  // A badge that is switched on but not configured would render an empty chip on a live
  // course card, so the incomplete states are refused at write time.
  describe("badge validation", () => {
    it("rejects enabling a badge when no colour has ever been set", async () => {
      repo.findById.mockResolvedValue({ ...ROW, badgeColor: null, badgeLabel: "Hot" });

      await expect(
        runWithScope("all", () => service.update("tenant-1", "program-1", { badgeEnabled: true })),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it("rejects a badge with a colour but no text", async () => {
      repo.findById.mockResolvedValue(ROW);

      await expect(
        runWithScope("all", () =>
          service.update("tenant-1", "program-1", {
            badgeColor: "#DC2626",
            badgeLabel: null,
            badgeEnabled: true,
          }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.update).not.toHaveBeenCalled();
    });

    // Whitespace is not text, a blank chip is the same defect as a missing label.
    it("rejects a whitespace-only badge label", async () => {
      repo.findById.mockResolvedValue(ROW);

      await expect(
        runWithScope("all", () =>
          service.update("tenant-1", "program-1", {
            badgeColor: "#DC2626",
            badgeLabel: "   ",
            badgeEnabled: true,
          }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it("accepts enabling a fully configured badge", async () => {
      repo.findById.mockResolvedValue(ROW);
      repo.update.mockResolvedValue({
        ...ROW,
        badgeColor: "#DC2626",
        badgeLabel: "Hot",
        badgeEnabled: true,
      });

      const detail = await runWithScope("all", () =>
        service.update("tenant-1", "program-1", {
          badgeColor: "#DC2626",
          badgeLabel: "Hot",
          badgeEnabled: true,
        }),
      );

      expect(detail.badgeColor).toBe("#DC2626");
      expect(detail.badgeEnabled).toBe(true);
    });

    // An incomplete badge is only a problem once it is visible, staff must be able to
    // park a half-configured badge with the switch off.
    it("allows an unconfigured badge while it stays switched off", async () => {
      repo.findById.mockResolvedValue(ROW);
      repo.update.mockResolvedValue(ROW);

      await runWithScope("all", () =>
        service.update("tenant-1", "program-1", { badgeColor: "#DC2626", badgeEnabled: false }),
      );

      expect(repo.update).toHaveBeenCalled();
    });
  });
});
