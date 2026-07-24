// apps/api/src/modules/batches/batches.module.ts
//
// Wires the batches feature module (docs/04-trd-architecture.md §2.2 template). Exports
// `BatchesRepository` so the enrollments module can depend on it for capacity checks
// (`countActiveEnrollments`) and batch existence/branch lookups without duplicating Prisma
// access.

import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { BatchesController } from "./batches.controller";
import { BatchesService } from "./batches.service";
import { BatchesRepository } from "./batches.repository";

@Module({
  imports: [AuthModule],
  controllers: [BatchesController],
  providers: [BatchesService, BatchesRepository],
  exports: [BatchesRepository],
})
export class BatchesModule {}
