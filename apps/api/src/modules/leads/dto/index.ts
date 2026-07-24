// apps/api/src/modules/leads/dto/index.ts
//
// Re-exports the leads/activities/bookings zod schemas from @repo/types
// (docs/04-trd-architecture.md §2.2 module template). Never redeclare a shape here —
// single source of truth stays in the shared package.

export {
  // Leads
  LeadStageSchema,
  type LeadStage,
  LeadUtmSchema,
  type LeadUtm,
  CreateLeadRequestSchema,
  type CreateLeadRequest,
  UpdateLeadRequestSchema,
  type UpdateLeadRequest,
  ListLeadsQuerySchema,
  type ListLeadsQuery,
  MoveLeadStageRequestSchema,
  type MoveLeadStageRequest,
  AssignLeadOwnerRequestSchema,
  type AssignLeadOwnerRequest,
  ConvertLeadRequestSchema,
  type ConvertLeadRequest,
  type LeadSummary,
  type LeadDetail,
  type ConvertLeadResponse,
  // Activities
  ActivityTypeSchema,
  type ActivityType,
  ActivityPayloadSchema,
  type ActivityPayload,
  CreateActivityRequestSchema,
  type CreateActivityRequest,
  CompleteTaskRequestSchema,
  type CompleteTaskRequest,
  ListActivitiesQuerySchema,
  type ListActivitiesQuery,
  type ActivityDetail,
  // Bookings
  BookingStatusSchema,
  type BookingStatus,
  CreateBookingRequestSchema,
  type CreateBookingRequest,
  UpdateBookingRequestSchema,
  type UpdateBookingRequest,
  MoveBookingStatusRequestSchema,
  type MoveBookingStatusRequest,
  ListBookingsQuerySchema,
  type ListBookingsQuery,
  CreatePublicBookingRequestSchema,
  type CreatePublicBookingRequest,
  type PublicBookingResponse,
  type BookingSummary,
  type BookingDetail,
  // Students (needed for conversion's studentFields subset)
  CreateStudentRequestSchema,
  type CreateStudentRequest,
} from "@repo/types";
