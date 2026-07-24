// apps/api/src/modules/live-classes/dto/index.ts
//
// Re-exports the Phase-9 Live Class zod schemas from @repo/types (docs/04-trd-architecture.md
// §2.2 module template). Never redeclare a shape here — single source of truth stays in
// packages/types/src/live/live-classes.schemas.ts.

export {
  LiveClassProviderSchema,
  type LiveClassProvider,
  LiveClassStatusSchema,
  type LiveClassStatus,
  CreateLiveClassRequestSchema,
  type CreateLiveClassRequest,
  UpdateLiveClassRequestSchema,
  type UpdateLiveClassRequest,
  CancelLiveClassRequestSchema,
  type CancelLiveClassRequest,
  ListLiveClassesQuerySchema,
  type ListLiveClassesQuery,
  ListMyLiveClassesQuerySchema,
  type ListMyLiveClassesQuery,
  LiveClassSummarySchema,
  type LiveClassSummary,
  LiveClassDetailSchema,
  type LiveClassDetail,
  MyLiveClassSchema,
  type MyLiveClass,
  JoinLiveClassResponseSchema,
  type JoinLiveClassResponse,
  LiveClassAttendanceSyncResultSchema,
  type LiveClassAttendanceSyncResult,
} from "@repo/types";
