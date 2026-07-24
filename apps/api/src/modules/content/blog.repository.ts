// apps/api/src/modules/content/blog.repository.ts
//
// Prisma data access ONLY (CLAUDE.md §3.3). BlogService is the only caller. Soft-delete +
// audit handled transparently by the Prisma client extensions (`BlogCategory`/`BlogPost`
// are already registered). `slug` on both models carries a per-tenant partial-unique index
// (WHERE deleted_at IS NULL) — prisma/migrations/20260709024522_phase9_completion_partial_indexes.

import { Injectable } from "@nestjs/common";
import type { ContentStatus as PrismaContentStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";

export interface BlogCategoryRow {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
}

export interface BlogPostRow {
  id: string;
  categoryId: string | null;
  categoryName: string | null;
  categorySlug: string | null;
  authorId: string | null;
  authorName: string | null;
  title: string;
  slug: string;
  excerpt: string | null;
  body: string;
  coverImageKey: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  status: PrismaContentStatus;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class BlogRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ── Categories ────────────────────────────────────────────────────────────

  async listCategories(tenantId: string): Promise<BlogCategoryRow[]> {
    return this.prisma.client.blogCategory.findMany({ where: { tenantId, deletedAt: null }, orderBy: { name: "asc" } });
  }

  async findCategoryById(tenantId: string, id: string): Promise<BlogCategoryRow | null> {
    return this.prisma.client.blogCategory.findFirst({ where: { id, tenantId, deletedAt: null } });
  }

  async createCategory(tenantId: string, data: { name: string; slug: string }): Promise<{ id: string }> {
    const row = await this.prisma.client.blogCategory.create({ data: { tenantId, ...data } });
    return { id: row.id };
  }

  async updateCategory(id: string, patch: Partial<{ name: string; slug: string }>): Promise<void> {
    await this.prisma.client.blogCategory.update({ where: { id }, data: patch });
  }

  // ── Posts ────────────────────────────────────────────────────────────────

  private toPostRow(row: {
    id: string;
    categoryId: string | null;
    category: { name: string; slug: string } | null;
    authorId: string | null;
    author: { name: string } | null;
    title: string;
    slug: string;
    excerpt: string | null;
    body: string;
    coverImageKey: string | null;
    seoTitle: string | null;
    seoDescription: string | null;
    status: PrismaContentStatus;
    publishedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): BlogPostRow {
    return {
      id: row.id,
      categoryId: row.categoryId,
      categoryName: row.category?.name ?? null,
      categorySlug: row.category?.slug ?? null,
      authorId: row.authorId,
      authorName: row.author?.name ?? null,
      title: row.title,
      slug: row.slug,
      excerpt: row.excerpt,
      body: row.body,
      coverImageKey: row.coverImageKey,
      seoTitle: row.seoTitle,
      seoDescription: row.seoDescription,
      status: row.status,
      publishedAt: row.publishedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async listPosts(filters: {
    tenantId: string;
    categoryId?: string;
    status?: PrismaContentStatus;
    search?: string;
    page: number;
    pageSize: number;
  }): Promise<{ rows: BlogPostRow[]; total: number }> {
    const where = {
      tenantId: filters.tenantId,
      deletedAt: null,
      ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.search ? { title: { contains: filters.search, mode: "insensitive" as const } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.client.blogPost.findMany({
        where,
        include: { category: { select: { name: true, slug: true } }, author: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
      this.prisma.client.blogPost.count({ where }),
    ]);
    return { rows: rows.map((r) => this.toPostRow(r)), total };
  }

  async findPostById(tenantId: string, id: string): Promise<BlogPostRow | null> {
    const row = await this.prisma.client.blogPost.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: { category: { select: { name: true, slug: true } }, author: { select: { name: true } } },
    });
    return row ? this.toPostRow(row) : null;
  }

  async findPublishedBySlug(tenantId: string, slug: string): Promise<BlogPostRow | null> {
    const row = await this.prisma.client.blogPost.findFirst({
      where: { tenantId, slug, status: "published", deletedAt: null },
      include: { category: { select: { name: true, slug: true } }, author: { select: { name: true } } },
    });
    return row ? this.toPostRow(row) : null;
  }

  async listPublished(filters: { tenantId: string; categorySlug?: string; search?: string; limit: number }): Promise<BlogPostRow[]> {
    const rows = await this.prisma.client.blogPost.findMany({
      where: {
        tenantId: filters.tenantId,
        status: "published",
        deletedAt: null,
        ...(filters.categorySlug ? { category: { slug: filters.categorySlug } } : {}),
        ...(filters.search ? { title: { contains: filters.search, mode: "insensitive" } } : {}),
      },
      include: { category: { select: { name: true, slug: true } }, author: { select: { name: true } } },
      orderBy: { publishedAt: "desc" },
      take: filters.limit,
    });
    return rows.map((r) => this.toPostRow(r));
  }

  async createPost(
    tenantId: string,
    data: {
      categoryId: string | null;
      authorId: string | null;
      title: string;
      slug: string;
      excerpt: string | null;
      body: string;
      coverImageKey: string | null;
      seoTitle: string | null;
      seoDescription: string | null;
      status: PrismaContentStatus;
      publishedAt: Date | null;
    },
  ): Promise<{ id: string }> {
    const row = await this.prisma.client.blogPost.create({ data: { tenantId, ...data } });
    return { id: row.id };
  }

  async updatePost(
    id: string,
    patch: Partial<{
      categoryId: string | null;
      title: string;
      slug: string;
      excerpt: string | null;
      body: string;
      coverImageKey: string | null;
      seoTitle: string | null;
      seoDescription: string | null;
      status: PrismaContentStatus;
      publishedAt: Date | null;
    }>,
  ): Promise<void> {
    await this.prisma.client.blogPost.update({ where: { id }, data: patch });
  }

  async softDeletePost(id: string): Promise<void> {
    await this.prisma.client.blogPost.delete({ where: { id } }); // rewritten to soft-delete by the extension.
  }

  async categoryExists(tenantId: string, id: string): Promise<boolean> {
    const row = await this.prisma.client.blogCategory.findFirst({ where: { id, tenantId, deletedAt: null }, select: { id: true } });
    return !!row;
  }

  /** Resolves the tenant id for the public (unauthenticated) surface. */
  async getTenantIdBySlug(slug: string): Promise<string | null> {
    const row = await this.prisma.client.tenant.findUnique({ where: { slug }, select: { id: true } });
    return row?.id ?? null;
  }
}
