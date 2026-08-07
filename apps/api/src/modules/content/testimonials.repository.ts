// apps/api/src/modules/content/testimonials.repository.ts
//
// Prisma data access ONLY (CLAUDE.md §3.3). TestimonialsService is the only caller.
// Soft-delete + audit handled transparently by the Prisma client extensions.

import { Injectable } from "@nestjs/common";
import type { ContentStatus as PrismaContentStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { resolveTenantIdCached } from "../../common/tenant/tenant-id-cache";

export interface TestimonialRow {
  id: string;
  programId: string | null;
  studentName: string;
  studentPhotoKey: string | null;
  quote: string;
  rating: number | null;
  status: PrismaContentStatus;
  order: number;
  createdAt: Date;
}

/**
 * A published testimonial plus the joined program title.
 *
 * Public testimonial cards show the program a student trained on ("Clinical Research")
 * under their name. The title lives on `Program`, not `Testimonial`, so every PUBLIC read
 * path joins it — the CRM reads (`list`/`findById`) deliberately do not, since the CRM DTO
 * carries the raw `programId` and the manager renders its own program picker.
 *
 * Flattened here rather than leaking Prisma's nested `{ program: { title } }` shape past
 * the repository boundary (CLAUDE.md §3.3).
 */
export interface PublishedTestimonialRow extends TestimonialRow {
  programTitle: string | null;
}

/** Prisma args shared by every published read, so the joined shape can't drift between them. */
const PUBLISHED_INCLUDE = { program: { select: { title: true } } } as const;

function toPublishedRow(
  row: TestimonialRow & { program: { title: string } | null },
): PublishedTestimonialRow {
  const { program, ...rest } = row;
  return { ...rest, programTitle: program?.title ?? null };
}

@Injectable()
export class TestimonialsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(filters: {
    tenantId: string;
    programId?: string;
    status?: PrismaContentStatus;
    page: number;
    pageSize: number;
  }): Promise<{ rows: TestimonialRow[]; total: number }> {
    const where: Prisma.TestimonialWhereInput = {
      tenantId: filters.tenantId,
      deletedAt: null,
      ...(filters.programId ? { programId: filters.programId } : {}),
      ...(filters.status ? { status: filters.status } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.client.testimonial.findMany({ where, orderBy: [{ order: "asc" }, { createdAt: "desc" }], skip: (filters.page - 1) * filters.pageSize, take: filters.pageSize }),
      this.prisma.client.testimonial.count({ where }),
    ]);
    return { rows, total };
  }

  async findById(tenantId: string, id: string): Promise<TestimonialRow | null> {
    return this.prisma.client.testimonial.findFirst({ where: { id, tenantId, deletedAt: null } });
  }

  async listPublished(tenantId: string, programId?: string): Promise<PublishedTestimonialRow[]> {
    const rows = await this.prisma.client.testimonial.findMany({
      where: { tenantId, status: "published", deletedAt: null, ...(programId ? { programId } : {}) },
      orderBy: [{ order: "asc" }, { createdAt: "desc" }],
      include: PUBLISHED_INCLUDE,
    });
    return rows.map(toPublishedRow);
  }

  /**
   * Phase-10 page builder (`live_collection_ref`, `mode=manual`) — published-only,
   * tenant-scoped batch fetch by id. Order is NOT preserved here (the resolver
   * re-orders to match the author's selected `ids` sequence); missing/unpublished/
   * deleted ids are simply absent from the result (no error).
   */
  async findManyPublishedByIds(tenantId: string, ids: string[]): Promise<PublishedTestimonialRow[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.client.testimonial.findMany({
      where: { tenantId, id: { in: ids }, status: "published", deletedAt: null },
      include: PUBLISHED_INCLUDE,
    });
    return rows.map(toPublishedRow);
  }

  /** Phase-10 page builder (`live_collection_ref`, `mode=filter`) — published-only, filtered + sorted + limited. */
  async listPublishedFiltered(
    tenantId: string,
    filters: { programId?: string; minRating?: number; limit: number; sort: "order" | "newest" },
  ): Promise<PublishedTestimonialRow[]> {
    const rows = await this.prisma.client.testimonial.findMany({
      where: {
        tenantId,
        status: "published",
        deletedAt: null,
        ...(filters.programId ? { programId: filters.programId } : {}),
        ...(filters.minRating !== undefined ? { rating: { gte: filters.minRating } } : {}),
      },
      orderBy: filters.sort === "newest" ? [{ createdAt: "desc" }] : [{ order: "asc" }, { createdAt: "desc" }],
      take: filters.limit,
      include: PUBLISHED_INCLUDE,
    });
    return rows.map(toPublishedRow);
  }

  async create(
    tenantId: string,
    data: { programId: string | null; studentName: string; studentPhotoKey: string | null; quote: string; rating: number | null; status: PrismaContentStatus; order: number },
  ): Promise<{ id: string }> {
    const row = await this.prisma.client.testimonial.create({ data: { tenantId, ...data } });
    return { id: row.id };
  }

  async update(
    id: string,
    patch: Partial<{ programId: string | null; studentName: string; studentPhotoKey: string | null; quote: string; rating: number | null; status: PrismaContentStatus; order: number }>,
  ): Promise<void> {
    await this.prisma.client.testimonial.update({ where: { id }, data: patch });
  }

  async softDelete(id: string): Promise<void> {
    await this.prisma.client.testimonial.delete({ where: { id } }); // rewritten to soft-delete by the extension.
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
