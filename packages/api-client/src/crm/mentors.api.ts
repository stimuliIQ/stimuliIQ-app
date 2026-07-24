// Typed mentors SDK — Phase 8, human-mentor track (docs/specs/phase-8-mentor.md).
// GET/POST/PATCH/DELETE/restore over /api/v1/crm/mentors (WS-1 hiring-record CRUD).
// See packages/types/src/crm/mentors.schemas.ts for the full contract + the
// ground-truth schema deviations from the spec prose (no branchId filter,
// email required, no grant-login endpoint).
//
// Batch-assignment (WS-2), completion rollup + mark-complete (WS-3) live on
// `client.crm.batches.*` (crm/batches.api.ts) since they hang off a batch id,
// not a mentor id. The mentor-facing dashboard (WS-4) lives on
// `client.crm.mentorDashboard` (crm/mentor-dashboard.api.ts) — Mentor logs
// into the CRM app (LOCK-3), not the LMS.

import type {
  ListMentorsQuery,
  MentorSummary,
  MentorDetail,
  CreateMentorRequest,
  UpdateMentorRequest,
  MentorPhotoUploadUrlRequest,
  SignedUploadResponse,
} from "@repo/types";
import type { ApiClient } from "../http/client.js";
import { toQueryString } from "../http/query.js";

export class MentorsApi {
  constructor(private readonly client: ApiClient) {}

  /** GET /api/v1/crm/mentors — search by name/institute, filter by engagementStatus/expertise. */
  async list(query: ListMentorsQuery) {
    return this.client.requestPaginated<MentorSummary>(
      "GET",
      `/api/v1/crm/mentors${toQueryString(query)}`,
    );
  }

  /** GET /api/v1/crm/mentors/:id — includes active batch assignments. */
  async get(id: string): Promise<MentorDetail> {
    return this.client.request<MentorDetail>("GET", `/api/v1/crm/mentors/${id}`);
  }

  /** POST /api/v1/crm/mentors — creates ONLY a `mentors` row (no `users` row — see schema file header). */
  async create(body: CreateMentorRequest, idempotencyKey: string = crypto.randomUUID()): Promise<MentorDetail> {
    return this.client.request<MentorDetail>("POST", "/api/v1/crm/mentors", { body, idempotencyKey });
  }

  /** PATCH /api/v1/crm/mentors/:id — partial update. */
  async update(
    id: string,
    body: UpdateMentorRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<MentorDetail> {
    return this.client.request<MentorDetail>("PATCH", `/api/v1/crm/mentors/${id}`, { body, idempotencyKey });
  }

  /** DELETE /api/v1/crm/mentors/:id — soft-delete. 409 MENTOR_HAS_ACTIVE_ASSIGNMENTS if still assigned to any batch. */
  async remove(id: string, idempotencyKey: string = crypto.randomUUID()): Promise<MentorDetail> {
    return this.client.request<MentorDetail>("DELETE", `/api/v1/crm/mentors/${id}`, { idempotencyKey });
  }

  /** POST /api/v1/crm/mentors/:id/restore */
  async restore(id: string, idempotencyKey: string = crypto.randomUUID()): Promise<MentorDetail> {
    return this.client.request<MentorDetail>("POST", `/api/v1/crm/mentors/${id}/restore`, {
      body: {},
      idempotencyKey,
    });
  }

  /**
   * POST /api/v1/crm/mentors/photo-upload-url — mint a short-lived signed PUT URL for a
   * mentor photo. Then PUT the file to `uploadUrl` (with `additionalHeaders`) and pass the
   * returned `storageKey` back as `photoKey` on create/update.
   */
  async photoUploadUrl(body: MentorPhotoUploadUrlRequest): Promise<SignedUploadResponse> {
    return this.client.request<SignedUploadResponse>("POST", "/api/v1/crm/mentors/photo-upload-url", { body });
  }
}
