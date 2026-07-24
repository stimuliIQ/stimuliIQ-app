// apps/api/src/modules/lms/dto/index.ts
//
// DTO re-export barrel for the LMS module (docs/04 §2.2 module template).
// All DTO types/schemas are imported from @repo/types — this is the re-export
// barrel that controllers/services import for convenience, matching the pattern
// used by commerce, students, and other modules.
//
// IMPORTANT: DTOs are never declared here — they live in @repo/types.
// This barrel only re-exports the exact shapes used by the LMS module's
// controllers and services, keeping the module's dependency on @repo/types
// explicit and tree-shakeable.

export {
  // Dashboard
  MeDashboardResponseSchema,
  type MeDashboardResponse,
  EnrollmentCardSchema,
  type EnrollmentCard,
  ContinueLearningItemSchema,
  type ContinueLearningItem,
  UpcomingLessonItemSchema,
  type UpcomingLessonItem,
  ProgramProgressSummarySchema,
  type ProgramProgressSummary,
} from "@repo/types";

export {
  // LMS Enrollments (student surface)
  ListMyEnrollmentsQuerySchema,
  type ListMyEnrollmentsQuery,
  MyEnrollmentSummarySchema,
  type MyEnrollmentSummary,
  MyEnrollmentDetailSchema,
  type MyEnrollmentDetail,
} from "@repo/types";

export {
  // Curriculum
  CurriculumResponseSchema,
  type CurriculumResponse,
  CurriculumModuleNodeSchema,
  type CurriculumModuleNode,
  CurriculumLessonNodeSchema,
  type CurriculumLessonNode,
  LessonProgressSnapshotSchema,
  type LessonProgressSnapshot,
  LessonProgressStatusSchema,
  type LessonProgressStatus,
} from "@repo/types";

export {
  // Lessons + stream-url (the critical endpoint)
  LessonDetailResponseSchema,
  type LessonDetailResponse,
  StreamUrlResponseSchema,
  type StreamUrlResponse,
  WatermarkPayloadSchema,
  type WatermarkPayload,
  VideoMetaSchema,
  type VideoMeta,
  VideoStatusSchema,
  type VideoStatus,
  ResourceMetaSchema,
  type ResourceMeta,
} from "@repo/types";

export {
  // Progress (wave 4b — exported here for seam sharing)
  UpdateProgressRequestSchema,
  type UpdateProgressRequest,
  MarkLessonCompleteRequestSchema,
  type MarkLessonCompleteRequest,
  ProgressResponseSchema,
  type ProgressResponse,
  MyProgressResponseSchema,
  type MyProgressResponse,
} from "@repo/types";

export {
  // Attendance (wave 4b — exported here for seam sharing)
  ListMyAttendanceQuerySchema,
  type ListMyAttendanceQuery,
  MyAttendanceItemSchema,
  type MyAttendanceItem,
  MyAttendanceResponseSchema,
  type MyAttendanceResponse,
} from "@repo/types";
