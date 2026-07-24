// Typed courses/curriculum SDK — programs CRUD + publish/unpublish +
// modules/lessons CRUD + reorder, over /api/v1/crm/courses.

import type {
  ListProgramsQuery,
  ProgramSummary,
  ProgramDetail,
  CreateProgramRequest,
  UpdateProgramRequest,
  SetProgramVisibilityRequest,
  CurriculumTree,
  ModuleNode,
  CreateModuleRequest,
  UpdateModuleRequest,
  ReorderModulesRequest,
  LessonNode,
  CreateLessonRequest,
  UpdateLessonRequest,
  ReorderLessonsRequest,
  ProgramImageUploadUrlRequest,
  LessonResourceUploadUrlRequest,
  CreateLessonResourceRequest,
  LessonResource,
  SignedUploadResponse,
} from "@repo/types";
import type { ApiClient } from "../http/client.js";
import { toQueryString } from "../http/query.js";

export class CoursesApi {
  constructor(private readonly client: ApiClient) {}

  /** GET /api/v1/crm/courses */
  async list(query: ListProgramsQuery) {
    return this.client.requestPaginated<ProgramSummary>(
      "GET",
      `/api/v1/crm/courses${toQueryString(query)}`,
    );
  }

  /** GET /api/v1/crm/courses/:id */
  async get(id: string): Promise<ProgramDetail> {
    return this.client.request<ProgramDetail>("GET", `/api/v1/crm/courses/${id}`);
  }

  /**
   * POST /api/v1/crm/courses/image-upload-url — mint a short-lived signed PUT URL for a
   * course card/OG image. Then PUT the file to `uploadUrl` (with `additionalHeaders`) and
   * pass the returned `storageKey` back as `ogImageKey` on create/update.
   */
  async imageUploadUrl(body: ProgramImageUploadUrlRequest): Promise<SignedUploadResponse> {
    return this.client.request<SignedUploadResponse>("POST", "/api/v1/crm/courses/image-upload-url", { body });
  }

  // ─── Lesson resources (PDF / slides / datasets) ─────────────────────────
  //
  // A lesson has MANY resources (1:N), unlike video which is 1:1. Two-step
  // ingest, same as the course image: mint a signed PUT → upload the file
  // directly to storage → register the returned `storageKey`.
  // The raw storageKey is server-internal and never appears in a read DTO.

  /** POST /api/v1/crm/courses/lessons/:lessonId/resources/upload-url — permission: courses.edit */
  async resourceUploadUrl(
    lessonId: string,
    body: LessonResourceUploadUrlRequest,
  ): Promise<SignedUploadResponse> {
    return this.client.request<SignedUploadResponse>(
      "POST",
      `/api/v1/crm/courses/lessons/${lessonId}/resources/upload-url`,
      { body },
    );
  }

  /** GET /api/v1/crm/courses/lessons/:lessonId/resources — permission: courses.view */
  async listLessonResources(lessonId: string): Promise<LessonResource[]> {
    return this.client.request<LessonResource[]>(
      "GET",
      `/api/v1/crm/courses/lessons/${lessonId}/resources`,
    );
  }

