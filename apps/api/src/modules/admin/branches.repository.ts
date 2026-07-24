// apps/api/src/modules/admin/branches.repository.ts
//
// Prisma data access ONLY (docs/04-trd-architecture.md §2.1). BranchesService is the only
// caller. `branches.*` is seeded at scope=all only (super_admin/admin) — no branch/
// assigned/own scope exists for this module in P1, so there is no scope filter here.

import { Injectable } from "@nestjs/common";
import type { BranchStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";

export interface BranchRow {
  id: string;
  name: string;
  city: string | null;
  address: string | null;
  status: BranchStatus;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface ListBranchesFilters {
  tenantId: string;
  search?: string;
  status?: BranchStatus;
  page: number;
  pageSize: number;
}

@Injectable()
export class BranchesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(filters: ListBranchesFilters): Promise<{ rows: BranchRow[]; total: number }> {
    const where = {
      tenantId: filters.tenantId,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.search ? { name: { contains: filters.search, mode: "insensitive" as const } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.client.branch.findMany({
        where,
        orderBy: { name: "asc" },
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
      this.prisma.client.branch.count({ where }),
    ]);
    return { rows, total };
  }

  async findById(tenantId: string, id: string): Promise<BranchRow | null> {
    return this.prisma.client.branch.findFirst({ where: { id, tenantId } });
  }

  async create(
    tenantId: string,
    data: { name: string; city: string; address?: string; status: BranchStatus },
  ): Promise<BranchRow> {
    return this.prisma.client.branch.create({
      data: { tenantId, name: data.name, city: data.city, address: data.address ?? null, status: data.status },
    });
  }

  async update(
    id: string,
    patch: Partial<{ name: string; city: string; address: string | null; status: BranchStatus }>,
  ): Promise<BranchRow> {
    return this.prisma.client.branch.update({ where: { id }, data: patch });
  }
}
