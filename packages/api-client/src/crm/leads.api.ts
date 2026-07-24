// Typed leads SDK — Phase 2, Wave 2 (docs/plans/phase-2.md task #2).
// Full CRUD + stage move + owner assign + convert over /api/v1/crm/leads.

import type {
  LeadSummary,
  LeadDetail,
  ListLeadsQuery,
  CreateLeadRequest,
  UpdateLeadRequest,
  MoveLeadStageRequest,
  AssignLeadOwnerRequest,
  ConvertLeadRequest,
  ConvertLeadResponse,
} from "@repo/types";
import type { ApiClient } from "../http/client.js";
import { toQueryString } from "../http/query.js";

export class LeadsApi {
  constructor(private readonly client: ApiClient) {}

  /** GET /api/v1/crm/leads — filter/paginate the lead pipeline (scope enforced server-side). */
  async list(query: ListLeadsQuery) {
    return this.client.requestPaginated<LeadSummary>(
      "GET",
      `/api/v1/crm/leads${toQueryString(query)}`,
    );
  }

  /** GET /api/v1/crm/leads/:id */
  async get(id: string): Promise<LeadDetail> {
    return this.client.request<LeadDetail>("GET", `/api/v1/crm/leads/${id}`);
  }

  /**
   * POST /api/v1/crm/leads
   *
   * Creates a new lead. `phone` unique per tenant (409 on duplicate).
   * Stage defaults to `new`. `idempotencyKey` prevents duplicate lead creation on retry.
   */
  async create(
    body: CreateLeadRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<LeadDetail> {
    return this.client.request<LeadDetail>("POST", "/api/v1/crm/leads", { body, idempotencyKey });
  }

  /** PATCH /api/v1/crm/leads/:id — partial update (not stage/owner — use sub-endpoints). */
  async update(
    id: string,
    body: UpdateLeadRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<LeadDetail> {
    return this.client.request<LeadDetail>(
      "PATCH",
      `/api/v1/crm/leads/${id}`,
      { body, idempotencyKey },
    );
  }

  /** DELETE /api/v1/crm/leads/:id — soft-delete (Admin/Owner only). */
  async remove(id: string, idempotencyKey: string = crypto.randomUUID()): Promise<LeadDetail> {
    return this.client.request<LeadDetail>(
      "DELETE",
      `/api/v1/crm/leads/${id}`,
      { idempotencyKey },
    );
  }

  /**
   * PATCH /api/v1/crm/leads/:id/stage
   *
   * Kanban stage transition — audited with before/after values. Use this for all
   * pipeline stage moves (not the general update endpoint). Idempotent on replay.
   */
  async moveStage(
    id: string,
    body: MoveLeadStageRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<LeadDetail> {
    return this.client.request<LeadDetail>(
      "PATCH",
      `/api/v1/crm/leads/${id}/stage`,
      { body, idempotencyKey },
    );
  }

  /**
   * PATCH /api/v1/crm/leads/:id/owner
   *
   * Assign or unassign a lead owner. The previous owner is recorded in the audit log.
   */
  async assignOwner(
    id: string,
    body: AssignLeadOwnerRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<LeadDetail> {
    return this.client.request<LeadDetail>(
      "PATCH",
      `/api/v1/crm/leads/${id}/owner`,
      { body, idempotencyKey },
    );
  }

  /**
   * POST /api/v1/crm/leads/:id/convert
   *
   * Atomic lead→student conversion. Creates student_profile, sets
   * converted_student_id + stage=won. Optionally creates order+enrollment
   * (if programId+batchId provided). Idempotent by idempotencyKey — replaying
   * does NOT create a second student or order.
   */
  async convert(
    id: string,
    body: ConvertLeadRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<ConvertLeadResponse> {
    return this.client.request<ConvertLeadResponse>(
      "POST",
      `/api/v1/crm/leads/${id}/convert`,
      { body, idempotencyKey },
    );
  }
}
