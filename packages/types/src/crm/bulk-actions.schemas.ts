// packages/types/src/crm/bulk-actions.schemas.ts
//
// Shared contract for CRM bulk actions (Phase 9 Completion T30) — PROMOTED from the
// STOPGAP local schema at apps/api/src/modules/bulk-actions/dto/bulk-actions.schemas.ts
// (see that file's header for the full original rationale: it was declared local to
// apps/api because this task's brief scoped backend-builder to apps/api only). This
// package is now the canonical shared contract; the backend controller/service
// currently still import their own local copy — the two shapes MUST stay
// structurally identical (mirrored 1:1 field-for-field, not re-derived).
//
// Endpoints:
//   POST /api/v1/crm/bulk/leads/assign     — permission: bulk.leads
//   POST /api/v1/crm/bulk/leads/stage      — permission: bulk.leads
//   POST /api/v1/crm/bulk/students/status  — permission: bulk.students
//
// Row-level scope enforcement: every id runs through the SAME already-scope-checked,
// already-audited single-row service method the corresponding single-item endpoint
// uses — a bulk action never has broader reach than the equivalent one-at-a-time
// action. Per-row `success: false` covers BOTH "row not found" and "row outside the
// caller's data-scope" — indistinguishable by design (IDOR posture: no existence
// disclosure for out-of-scope rows, same as every other module's single-item endpoints).
//
// All request schemas are .strict() (CLAUDE.md §3.2 — the global ZodValidationPipe
// strips extras).

import { z } from "zod";
import { UuidSchema } from "../common/primitives.js";
import { LeadStageSchema } from "./leads.schemas.js";
import { StudentStatusSchema } from "./students.schemas.js";

/** Shared cap on how many ids one bulk-action request may target in a single call. */
export const MAX_BULK_IDS = 200;

const BulkIdsSchema = z.array(UuidSchema).min(1).max(MAX_BULK_IDS);

// ─────────────────────────────────────────────────────────────────────────
// Bulk actions — leads
// ─────────────────────────────────────────────────────────────────────────

/** POST /api/v1/crm/bulk/leads/assign */
export const BulkAssignLeadsRequestSchema = z
  .object({
    ids: BulkIdsSchema,
    ownerId: UuidSchema.nullable().describe("User to assign as owner, or null to unassign."),
  })
  .strict();
export type BulkAssignLeadsRequest = z.infer<typeof BulkAssignLeadsRequestSchema>;

/** POST /api/v1/crm/bulk/leads/stage */
export const BulkMoveLeadsStageRequestSchema = z
  .object({
    ids: BulkIdsSchema,
    stage: LeadStageSchema,
  })
  .strict();
export type BulkMoveLeadsStageRequest = z.infer<typeof BulkMoveLeadsStageRequestSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Bulk actions — students
// ─────────────────────────────────────────────────────────────────────────

/** POST /api/v1/crm/bulk/students/status */
export const BulkUpdateStudentsStatusRequestSchema = z
  .object({
    ids: BulkIdsSchema,
    status: StudentStatusSchema,
  })
  .strict();
export type BulkUpdateStudentsStatusRequest = z.infer<typeof BulkUpdateStudentsStatusRequestSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Bulk action result — shared response shape
// ─────────────────────────────────────────────────────────────────────────

/**
 * Per-row outcome. `success: false` covers BOTH "row not found" and "row outside the
 * caller's data-scope" — indistinguishable by design (IDOR posture: no existence
 * disclosure for out-of-scope rows, same as every other module's single-item endpoints).
 */
export const BulkActionResultSchema = z.object({
  id: UuidSchema,
  success: z.boolean(),
  error: z.string().nullable(),
});
export type BulkActionResult = z.infer<typeof BulkActionResultSchema>;

export const BulkActionResponseSchema = z.object({
  results: z.array(BulkActionResultSchema),
  successCount: z.number().int().min(0),
  failureCount: z.number().int().min(0),
});
export type BulkActionResponse = z.infer<typeof BulkActionResponseSchema>;
