// apps/api/src/modules/growth/landing-pages.repository.ts
//
// Prisma data access ONLY (CLAUDE.md §3.3). LandingPagesService is the only caller.
// Soft-delete + audit handled transparently by the Prisma client extensions.
// `slug` is NOT globally unique — a campaign may run multiple A/B `variant`s of the
// same slug (see prisma/schema.prisma LandingPage — @@index([slug]), no unique
// constraint), so uniqueness is NOT enforced at the DB layer; the service enforces
// "one row per (tenantId, slug, variant)" as a soft business rule via a lookup before
// insert (best-effort — a race would produce two variants with the same key, which is
// harmless: the public resolver just treats them as two equally-weighted variants).

import { Injectable } from "@nestjs/common";
import type { ContentStatus as PrismaContentStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";

export interface LandingPageRow {
  id: string;
  campaign: string | null;
  slug: string;
  title: string;
  variant: string;
  content: Prisma.JsonValue;
  seoTitle: string | null;
  seoDescription: string | null;
  status: PrismaContentStatus;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ListLandingPagesFilters {
  tenantId: string;
  campaign?: string;
  status?: PrismaContentStatus;
  search?: string;
  page: number;
  pageSize: number;
}

export interface CreateLandingPageData {
  campaign: string | null;
  slug: string;
  title: string;
  variant: string;
  content: Prisma.InputJsonValue;
  seoTitle: string | null;
  seoDescription: string | null;
  status: PrismaContentStatus;
  publishedAt: Date | null;
}

export type UpdateLandingPageData = Partial<CreateLandingPageData>;

@Injectable()
export class LandingPagesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(filters: ListLandingPagesFilters): Promise<{ rows: LandingPageRow[]; total: number }> {
    const where: Prisma.LandingPageWhereInput = {
      tenantId: filters.tenantId,
      deletedAt: null,
      ...(filters.campaign ? { campaign: filters.campaign } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.search ? { title: { contains: filters.search, mode: "insensitive" } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.client.landingPage.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
      this.prisma.client.landingPage.count({ where }),
    ]);
    return { rows, total };
  }

  async findById(tenantId: string, id: string): Promise<LandingPageRow | null> {
    return this.prisma.client.landingPage.findFirst({ where: { id, tenantId, deletedAt: null } });
  }

  /** Public render: all PUBLISHED rows for a (tenantId, slug) — server picks the variant. */
  async findPublishedBySlug(tenantId: string, slug: string): Promise<LandingPageRow[]> {
    return this.prisma.client.landingPage.findMany({
      where: { tenantId, slug, status: "published", deletedAt: null },
      orderBy: { variant: "asc" },
    });
  }

  async create(tenantId: string, data: CreateLandingPageData): Promise<{ id: string }> {
    const row = await this.prisma.client.landingPage.create({ data: { tenantId, ...data } });
    return { id: row.id };
  }

  async update(id: string, patch: UpdateLandingPageData): Promise<void> {
    await this.prisma.client.landingPage.update({ where: { id }, data: patch });
  }

  async softDelete(id: string): Promise<void> {
    await this.prisma.client.landingPage.delete({ where: { id } }); // rewritten to soft-delete by the extension.
  }

  /** Resolves the tenant id for the public (unauthenticated) surface — mirrors public.repository.ts. */
  async getTenantIdBySlug(tenantSlug: string): Promise<string | null> {
    const row = await this.prisma.client.tenant.findUnique({ where: { slug: tenantSlug }, select: { id: true } });
    return row?.id ?? null;
  }
}
