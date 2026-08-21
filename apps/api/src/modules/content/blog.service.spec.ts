// apps/api/src/modules/content/blog.service.spec.ts
//
// Unit tests for BlogService (docs/plans/phase-9-completion.md T22). Covers: scope=all
// only, the publish gate (create/update never directly set status=published; only the
// dedicated publish() action does, setting publishedAt server-side), slug-conflict -> 409,
// CDN URL minting (raw coverImageKey never leaks), and public read returns published-only
// with the public projection shape.

import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { BlogService } from "./blog.service";
import { BlogRepository, type BlogPostRow } from "./blog.repository";
import { scopeContextStorage, type ScopeContext } from "../auth/lib/scope-context";
import { validateEnv } from "../../config/env";

/** The public asset base the code mints against (PUBLIC_ASSET_BASE_URL or the prod CDN). */
function assetUrl(key: string): string {
  const base = (validateEnv().PUBLIC_ASSET_BASE_URL ?? "https://cdn.stimuliiq.com").replace(/\/+$/, "");
  return `${base}/${key}`;
}

type Mocked<T> = { [K in keyof T]: T[K] extends (...args: never[]) => unknown ? jest.Mock : T[K] };

function mockRepository(): Mocked<BlogRepository> {
  return {
    listCategories: jest.fn(),
    findCategoryById: jest.fn(),
    createCategory: jest.fn(),
    updateCategory: jest.fn(),
    listPosts: jest.fn(),
    findPostById: jest.fn(),
    findPublishedBySlug: jest.fn(),
    listPublished: jest.fn(),
    createPost: jest.fn(),
    updatePost: jest.fn(),
    softDeletePost: jest.fn(),
    categoryExists: jest.fn().mockResolvedValue(true),
    getTenantIdBySlug: jest.fn().mockResolvedValue("tenant-1"),
  } as unknown as Mocked<BlogRepository>;
}

const ROW: BlogPostRow = {
  id: "post-1",
  categoryId: "cat-1",
  categoryName: "Engineering",
  categorySlug: "engineering",
  authorId: "author-1",
  authorName: "Jane Doe",
  title: "How we scaled to 100k students",
  slug: "how-we-scaled",
  excerpt: "A deep dive.",
  body: "Full article body.",
  coverImageKey: "blog/how-we-scaled/cover.jpg",
  seoTitle: null,
  seoDescription: null,
  status: "draft",
  publishedAt: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

function runWithScope<T>(scope: ScopeContext["scope"], fn: () => T): T {
  const ctx: ScopeContext = { permissionKey: "content.view", scope, actorId: "actor-1", tenantId: "tenant-1" };
  return scopeContextStorage.run(ctx, fn);
}

describe("BlogService", () => {
  let service: BlogService;
  let repo: Mocked<BlogRepository>;

  beforeEach(() => {
    repo = mockRepository();
    service = new BlogService(repo as unknown as BlogRepository);
  });

  it("scope=all succeeds; non-all scope fails closed (403)", async () => {
    repo.listPosts.mockResolvedValue({ rows: [ROW], total: 1 });
    const result = await runWithScope("all", () => service.listPosts("tenant-1", { page: 1, pageSize: 20 }));
    expect(result.items).toHaveLength(1);

    await expect(runWithScope("own", () => service.listPosts("tenant-1", { page: 1, pageSize: 20 }))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  describe("publish gate", () => {
    it("create() with status='published' in the body is silently downgraded to 'draft'", async () => {
      repo.createPost.mockResolvedValue({ id: "post-new" });
      repo.findPostById.mockResolvedValue({ ...ROW, id: "post-new" });

      await runWithScope("all", () =>
        service.create("tenant-1", "author-1", {
          title: "New post",
          slug: "new-post",
          body: "body",
          status: "published",
        }),
      );

      expect(repo.createPost).toHaveBeenCalledWith("tenant-1", expect.objectContaining({ status: "draft", publishedAt: null }));
    });

    it("update() with status='published' in the body is IGNORED, publishedAt is never set via PATCH", async () => {
      repo.findPostById.mockResolvedValueOnce(ROW).mockResolvedValueOnce(ROW);
      await runWithScope("all", () => service.update("tenant-1", "post-1", { status: "published" }));
      // The repository update call must NOT include `status` at all (silently dropped).
      expect(repo.updatePost).toHaveBeenCalledWith("post-1", {});
    });

    it("update() may still move status to 'archived' (non-publish transitions allowed)", async () => {
      repo.findPostById.mockResolvedValueOnce(ROW).mockResolvedValueOnce(ROW);
      await runWithScope("all", () => service.update("tenant-1", "post-1", { status: "archived" }));
      expect(repo.updatePost).toHaveBeenCalledWith("post-1", { status: "archived" });
    });

    it("publish() sets status=published AND publishedAt (server-derived timestamp)", async () => {
      repo.findPostById.mockResolvedValueOnce(ROW).mockResolvedValueOnce({ ...ROW, status: "published", publishedAt: new Date() });
      const before = Date.now();
      await runWithScope("all", () => service.publish("tenant-1", "post-1"));
      const call = repo.updatePost.mock.calls[0][1];
      expect(call.status).toBe("published");
      expect(call.publishedAt.getTime()).toBeGreaterThanOrEqual(before);
    });

    it("publish() on an already-published post -> 409", async () => {
      repo.findPostById.mockResolvedValue({ ...ROW, status: "published" });
      await expect(runWithScope("all", () => service.publish("tenant-1", "post-1"))).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe("slug conflict", () => {
    it("create() with a duplicate slug (P2002) -> 409 content.slug_taken", async () => {
      const { Prisma } = jest.requireActual("@prisma/client");
      repo.createPost.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("Unique constraint", { code: "P2002", clientVersion: "5.0" }));
      await expect(
        runWithScope("all", () =>
          service.create("tenant-1", "author-1", { title: "Dup", slug: "how-we-scaled", body: "x", status: "draft" }),
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe("CDN URL minting", () => {
    it("the raw coverImageKey never appears in the response, only the minted CDN URL", async () => {
      repo.findPostById.mockResolvedValue(ROW);
      const result = await runWithScope("all", () => service.getById("tenant-1", "post-1"));
      expect(result).not.toHaveProperty("coverImageKey");
      expect(result.coverImageUrl).toBe(assetUrl(ROW.coverImageKey!));
    });

    it("a null coverImageKey maps to a null coverImageUrl (not a broken URL)", async () => {
      repo.findPostById.mockResolvedValue({ ...ROW, coverImageKey: null });
      const result = await runWithScope("all", () => service.getById("tenant-1", "post-1"));
      expect(result.coverImageUrl).toBeNull();
    });
  });

  describe("public read (unauthenticated, published only)", () => {
    it("listPublic resolves the tenant by slug and returns the public projection", async () => {
      repo.listPublished.mockResolvedValue([{ ...ROW, status: "published", publishedAt: new Date("2026-01-05T00:00:00Z") }]);
      const result = await service.listPublic({ limit: 20 });
      expect(repo.getTenantIdBySlug).toHaveBeenCalledWith("stimuliiq");
      expect(result).toHaveLength(1);
      const first = result[0]!;
      expect(first).not.toHaveProperty("status");
      expect(first).not.toHaveProperty("coverImageKey");
      expect(first.categorySlug).toBe("engineering");
    });

    it("getPublicBySlug for a NON-published slug -> 404 (draft never leaks)", async () => {
      repo.findPublishedBySlug.mockResolvedValue(null); // repository query itself filters status='published'
      await expect(service.getPublicBySlug("draft-post")).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
