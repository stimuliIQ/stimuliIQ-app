// apps/api/src/modules/careers/dto/index.ts
//
// Re-export barrel for the careers module's contracts. Follows the same convention as
// every other module's `dto/index.ts`: the API NEVER defines its own request/response
// shapes — they live in `@repo/types` so the CRM, the marketing site and the API validate
// against one source of truth (CLAUDE.md §3.2). This file exists purely so controllers
// import from a short relative path and the module's surface is visible in one place.

export {
  // ── Openings ──
  JobOpeningStatusSchema,
  type JobOpeningStatus,
  JobOpeningWorkModeSchema,
  type JobOpeningWorkMode,
  PublicJobOpeningSchema,
  type PublicJobOpening,
  ListPublicJobOpeningsQuerySchema,
  type ListPublicJobOpeningsQuery,
  JobOpeningSchema,
  type JobOpening,
  CreateJobOpeningRequestSchema,
  type CreateJobOpeningRequest,
  UpdateJobOpeningRequestSchema,
  type UpdateJobOpeningRequest,
  ListJobOpeningsQuerySchema,
  type ListJobOpeningsQuery,

  // ── Applications: public ──
  SubmitCareerApplicationRequestSchema,
  type SubmitCareerApplicationRequest,
  SubmitCareerApplicationResponseSchema,
  type SubmitCareerApplicationResponse,
  PublicCareerResumeUploadUrlRequestSchema,
  type PublicCareerResumeUploadUrlRequest,
  PublicCareerResumeUploadUrlResponseSchema,
  type PublicCareerResumeUploadUrlResponse,

  // ── Applications: CRM reads ──
  CareerApplicationStatusSchema,
  type CareerApplicationStatus,
  ListCareerApplicationsQuerySchema,
  type ListCareerApplicationsQuery,
  CareerApplicationSummarySchema,
  type CareerApplicationSummary,
  CareerApplicationDetailSchema,
  type CareerApplicationDetail,

  // ── Applications: the four review verbs ──
  HoldCareerApplicationRequestSchema,
  type HoldCareerApplicationRequest,
  ShortlistCareerApplicationRequestSchema,
  type ShortlistCareerApplicationRequest,
  OfferCareerApplicationRequestSchema,
  type OfferCareerApplicationRequest,
  RejectCareerApplicationRequestSchema,
  type RejectCareerApplicationRequest,

  // ── Applications: supporting actions ──
  OfferLetterUploadUrlRequestSchema,
  type OfferLetterUploadUrlRequest,
  ResendAcknowledgementResponseSchema,
  type ResendAcknowledgementResponse,
  type SignedUploadResponse,
} from "@repo/types";
