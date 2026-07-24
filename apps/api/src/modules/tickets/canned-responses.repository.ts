// apps/api/src/modules/tickets/canned-responses.repository.ts
//
// Prisma data access ONLY (CLAUDE.md §3.3). CannedResponsesService is the only caller.
// Soft-delete + audit are handled transparently by the Prisma client extensions
// (`CannedResponse` is already registered).
//
// SCOPE: `canned_responses.manage` is seeded ONLY at scope=all (support/content_editor) —
// no branch/assigned/own variant exists for this module, so this repository applies no
// scope-derived restriction (the service still resolves+asserts scope="all" defensively).

import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

export interface CannedResponseRow {
  id: string;
  title: string;
  body: string;
  category: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface ListCannedResponsesFilters {
  tenantId: string;
  category?: string;
  search?: string;
  page: number;
  pageSize: number;
}

@Injectable()
export class CannedResponsesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(filters: ListCannedResponsesFilters): Promise<{ rows: CannedResponseRow[]; total: number }> {
    const where = {
      tenantId: filters.tenantId,
      deletedAt: null,
      ...(filters.category ? { category: filters.category } : {}),
      ...(filters.search
        ? { OR: [{ title: { contains: filters.search, mode: "insensitive" as const } }, { body: { contains: filters.search, mode: "insensitive" as const } }] }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.client.cannedResponse.findMany({
        where,
        orderBy: { title: "asc" },
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
      this.prisma.client.cannedResponse.count({ where }),
    ]);
    return { rows, total };
  }

  async findById(tenantId: string, id: string): Promise<CannedResponseRow | null> {
    return this.prisma.client.cannedResponse.findFirst({ where: { id, tenantId, deletedAt: null } });
  }

  async create(tenantId: string, data: { title: string; body: string; category: string | null }): Promise<{ id: string }> {
    const row = await this.prisma.client.cannedResponse.create({ data: { tenantId, ...data } });
    return { id: row.id };
  }

  async update(id: string, patch: Partial<{ title: string; body: string; category: string | null }>): Promise<void> {
    await this.prisma.client.cannedResponse.update({ where: { id }, data: patch });
  }

  async softDelete(id: string): Promise<void> {
    await this.prisma.client.cannedResponse.delete({ where: { id } }); // rewritten to soft-delete by the extension.
  }
}
