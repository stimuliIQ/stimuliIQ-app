// apps/api/src/modules/batches/dto/index.ts
//
// Re-exports the batches zod schemas from @repo/types (docs/04-trd-architecture.md §2.2
// module template). Never redeclare a shape here — single source of truth stays in the
// shared package.

export {
  CreateBatchRequestSchema,
  type CreateBatchRequest,
  UpdateBatchRequestSchema,
  type UpdateBatchRequest,
  ListBatchesQuerySchema,
  type ListBatchesQuery,
  AssignBatchFacultyRequestSchema,
  type AssignBatchFacultyRequest,
  RestoreBatchRequestSchema,
  type RestoreBatchRequest,
  type BatchSummary,
  type BatchDetail,
  type BatchRoster,
  type BatchRosterEntry,
  type BatchMode,
  type BatchStatus,
} from "@repo/types";
