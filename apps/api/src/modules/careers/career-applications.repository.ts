// apps/api/src/modules/careers/career-applications.repository.ts
//
// Prisma data access ONLY (CLAUDE.md §3.3). CareerApplicationsService is the only caller.
// Soft-delete + audit are handled by the Prisma client extensions (CareerApplication is
// registered in both, and its name/email/phone are in PII_FIELD_REGISTRY so the audit
// snapshot hashes them).

import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { resolveTenantIdCached } from "../../common/tenant/tenant-id-cache";
import type { JobOpeningRow } from "./job-openings.repository";

export interface CareerApplicationRow {
  id: string;
  tenantId: string;
  jobOpeningId: string | null;
  name: string;
  email: string;
  phone: string | null;
  role: string;
  resumeStorageKey: string;
  coverLetter: string | null;
  status: string;
  internalNotes: string | null;
  nextRoundName: string | null;
  nextRoundDetails: string | null;
  offerLetterStorageKey: string | null;
  offerLetterFileName: string | null;
  acknowledgedAt: Date | null;
  decidedAt: Date | null;
  decidedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
  /**
   * Present on every read below — the reviewer needs the role's current title and the name
   * of whoever last decided, and fetching those per row would be an N+1.
   *
   * IMPORTANT: the soft-delete extension merges `deleted_at: null` into TOP-LEVEL where
   * clauses only; it does not touch nested includes. So this can be a soft-deleted opening,
   * and it carries `deletedAt` precisely so the service's mapper can drop it. Do not treat
   * a non-null `jobOpening` here as "the opening still exists".
   */
  jobOpening: (JobOpeningRow & { deletedAt: Date | null }) | null;
  decidedBy: { id: string; name: string } | null;
}

/** The one include shape every read in this file uses, so list and detail never diverge. */
const WITH_RELATIONS = {
  jobOpening: true,
  decidedBy: { select: { id: true, name: true } },
} satisfies Prisma.CareerApplicationInclude;

export interface DecisionWrite {
  status: string;
  decidedAt: Date;
  decidedByUserId: string;
  internalNotes?: string | null;
  nextRoundName?: string | null;
  nextRoundDetails?: string | null;
  offerLetterStorageKey?: string | null;
  offerLetterFileName?: string | null;
}

@Injectable()
export class CareerApplicationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(filters: {
    tenantId: string;
    status?: string;
    jobOpeningId?: string;
    role?: string;
    search?: string;
    page: number;
    pageSize: number;
  }): Promise<{ rows: CareerApplicationRow[]; total: number }> {
    const where: Prisma.CareerApplicationWhereInput = {
      tenantId: filters.tenantId,
      deletedAt: null,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.jobOpeningId ? { jobOpeningId: filters.jobOpeningId } : {}),
      ...(filters.role ? { role: { contains: filters.role, mode: "insensitive" } } : {}),
      ...(filters.search
        ? {
            OR: [
              { name: { contains: filters.search, mode: "insensitive" } },
              { email: { contains: filters.search, mode: "insensitive" } },
              { role: { contains: filters.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.client.careerApplication.findMany({
        where,
        include: WITH_RELATIONS,
        orderBy: { createdAt: "desc" },
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
      this.prisma.client.careerApplication.count({ where }),
    ]);
    return { rows: rows as CareerApplicationRow[], total };
  }

  async findById(tenantId: string, id: string): Promise<CareerApplicationRow | null> {
    const row = await this.prisma.client.careerApplication.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: WITH_RELATIONS,
    });
    return (row as CareerApplicationRow | null) ?? null;
  }

  async create(
    tenantId: string,
    data: {
      jobOpeningId: string | null;
      name: string;
      email: string;
      phone: string | null;
      role: string;
      resumeStorageKey: string;
      coverLetter: string | null;
    },
  ): Promise<{ id: string }> {
    return this.prisma.client.careerApplication.create({
      data: { tenantId, ...data },
      select: { id: true },
    });
  }

  /**
   * Applies a review decision.
   *
   * `expectedStatuses` is checked IN THE UPDATE's WHERE, not read-then-write: two reviewers
   * opening the same application must not both be able to decide it, and the second one
   * must find out. `updateMany` returning 0 is that signal — the same guard the P4
   * submission-return path uses for the same reason.
   */
  async applyDecision(id: string, expectedStatuses: string[], data: DecisionWrite): Promise<number> {
    const result = await this.prisma.client.careerApplication.updateMany({
      where: { id, deletedAt: null, status: { in: expectedStatuses } },
      data,
    });
    return result.count;
  }

  /** Records that the acknowledgement email was accepted by the provider. */
  async markAcknowledged(id: string, at: Date): Promise<void> {
    await this.prisma.client.careerApplication.update({ where: { id }, data: { acknowledgedAt: at } });
  }

  async softDelete(id: string): Promise<void> {
    await this.prisma.client.careerApplication.delete({ where: { id } });
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
