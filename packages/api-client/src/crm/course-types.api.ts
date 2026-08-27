// Typed course-types SDK (CRM). Spec: docs/specs/course-types.md, ADR-0068.
// Exposed on the SDK as `client.crm.courseTypes.*`.
//
// This is the list that replaced the `StudentCourseType` enum. `list()` is what every
// course-type dropdown in the CRM reads (gated on `students.view`, because a picker is
// useless to a counsellor who cannot fetch its options); the write methods are gated on
// `course_types.manage` and callers must hide them behind that permission — the API is the
// real enforcement (CLAUDE.md §3.5).
//
// There is no `update(id, { key })`. The key is generated from the label on create and is
// immutable afterwards: every student row stores it, so an editable key would silently
// re-point people's records.

import type {
  CourseTypeOption,
  CreateCourseTypeRequest,
  ListCourseTypesQuery,
  UpdateCourseTypeRequest,
} from "@repo/types";
import type { ApiClient } from "../http/client.js";
import { toQueryString } from "../http/query.js";

export class CourseTypesApi {
  constructor(private readonly client: ApiClient) {}

  /**
   * GET /api/v1/crm/course-types — pass `activeOnly: true` for a picker (hidden options
   * must not be offered on new records) and omit it on the management screen, which has to
   * show hidden options in order to un-hide them.
   */
  async list(query: ListCourseTypesQuery) {
    return this.client.requestPaginated<CourseTypeOption>(
      "GET",
      `/api/v1/crm/course-types${toQueryString(query)}`,
    );
  }

  /** POST /api/v1/crm/course-types — the key is derived from the label server-side. */
  async create(body: CreateCourseTypeRequest): Promise<CourseTypeOption> {
    return this.client.request<CourseTypeOption>("POST", "/api/v1/crm/course-types", { body });
  }

  /** PATCH /api/v1/crm/course-types/:id — rename, reorder, or show/hide. */
  async update(id: string, body: UpdateCourseTypeRequest): Promise<CourseTypeOption> {
    return this.client.request<CourseTypeOption>("PATCH", `/api/v1/crm/course-types/${id}`, { body });
  }

  /**
   * DELETE /api/v1/crm/course-types/:id — refused with 409 `course_types.in_use` while any
   * student is recorded with it. Hiding is the operation staff usually want.
   */
  async remove(id: string): Promise<void> {
    await this.client.request<void>("DELETE", `/api/v1/crm/course-types/${id}`);
  }
}
