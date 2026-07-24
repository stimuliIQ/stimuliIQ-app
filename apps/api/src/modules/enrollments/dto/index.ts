// apps/api/src/modules/enrollments/dto/index.ts
//
// Re-exports the enrollments zod schemas from @repo/types (docs/04-trd-architecture.md
// §2.2 module template). Never redeclare a shape here — single source of truth stays in
// the shared package.

export {
  CreateEnrollmentRequestSchema,
  type CreateEnrollmentRequest,
  MoveEnrollmentRequestSchema,
  type MoveEnrollmentRequest,
  WithdrawEnrollmentRequestSchema,
  type WithdrawEnrollmentRequest,
  ListEnrollmentsQuerySchema,
  type ListEnrollmentsQuery,
  type Enrollment,
  type EnrollmentStatus,
} from "@repo/types";
