// apps/api/src/modules/content/testimonials.repository.ts
//
// Prisma data access ONLY (CLAUDE.md §3.3). TestimonialsService is the only caller.
// Soft-delete + audit handled transparently by the Prisma client extensions.

import { Injectable } from "@nestjs/common";
import type { ContentStatus as PrismaContentStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";

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

  async listPublished(tenantId: string, programId?: string): Promise<TestimonialRow[]> {
    return this.prisma.client.testimonial.findMany({
      where: { tenantId, status: "published", deletedAt: null, ...(programId ? { programId } : {}) },
      orderBy: [{ order: "asc" }, { createdAt: "desc" }],
    });
  }

  /**
   * Phase-10 page builder (`live_collection_ref`, `mode=manual`) — published-only,
   * tenant-scoped batch fetch by id. Order is NOT preserved here (the resolver
   * re-orders to match the author's selected `ids` sequence); missing/unpublished/
   * deleted ids are simply absent from the result (no error).
   */
  async findManyPublishedByIds(tenantId: string, ids: string[]): Promise<TestimonialRow[]> {
    if (ids.length === 0) return [];
    return this.prisma.client.testimonial.findMany({
      where: { tenantId, id: { in: ids }, status: "published", deletedAt: null },
    });
  }

  /** Phase-10 page builder (`live_collection_ref`, `mode=filter`) — published-only, filtered + sorted + limited. */
  async listPublishedFiltered(
    tenantId: string,
    filters: { programId?: string; minRating?: number; limit: number; sort: "order" | "newest" },
  ): Promise<TestimonialRow[]> {
    return this.prisma.client.testimonial.findMany({
      where: {
        tenantId,
        status: "published",
        deletedAt: null,
        ...(filters.programId ? { programId: filters.programId } : {}),
        ...(filters.minRating !== undefined ? { rating: { gte: filters.minRating } } : {}),
      },
      orderBy: filters.sort === "newest" ? [{ createdAt: "desc" }] : [{ order: "asc" }, { createdAt: "desc" }],
      take: filters.limit,
    });
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
    const row = await this.prisma.client.tenant.findUnique({ where: { slug }, select: { id: true } });
    return row?.id ?? null;
  }
}
