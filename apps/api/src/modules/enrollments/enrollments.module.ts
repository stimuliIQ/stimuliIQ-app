// apps/api/src/modules/enrollments/enrollments.module.ts
//
// Wires the enrollments feature module (docs/04-trd-architecture.md §2.2 template).

import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { StudentsModule } from "../students/students.module";
import { EnrollmentsController } from "./enrollments.controller";
import { EnrollmentsService } from "./enrollments.service";
import { EnrollmentsRepository } from "./enrollments.repository";

@Module({
  // StudentsModule: for LmsAccountProvisioningService (auto-provision LMS login on
  // enrollment — lifecycle-redesign P3).
  imports: [AuthModule, StudentsModule],
  controllers: [EnrollmentsController],
  providers: [EnrollmentsService, EnrollmentsRepository],
  exports: [EnrollmentsRepository],
})
export class EnrollmentsModule {}
