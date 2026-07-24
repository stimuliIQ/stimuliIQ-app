// apps/api/src/modules/bulk-actions/bulk-actions.service.ts
//
// Business logic for bulk actions on leads/students (docs/plans/phase-9-completion.md
// T30). No Prisma here.
//
// ─── ROW-LEVEL SCOPE ENFORCEMENT — THE HEADLINE REQUIREMENT ───────────────────────
//
// "Never trust a client-supplied id list — filter to rows the caller may act on"
// (task brief). This is achieved by NOT re-implementing scope resolution here at all:
// every id in the request is run through the EXACT SAME already-scope-checked,
// already-audited, already-IDOR-safe single-row service method the corresponding
// single-item endpoint uses (`LeadsService.assignOwner`/`moveStage`,
// `StudentsService.update`). Those methods call `requireScopeContext()` internally,
// which reads the ScopeContext THIS request's `ScopeInterceptor` resolved from the
// `bulk.leads`/`bulk.students` permission grant matched at the controller boundary — so
// a counsellor's bulk-assign is transparently restricted to their OWN leads, a branch
// manager's bulk-status-update to their OWN branch's students, etc., with ZERO
// duplicated scope logic. An id outside the caller's scope surfaces as the SAME
// `NotFoundException` the single-item endpoint would throw (IDOR-safe: no existence
// disclosure) — caught here per-row and reported as `{ id, success: false }` rather than
// aborting the whole batch.
//
// Every successful row write goes through the underlying repository's normal
// `.update()`/`.assignOwner()`/`.moveStage()` call, which the Prisma audit extension
// intercepts individually — so "audited per row" falls out of this design for free,
// with no separate audit-log plumbing needed here.

import { Injectable, Logger } from "@nestjs/common";
import { LeadsService } from "../leads/leads.service";
import { StudentsService } from "../students/students.service";
import type {
  BulkActionResponse,
  BulkActionResult,
  BulkAssignLeadsRequest,
  BulkMoveLeadsStageRequest,
  BulkUpdateStudentsStatusRequest,
} from "./dto";

@Injectable()
export class BulkActionsService {
  private readonly logger = new Logger(BulkActionsService.name);

  constructor(
    private readonly leadsService: LeadsService,
    private readonly studentsService: StudentsService,
  ) {}

  private async runPerRow(ids: string[], action: (id: string) => Promise<void>): Promise<BulkActionResponse> {
    const results: BulkActionResult[] = [];
    for (const id of ids) {
      try {
        await action(id);
        results.push({ id, success: true, error: null });
      } catch (err) {
        // A per-row failure (out-of-scope -> 404, validation error, invalid transition,
        // etc.) must never abort the rest of the batch — isolate + report it.
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`[BulkActionsService] row id=${id} failed (non-fatal, continuing batch): ${message}`);
        results.push({ id, success: false, error: message });
      }
    }
    const successCount = results.filter((r) => r.success).length;
    return { results, successCount, failureCount: results.length - successCount };
  }

  async bulkAssignLeads(tenantId: string, body: BulkAssignLeadsRequest): Promise<BulkActionResponse> {
    return this.runPerRow(body.ids, async (id) => {
      await this.leadsService.assignOwner(tenantId, id, { ownerId: body.ownerId });
    });
  }

  async bulkMoveLeadsStage(tenantId: string, body: BulkMoveLeadsStageRequest): Promise<BulkActionResponse> {
    return this.runPerRow(body.ids, async (id) => {
      await this.leadsService.moveStage(tenantId, id, { stage: body.stage });
    });
  }

  async bulkUpdateStudentsStatus(tenantId: string, body: BulkUpdateStudentsStatusRequest): Promise<BulkActionResponse> {
    return this.runPerRow(body.ids, async (id) => {
      await this.studentsService.update(tenantId, id, { status: body.status });
    });
  }
}