  /** POST /api/v1/crm/courses/lessons/:lessonId/resources — permission: courses.edit */
  async createLessonResource(
    lessonId: string,
    body: CreateLessonResourceRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<LessonResource> {
    return this.client.request<LessonResource>(
      "POST",
      `/api/v1/crm/courses/lessons/${lessonId}/resources`,
      { body, idempotencyKey },
    );
  }

  /** DELETE /api/v1/crm/courses/lessons/resources/:resourceId — soft delete. Permission: courses.edit */
  async deleteLessonResource(
    resourceId: string,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<void> {
    return this.client.request<void>(
      "DELETE",
      `/api/v1/crm/courses/lessons/resources/${resourceId}`,
      { idempotencyKey },
    );
  }

  /** POST /api/v1/crm/courses */
  async create(body: CreateProgramRequest, idempotencyKey: string = crypto.randomUUID()): Promise<ProgramDetail> {
    return this.client.request<ProgramDetail>("POST", "/api/v1/crm/courses", { body, idempotencyKey });
  }

  /** PATCH /api/v1/crm/courses/:id */
  async update(
    id: string,
    body: UpdateProgramRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<ProgramDetail> {
    return this.client.request<ProgramDetail>("PATCH", `/api/v1/crm/courses/${id}`, { body, idempotencyKey });
  }

  /** POST /api/v1/crm/courses/:id/publish */
  async publish(id: string, idempotencyKey: string = crypto.randomUUID()): Promise<ProgramDetail> {
    return this.client.request<ProgramDetail>("POST", `/api/v1/crm/courses/${id}/publish`, {
      body: {},
      idempotencyKey,
    });
  }

  /** POST /api/v1/crm/courses/:id/unpublish */
  async unpublish(id: string, idempotencyKey: string = crypto.randomUUID()): Promise<ProgramDetail> {
    return this.client.request<ProgramDetail>("POST", `/api/v1/crm/courses/${id}/unpublish`, {
      body: {},
      idempotencyKey,
    });
  }

  /** PATCH /api/v1/crm/courses/:id/visibility — toggle the marketing `isPublic` flag. */
  async setVisibility(
    id: string,
    body: SetProgramVisibilityRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<ProgramDetail> {
    return this.client.request<ProgramDetail>("PATCH", `/api/v1/crm/courses/${id}/visibility`, { body, idempotencyKey });
  }

  /** GET /api/v1/crm/courses/:id/curriculum — the full program -> modules -> lessons tree. */
  async getCurriculum(id: string): Promise<CurriculumTree> {
    return this.client.request<CurriculumTree>("GET", `/api/v1/crm/courses/${id}/curriculum`);
  }

  /** POST /api/v1/crm/courses/:id/modules */
  async createModule(
    programId: string,
    body: CreateModuleRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<ModuleNode> {
    return this.client.request<ModuleNode>("POST", `/api/v1/crm/courses/${programId}/modules`, {
      body,
      idempotencyKey,
    });
  }

  /** PATCH /api/v1/crm/courses/:id/modules/:moduleId */
  async updateModule(
    programId: string,
    moduleId: string,
    body: UpdateModuleRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<ModuleNode> {
    return this.client.request<ModuleNode>(
      "PATCH",
      `/api/v1/crm/courses/${programId}/modules/${moduleId}`,
      { body, idempotencyKey },
    );
  }

  /** POST /api/v1/crm/courses/:id/modules/reorder — returns the curriculum tree post-reorder. */
  async reorderModules(
    programId: string,
    body: ReorderModulesRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<CurriculumTree> {
    return this.client.request<CurriculumTree>(
      "POST",
      `/api/v1/crm/courses/${programId}/modules/reorder`,
      { body, idempotencyKey },
    );
  }

  /** POST /api/v1/crm/courses/:id/modules/:moduleId/lessons */
  async createLesson(
    programId: string,
    moduleId: string,
    body: CreateLessonRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<LessonNode> {
    return this.client.request<LessonNode>(
      "POST",
      `/api/v1/crm/courses/${programId}/modules/${moduleId}/lessons`,
      { body, idempotencyKey },
    );
  }

  /** PATCH /api/v1/crm/courses/:id/modules/:moduleId/lessons/:lessonId */
  async updateLesson(
    programId: string,
    moduleId: string,
    lessonId: string,
    body: UpdateLessonRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<LessonNode> {
    return this.client.request<LessonNode>(
      "PATCH",
      `/api/v1/crm/courses/${programId}/modules/${moduleId}/lessons/${lessonId}`,
      { body, idempotencyKey },
    );
  }

  /** POST /api/v1/crm/courses/:id/modules/:moduleId/lessons/reorder — returns the curriculum tree post-reorder. */
  async reorderLessons(
    programId: string,
    moduleId: string,
    body: ReorderLessonsRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<CurriculumTree> {
    return this.client.request<CurriculumTree>(
      "POST",
      `/api/v1/crm/courses/${programId}/modules/${moduleId}/lessons/reorder`,
      { body, idempotencyKey },
    );
  }
}
