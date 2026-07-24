// apps/api/src/modules/tickets/kb-articles.repository.ts
//
// Prisma data access ONLY (CLAUDE.md §3.3). KbArticlesService is the only caller.
// Soft-delete + audit handled transparently by the Prisma client extensions.
// `slug` carries a per-tenant partial-unique index (WHERE deleted_at IS NULL) —
// prisma/migrations/20260709024522_phase9_completion_partial_indexes.

import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

export interface KbArticleRow {
  id: string;
  title: string;
  slug: string;
  body: string;
  category: string | null;
  published: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface ListKbArticlesFilters {
  tenantId: string;
  category?: string;
  published?: boolean;
  search?: string;
  page: number;
  pageSize: number;
}

@Injectable()
export class KbArticlesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(filters: ListKbArticlesFilters): Promise<{ rows: KbArticleRow[]; total: number }> {
    const where = {
      tenantId: filters.tenantId,
      deletedAt: null,
      ...(filters.category ? { category: filters.category } : {}),
      ...(filters.published !== undefined ? { published: filters.published } : {}),
      ...(filters.search
        ? { OR: [{ title: { contains: filters.search, mode: "insensitive" as const } }, { body: { contains: filters.search, mode: "insensitive" as const } }] }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.client.kbArticle.findMany({
        where,
        orderBy: { title: "asc" },
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
      this.prisma.client.kbArticle.count({ where }),
    ]);
    return { rows, total };
  }

  async findById(tenantId: string, id: string): Promise<KbArticleRow | null> {
    return this.prisma.client.kbArticle.findFirst({ where: { id, tenantId, deletedAt: null } });
  }

  /** Public read: PUBLISHED ONLY, no tenant/status leakage in the caller-facing shape (mapped by the service). */
  async findPublishedBySlug(tenantId: string, slug: string): Promise<KbArticleRow | null> {
    return this.prisma.client.kbArticle.findFirst({ where: { tenantId, slug, published: true, deletedAt: null } });
  }

  async listPublished(filters: { tenantId: string; category?: string; search?: string; limit: number }): Promise<KbArticleRow[]> {
    return this.prisma.client.kbArticle.findMany({
      where: {
        tenantId: filters.tenantId,
        published: true,
        deletedAt: null,
        ...(filters.category ? { category: filters.category } : {}),
        ...(filters.search
          ? { OR: [{ title: { contains: filters.search, mode: "insensitive" } }, { body: { contains: filters.search, mode: "insensitive" } }] }
          : {}),
      },
      orderBy: { title: "asc" },
      take: filters.limit,
    });
  }

  async create(tenantId: string, data: { title: string; slug: string; body: string; category: string | null; published: boolean }): Promise<{ id: string }> {
    const row = await this.prisma.client.kbArticle.create({ data: { tenantId, ...data } });
    return { id: row.id };
  }

  async update(id: string, patch: Partial<{ title: string; slug: string; body: string; category: string | null; published: boolean }>): Promise<void> {
    await this.prisma.client.kbArticle.update({ where: { id }, data: patch });
  }

  async softDelete(id: string): Promise<void> {
    await this.prisma.client.kbArticle.delete({ where: { id } }); // rewritten to soft-delete by the extension.
  }

  /** Resolves the tenant id for the public (unauthenticated) surface — mirrors public.repository.ts. */
  async getTenantIdBySlug(slug: string): Promise<string | null> {
    const row = await this.prisma.client.tenant.findUnique({ where: { slug }, select: { id: true } });
    return row?.id ?? null;
  }
}
