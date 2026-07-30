// apps/api/src/modules/content/content-pages.repository.ts
//
// Prisma data access ONLY (CLAUDE.md §3.3). ContentPagesService is the only caller.
// Soft-delete + audit handled transparently by the Prisma client extensions. `slug`
// carries a per-tenant partial-unique index (WHERE deleted_at IS NULL).

import { Injectable } from "@nestjs/common";
import type { ContentStatus as PrismaContentStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { resolveTenantIdCached } from "../../common/tenant/tenant-id-cache";

export interface ContentPageRow {
  id: string;
  slug: string;
  title: string;
  body: Prisma.JsonValue;
  seoTitle: string | null;
  seoDescription: string | null;
  // seoImagePath — Phase-11 locked templates (docs/plans/phase-11-locked-templates.md):
  // per-page social/OG image, a StorageProvider object key (ObjectKeySchema), never a raw
  // URL. Nullable/additive — see schema.prisma's doc comment on ContentPage.seoImagePath.
  seoImagePath: string | null;
  status: PrismaContentStatus;
  publishedAt: Date | null;
  // Phase-10 page builder (docs/specs/phase-10-page-builder.md): `true` -> row is
  // authored through the block-based page builder — see schema.prisma's doc comment
  // on `ContentPage.isBuilderManaged` for the full rationale.
  isBuilderManaged: boolean;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class ContentPagesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(filters: { tenantId: string; status?: PrismaContentStatus; search?: string; isBuilderManaged?: boolean; page: number; pageSize: number }): Promise<{ rows: ContentPageRow[]; total: number }> {
    const where: Prisma.ContentPageWhereInput = {
      tenantId: filters.tenantId,
      deletedAt: null,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.search ? { title: { contains: filters.search, mode: "insensitive" } } : {}),
      ...(filters.isBuilderManaged !== undefined ? { isBuilderManaged: filters.isBuilderManaged } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.client.contentPage.findMany({ where, orderBy: { createdAt: "desc" }, skip: (filters.page - 1) * filters.pageSize, take: filters.pageSize }),
      this.prisma.client.contentPage.count({ where }),
    ]);
    return { rows, total };
  }

  async findById(tenantId: string, id: string): Promise<ContentPageRow | null> {
    return this.prisma.client.contentPage.findFirst({ where: { id, tenantId, deletedAt: null } });
  }

  async findPublishedBySlug(tenantId: string, slug: string): Promise<ContentPageRow | null> {
    return this.prisma.client.contentPage.findFirst({ where: { tenantId, slug, status: "published", deletedAt: null } });
  }

  async create(
    tenantId: string,
    data: {
      slug: string;
      title: string;
      body: Prisma.InputJsonValue;
      seoTitle: string | null;
      seoDescription: string | null;
      seoImagePath: string | null;
      status: PrismaContentStatus;
      publishedAt: Date | null;
      /** Phase-10 page builder — omitted (Prisma `@default(false)`) for the generic CMS create path. */
      isBuilderManaged?: boolean;
    },
  ): Promise<{ id: string }> {
    const row = await this.prisma.client.contentPage.create({ data: { tenantId, ...data } });
    return { id: row.id };
  }

  async update(
    id: string,
    patch: Partial<{ slug: string; title: string; body: Prisma.InputJsonValue; seoTitle: string | null; seoDescription: string | null; seoImagePath: string | null; status: PrismaContentStatus; publishedAt: Date | null }>,
  ): Promise<void> {
    await this.prisma.client.contentPage.update({ where: { id }, data: patch });
  }

  async softDelete(id: string): Promise<void> {
    await this.prisma.client.contentPage.delete({ where: { id } }); // rewritten to soft-delete by the extension.
  }

  async getTenantIdBySlug(slug: string): Promise<string | null> {
    // Memoised per process — the slug is a compile-time constant and this is a
    // cross-region round trip. See common/tenant/tenant-id-cache.ts.
    return resolveTenantIdCached(slug, async () => {
      const row = await this.prisma.client.tenant.findUnique({
        where: { slug },
        select: { id: true },
      });
      return row?.id ?? null;
    });
  }
}
