// apps/api/src/modules/content/blog.service.ts
//
// Business logic for the headless CMS blog surface (docs/plans/phase-9-completion.md
// T22). No Prisma here (CLAUDE.md §3.3). scope=all only for every content.* permission
// (content_editor/marketing) — fails closed otherwise, mirroring the mentors "unresolvable
// scope" precedent.
//
// PUBLISH GATE: PATCH (content.edit) can move a post between draft/archived but NEVER
// directly to "published" — only the dedicated POST :id/publish action (content.publish,
// a SEPARATE permission key) may do that, setting `publishedAt` server-side. This mirrors
// tickets.service.ts's "independently-gated mutation actions" pattern (edit vs assign vs
// close) for the SAME reason: the permission catalog carries a dedicated key for the action.
//
// XSS (ADR-0045): `body` is rich text/MDX-ish, authored ONLY by permission-gated CRM staff
// (content.create/edit). It is stored and returned RAW — the render-sink DOMPurify pass
// (frontend, T19 rich-text sink) is the actual XSS control for this trusted-author surface,
// per ADR-0045's "sanitize at the render sink, not at write time" decision. No backend
// HTML-stripping is applied here (unlike anonymous public UGC — see content-intake.service.ts
// for that distinct, untrusted-input posture).

import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  BlogCategory,
  BlogPostDetail,
  BlogPostSummary,
  CreateBlogCategoryRequest,
  CreateBlogPostRequest,
  ListBlogPostsQuery,
  ListPublicBlogPostsQuery,
  PublicBlogPostDetail,
  PublicBlogPostSummary,
  UpdateBlogCategoryRequest,
  UpdateBlogPostRequest,
} from "@repo/types";
import { BlogRepository, type BlogCategoryRow, type BlogPostRow } from "./blog.repository";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { requireScopeContext } from "../auth/lib/scope-context";
import { TENANT_SLUG, mintCdnUrl } from "./content.util";

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

@Injectable()
export class BlogService {
  constructor(private readonly repository: BlogRepository) {}

  private assertAllScope(): void {
    const scope = requireScopeContext();
    if (scope.scope !== "all") {
      throw new ForbiddenException({
        code: "content.scope_unresolvable",
        title: "Scope not supported",
        detail: `The "${scope.scope}" data-scope is not resolvable for headless content.`,
      });
    }
  }

  // ── Categories (CRM) ─────────────────────────────────────────────────────

  async listCategories(tenantId: string): Promise<BlogCategory[]> {
    this.assertAllScope();
    const rows = await this.repository.listCategories(tenantId);
    return rows.map(toCategoryDto);
  }

  async createCategory(tenantId: string, body: CreateBlogCategoryRequest): Promise<BlogCategory> {
    this.assertAllScope();
    try {
      const created = await this.repository.createCategory(tenantId, body);
      const row = await this.repository.findCategoryById(tenantId, created.id);
      if (!row) throw new NotFoundException({ code: "content.category_not_found", title: "Category not found after creation" });
      return toCategoryDto(row);
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException({ code: "content.slug_taken", title: "Slug already in use" });
      throw err;
    }
  }

  async updateCategory(tenantId: string, id: string, body: UpdateBlogCategoryRequest): Promise<BlogCategory> {
    this.assertAllScope();
    const existing = await this.repository.findCategoryById(tenantId, id);
    if (!existing) throw new NotFoundException({ code: "content.category_not_found", title: "Category not found" });
    try {
      await this.repository.updateCategory(id, body);
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException({ code: "content.slug_taken", title: "Slug already in use" });
      throw err;
    }
    const updated = await this.repository.findCategoryById(tenantId, id);
    if (!updated) throw new NotFoundException({ code: "content.category_not_found", title: "Category not found after update" });
    return toCategoryDto(updated);
  }

  // ── Posts (CRM) ──────────────────────────────────────────────────────────

  async listPosts(tenantId: string, query: ListBlogPostsQuery): Promise<PaginatedResult<BlogPostSummary>> {
    this.assertAllScope();
    const { rows, total } = await this.repository.listPosts({
      tenantId,
      categoryId: query.categoryId,
      status: query.status,
      search: query.search,
      page: query.page,
      pageSize: query.pageSize,
    });
    return new PaginatedResult(rows.map(toSummary), {
      page: query.page,
      pageSize: query.pageSize,
      total,
      hasMore: query.page * query.pageSize < total,
    });
  }

  async getById(tenantId: string, id: string): Promise<BlogPostDetail> {
    this.assertAllScope();
    const row = await this.repository.findPostById(tenantId, id);
    if (!row) throw new NotFoundException({ code: "content.not_found", title: "Blog post not found" });
    return toDetail(row);
  }

  async create(tenantId: string, actorId: string, body: CreateBlogPostRequest): Promise<BlogPostDetail> {
    this.assertAllScope();
    if (body.categoryId) {
      const ok = await this.repository.categoryExists(tenantId, body.categoryId);
      if (!ok) throw new NotFoundException({ code: "content.category_not_found", title: "Category not found" });
    }
    // content.create never directly publishes — status forced to "draft" unless caller
    // explicitly requests "archived" (a valid non-published initial state); "published"
    // requires the dedicated content.publish action below.
    const status = body.status === "published" ? "draft" : body.status;
    try {
      const created = await this.repository.createPost(tenantId, {
        categoryId: body.categoryId ?? null,
        authorId: actorId,
        title: body.title,
        slug: body.slug,
        excerpt: body.excerpt ?? null,
        body: body.body,
        coverImageKey: body.coverImageKey ?? null,
        seoTitle: body.seoTitle ?? null,
        seoDescription: body.seoDescription ?? null,
        status,
        publishedAt: null,
      });
      const row = await this.repository.findPostById(tenantId, created.id);
      if (!row) throw new NotFoundException({ code: "content.not_found", title: "Blog post not found after creation" });
      return toDetail(row);
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException({ code: "content.slug_taken", title: "Slug already in use" });
      throw err;
    }
  }

