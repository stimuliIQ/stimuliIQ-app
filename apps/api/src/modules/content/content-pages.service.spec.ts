// apps/api/src/modules/content/content-pages.service.spec.ts
//
// Unit tests for ContentPagesService — the generic block-based CMS page surface, INCLUDING
// the Phase-10 security fix (api-designer review, tightened per Wave security review M2):
// the generic PATCH/publish/delete endpoints must UNCONDITIONALLY reject mutating an
// `isBuilderManaged` row — no exception, not even for a caller who additionally holds
// `content.builder` (docs/specs/phase-10-page-builder.md — every builder edit must go
// through the versioned `/builder` endpoints, which enforce strict block-union validation
// + version snapshotting that the generic endpoints do not). The service no longer takes a
// `user`/permission argument for this check at all — the block is unconditional on
// `isBuilderManaged`, so there is nothing left to differentiate by caller permission at
// this layer; the true end-to-end "even super_admin is blocked via the generic PATCH
// endpoint" proof lives in test/integration/phase-10-page-builder.integration-spec.ts.
// Also covers: scope=all only, the publish gate, slug-conflict -> 409, and public-read
// builder-vs-legacy body resolution.

import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { ContentPagesService } from "./content-pages.service";
import { ContentPagesRepository, type ContentPageRow } from "./content-pages.repository";
import { LiveCollectionResolverService } from "./live-collection-resolver.service";
import { scopeContextStorage, type ScopeContext } from "../auth/lib/scope-context";

type Mocked<T> = { [K in keyof T]: T[K] extends (...args: never[]) => unknown ? jest.Mock : T[K] };

function mockRepository(): Mocked<ContentPagesRepository> {
  return {
    list: jest.fn(),
    findById: jest.fn(),
    findPublishedBySlug: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    softDelete: jest.fn(),
    getTenantIdBySlug: jest.fn().mockResolvedValue("tenant-1"),
  } as unknown as Mocked<ContentPagesRepository>;
}

function mockResolver(): Mocked<LiveCollectionResolverService> {
  return {
    resolveKnownBlocks: jest.fn(),
    resolveRawBlocks: jest.fn().mockResolvedValue([]),
  } as unknown as Mocked<LiveCollectionResolverService>;
}

