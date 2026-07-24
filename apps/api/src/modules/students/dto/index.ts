// apps/api/src/modules/students/dto/index.ts
//
// Re-exports the students zod schemas from @repo/types (docs/04-trd-architecture.md
// §2.2 module template). Never redeclare a shape here — single source of truth stays
// in the shared package.

export {
  CreateStudentRequestSchema,
  type CreateStudentRequest,
  UpdateStudentRequestSchema,
  type UpdateStudentRequest,
  ListStudentsQuerySchema,
  type ListStudentsQuery,
  RestoreStudentRequestSchema,
  type RestoreStudentRequest,
  type StudentSummary,
  type StudentDetail,
  type ResendCredentialsResponse,
} from "@repo/types";
