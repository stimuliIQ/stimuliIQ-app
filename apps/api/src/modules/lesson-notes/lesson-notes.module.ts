// apps/api/src/modules/lesson-notes/lesson-notes.module.ts
//
// Phase-9 Completion T29 — own-scope LMS lesson notes (docs/plans/phase-9-completion.md).
// Imports LmsModule for LmsRepository (the enrollment gate's dependency — see
// lesson-notes.service.ts's `assertLessonAccessible`).

import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { LmsModule } from "../lms/lms.module";
import { LessonNotesController } from "./lesson-notes.controller";
import { LessonNotesService } from "./lesson-notes.service";
import { LessonNotesRepository } from "./lesson-notes.repository";

@Module({
  imports: [AuthModule, LmsModule],
  controllers: [LessonNotesController],
  providers: [LessonNotesService, LessonNotesRepository],
  exports: [LessonNotesService, LessonNotesRepository],
})
export class LessonNotesModule {}
