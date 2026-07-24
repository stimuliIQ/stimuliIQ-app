// apps/api/src/modules/search/search.module.ts
//
// Phase-9 Completion T29 — global search across lessons/resources/forum threads,
// own-enrolled scope (docs/plans/phase-9-completion.md). Imports LmsModule for
// LmsRepository.findStudentProfileId (userId -> student_profiles.id resolution).

import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { LmsModule } from "../lms/lms.module";
import { SearchController } from "./search.controller";
import { SearchService } from "./search.service";
import { SearchRepository } from "./search.repository";

@Module({
  imports: [AuthModule, LmsModule],
  controllers: [SearchController],
  providers: [SearchService, SearchRepository],
  exports: [SearchService, SearchRepository],
})
export class SearchModule {}
