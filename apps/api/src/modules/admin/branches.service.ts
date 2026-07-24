// apps/api/src/modules/admin/branches.service.ts
//
// Business logic for branch CRUD (docs/04-trd-architecture.md §2.1, docs/03 §7.16).
// `branches.*` is seeded at scope=all only (super_admin/admin) in P1 — no data-scope
// resolution needed here (unlike batches/students/faculty).

import { Injectable, NotFoundException } from "@nestjs/common";
import type { BranchDetail } from "@repo/types";
import { BranchesRepository, type BranchRow } from "./branches.repository";
import { PaginatedResult } from "../../common/dto/paginated-result";
import type { CreateBranchRequest, ListBranchesQuery, UpdateBranchRequest } from "./dto";

@Injectable()
export class BranchesService {
  constructor(private readonly repository: BranchesRepository) {}

  async list(tenantId: string, query: ListBranchesQuery): Promise<PaginatedResult<BranchDetail>> {
    const { rows, total } = await this.repository.list({
      tenantId,
      search: query.search,
      status: query.status,
      page: query.page,
      pageSize: query.pageSize,
    });
    return new PaginatedResult(rows.map(toDto), {
      page: query.page,
      pageSize: query.pageSize,
      total,
      hasMore: query.page * query.pageSize < total,
    });
  }

  async getById(tenantId: string, id: string): Promise<BranchDetail> {
    const row = await this.repository.findById(tenantId, id);
    if (!row) {
      throw new NotFoundException({ code: "branches.not_found", title: "Branch not found" });
    }
    return toDto(row);
  }

  async create(tenantId: string, body: CreateBranchRequest): Promise<BranchDetail> {
    const created = await this.repository.create(tenantId, {
      name: body.name,
      city: body.city,
      address: body.address,
      status: body.status,
    });
    return toDto(created);
  }

  async update(tenantId: string, id: string, body: UpdateBranchRequest): Promise<BranchDetail> {
    const existing = await this.repository.findById(tenantId, id);
    if (!existing) {
      throw new NotFoundException({ code: "branches.not_found", title: "Branch not found" });
    }
    const updated = await this.repository.update(id, {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.city !== undefined ? { city: body.city } : {}),
      ...(body.address !== undefined ? { address: body.address } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
    });
    return toDto(updated);
  }
}

function toDto(row: BranchRow): BranchDetail {
  return {
    id: row.id,
    name: row.name,
    city: row.city ?? "",
    address: row.address,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
