// apps/api/src/modules/courses/courses.module.ts
//
// Wires the courses feature module (docs/04-trd-architecture.md §2.2 template). Imports
// AuthModule for the guards/interceptor it reuses (JwtAuthGuard, PermissionsGuard,
// ScopeInterceptor) rather than redeclaring providers — single DI source per CLAUDE.md §3.

import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { StorageProviderModule } from "../storage/providers/storage/storage-provider.module";
import { CoursesController } from "./courses.controller";
import { CoursesService } from "./courses.service";
import { CoursesRepository } from "./courses.repository";

@Module({
  imports: [AuthModule, StorageProviderModule],
  controllers: [CoursesController],
  providers: [CoursesService, CoursesRepository],
  exports: [CoursesRepository],
})
export class CoursesModule {}
