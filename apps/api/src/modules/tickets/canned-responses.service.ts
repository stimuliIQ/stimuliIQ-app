// apps/api/src/modules/tickets/canned-responses.service.ts
//
// Business logic for support-agent canned response macros (docs/plans/phase-9-
// completion.md T21). No Prisma here (CLAUDE.md §3.3). `canned_responses.manage` is
// seeded ONLY at scope=all — any other resolved scope fails closed (403), matching the
// mentors.module "unresolvable scope" precedent.

import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type {
  CannedResponse,
  CreateCannedResponseRequest,
  ListCannedResponsesQuery,
  UpdateCannedResponseRequest,
} from "@repo/types";
import { CannedResponsesRepository, type CannedResponseRow } from "./canned-responses.repository";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { requireScopeContext } from "../auth/lib/scope-context";

@Injectable()
export class CannedResponsesService {
  constructor(private readonly repository: CannedResponsesRepository) {}

  private assertAllScope(): void {
    const scope = requireScopeContext();
    if (scope.scope !== "all") {
      throw new ForbiddenException({
        code: "canned_responses.scope_unresolvable",
        title: "Scope not supported",
        detail: `The "${scope.scope}" data-scope is not resolvable for canned responses.`,
      });
    }
  }

  async list(tenantId: string, query: ListCannedResponsesQuery): Promise<PaginatedResult<CannedResponse>> {
    this.assertAllScope();
    const { rows, total } = await this.repository.list({
      tenantId,
      category: query.category,
      search: query.search,
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

  async create(tenantId: string, body: CreateCannedResponseRequest): Promise<CannedResponse> {
    this.assertAllScope();
    const created = await this.repository.create(tenantId, {
      title: body.title,
      body: body.body,
      category: body.category ?? null,
    });
    const row = await this.repository.findById(tenantId, created.id);
    if (!row) throw new NotFoundException({ code: "canned_responses.not_found", title: "Canned response not found after creation" });
    return toDto(row);
  }

  async update(tenantId: string, id: string, body: UpdateCannedResponseRequest): Promise<CannedResponse> {
    this.assertAllScope();
    const existing = await this.repository.findById(tenantId, id);
    if (!existing) throw new NotFoundException({ code: "canned_responses.not_found", title: "Canned response not found" });

    await this.repository.update(id, {
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.body !== undefined ? { body: body.body } : {}),
      ...(body.category !== undefined ? { category: body.category } : {}),
    });
    const updated = await this.repository.findById(tenantId, id);
    if (!updated) throw new NotFoundException({ code: "canned_responses.not_found", title: "Canned response not found after update" });
    return toDto(updated);
  }

  async softDelete(tenantId: string, id: string): Promise<void> {
    this.assertAllScope();
    const existing = await this.repository.findById(tenantId, id);
    if (!existing) throw new NotFoundException({ code: "canned_responses.not_found", title: "Canned response not found" });
    await this.repository.softDelete(id);
  }
}

function toDto(row: CannedResponseRow): CannedResponse {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    category: row.category,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
