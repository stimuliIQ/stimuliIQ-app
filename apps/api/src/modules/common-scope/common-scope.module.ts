// apps/api/src/modules/common-scope/common-scope.module.ts
//
// Wires `EnrollmentScopeRepository` (docs/04-trd-architecture.md §2.2 template) as a
// standalone, exported provider so any feature module (students/faculty/courses/batches/
// enrollments) can import `CommonScopeModule` and inject the shared scope-resolution
// helper without duplicating batches/enrollments scope queries.

import { Module } from "@nestjs/common";
import { EnrollmentScopeRepository } from "./enrollment-scope.repository";

@Module({
  providers: [EnrollmentScopeRepository],
  exports: [EnrollmentScopeRepository],
})
export class CommonScopeModule {}
