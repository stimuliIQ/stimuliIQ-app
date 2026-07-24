// Typed lesson-notes SDK (own-scope) — Phase 9 Completion, T10/T14/T29.

import type { CreateLessonNoteRequest, UpdateLessonNoteRequest, ListLessonNotesQuery, LessonNote } from "@repo/types";
import type { ApiClient } from "../http/client.js";
import { toQueryString } from "../http/query.js";

export class LessonNotesApi {
  constructor(private readonly client: ApiClient) {}

  /** GET /api/v1/me/lessons/:lessonId/notes */
  async list(lessonId: string, query: ListLessonNotesQuery) {
    return this.client.requestPaginated<LessonNote>(
      "GET",
      `/api/v1/me/lessons/${lessonId}/notes${toQueryString(query)}`,
    );
  }

  /** POST /api/v1/me/lessons/:lessonId/notes */
  async create(
    lessonId: string,
    body: CreateLessonNoteRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<LessonNote> {
    return this.client.request<LessonNote>("POST", `/api/v1/me/lessons/${lessonId}/notes`, { body, idempotencyKey });
  }

  /** PATCH /api/v1/me/lessons/:lessonId/notes/:noteId */
  async update(
    lessonId: string,
    noteId: string,
    body: UpdateLessonNoteRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<LessonNote> {
    return this.client.request<LessonNote>("PATCH", `/api/v1/me/lessons/${lessonId}/notes/${noteId}`, {
      body,
      idempotencyKey,
    });
  }

  /** DELETE /api/v1/me/lessons/:lessonId/notes/:noteId */
  // 204 No Content — nothing is returned.
  async remove(lessonId: string, noteId: string, idempotencyKey: string = crypto.randomUUID()): Promise<void> {
    await this.client.request<void>("DELETE", `/api/v1/me/lessons/${lessonId}/notes/${noteId}`, {
      idempotencyKey,
    });
  }
}