  /** PATCH — content.edit. Publish gate: a "published" status in the body is ignored (use publish()). */
  async update(tenantId: string, id: string, body: UpdateBlogPostRequest): Promise<BlogPostDetail> {
    this.assertAllScope();
    const existing = await this.repository.findPostById(tenantId, id);
    if (!existing) throw new NotFoundException({ code: "content.not_found", title: "Blog post not found" });
    if (body.categoryId) {
      const ok = await this.repository.categoryExists(tenantId, body.categoryId);
      if (!ok) throw new NotFoundException({ code: "content.category_not_found", title: "Category not found" });
    }
    try {
      await this.repository.updatePost(id, {
        ...(body.categoryId !== undefined ? { categoryId: body.categoryId } : {}),
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.slug !== undefined ? { slug: body.slug } : {}),
        ...(body.excerpt !== undefined ? { excerpt: body.excerpt } : {}),
        ...(body.body !== undefined ? { body: body.body } : {}),
        ...(body.coverImageKey !== undefined ? { coverImageKey: body.coverImageKey } : {}),
        ...(body.seoTitle !== undefined ? { seoTitle: body.seoTitle } : {}),
        ...(body.seoDescription !== undefined ? { seoDescription: body.seoDescription } : {}),
        // publish gate: "published" is silently ignored here — see file header.
        ...(body.status !== undefined && body.status !== "published" ? { status: body.status } : {}),
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException({ code: "content.slug_taken", title: "Slug already in use" });
      throw err;
    }
    const updated = await this.repository.findPostById(tenantId, id);
    if (!updated) throw new NotFoundException({ code: "content.not_found", title: "Blog post not found after update" });
    return toDetail(updated);
  }

  /** POST :id/publish — content.publish (separate permission key). Unconditional transition to published. */
  async publish(tenantId: string, id: string): Promise<BlogPostDetail> {
    this.assertAllScope();
    const existing = await this.repository.findPostById(tenantId, id);
    if (!existing) throw new NotFoundException({ code: "content.not_found", title: "Blog post not found" });
    if (existing.status === "published") {
      throw new ConflictException({ code: "content.already_published", title: "Already published" });
    }
    await this.repository.updatePost(id, { status: "published", publishedAt: new Date() });
    const updated = await this.repository.findPostById(tenantId, id);
    if (!updated) throw new NotFoundException({ code: "content.not_found", title: "Blog post not found after publish" });
    return toDetail(updated);
  }

  async softDelete(tenantId: string, id: string): Promise<void> {
    this.assertAllScope();
    const existing = await this.repository.findPostById(tenantId, id);
    if (!existing) throw new NotFoundException({ code: "content.not_found", title: "Blog post not found" });
    await this.repository.softDeletePost(id);
  }

  // ── Public (anonymous, published only) ───────────────────────────────────

  private async resolveTenantId(): Promise<string> {
    const tenantId = await this.repository.getTenantIdBySlug(TENANT_SLUG);
    if (!tenantId) throw new NotFoundException({ code: "content.tenant_not_found", title: "Tenant not found" });
    return tenantId;
  }

  async listPublic(query: ListPublicBlogPostsQuery): Promise<PublicBlogPostSummary[]> {
    const tenantId = await this.resolveTenantId();
    const rows = await this.repository.listPublished({
      tenantId,
      categorySlug: query.categorySlug,
      search: query.search,
      limit: query.limit,
    });
    return rows.map(toPublicSummary);
  }

  async getPublicBySlug(slug: string): Promise<PublicBlogPostDetail> {
    const tenantId = await this.resolveTenantId();
    const row = await this.repository.findPublishedBySlug(tenantId, slug);
    if (!row) throw new NotFoundException({ code: "content.not_found", title: "Blog post not found" });
    return {
      ...toPublicSummary(row),
      body: row.body,
      seoTitle: row.seoTitle,
      seoDescription: row.seoDescription,
      authorName: row.authorName,
    };
  }
}

function toCategoryDto(row: BlogCategoryRow): BlogCategory {
  return { id: row.id, name: row.name, slug: row.slug, createdAt: row.createdAt.toISOString() };
}

function toSummary(row: BlogPostRow): BlogPostSummary {
  return {
    id: row.id,
    categoryId: row.categoryId,
    categoryName: row.categoryName,
    title: row.title,
    slug: row.slug,
    excerpt: row.excerpt,
    coverImageUrl: mintCdnUrl(row.coverImageKey),
    status: row.status,
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

function toDetail(row: BlogPostRow): BlogPostDetail {
  return {
    ...toSummary(row),
    body: row.body,
    seoTitle: row.seoTitle,
    seoDescription: row.seoDescription,
    authorId: row.authorId,
    authorName: row.authorName,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toPublicSummary(row: BlogPostRow): PublicBlogPostSummary {
  return {
    id: row.id,
    categoryName: row.categoryName,
    categorySlug: row.categorySlug,
    title: row.title,
    slug: row.slug,
    excerpt: row.excerpt,
    coverImageUrl: mintCdnUrl(row.coverImageKey),
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
  };
}
