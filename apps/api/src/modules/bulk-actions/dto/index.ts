// apps/api/src/modules/bulk-actions/dto/index.ts
//
// Re-exports this module's LOCAL zod schemas (see bulk-actions.schemas.ts's header for
// why these are NOT in @repo/types yet — a documented, flagged stopgap).

export {
  MAX_BULK_IDS,
  BulkAssignLeadsRequestSchema,
  type BulkAssignLeadsRequest,
  BulkMoveLeadsStageRequestSchema,
  type BulkMoveLeadsStageRequest,
  BulkUpdateStudentsStatusRequestSchema,
  type BulkUpdateStudentsStatusRequest,
  BulkActionResultSchema,
  type BulkActionResult,
  BulkActionResponseSchema,
  type BulkActionResponse,
  SavedViewModuleSchema,
  type SavedViewModule,
  CreateSavedViewRequestSchema,
  type CreateSavedViewRequest,
  ListSavedViewsQuerySchema,
  type ListSavedViewsQuery,
  SavedViewSchema,
  type SavedView,
} from "./bulk-actions.schemas";
