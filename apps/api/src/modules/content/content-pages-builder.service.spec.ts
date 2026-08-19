// apps/api/src/modules/content/content-pages-builder.service.spec.ts
//
// Unit tests for ContentPagesBuilderService (docs/specs/phase-10-page-builder.md).
// Covers: reserved-slug denylist at create time (Edge case #8), slug-conflict -> 409,
// version-snapshot "save-before-apply" semantics (AC 6), optimistic-concurrency 409 on
// mismatch (Edge case #5), preview is read-only (no persistence call), revert's
// "apply the target version's content, still append a new version" contract (AC 7), AND
// (Phase-11 locked templates, docs/plans/phase-11-locked-templates.md P3) the server-side
// template-lock guard on save()/revert() for core-template slugs.

import { ConflictException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { defaultBodyForSlug } from "@repo/types";
import { ContentPagesBuilderService } from "./content-pages-builder.service";
import { ContentPagesRepository, type ContentPageRow } from "./content-pages.repository";
import { ContentPageVersionsRepository, type ContentPageVersionRow, type ApplyVersionSnapshotResult } from "./content-page-versions.repository";
import { LiveCollectionResolverService } from "./live-collection-resolver.service";
import { scopeContextStorage, type ScopeContext } from "../auth/lib/scope-context";
import type { RequestUser } from "../auth/lib/request-user";

type Mocked<T> = { [K in keyof T]: T[K] extends (...args: never[]) => unknown ? jest.Mock : T[K] };

function mockPagesRepository(): Mocked<ContentPagesRepository> {
  return {
    list: jest.fn(),
    findById: jest.fn(),
    findPublishedBySlug: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    softDelete: jest.fn(),
    getTenantIdBySlug: jest.fn(),
  } as unknown as Mocked<ContentPagesRepository>;
}

function mockVersionsRepository(): Mocked<ContentPageVersionsRepository> {
  return {
    list: jest.fn(),
    findVersionByNumber: jest.fn(),
    countVersions: jest.fn(),
    applyWithVersionSnapshot: jest.fn(),
  } as unknown as Mocked<ContentPageVersionsRepository>;
}

function mockResolver(): Mocked<LiveCollectionResolverService> {
  return {
    resolveKnownBlocks: jest.fn(),
    resolveRawBlocks: jest.fn(),
  } as unknown as Mocked<LiveCollectionResolverService>;
}

function mockStorageProvider() {
  return {
    getSignedUploadUrl: jest.fn(),
    getSignedDownloadUrl: jest.fn(),
    putObject: jest.fn(),
    delete: jest.fn(),
    head: jest.fn(),
    getObject: jest.fn().mockResolvedValue({ body: Buffer.from("stub"), contentType: "application/pdf", size: 4 }),
  };
}

// NOTE: slug is deliberately NON-core (not in page-templates.schemas.ts's
// CoreTemplateSlugSchema) — these shared fixtures back the generic version-snapshot/
// concurrency/preview/revert tests below, which are orthogonal to the Phase-11
// locked-template guard (docs/plans/phase-11-locked-templates.md). Dedicated
// template-lock tests further down use an ACTUAL core slug ("gallery").
const BUILDER_ROW: ContentPageRow = {
  id: "page-1",
  slug: "custom-landing",
  title: "Home",
  body: [{ type: "hero", data: { headline: "Welcome" } }] as unknown as Prisma.JsonValue,
  seoTitle: "Home | StimuliiQ",
  seoDescription: "desc",
  seoImagePath: null,
  status: "published",
  publishedAt: new Date("2026-01-01T00:00:00Z"),
  isBuilderManaged: true,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

const NON_BUILDER_ROW: ContentPageRow = { ...BUILDER_ROW, id: "page-2", isBuilderManaged: false };

const USER: RequestUser = {
  id: "actor-1",
  tenantId: "tenant-1",
  roles: ["super_admin"],
  permissions: [{ key: "content.builder", scope: "all" }],
  mustChangePassword: false,
};

function runWithScope<T>(scope: ScopeContext["scope"], fn: () => T): T {
  const ctx: ScopeContext = { permissionKey: "content.builder", scope, actorId: "actor-1", tenantId: "tenant-1" };
  return scopeContextStorage.run(ctx, fn);
}

describe("ContentPagesBuilderService", () => {
  let service: ContentPagesBuilderService;
  let pagesRepo: Mocked<ContentPagesRepository>;
  let versionsRepo: Mocked<ContentPageVersionsRepository>;
  let resolver: Mocked<LiveCollectionResolverService>;
  let storage: ReturnType<typeof mockStorageProvider>;

  beforeEach(() => {
    pagesRepo = mockPagesRepository();
    versionsRepo = mockVersionsRepository();
    resolver = mockResolver();
    storage = mockStorageProvider();
    service = new ContentPagesBuilderService(
      pagesRepo as unknown as ContentPagesRepository,
      versionsRepo as unknown as ContentPageVersionsRepository,
      resolver as unknown as LiveCollectionResolverService,
      storage as never,
    );
  });

  describe("create()", () => {
    it.each(["about", "about/team", "PROGRAMS", "lp", "lp/summer-sale", "verify", "home"])(
      "rejects a reserved slug %s with 409 content.builder.slug_reserved",
      async (slug) => {
        await expect(
          runWithScope("all", () => service.create("tenant-1", { slug, title: "Test" })),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(pagesRepo.create).not.toHaveBeenCalled();
      },
    );

    it("accepts a non-reserved slug, creates status=published body=[] with NO version row, currentVersion=0", async () => {
      pagesRepo.create.mockResolvedValue({ id: "page-new" });
      pagesRepo.findById.mockResolvedValue({ ...BUILDER_ROW, id: "page-new", slug: "spring-sale", body: [] as unknown as Prisma.JsonValue });

      const result = await runWithScope("all", () => service.create("tenant-1", { slug: "spring-sale", title: "Spring Sale" }));

      expect(pagesRepo.create).toHaveBeenCalledWith(
        "tenant-1",
        expect.objectContaining({ slug: "spring-sale", status: "published", isBuilderManaged: true, body: [] }),
      );
      expect(result.currentVersion).toBe(0);
      expect(result.isBuilderManaged).toBe(true);
      expect(versionsRepo.applyWithVersionSnapshot).not.toHaveBeenCalled();
    });

    it("maps a P2002 unique-constraint violation to 409 content.slug_taken", async () => {
      pagesRepo.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "6.19.3" }));
      await expect(
        runWithScope("all", () => service.create("tenant-1", { slug: "spring-sale", title: "Spring Sale" })),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it("threads a submitted seoImagePath through to the repository create() call", async () => {
      pagesRepo.create.mockResolvedValue({ id: "page-new" });
      pagesRepo.findById.mockResolvedValue({
        ...BUILDER_ROW,
        id: "page-new",
        slug: "spring-sale",
        body: [] as unknown as Prisma.JsonValue,
        seoImagePath: "marketing_images/tenant-1/spring-sale-og.webp",
      });

      const result = await runWithScope("all", () =>
        service.create("tenant-1", { slug: "spring-sale", title: "Spring Sale", seoImagePath: "marketing_images/tenant-1/spring-sale-og.webp" }),
      );

      expect(pagesRepo.create).toHaveBeenCalledWith(
        "tenant-1",
        expect.objectContaining({ seoImagePath: "marketing_images/tenant-1/spring-sale-og.webp" }),
      );
      expect(result.seoImagePath).toBe("marketing_images/tenant-1/spring-sale-og.webp");
    });
  });

  describe("save() — version-snapshot semantics + optimistic concurrency (Edge case #5)", () => {
    it("404s when the page does not exist", async () => {
      pagesRepo.findById.mockResolvedValue(null);
      await expect(
        runWithScope("all", () => service.save("tenant-1", USER, "missing", { body: [], expectedVersion: 0 })),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(versionsRepo.applyWithVersionSnapshot).not.toHaveBeenCalled();
    });

    it("404s when the row exists but is NOT builder-managed (generic CMS row)", async () => {
      pagesRepo.findById.mockResolvedValue(NON_BUILDER_ROW);
      await expect(
        runWithScope("all", () => service.save("tenant-1", USER, NON_BUILDER_ROW.id, { body: [], expectedVersion: 0 })),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("409s with content.builder.version_conflict when expectedVersion is stale", async () => {
      pagesRepo.findById.mockResolvedValue(BUILDER_ROW);
      versionsRepo.applyWithVersionSnapshot.mockResolvedValue({ ok: false, reason: "version_conflict", currentVersion: 3 } as ApplyVersionSnapshotResult);
      await expect(
        runWithScope("all", () => service.save("tenant-1", USER, BUILDER_ROW.id, { body: [], expectedVersion: 1 })),
      ).rejects.toMatchObject({ status: 409 });
    });

    it("calls applyWithVersionSnapshot with expectedVersion+1 semantics delegated to the repository, and returns the new currentVersion", async () => {
      pagesRepo.findById.mockResolvedValue(BUILDER_ROW);
      const savedRow: ContentPageRow = { ...BUILDER_ROW, title: "New Home Title" };
      versionsRepo.applyWithVersionSnapshot.mockResolvedValue({ ok: true, newVersion: 4, row: savedRow } as ApplyVersionSnapshotResult);

      const body = { title: "New Home Title", body: [{ type: "brain_showcase" as const, data: {} }], expectedVersion: 3 };
      const result = await runWithScope("all", () => service.save("tenant-1", USER, BUILDER_ROW.id, body));

      expect(versionsRepo.applyWithVersionSnapshot).toHaveBeenCalledWith(
        "tenant-1",
        BUILDER_ROW.id,
        3,
        expect.objectContaining({ title: "New Home Title" }),
        USER.id,
      );
      expect(result.currentVersion).toBe(4);
      expect(result.title).toBe("New Home Title");
    });

    it("preserves the existing title/seoTitle/seoDescription/seoImagePath when the save request omits them (partial-save semantics)", async () => {
      pagesRepo.findById.mockResolvedValue(BUILDER_ROW);
      versionsRepo.applyWithVersionSnapshot.mockResolvedValue({ ok: true, newVersion: 1, row: BUILDER_ROW } as ApplyVersionSnapshotResult);

      await runWithScope("all", () => service.save("tenant-1", USER, BUILDER_ROW.id, { body: [], expectedVersion: 0 }));

      expect(versionsRepo.applyWithVersionSnapshot).toHaveBeenCalledWith(
        "tenant-1",
        BUILDER_ROW.id,
        0,
        expect.objectContaining({ title: BUILDER_ROW.title, seoTitle: BUILDER_ROW.seoTitle, seoDescription: BUILDER_ROW.seoDescription, seoImagePath: BUILDER_ROW.seoImagePath }),
        USER.id,
      );
    });

    it("threads a NEWLY submitted seoImagePath through to the version-snapshot write and back out on toBuilderDetail (round-trip)", async () => {
      pagesRepo.findById.mockResolvedValue(BUILDER_ROW); // existing seoImagePath: null
      const savedRow: ContentPageRow = { ...BUILDER_ROW, seoImagePath: "marketing_images/tenant-1/og-image.webp" };
      versionsRepo.applyWithVersionSnapshot.mockResolvedValue({ ok: true, newVersion: 1, row: savedRow } as ApplyVersionSnapshotResult);

      const result = await runWithScope("all", () =>
        service.save("tenant-1", USER, BUILDER_ROW.id, { body: [], seoImagePath: "marketing_images/tenant-1/og-image.webp", expectedVersion: 0 }),
      );

      expect(versionsRepo.applyWithVersionSnapshot).toHaveBeenCalledWith(
        "tenant-1",
        BUILDER_ROW.id,
        0,
        expect.objectContaining({ seoImagePath: "marketing_images/tenant-1/og-image.webp" }),
        USER.id,
      );
      expect(result.seoImagePath).toBe("marketing_images/tenant-1/og-image.webp");
    });
  });

  describe("preview() — read-only, no persistence", () => {
    it("404s when the page is not a builder page", async () => {
      pagesRepo.findById.mockResolvedValue(null);
      await expect(
        runWithScope("all", () => service.preview("tenant-1", "missing", { body: [] })),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("resolves the SUBMITTED (unsaved) body through the resolver and never touches the persistence layer", async () => {
      pagesRepo.findById.mockResolvedValue(BUILDER_ROW);
      resolver.resolveKnownBlocks.mockResolvedValue([{ type: "brain_showcase", data: {} }]);

      const unsavedBody = [{ type: "brain_showcase" as const, data: {} }];
      const result = await runWithScope("all", () => service.preview("tenant-1", BUILDER_ROW.id, { body: unsavedBody }));

      expect(resolver.resolveKnownBlocks).toHaveBeenCalledWith("tenant-1", unsavedBody);
      expect(result.blocks).toEqual([{ type: "brain_showcase", data: {} }]);
      expect(versionsRepo.applyWithVersionSnapshot).not.toHaveBeenCalled();
      expect(pagesRepo.update).not.toHaveBeenCalled();
    });
  });

  describe("listVersions() / getVersion()", () => {
    it("404s listVersions when the page is not a builder page", async () => {
      pagesRepo.findById.mockResolvedValue(NON_BUILDER_ROW);
      await expect(
        runWithScope("all", () => service.listVersions("tenant-1", NON_BUILDER_ROW.id, { page: 1, pageSize: 20 })),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("lists version summaries newest-first (delegates ordering to the repository)", async () => {
      pagesRepo.findById.mockResolvedValue(BUILDER_ROW);
      const versionRow: ContentPageVersionRow = {
        version: 2,
        title: "Home v2",
        body: [] as unknown as Prisma.JsonValue,
        seoTitle: null,
        seoDescription: null,
        seoImagePath: null,
        createdBy: { id: "actor-1", name: "Super Admin" },
        createdAt: new Date("2026-01-02T00:00:00Z"),
      };
      versionsRepo.list.mockResolvedValue({ rows: [versionRow], total: 1 });

      const result = await runWithScope("all", () => service.listVersions("tenant-1", BUILDER_ROW.id, { page: 1, pageSize: 20 }));
      expect(result.items).toEqual([{ version: 2, title: "Home v2", createdBy: { id: "actor-1", name: "Super Admin" }, createdAt: "2026-01-02T00:00:00.000Z" }]);
    });

    it("getVersion() 404s with content.builder.version_not_found for an unknown version", async () => {
      pagesRepo.findById.mockResolvedValue(BUILDER_ROW);
      versionsRepo.findVersionByNumber.mockResolvedValue(null);
      await expect(runWithScope("all", () => service.getVersion("tenant-1", BUILDER_ROW.id, 99))).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("revert() — append-only history (AC 7)", () => {
    it("404s with content.builder.version_not_found when the target version does not exist", async () => {
      pagesRepo.findById.mockResolvedValue(BUILDER_ROW);
      versionsRepo.findVersionByNumber.mockResolvedValue(null);
      await expect(
        runWithScope("all", () => service.revert("tenant-1", USER, BUILDER_ROW.id, 99, { expectedVersion: 3 })),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(versionsRepo.applyWithVersionSnapshot).not.toHaveBeenCalled();
    });

    it("409s on a stale expectedVersion, same as save()", async () => {
      pagesRepo.findById.mockResolvedValue(BUILDER_ROW);
      const targetVersion: ContentPageVersionRow = {
        version: 1,
        title: "Home v1",
        body: [] as unknown as Prisma.JsonValue,
        seoTitle: null,
        seoDescription: null,
        seoImagePath: null,
        createdBy: { id: "actor-1", name: "Super Admin" },
        createdAt: new Date("2026-01-01T00:00:00Z"),
      };
      versionsRepo.findVersionByNumber.mockResolvedValue(targetVersion);
      versionsRepo.applyWithVersionSnapshot.mockResolvedValue({ ok: false, reason: "version_conflict", currentVersion: 5 } as ApplyVersionSnapshotResult);

      await expect(
        runWithScope("all", () => service.revert("tenant-1", USER, BUILDER_ROW.id, 1, { expectedVersion: 3 })),
      ).rejects.toMatchObject({ status: 409 });
    });

    it("applies the TARGET version's content (not the current live content) and returns the new currentVersion", async () => {
      pagesRepo.findById.mockResolvedValue(BUILDER_ROW);
      const targetVersion: ContentPageVersionRow = {
        version: 1,
        title: "Home v1 (original)",
        body: [{ type: "hero", data: { headline: "Original" } }] as unknown as Prisma.JsonValue,
        seoTitle: "Original SEO",
        seoDescription: "Original desc",
        seoImagePath: null,
        createdBy: { id: "actor-1", name: "Super Admin" },
        createdAt: new Date("2026-01-01T00:00:00Z"),
      };
      versionsRepo.findVersionByNumber.mockResolvedValue(targetVersion);
      const revertedRow: ContentPageRow = { ...BUILDER_ROW, title: "Home v1 (original)", seoTitle: "Original SEO", seoDescription: "Original desc" };
      versionsRepo.applyWithVersionSnapshot.mockResolvedValue({ ok: true, newVersion: 6, row: revertedRow } as ApplyVersionSnapshotResult);

      const result = await runWithScope("all", () => service.revert("tenant-1", USER, BUILDER_ROW.id, 1, { expectedVersion: 5 }));

      expect(versionsRepo.applyWithVersionSnapshot).toHaveBeenCalledWith(
        "tenant-1",
        BUILDER_ROW.id,
        5,
        expect.objectContaining({ title: "Home v1 (original)", seoTitle: "Original SEO", seoDescription: "Original desc" }),
        USER.id,
      );
      expect(result.currentVersion).toBe(6);
      expect(result.title).toBe("Home v1 (original)");
    });

    it("L2 (security review): rejects reverting to a snapshot whose body no longer parses against PageBuilderBlockSchema (422 content.builder.version_no_longer_valid), and never applies it", async () => {
      pagesRepo.findById.mockResolvedValue(BUILDER_ROW);
      const corruptedVersion: ContentPageVersionRow = {
        version: 1,
        title: "Home v1 (corrupted)",
        // `hero` requires `headline` — this snapshot predates that requirement (or the
        // registry tightened since it was written) and no longer parses.
        body: [{ type: "hero", data: {} }] as unknown as Prisma.JsonValue,
        seoTitle: null,
        seoDescription: null,
        seoImagePath: null,
        createdBy: { id: "actor-1", name: "Super Admin" },
        createdAt: new Date("2026-01-01T00:00:00Z"),
      };
      versionsRepo.findVersionByNumber.mockResolvedValue(corruptedVersion);

      let caught: Error | undefined;
      try {
        await runWithScope("all", () => service.revert("tenant-1", USER, BUILDER_ROW.id, 1, { expectedVersion: 5 }));
      } catch (err) {
        caught = err as Error;
      }
      expect(caught).toBeDefined();
      expect(caught).toMatchObject({ status: 422 });
      // @ts-expect-error -- NestJS HttpException.getResponse() is typed string | object; we know it's an object with `code`.
      expect(caught!.getResponse().code).toBe("content.builder.version_no_longer_valid");
      expect(versionsRepo.applyWithVersionSnapshot).not.toHaveBeenCalled();
    });

    it("L2: rejects reverting to a snapshot whose body exceeds the 60-block page-level ceiling", async () => {
      pagesRepo.findById.mockResolvedValue(BUILDER_ROW);
      const oversizedVersion: ContentPageVersionRow = {
        version: 1,
        title: "Home v1 (oversized)",
        body: Array.from({ length: 61 }, () => ({ type: "brain_showcase", data: {} })) as unknown as Prisma.JsonValue,
        seoTitle: null,
        seoDescription: null,
        seoImagePath: null,
        createdBy: { id: "actor-1", name: "Super Admin" },
        createdAt: new Date("2026-01-01T00:00:00Z"),
      };
      versionsRepo.findVersionByNumber.mockResolvedValue(oversizedVersion);

      let caught: Error | undefined;
      try {
        await runWithScope("all", () => service.revert("tenant-1", USER, BUILDER_ROW.id, 1, { expectedVersion: 5 }));
      } catch (err) {
        caught = err as Error;
      }
      expect(caught).toMatchObject({ status: 422 });
      expect(versionsRepo.applyWithVersionSnapshot).not.toHaveBeenCalled();
    });
  });

  describe("Phase-11 locked templates — server-side template guard (docs/plans/phase-11-locked-templates.md P3)", () => {
    // "gallery" is a real core template slug (page-templates.schemas.ts) with the SHORTEST
    // fixed section list (hero, gallery_grid) — easiest to construct valid/invalid bodies
    // for without hand-maintaining a duplicate of the registry here.
    const GALLERY_ROW: ContentPageRow = { ...BUILDER_ROW, id: "page-gallery", slug: "gallery" };
    const VALID_GALLERY_BODY = defaultBodyForSlug("gallery");

    describe("save()", () => {
      it("rejects a body missing a required section (422 content.builder.template_violation)", async () => {
        pagesRepo.findById.mockResolvedValue(GALLERY_ROW);
        const bodyMissingSection = [VALID_GALLERY_BODY[0]!]; // only `hero` — `gallery_grid` removed

        let caught: Error | undefined;
        try {
          await runWithScope("all", () => service.save("tenant-1", USER, GALLERY_ROW.id, { body: bodyMissingSection, expectedVersion: 0 }));
        } catch (err) {
          caught = err as Error;
        }
        expect(caught).toMatchObject({ status: 422 });
        // @ts-expect-error -- NestJS HttpException.getResponse() is typed string | object; we know it's an object with `code`.
        expect(caught!.getResponse().code).toBe("content.builder.template_violation");
        expect(versionsRepo.applyWithVersionSnapshot).not.toHaveBeenCalled();
      });

      it("rejects a body with an added/extra section", async () => {
        pagesRepo.findById.mockResolvedValue(GALLERY_ROW);
        const bodyWithExtra = [...VALID_GALLERY_BODY, { type: "faq" as const, data: { items: [{ question: "Q", answer: "A" }] } }];

        await expect(
          runWithScope("all", () => service.save("tenant-1", USER, GALLERY_ROW.id, { body: bodyWithExtra, expectedVersion: 0 })),
        ).rejects.toMatchObject({ status: 422 });
        expect(versionsRepo.applyWithVersionSnapshot).not.toHaveBeenCalled();
      });

      it("rejects a body with sections reordered (wrong block type at a fixed position)", async () => {
        pagesRepo.findById.mockResolvedValue(GALLERY_ROW);
        const reordered = [VALID_GALLERY_BODY[1]!, VALID_GALLERY_BODY[0]!]; // gallery_grid first, hero second

        await expect(
          runWithScope("all", () => service.save("tenant-1", USER, GALLERY_ROW.id, { body: reordered, expectedVersion: 0 })),
        ).rejects.toMatchObject({ status: 422 });
        expect(versionsRepo.applyWithVersionSnapshot).not.toHaveBeenCalled();
      });

      it("accepts a full, valid template body for a core slug and persists it", async () => {
        pagesRepo.findById.mockResolvedValue(GALLERY_ROW);
        versionsRepo.applyWithVersionSnapshot.mockResolvedValue({
          ok: true,
          newVersion: 1,
          row: { ...GALLERY_ROW, body: VALID_GALLERY_BODY as unknown as Prisma.JsonValue },
        } as ApplyVersionSnapshotResult);

        const result = await runWithScope("all", () => service.save("tenant-1", USER, GALLERY_ROW.id, { body: VALID_GALLERY_BODY, expectedVersion: 0 }));

        expect(versionsRepo.applyWithVersionSnapshot).toHaveBeenCalledWith(
          "tenant-1",
          GALLERY_ROW.id,
          0,
          expect.objectContaining({ body: VALID_GALLERY_BODY }),
          USER.id,
        );
        expect(result.currentVersion).toBe(1);
      });

      it("does NOT enforce the template lock for a non-core slug (existing free-form behaviour unchanged)", async () => {
        pagesRepo.findById.mockResolvedValue(BUILDER_ROW); // slug: custom-landing (non-core)
        versionsRepo.applyWithVersionSnapshot.mockResolvedValue({ ok: true, newVersion: 1, row: BUILDER_ROW } as ApplyVersionSnapshotResult);
        const arbitraryBody = [{ type: "brain_showcase" as const, data: {} }];

        await runWithScope("all", () => service.save("tenant-1", USER, BUILDER_ROW.id, { body: arbitraryBody, expectedVersion: 0 }));

        expect(versionsRepo.applyWithVersionSnapshot).toHaveBeenCalledWith(
          "tenant-1",
          BUILDER_ROW.id,
          0,
          expect.objectContaining({ body: arbitraryBody }),
          USER.id,
        );
      });
    });

    describe("revert()", () => {
      it("rejects reverting a core-template page to a snapshot that no longer matches the template", async () => {
        pagesRepo.findById.mockResolvedValue(GALLERY_ROW);
        const badSnapshot: ContentPageVersionRow = {
          version: 1,
          title: "Gallery v1",
          body: [VALID_GALLERY_BODY[0]!] as unknown as Prisma.JsonValue, // missing gallery_grid
          seoTitle: null,
          seoDescription: null,
          seoImagePath: null,
          createdBy: { id: "actor-1", name: "Super Admin" },
          createdAt: new Date("2026-01-01T00:00:00Z"),
        };
        versionsRepo.findVersionByNumber.mockResolvedValue(badSnapshot);

        let caught: Error | undefined;
        try {
          await runWithScope("all", () => service.revert("tenant-1", USER, GALLERY_ROW.id, 1, { expectedVersion: 5 }));
        } catch (err) {
          caught = err as Error;
        }
        expect(caught).toMatchObject({ status: 422 });
        // @ts-expect-error -- see comment above.
        expect(caught!.getResponse().code).toBe("content.builder.template_violation");
        expect(versionsRepo.applyWithVersionSnapshot).not.toHaveBeenCalled();
      });

      it("accepts reverting a core-template page to a fully valid template snapshot", async () => {
        pagesRepo.findById.mockResolvedValue(GALLERY_ROW);
        const goodSnapshot: ContentPageVersionRow = {
          version: 1,
          title: "Gallery v1",
          body: VALID_GALLERY_BODY as unknown as Prisma.JsonValue,
          seoTitle: null,
          seoDescription: null,
          seoImagePath: null,
          createdBy: { id: "actor-1", name: "Super Admin" },
          createdAt: new Date("2026-01-01T00:00:00Z"),
        };
        versionsRepo.findVersionByNumber.mockResolvedValue(goodSnapshot);
        versionsRepo.applyWithVersionSnapshot.mockResolvedValue({ ok: true, newVersion: 6, row: GALLERY_ROW } as ApplyVersionSnapshotResult);

        const result = await runWithScope("all", () => service.revert("tenant-1", USER, GALLERY_ROW.id, 1, { expectedVersion: 5 }));
        expect(result.currentVersion).toBe(6);
        expect(versionsRepo.applyWithVersionSnapshot).toHaveBeenCalled();
      });
    });
  });

  describe("getMediaUploadUrl()", () => {
    it("mints a marketing_images-namespaced key and delegates to the StorageProvider", async () => {
      storage.getSignedUploadUrl.mockResolvedValue({
        url: "https://signed.example.com/put",
        storageKey: "marketing_images/tenant-1/uuid-hero.webp",
        expiresAt: new Date("2026-01-01T00:15:00Z"),
        requiredHeaders: { "Content-Type": "image/webp" },
      });

      const result = await runWithScope("all", () =>
        service.getMediaUploadUrl("tenant-1", { fileName: "hero.webp", contentType: "image/webp", sizeBytes: 1_000_000 }),
      );

      expect(storage.getSignedUploadUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          key: expect.stringMatching(/^marketing_images\/tenant-1\//),
          contentType: "image/webp",
          maxBytes: 1_000_000,
          ttlSeconds: 900,
        }),
      );
      expect(result).toEqual({
        storageKey: "marketing_images/tenant-1/uuid-hero.webp",
        uploadUrl: "https://signed.example.com/put",
        expiresAt: "2026-01-01T00:15:00.000Z",
        additionalHeaders: { "Content-Type": "image/webp" },
        maxSizeBytes: 1_000_000,
      });
    });
  });
});
