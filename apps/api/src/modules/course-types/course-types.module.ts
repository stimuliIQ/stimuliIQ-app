// apps/api/src/modules/course-types/course-types.module.ts
//
// CRM-managed course types (docs/specs/course-types.md, ADR-0068) — the list that replaced
// the `StudentCourseType` enum.
//
// Imports AuthModule only (guards). Exports CourseTypesService because the students module
// depends on it for both halves of the contract: `assertKnownKey` on every write and
// `labelMap` on every read. That dependency is one-way — nothing here knows about students
// beyond counting how many hold a key.
import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";

import { CourseTypesController } from "./course-types.controller";
import { CourseTypesRepository } from "./course-types.repository";
import { CourseTypesService } from "./course-types.service";

@Module({
  imports: [AuthModule],
  controllers: [CourseTypesController],
  providers: [CourseTypesService, CourseTypesRepository],
  exports: [CourseTypesService],
})
export class CourseTypesModule {}
