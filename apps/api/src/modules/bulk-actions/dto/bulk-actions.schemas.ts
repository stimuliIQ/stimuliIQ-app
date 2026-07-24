// apps/api/src/modules/bulk-actions/dto/bulk-actions.schemas.ts
//
// STOPGAP CONTRACT (documented deviation from the module template — see file header of
// dto/index.ts in this directory for the full rationale): every other module's dto/
// index.ts re-exports schemas whose single source of truth lives in @repo/types
// (docs/04-trd-architecture.md §2.2). Bulk-action / saved-view / per-city-SEO /
// bundle-pricing request+response shapes were NOT added to @repo/types in this task's
// Wave-2 contracts pass (verified: no bulk/saved-view/city-seo/bundle schema exists
// anywhere under packages/types/src as of this task), and this task's brief explicitly
// scopes backend-builder to `apps/api` only ("Do NOT touch packages/* or any frontend").
// Rather than skip T30 entirely or silently violate that boundary, these schemas are
// defined here, LOCAL to apps/api, validated via the SAME ZodValidationPipe every other
// endpoint uses. FOLLOW-UP (flagged in the task's final report): api-designer should
// promote these to packages/types/src/crm/bulk-actions.schemas.ts (+ saved-views +
// growth) in a subsequent pass so `@repo/api-client`/frontend can consume the same
// contract — nothing below should be treated as a second permanent source of truth.

import { z } from "zod";
import { UuidSchema, PageQuerySchema, LeadStageSchema, StudentStatusSchema } from "@repo/types";

/** Shared cap on how many ids one bulk-action request may target in a single call. */
export const MAX_BULK_IDS = 200;

const IdsSchema = z.array(UuidSchema).min(1).max(MAX_BULK_IDS);

// ─────────────────────────────────────────────────────────────────────────
// Bulk actions — leads
// ─────────────────────────────────────────────────────────────────────────

/** POST /api/v1/crm/bulk/leads/assign */
export const BulkAssignLeadsRequestSchema = z
  .object({
    ids: IdsSchema,
    ownerId: UuidSchema.nullable().describe("User to assign as owner, or null to unassign."),
  })
  .strict();
export type BulkAssignLeadsRequest = z.infer<typeof BulkAssignLeadsRequestSchema>;

/** POST /api/v1/crm/bulk/leads/stage */
export const BulkMoveLeadsStageRequestSchema = z
  .object({
    ids: IdsSchema,
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
    ids: IdsSchema,
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

// ─────────────────────────────────────────────────────────────────────────
// Saved views — own-scope, per (userId, module)
// ─────────────────────────────────────────────────────────────────────────

export const SavedViewModuleSchema = z.enum(["leads", "students"]);
export type SavedViewModule = z.infer<typeof SavedViewModuleSchema>;

/** POST /api/v1/crm/saved-views */
export const CreateSavedViewRequestSchema = z
  .object({
    module: SavedViewModuleSchema,
    name: z.string().min(1).max(80),
    filters: z.record(z.string(), z.unknown()).describe("Opaque filter-set — echoed back verbatim, never interpreted server-side."),
  })
  .strict();
export type CreateSavedViewRequest = z.infer<typeof CreateSavedViewRequestSchema>;

/** GET /api/v1/crm/saved-views */
export const ListSavedViewsQuerySchema = z
  .object({
    module: SavedViewModuleSchema.optional(),
  })
  .merge(PageQuerySchema)
  .strict();
export type ListSavedViewsQuery = z.infer<typeof ListSavedViewsQuerySchema>;

export const SavedViewSchema = z.object({
  id: UuidSchema,
  module: SavedViewModuleSchema,
  name: z.string(),
  filters: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});
export type SavedView = z.infer<typeof SavedViewSchema>;
