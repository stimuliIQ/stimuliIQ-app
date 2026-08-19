// apps/api/src/modules/careers/job-openings.repository.ts
//
// Prisma data access ONLY (CLAUDE.md §3.3). JobOpeningsService is the only caller.
// Soft-delete + audit are handled transparently by the Prisma client extensions
// (JobOpening is registered in both).
//
// The applicant counts on the CRM list are computed HERE, in one grouped query per page,
// rather than by the service looping openings — a per-row count is the N+1 this list would
// otherwise ship with on day one.

import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { resolveTenantIdCached } from "../../common/tenant/tenant-id-cache";

export interface JobOpeningRow {
  id: string;
  tenantId: string;
  title: string;
  slug: string;
  department: string | null;
  employmentType: string;
  location: string;
  workMode: string | null;
  experienceLevel: string | null;
  summary: string;
  description: string | null;
  responsibilities: Prisma.JsonValue;
  requirements: Prisma.JsonValue;
  compensationNote: string | null;
  status: string;
  order: number;
  openingsCount: number;
  closesOn: Date | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface JobOpeningWriteData {
  title: string;
  slug: string;
  department: string | null;
  employmentType: string;
  location: string;
  workMode: string | null;
  experienceLevel: string | null;
  summary: string;
  description: string | null;
  responsibilities: string[];
  requirements: string[];
  compensationNote: string | null;
  status: string;
  order: number;
  openingsCount: number;
  closesOn: Date | null;
  publishedAt: Date | null;
}

/** Per-opening application tallies, keyed by job opening id. */
export interface ApplicationCounts {
  total: number;
  pending: number;
}

@Injectable()
export class JobOpeningsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(filters: {
    tenantId: string;
    status?: string;
    department?: string;
    search?: string;
    page: number;
    pageSize: number;
  }): Promise<{ rows: JobOpeningRow[]; total: number }> {
    const where: Prisma.JobOpeningWhereInput = {
      tenantId: filters.tenantId,
      deletedAt: null,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.department ? { department: filters.department } : {}),
      ...(filters.search
        ? {
            OR: [
              { title: { contains: filters.search, mode: "insensitive" } },
              { location: { contains: filters.search, mode: "insensitive" } },
              { department: { contains: filters.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.client.jobOpening.findMany({
        where,
        orderBy: [{ order: "asc" }, { createdAt: "desc" }],
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
      this.prisma.client.jobOpening.count({ where }),
    ]);
    return { rows, total };
  }

  /**
   * Published, non-lapsed openings for the public site.
   *
   * `closesOn` is compared against the caller's `today` (a DATE at midnight UTC) with
   * `gte`, which keeps the closing day itself open — the inclusive semantics the schema
   * comment and `isJobOpeningLive` both promise.
   */
  async listPublic(filters: {
    tenantId: string;
    department?: string;
    location?: string;
    workMode?: string;
    today: Date;
    limit: number;
  }): Promise<JobOpeningRow[]> {
    return this.prisma.client.jobOpening.findMany({
      where: {
        tenantId: filters.tenantId,
        deletedAt: null,
        status: "published",
        OR: [{ closesOn: null }, { closesOn: { gte: filters.today } }],
        ...(filters.department ? { department: filters.department } : {}),
        ...(filters.location ? { location: { contains: filters.location, mode: "insensitive" } } : {}),
        ...(filters.workMode ? { workMode: filters.workMode } : {}),
      },
      orderBy: [{ order: "asc" }, { createdAt: "desc" }],
      take: filters.limit,
    });
  }

  async findById(tenantId: string, id: string): Promise<JobOpeningRow | null> {
    return this.prisma.client.jobOpening.findFirst({ where: { id, tenantId, deletedAt: null } });
  }

  /** Slug uniqueness check. `excludeId` lets an update keep its own slug. */
  async findBySlug(tenantId: string, slug: string, excludeId?: string): Promise<JobOpeningRow | null> {
    return this.prisma.client.jobOpening.findFirst({
      where: { tenantId, slug, deletedAt: null, ...(excludeId ? { id: { not: excludeId } } : {}) },
    });
  }

  async create(tenantId: string, data: JobOpeningWriteData): Promise<{ id: string }> {
    const created = await this.prisma.client.jobOpening.create({
      data: { tenantId, ...data },
      select: { id: true },
    });
    return created;
  }

  async update(id: string, data: Partial<JobOpeningWriteData>): Promise<void> {
    await this.prisma.client.jobOpening.update({ where: { id }, data });
  }

  async softDelete(id: string): Promise<void> {
    // The soft-delete extension turns this into an UPDATE of deleted_at.
    await this.prisma.client.jobOpening.delete({ where: { id } });
  }

  /**
   * Application tallies for a batch of openings — ONE groupBy, not one count per row.
   * Openings with no applications are simply absent from the map; the service defaults
   * them to zero rather than this method fabricating empty entries.
   */
  async countApplicationsByOpening(tenantId: string, openingIds: string[]): Promise<Map<string, ApplicationCounts>> {
    const counts = new Map<string, ApplicationCounts>();
    if (openingIds.length === 0) return counts;

    const grouped = await this.prisma.client.careerApplication.groupBy({
      by: ["jobOpeningId", "status"],
      where: { tenantId, deletedAt: null, jobOpeningId: { in: openingIds } },
      _count: { _all: true },
    });

    for (const row of grouped) {
      if (!row.jobOpeningId) continue;
      const existing = counts.get(row.jobOpeningId) ?? { total: 0, pending: 0 };
      existing.total += row._count._all;
      if (row.status === "new") existing.pending += row._count._all;
      counts.set(row.jobOpeningId, existing);
    }
    return counts;
  }

  async getTenantIdBySlug(slug: string): Promise<string | null> {
    // Memoised per process — the slug is a compile-time constant and this is a cross-region
    // round trip. See common/tenant/tenant-id-cache.ts. Every public careers read pays this
    // before its real query, so it matters here more than most.
    return resolveTenantIdCached(slug, async () => {
      const row = await this.prisma.client.tenant.findUnique({ where: { slug }, select: { id: true } });
      return row?.id ?? null;
    });
  }
}
