// apps/api/src/modules/batches/batches.service.ts
//
// Business logic for batch management (docs/04-trd-architecture.md §2.1). Owns the
// data-scope DECISION: "branch" and "assigned" are BOTH fully resolvable for batches
// (unlike students/courses in Wave 3a) since `batches.branchId` (required) and
// `batches.facultyId` are direct columns — no Wave-3b gap exists here at all; this module
// IS the Wave-3b resolution point other modules depend on (see
// ../common-scope/enrollment-scope.repository.ts).
//
// IDOR / object-level authz: any GET/PATCH/DELETE/restore/assign-faculty/roster by :id
// re-verifies the row is in the caller's tenant AND resolved scope before acting;
// out-of-scope/out-of-tenant ids return 404 (not 403) — consistent with students/faculty.

import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { BatchDetail, BatchRoster, BatchSummary } from "@repo/types";
import { BatchesRepository, type BatchRosterRow, type BatchRow } from "./batches.repository";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { requireScopeContext } from "../auth/lib/scope-context";
import type { AssignBatchFacultyRequest, CreateBatchRequest, ListBatchesQuery, UpdateBatchRequest } from "./dto";

@Injectable()
export class BatchesService {
  constructor(private readonly repository: BatchesRepository) {}

  /**
   * Resolves the current scope into repository-level restriction options, or throws 403
   * for anything not seeded/resolvable. Empty object = no restriction (scope "all").
   */
  private async resolveListRestriction(
    actorId: string,
  ): Promise<{ restrictToBranchIds?: string[]; restrictToFacultyId?: string }> {
    const scope = requireScopeContext();
    switch (scope.scope) {
      case "all":
        return {};
      case "branch": {
        const branchIds = await this.repository.listCallerBranchIds(actorId);
        // No branchId on the caller's user_roles -> nothing visible (empty array, not
        // undefined, so the repository filters to zero rows rather than "all").
        return { restrictToBranchIds: branchIds };
      }
      case "assigned": {
        const facultyId = await this.repository.findOwnFacultyProfileId(
          requireScopeContext().tenantId,
          actorId,
        );
        // No faculty profile for this caller -> nothing visible (a facultyId that can
        // never match, rather than "all").
        return { restrictToFacultyId: facultyId ?? "00000000-0000-0000-0000-000000000000" };
      }
      case "own":
      default:
        throw new ForbiddenException({
          code: "batches.scope_unresolvable",
          title: "Scope not yet supported",
          detail: `The "${scope.scope}" data-scope is not seeded/resolvable for the batches module in P1.`,
        });
    }
  }

  /** Same scope resolution, for a single-row (by id) lookup. */
  private async resolveObjectRestriction(
    tenantId: string,
    actorId: string,
  ): Promise<{ branchIds?: string[]; facultyId?: string }> {
    const scope = requireScopeContext();
    switch (scope.scope) {
      case "all":
        return {};
      case "branch":
        return { branchIds: await this.repository.listCallerBranchIds(actorId) };
      case "assigned": {
        const facultyId = await this.repository.findOwnFacultyProfileId(tenantId, actorId);
        return { facultyId: facultyId ?? "00000000-0000-0000-0000-000000000000" };
      }
      case "own":
      default:
        throw new ForbiddenException({
          code: "batches.scope_unresolvable",
          title: "Scope not yet supported",
          detail: `The "${scope.scope}" data-scope is not seeded/resolvable for the batches module in P1.`,
        });
    }
  }

  private assertRowInScope(row: BatchRow, restriction: { branchIds?: string[]; facultyId?: string }): void {
    if (restriction.branchIds && !restriction.branchIds.includes(row.branchId)) {
      throw new NotFoundException({ code: "batches.not_found", title: "Batch not found" });
    }
    if (restriction.facultyId && restriction.facultyId !== row.facultyId) {
      throw new NotFoundException({ code: "batches.not_found", title: "Batch not found" });
    }
  }

  async list(tenantId: string, actorId: string, query: ListBatchesQuery): Promise<PaginatedResult<BatchSummary>> {
    const restriction = await this.resolveListRestriction(actorId);

    const { rows, total } = await this.repository.list({
      tenantId,
      search: query.search,
      programId: query.programId,
      branchId: query.branchId,
      facultyId: query.facultyId ?? restriction.restrictToFacultyId,
      status: query.status,
      includeDeleted: query.includeDeleted,
      page: query.page,
      pageSize: query.pageSize,
      restrictToBranchIds: restriction.restrictToBranchIds,
    });

    return new PaginatedResult(rows.map(toSummary), {
      page: query.page,
      pageSize: query.pageSize,
      total,
      hasMore: query.page * query.pageSize < total,
    });
  }

