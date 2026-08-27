// apps/api/src/modules/course-types/course-types.repository.ts
//
// Prisma data access ONLY (CLAUDE.md §3.3). CourseTypesService is the only caller, plus
// StudentsService via the service's `labelMap`/`assertKnownKey` helpers.
//
// Every query is tenant-scoped from `req.user.tenantId` (CLAUDE.md §3: never trust a
// tenantId from the client). Soft-delete and audit are applied transparently by the Prisma
// client extensions — `CourseType` is registered in both (see prisma.service.ts).

import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";

export interface CourseTypeRow {
  id: string;
  key: string;
  label: string;
  sortOrder: number;
  active: boolean;
  createdAt: Date;
}

@Injectable()
export class CourseTypesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(filters: {
    tenantId: string;
    activeOnly: boolean;
    page: number;
    pageSize: number;
  }): Promise<{ rows: CourseTypeRow[]; total: number }> {
    const where: Prisma.CourseTypeWhereInput = {
      tenantId: filters.tenantId,
      deletedAt: null,
      ...(filters.activeOnly ? { active: true } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.client.courseType.findMany({
        where,
        // sortOrder is the staff-chosen order; label breaks ties so the list never
        // reshuffles between requests when several options share an order.
        orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
      this.prisma.client.courseType.count({ where }),
    ]);
    return { rows, total };
  }

  async findById(tenantId: string, id: string): Promise<CourseTypeRow | null> {
    return this.prisma.client.courseType.findFirst({ where: { id, tenantId, deletedAt: null } });
  }

  async findByKey(tenantId: string, key: string): Promise<CourseTypeRow | null> {
    return this.prisma.client.courseType.findFirst({ where: { tenantId, key, deletedAt: null } });
  }

  /** Every live option's key -> label, for resolving stored keys on read. */
  async listAll(tenantId: string): Promise<CourseTypeRow[]> {
    return this.prisma.client.courseType.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
    });
  }

  /**
   * How many non-deleted students hold each of these keys. One grouped query rather than
   * one per option — the management screen shows the count on every row.
   */
  async countStudentsByKey(tenantId: string, keys: string[]): Promise<Map<string, number>> {
    if (keys.length === 0) return new Map();
    const grouped = await this.prisma.client.studentProfile.groupBy({
      by: ["courseType"],
      where: { tenantId, deletedAt: null, courseType: { in: keys } },
      _count: { _all: true },
    });
    return new Map(grouped.filter((g) => g.courseType !== null).map((g) => [g.courseType as string, g._count._all]));
  }

  async create(
    tenantId: string,
    data: { key: string; label: string; sortOrder: number; active: boolean },
  ): Promise<{ id: string }> {
    const row = await this.prisma.client.courseType.create({ data: { tenantId, ...data } });
    return { id: row.id };
  }

  async update(
    id: string,
    patch: Partial<{ label: string; sortOrder: number; active: boolean }>,
  ): Promise<void> {
    await this.prisma.client.courseType.update({ where: { id }, data: patch });
  }

  async softDelete(id: string): Promise<void> {
    await this.prisma.client.courseType.delete({ where: { id } }); // rewritten to soft-delete by the extension.
  }

  /** The highest sortOrder in use, so a new option lands at the bottom rather than the top. */
  async maxSortOrder(tenantId: string): Promise<number> {
    const row = await this.prisma.client.courseType.findFirst({
      where: { tenantId, deletedAt: null },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });
    return row?.sortOrder ?? 0;
  }
}