const GENERIC_ROW: ContentPageRow = {
  id: "page-1",
  slug: "about-us",
  title: "About Us",
  body: [{ type: "richtext", data: { html: "<p>hi</p>" } }] as unknown as Prisma.JsonValue,
  seoTitle: null,
  seoDescription: null,
  seoImagePath: null,
  status: "draft",
  publishedAt: null,
  isBuilderManaged: false,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

const BUILDER_ROW: ContentPageRow = { ...GENERIC_ROW, id: "page-2", slug: "home", isBuilderManaged: true, status: "published" };

function runWithScope<T>(scope: ScopeContext["scope"], fn: () => T): T {
  const ctx: ScopeContext = { permissionKey: "content.edit", scope, actorId: "actor-1", tenantId: "tenant-1" };
  return scopeContextStorage.run(ctx, fn);
}

describe("ContentPagesService", () => {
  let service: ContentPagesService;
  let repo: Mocked<ContentPagesRepository>;
  let resolver: Mocked<LiveCollectionResolverService>;

  beforeEach(() => {
    repo = mockRepository();
    resolver = mockResolver();
    service = new ContentPagesService(repo as unknown as ContentPagesRepository, resolver as unknown as LiveCollectionResolverService);
  });

  it("scope=all succeeds; non-all scope fails closed (403)", async () => {
    repo.list.mockResolvedValue({ rows: [GENERIC_ROW], total: 1 });
    const result = await runWithScope("all", () => service.list("tenant-1", { page: 1, pageSize: 20 }));
    expect(result.items).toHaveLength(1);

    await expect(runWithScope("own", () => service.list("tenant-1", { page: 1, pageSize: 20 }))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("create() maps a P2002 unique-constraint violation to 409 content.slug_taken", async () => {
    repo.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "6.19.3" }));
    await expect(
      runWithScope("all", () => service.create("tenant-1", { slug: "about-us", title: "About Us", body: [], status: "draft" })),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  describe("seoImagePath round-trip (Phase-11 locked templates, docs/plans/phase-11-locked-templates.md)", () => {
    it("create() persists a submitted seoImagePath and returns it on the detail projection", async () => {
      repo.create.mockResolvedValue({ id: "page-new" });
      repo.findById.mockResolvedValue({ ...GENERIC_ROW, id: "page-new", seoImagePath: "marketing_images/tenant-1/about-og.webp" });

      const result = await runWithScope("all", () =>
        service.create("tenant-1", { slug: "about-us", title: "About Us", body: [], status: "draft", seoImagePath: "marketing_images/tenant-1/about-og.webp" }),
      );

      expect(repo.create).toHaveBeenCalledWith("tenant-1", expect.objectContaining({ seoImagePath: "marketing_images/tenant-1/about-og.webp" }));
      expect(result.seoImagePath).toBe("marketing_images/tenant-1/about-og.webp");
    });

    it("update() threads a submitted seoImagePath through to the repository patch", async () => {
      repo.findById.mockResolvedValueOnce(GENERIC_ROW).mockResolvedValueOnce({ ...GENERIC_ROW, seoImagePath: "marketing_images/tenant-1/about-og-2.webp" });

      const result = await runWithScope("all", () =>
        service.update("tenant-1", GENERIC_ROW.id, { seoImagePath: "marketing_images/tenant-1/about-og-2.webp" }),
      );

      expect(repo.update).toHaveBeenCalledWith(GENERIC_ROW.id, expect.objectContaining({ seoImagePath: "marketing_images/tenant-1/about-og-2.webp" }));
      expect(result.seoImagePath).toBe("marketing_images/tenant-1/about-og-2.webp");
    });

    it("getPublicBySlug() surfaces seoImagePath for both builder-managed and legacy rows", async () => {
      repo.findPublishedBySlug.mockResolvedValueOnce({ ...BUILDER_ROW, seoImagePath: "marketing_images/tenant-1/home-og.webp" });
      resolver.resolveRawBlocks.mockResolvedValueOnce([]);
      const builderResult = await service.getPublicBySlug("home");
      expect(builderResult.seoImagePath).toBe("marketing_images/tenant-1/home-og.webp");

      repo.findPublishedBySlug.mockResolvedValueOnce({ ...GENERIC_ROW, seoImagePath: "marketing_images/tenant-1/about-og.webp" });
      const legacyResult = await service.getPublicBySlug("about-us");
      expect(legacyResult.seoImagePath).toBe("marketing_images/tenant-1/about-og.webp");
    });
  });

  describe("SECURITY FIX (M2): generic mutation endpoints UNCONDITIONALLY block isBuilderManaged rows", () => {
    it("update() 403s a content.edit-only caller on a builder-managed row", async () => {
      repo.findById.mockResolvedValue(BUILDER_ROW);
      let caught: ForbiddenException | undefined;
      try {
        await runWithScope("all", () => service.update("tenant-1", BUILDER_ROW.id, { title: "New title" }));
      } catch (err) {
        caught = err as ForbiddenException;
      }
      expect(caught).toBeInstanceOf(ForbiddenException);
      expect(caught!.getStatus()).toBe(403);
      expect(caught!.getResponse()).toMatchObject({ code: "content.builder_managed_forbidden" });
      expect(repo.update).not.toHaveBeenCalled();
    });

    it("update() ALLOWS a caller on a NON-builder-managed row (no regression to the legacy CMS flow)", async () => {
      repo.findById.mockResolvedValueOnce(GENERIC_ROW).mockResolvedValueOnce({ ...GENERIC_ROW, title: "New title" });
      const result = await runWithScope("all", () => service.update("tenant-1", GENERIC_ROW.id, { title: "New title" }));
      expect(result.title).toBe("New title");
    });

    it("publish() 403s unconditionally on a builder-managed row", async () => {
      repo.findById.mockResolvedValue(BUILDER_ROW);
      let caught: ForbiddenException | undefined;
      try {
        await runWithScope("all", () => service.publish("tenant-1", BUILDER_ROW.id));
      } catch (err) {
        caught = err as ForbiddenException;
      }
      expect(caught).toBeInstanceOf(ForbiddenException);
      expect(caught!.getResponse()).toMatchObject({ code: "content.builder_managed_forbidden" });
      expect(repo.update).not.toHaveBeenCalled();
    });

    it("softDelete() 403s unconditionally on a builder-managed row", async () => {
      repo.findById.mockResolvedValue(BUILDER_ROW);
      let caught: ForbiddenException | undefined;
      try {
        await runWithScope("all", () => service.softDelete("tenant-1", BUILDER_ROW.id));
      } catch (err) {
        caught = err as ForbiddenException;
      }
      expect(caught).toBeInstanceOf(ForbiddenException);
      expect(caught!.getResponse()).toMatchObject({ code: "content.builder_managed_forbidden" });
      expect(repo.softDelete).not.toHaveBeenCalled();
    });

    it("softDelete() ALLOWS a caller on a NON-builder-managed row (no regression)", async () => {
      repo.findById.mockResolvedValue(GENERIC_ROW);
      await runWithScope("all", () => service.softDelete("tenant-1", GENERIC_ROW.id));
      expect(repo.softDelete).toHaveBeenCalledWith(GENERIC_ROW.id);
    });
  });

  describe("getPublicBySlug — builder vs. legacy body resolution", () => {
    it("resolves live_collection_ref blocks (and sets isBuilderManaged=true) for a builder-managed row", async () => {
      repo.findPublishedBySlug.mockResolvedValue(BUILDER_ROW);
      resolver.resolveRawBlocks.mockResolvedValue([{ type: "brain_showcase", data: {} }]);
      const result = await service.getPublicBySlug("home");
      expect(result.isBuilderManaged).toBe(true);
      expect(resolver.resolveRawBlocks).toHaveBeenCalledWith("tenant-1", BUILDER_ROW.body);
      expect(result.body).toEqual([{ type: "brain_showcase", data: {} }]);
    });

    it("returns the raw generic blocks (isBuilderManaged=false) for a legacy row, WITHOUT calling the resolver", async () => {
      repo.findPublishedBySlug.mockResolvedValue(GENERIC_ROW);
      const result = await service.getPublicBySlug("about-us");
      expect(result.isBuilderManaged).toBe(false);
      expect(resolver.resolveRawBlocks).not.toHaveBeenCalled();
      expect(result.body).toEqual(GENERIC_ROW.body);
    });

    it("404s when the tenant cannot be resolved", async () => {
      repo.getTenantIdBySlug.mockResolvedValue(null);
      await expect(service.getPublicBySlug("home")).rejects.toBeInstanceOf(NotFoundException);
    });

    it("404s when no published row matches the slug", async () => {
      repo.findPublishedBySlug.mockResolvedValue(null);
      await expect(service.getPublicBySlug("unknown-slug")).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