  async getById(tenantId: string, actorId: string, id: string): Promise<BatchDetail> {
    const row = await this.repository.findById(tenantId, id);
    if (!row) {
      throw new NotFoundException({ code: "batches.not_found", title: "Batch not found" });
    }
    const restriction = await this.resolveObjectRestriction(tenantId, actorId);
    this.assertRowInScope(row, restriction);
    return toDetail(row);
  }

  async create(tenantId: string, actorId: string, body: CreateBatchRequest): Promise<BatchDetail> {
    // Creating a batch is gated by `batches.create`, seeded at scope=branch for
    // branch_manager — a branch-scoped creator may only create within their own branch.
    const scope = requireScopeContext();
    if (scope.scope === "branch") {
      const branchIds = await this.repository.listCallerBranchIds(actorId);
      if (!branchIds.includes(body.branchId)) {
        throw new ForbiddenException({
          code: "batches.branch_out_of_scope",
          title: "Branch out of scope",
          detail: "Branch managers may only create batches within their own branch.",
        });
      }
    } else if (scope.scope !== "all") {
      throw new ForbiddenException({
        code: "batches.scope_unresolvable",
        title: "Scope not yet supported",
        detail: `The "${scope.scope}" data-scope cannot create batches.`,
      });
    }

    const programOk = await this.repository.programExists(tenantId, body.programId);
    if (!programOk) {
      throw new NotFoundException({ code: "batches.program_not_found", title: "Program not found" });
    }
    const branchOk = await this.repository.branchExists(tenantId, body.branchId);
    if (!branchOk) {
      throw new NotFoundException({ code: "batches.branch_not_found", title: "Branch not found" });
    }
    if (body.facultyId) {
      const faculty = await this.repository.facultyExists(tenantId, body.facultyId);
      if (!faculty) {
        throw new NotFoundException({ code: "batches.faculty_not_found", title: "Faculty not found" });
      }
    }

    const created = await this.repository.create(tenantId, {
      programId: body.programId,
      branchId: body.branchId,
      facultyId: body.facultyId ?? null,
      name: body.name,
      startDate: new Date(body.startDate),
      endDate: body.endDate ? new Date(body.endDate) : null,
      capacity: body.capacity,
      mode: body.mode,
      schedule: body.schedule,
      status: body.status,
    });

    const row = await this.repository.findById(tenantId, created.id);
    if (!row) {
      throw new NotFoundException({ code: "batches.not_found", title: "Batch not found after creation" });
    }
    return toDetail(row);
  }

  async update(tenantId: string, actorId: string, id: string, body: UpdateBatchRequest): Promise<BatchDetail> {
    const existing = await this.repository.findById(tenantId, id);
    if (!existing) {
      throw new NotFoundException({ code: "batches.not_found", title: "Batch not found" });
    }
    const restriction = await this.resolveObjectRestriction(tenantId, actorId);
    this.assertRowInScope(existing, restriction);

    if (body.programId) {
      const programOk = await this.repository.programExists(tenantId, body.programId);
      if (!programOk) {
        throw new NotFoundException({ code: "batches.program_not_found", title: "Program not found" });
      }
    }
    if (body.branchId) {
      const branchOk = await this.repository.branchExists(tenantId, body.branchId);
      if (!branchOk) {
        throw new NotFoundException({ code: "batches.branch_not_found", title: "Branch not found" });
      }
    }
    if (body.facultyId) {
      const faculty = await this.repository.facultyExists(tenantId, body.facultyId);
      if (!faculty) {
        throw new NotFoundException({ code: "batches.faculty_not_found", title: "Faculty not found" });
      }
    }

    await this.repository.update(id, {
      ...(body.programId ? { programId: body.programId } : {}),
      ...(body.branchId ? { branchId: body.branchId } : {}),
      ...(body.facultyId !== undefined ? { facultyId: body.facultyId } : {}),
      ...(body.name ? { name: body.name } : {}),
      ...(body.startDate ? { startDate: new Date(body.startDate) } : {}),
      ...(body.endDate !== undefined ? { endDate: body.endDate ? new Date(body.endDate) : null } : {}),
      ...(body.capacity !== undefined ? { capacity: body.capacity } : {}),
      ...(body.mode ? { mode: body.mode } : {}),
      ...(body.schedule ? { schedule: body.schedule } : {}),
      ...(body.status ? { status: body.status } : {}),
    });

    const updated = await this.repository.findById(tenantId, id);
    if (!updated) {
      throw new NotFoundException({ code: "batches.not_found", title: "Batch not found after update" });
    }
    return toDetail(updated);
  }

