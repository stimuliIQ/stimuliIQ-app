// apps/api/src/modules/lesson-notes/lesson-notes.service.ts
//
// Business logic for own-scope LMS lesson notes (docs/plans/phase-9-completion.md T29).
// Every write/read first passes the SAME enrollment gate content endpoints use
// (`resolveEnrollmentForLesson`, imported from the lms module — never re-implemented,
// per that file's own "do not copy the logic; import the function" contract) so a
// student cannot create/read notes on a lesson they cannot access (enrolled OR preview).

import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { LessonNote } from "@repo/types";
import { LessonNotesRepository, type LessonNoteRow } from "./lesson-notes.repository";
import { LmsRepository } from "../lms/lms.repository";
import { resolveEnrollmentForLesson } from "../lms/lms-enrollment-gate";
import { PaginatedResult } from "../../common/dto/paginated-result";
import type { CreateLessonNoteRequest, UpdateLessonNoteRequest, ListLessonNotesQuery } from "./dto";

@Injectable()
export class LessonNotesService {
  constructor(
    private readonly repository: LessonNotesRepository,
    private readonly lmsRepository: LmsRepository,
  ) {}

  /** 404s (no existence disclosure) if the lesson doesn't exist or isn't accessible to this user. */
  private async assertLessonAccessible(userId: string, tenantId: string, lessonId: string): Promise<void> {
    const gate = await resolveEnrollmentForLesson(userId, tenantId, lessonId, this.lmsRepository);
    if (!gate) {
      throw new NotFoundException({ code: "lesson_notes.lesson_not_found", title: "Lesson not found" });
    }
  }

  async create(
    tenantId: string,
    userId: string,
    lessonId: string,
    body: CreateLessonNoteRequest,
  ): Promise<LessonNote> {
    await this.assertLessonAccessible(userId, tenantId, lessonId);
    const row = await this.repository.create({
      tenantId,
      userId,
      lessonId,
      body: body.body,
      timestampS: body.timestampS,
    });
    return toDto(row);
  }

  async list(
    tenantId: string,
    userId: string,
    lessonId: string,
    query: ListLessonNotesQuery,
  ): Promise<PaginatedResult<LessonNote>> {
    await this.assertLessonAccessible(userId, tenantId, lessonId);
    const { rows, total } = await this.repository.list({
      tenantId,
      userId,
      lessonId,
      page: query.page,
      pageSize: query.pageSize,
    });
    return new PaginatedResult(rows.map(toDto), {
      page: query.page,
      pageSize: query.pageSize,
      total,
      hasMore: query.page * query.pageSize < total,
    });
  }

  async update(
    tenantId: string,
    userId: string,
    lessonId: string,
    noteId: string,
    body: UpdateLessonNoteRequest,
  ): Promise<LessonNote> {
    const existing = await this.repository.findById(tenantId, userId, lessonId, noteId);
    if (!existing) {
      throw new NotFoundException({ code: "lesson_notes.not_found", title: "Lesson note not found" });
    }
    if (body.body === undefined && body.timestampS === undefined) {
      throw new BadRequestException({
        code: "lesson_notes.empty_update",
        title: "Nothing to update",
        detail: "Provide at least one field to update.",
      });
    }
    await this.repository.update(noteId, { body: body.body, timestampS: body.timestampS });
    const updated = await this.repository.findById(tenantId, userId, lessonId, noteId);
    if (!updated) throw new NotFoundException({ code: "lesson_notes.not_found", title: "Lesson note not found after update" });
    return toDto(updated);
  }

  async remove(tenantId: string, userId: string, lessonId: string, noteId: string): Promise<void> {
    const existing = await this.repository.findById(tenantId, userId, lessonId, noteId);
    if (!existing) {
      throw new NotFoundException({ code: "lesson_notes.not_found", title: "Lesson note not found" });
    }
    await this.repository.softDelete(noteId);
  }
}

function toDto(row: LessonNoteRow): LessonNote {
  return {
    id: row.id,
    lessonId: row.lessonId,
    body: row.body,
    timestampS: row.timestampS,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
