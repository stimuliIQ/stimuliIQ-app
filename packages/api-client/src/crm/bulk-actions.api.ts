// Typed CRM bulk-actions SDK — Phase 9 Completion T30 follow-up (promoted from a
// backend-local schema; see @repo/types crm/bulk-actions.schemas.ts file header).
//
// Namespace: client.crm.bulk.*
//
// Row-level scope enforcement happens server-side (every id runs through the SAME
// already-scope-checked single-row service the equivalent single-item endpoint
// uses) — this SDK never needs to pre-filter ids itself. Per-row `success: false`
// covers BOTH "not found" and "outside the caller's scope" (IDOR-safe, no existence
// disclosure).

import type {
  BulkAssignLeadsRequest,
  BulkMoveLeadsStageRequest,
  BulkUpdateStudentsStatusRequest,
  BulkActionResponse,
} from "@repo/types";
import type { ApiClient } from "../http/client.js";

export class BulkActionsApi {
  constructor(private readonly client: ApiClient) {}

  /** POST /api/v1/crm/bulk/leads/assign — permission: bulk.leads */
  async assignLeads(
    body: BulkAssignLeadsRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<BulkActionResponse> {
    return this.client.request<BulkActionResponse>("POST", "/api/v1/crm/bulk/leads/assign", {
      body,
      idempotencyKey,
    });
  }

  /** POST /api/v1/crm/bulk/leads/stage — permission: bulk.leads */
  async moveLeadsStage(
    body: BulkMoveLeadsStageRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<BulkActionResponse> {
    return this.client.request<BulkActionResponse>("POST", "/api/v1/crm/bulk/leads/stage", {
      body,
      idempotencyKey,
    });
  }

  /** POST /api/v1/crm/bulk/students/status — permission: bulk.students */
  async updateStudentsStatus(
    body: BulkUpdateStudentsStatusRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<BulkActionResponse> {
    return this.client.request<BulkActionResponse>("POST", "/api/v1/crm/bulk/students/status", {
      body,
      idempotencyKey,
    });
  }
}
