// apps/api/src/modules/tickets/kb-articles.service.spec.ts
//
// Unit tests for KbArticlesService (docs/plans/phase-9-completion.md T21). Covers: admin
// CRUD scope=all only, slug-conflict -> 409 (P2002 mapping), and the public
// (unauthenticated) surface returns ONLY published articles with the public projection
// (no `published`/`tenantId` leakage).

import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { KbArticlesService } from "./kb-articles.service";
import { KbArticlesRepository, type KbArticleRow } from "./kb-articles.repository";
import { scopeContextStorage, type ScopeContext } from "../auth/lib/scope-context";

type Mocked<T> = { [K in keyof T]: T[K] extends (...args: never[]) => unknown ? jest.Mock : T[K] };

function mockRepository(): Mocked<KbArticlesRepository> {
  return {
    list: jest.fn(),
    findById: jest.fn(),
    findPublishedBySlug: jest.fn(),
    listPublished: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    softDelete: jest.fn(),
    getTenantIdBySlug: jest.fn().mockResolvedValue("tenant-1"),
  } as unknown as Mocked<KbArticlesRepository>;
}

const ROW: KbArticleRow = {
  id: "kb-1",
  title: "How to reset your password",
  slug: "how-to-reset-your-password",
  body: "Go to settings...",
  category: "account",
  published: true,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  deletedAt: null,
};

function runWithScope<T>(scope: ScopeContext["scope"], fn: () => T): T {
  const ctx: ScopeContext = { permissionKey: "kb.view", scope, actorId: "actor-1", tenantId: "tenant-1" };
  return scopeContextStorage.run(ctx, fn);
}

describe("KbArticlesService", () => {
  let service: KbArticlesService;
  let repo: Mocked<KbArticlesRepository>;

  beforeEach(() => {
    repo = mockRepository();
    service = new KbArticlesService(repo as unknown as KbArticlesRepository);
  });

  describe("admin CRUD", () => {
    it("scope=all succeeds; non-all scope fails closed (403)", async () => {
      repo.list.mockResolvedValue({ rows: [ROW], total: 1 });
      const result = await runWithScope("all", () => service.list("tenant-1", { page: 1, pageSize: 20 }));
      expect(result.items).toHaveLength(1);

      await expect(
        runWithScope("own", () => service.list("tenant-1", { page: 1, pageSize: 20 })),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("create() with a duplicate slug -> 409 kb.slug_taken (P2002 mapping)", async () => {
      const { Prisma } = jest.requireActual("@prisma/client");
      const uniqueError = new Prisma.PrismaClientKnownRequestError("Unique constraint", { code: "P2002", clientVersion: "5.0" });
      repo.create.mockRejectedValue(uniqueError);

      await expect(
        runWithScope("all", () =>
          service.create("tenant-1", { title: "Dup", slug: "how-to-reset-your-password", body: "x", published: false }),
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it("update() on a missing article -> 404", async () => {
      repo.findById.mockResolvedValue(null);
      await expect(
        runWithScope("all", () => service.update("tenant-1", "missing", { title: "x" })),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("public (unauthenticated) read, published only", () => {
    it("listPublic resolves the tenant by slug and returns the public projection (no `published`/tenantId fields)", async () => {
      repo.listPublished.mockResolvedValue([ROW]);
      const result = await service.listPublic({ limit: 20 });
      expect(repo.getTenantIdBySlug).toHaveBeenCalledWith("stimuliiq");
      expect(repo.listPublished).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "tenant-1" }));
      expect(result).toEqual([{ id: "kb-1", title: ROW.title, slug: ROW.slug, category: "account" }]);
      expect(result[0]).not.toHaveProperty("published");
      expect(result[0]).not.toHaveProperty("tenantId");
    });

    it("getPublicBySlug for a slug with no PUBLISHED row -> 404 (draft articles never leak)", async () => {
      repo.findPublishedBySlug.mockResolvedValue(null);
      await expect(service.getPublicBySlug("draft-article")).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.findPublishedBySlug).toHaveBeenCalledWith("tenant-1", "draft-article");
    });

    it("getPublicBySlug for a published article returns the body", async () => {
      repo.findPublishedBySlug.mockResolvedValue(ROW);
      const result = await service.getPublicBySlug(ROW.slug);
      expect(result.body).toBe(ROW.body);
    });
  });
});
