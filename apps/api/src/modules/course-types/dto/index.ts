// apps/api/src/modules/course-types/dto/index.ts
//
// Re-exports the course-type zod schemas from @repo/types (docs/04-trd-architecture.md
// §2.2 module template). Never redeclare a shape here — single source of truth stays in
// the shared package.

export {
  CreateCourseTypeRequestSchema,
  type CreateCourseTypeRequest,
  UpdateCourseTypeRequestSchema,
  type UpdateCourseTypeRequest,
  ListCourseTypesQuerySchema,
  type ListCourseTypesQuery,
  type CourseTypeOption,
} from "@repo/types";