  async assignFaculty(
    tenantId: string,
    actorId: string,
    id: string,
    body: AssignBatchFacultyRequest,
  ): Promise<BatchDetail> {
    const existing = await this.repository.findById(tenantId, id);
    if (!existing) {
      throw new NotFoundException({ code: "batches.not_found", title: "Batch not found" });
    }
    const restriction = await this.resolveObjectRestriction(tenantId, actorId);
    this.assertRowInScope(existing, restriction);

    if (body.facultyId) {
      const faculty = await this.repository.facultyExists(tenantId, body.facultyId);
      if (!faculty) {
        throw new NotFoundException({ code: "batches.faculty_not_found", title: "Faculty not found" });
      }
      // Sensible same-branch validation: a faculty member should normally be assigned to
      // a batch in their own branch (or have no branch yet). Not a hard schema constraint,
      // but a deliberate business rule so cross-branch mis-assignment fails fast.
      if (faculty.branchId && faculty.branchId !== existing.branchId) {
        throw new ConflictException({
          code: "batches.faculty_branch_mismatch",
          title: "Faculty branch mismatch",
          detail: "This faculty member belongs to a different branch than the batch.",
        });
      }
    }

    await this.repository.assignFaculty(id, body.facultyId ?? null);

    const updated = await this.repository.findById(tenantId, id);
    if (!updated) {
      throw new NotFoundException({ code: "batches.not_found", title: "Batch not found after assignment" });
    }
    return toDetail(updated);
  }

  async softDelete(tenantId: string, actorId: string, id: string): Promise<BatchDetail> {
    const existing = await this.repository.findById(tenantId, id);
    if (!existing) {
      throw new NotFoundException({ code: "batches.not_found", title: "Batch not found" });
    }
    const restriction = await this.resolveObjectRestriction(tenantId, actorId);
    this.assertRowInScope(existing, restriction);

    await this.repository.softDelete(id);
    const after = await this.repository.findById(tenantId, id, true);
    return toDetail(after!);
  }

  async restore(tenantId: string, actorId: string, id: string): Promise<BatchDetail> {
    const existing = await this.repository.findById(tenantId, id, true);
    if (!existing) {
      throw new NotFoundException({ code: "batches.not_found", title: "Batch not found" });
    }
    const restriction = await this.resolveObjectRestriction(tenantId, actorId);
    this.assertRowInScope(existing, restriction);

    await this.repository.restore(id);
    const after = await this.repository.findById(tenantId, id);
    return toDetail(after!);
  }

  async roster(tenantId: string, actorId: string, id: string): Promise<BatchRoster> {
    const existing = await this.repository.findById(tenantId, id);
    if (!existing) {
      throw new NotFoundException({ code: "batches.not_found", title: "Batch not found" });
    }
    const restriction = await this.resolveObjectRestriction(tenantId, actorId);
    this.assertRowInScope(existing, restriction);

    const rows = await this.repository.roster(id);
    return rows.map(toRosterEntry);
  }
}

function toSummary(row: BatchRow): BatchSummary {
  return {
    id: row.id,
    programId: row.programId,
    programTitle: row.programTitle,
    branchId: row.branchId,
    branchName: row.branchName,
    facultyId: row.facultyId,
    facultyName: row.facultyName,
    name: row.name,
    startDate: row.startDate.toISOString().slice(0, 10),
    endDate: row.endDate ? row.endDate.toISOString().slice(0, 10) : null,
    capacity: row.capacity,
    enrolledCount: row.enrolledCount,
    mode: row.mode as BatchSummary["mode"],
    status: row.status as BatchSummary["status"],
    createdAt: row.createdAt.toISOString(),
  };
}

function toDetail(row: BatchRow): BatchDetail {
  return {
    ...toSummary(row),
    schedule: Array.isArray(row.schedule) ? (row.schedule as BatchDetail["schedule"]) : [],
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toRosterEntry(row: BatchRosterRow): BatchRoster[number] {
  return {
    enrollmentId: row.enrollmentId,
    studentId: row.studentId,
    studentName: row.studentName,
    studentEmail: row.studentEmail,
    status: row.status as BatchRoster[number]["status"],
    progressPct: row.progressPct,
    enrolledAt: row.enrolledAt.toISOString(),
  };
}
