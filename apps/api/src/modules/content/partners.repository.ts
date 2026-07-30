// apps/api/src/modules/content/partners.repository.ts
//
// Prisma data access ONLY (CLAUDE.md §3.3). PartnersService is the only caller.
// Soft-delete + audit handled transparently by the Prisma client extensions.

import { Injectable } from "@nestjs/common";
import type { ContentStatus as PrismaContentStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { resolveTenantIdCached } from "../../common/tenant/tenant-id-cache";

export interface PartnerRow {
  id: string;
  name: string;
  logoKey: string | null;
  url: string | null;
  category: string | null;
  status: PrismaContentStatus;
  order: number;
  createdAt: Date;
  // Phase-10 page builder (docs/specs/phase-10-page-builder.md Edge case #11) — additive,
  // nullable Partner fields backing `live_collection_ref(collection=partners)`'s
  // `ResolvedPartnerItem` projection. Not part of `PublicPartnerSchema`/`Partner` (the
  // generic CRM/public partner DTOs) — see prisma/schema.prisma's doc comment on
  // `Partner.focus`/`.established`/`.city`.
  focus: string | null;
  established: number | null;
  city: string | null;
}

@Injectable()
export class PartnersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(filters: { tenantId: string; category?: string; status?: PrismaContentStatus; page: number; pageSize: number }): Promise<{ rows: PartnerRow[]; total: number }> {
    const where: Prisma.PartnerWhereInput = {
      tenantId: filters.tenantId,
      deletedAt: null,
      ...(filters.category ? { category: filters.category } : {}),
      ...(filters.status ? { status: filters.status } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.client.partner.findMany({ where, orderBy: [{ order: "asc" }, { createdAt: "desc" }], skip: (filters.page - 1) * filters.pageSize, take: filters.pageSize }),
      this.prisma.client.partner.count({ where }),
    ]);
    return { rows, total };
  }

  async findById(tenantId: string, id: string): Promise<PartnerRow | null> {
    return this.prisma.client.partner.findFirst({ where: { id, tenantId, deletedAt: null } });
  }

  async listPublished(tenantId: string, category?: string): Promise<PartnerRow[]> {
    return this.prisma.client.partner.findMany({
      where: { tenantId, status: "published", deletedAt: null, ...(category ? { category } : {}) },
      orderBy: [{ order: "asc" }, { createdAt: "desc" }],
    });
  }

  /** Phase-10 page builder (`live_collection_ref(collection=partners)`) — published-only, filtered + sorted + limited. */
  async listPublishedFiltered(tenantId: string, filters: { category?: string; limit: number; sort: "order" | "newest" }): Promise<PartnerRow[]> {
    return this.prisma.client.partner.findMany({
      where: { tenantId, status: "published", deletedAt: null, ...(filters.category ? { category: filters.category } : {}) },
      orderBy: filters.sort === "newest" ? [{ createdAt: "desc" }] : [{ order: "asc" }, { createdAt: "desc" }],
      take: filters.limit,
    });
  }

  async create(
    tenantId: string,
    data: { name: string; logoKey: string | null; url: string | null; category: string | null; focus: string | null; established: number | null; city: string | null; status: PrismaContentStatus; order: number },
  ): Promise<{ id: string }> {
    const row = await this.prisma.client.partner.create({ data: { tenantId, ...data } });
    return { id: row.id };
  }

  async update(
    id: string,
    patch: Partial<{ name: string; logoKey: string | null; url: string | null; category: string | null; focus: string | null; established: number | null; city: string | null; status: PrismaContentStatus; order: number }>,
  ): Promise<void> {
    await this.prisma.client.partner.update({ where: { id }, data: patch });
  }

  async softDelete(id: string): Promise<void> {
    await this.prisma.client.partner.delete({ where: { id } }); // rewritten to soft-delete by the extension.
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
