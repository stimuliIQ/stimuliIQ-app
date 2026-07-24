// Campaigns SDK — Phase 6, Wave 2 (docs/plans/phase-6.md task #2).
//
// Namespace: client.engagement.campaigns.*
//
// Endpoints covered (CRM Marketing surface — campaigns.view/create/edit/send/delete):
//   Templates:
//     GET    /campaigns/templates              → listTemplates()
//     POST   /campaigns/templates              → createTemplate()
//     GET    /campaigns/templates/:id          → getTemplate()
//     PATCH  /campaigns/templates/:id          → updateTemplate()
//     DELETE /campaigns/templates/:id          → deleteTemplate()
//
//   Campaigns:
//     GET    /campaigns                        → list()
//     POST   /campaigns                        → create()
//     GET    /campaigns/:id                    → get()
//     PATCH  /campaigns/:id                    → update()
//     DELETE /campaigns/:id                    → delete()
//     POST   /campaigns/:id/send               → send()
//     POST   /campaigns/:id/pause              → pause()
//     POST   /campaigns/:id/cancel             → cancel()
//     GET    /campaigns/:id/recipients         → listRecipients()
//     GET    /campaigns/:id/metrics            → getMetrics()
//
// SECURITY CONTRACTS:
//   1. All campaign endpoints require campaigns.* permissions (Marketing/Admin/Owner, all-scope).
//   2. createTemplate() / updateTemplate(): dlt_template_id is REQUIRED for sms/whatsapp
//      channel templates. A missing or empty dlt_template_id → 422 DLT_TEMPLATE_ID_REQUIRED
//      (LOCK-D4, AC-78). The zod schema enforces this at both FE form validation
//      and BE ZodValidationPipe.
//   3. send() applies consent gate (marketing_opt_in = true, non-bypassable, AC-42)
//      and suppression check before any provider call.
//   4. Provider webhooks (POST /campaigns/webhooks/:channel) are UNAUTHENTICATED;
//      not exposed on this SDK — handled directly by the backend (HMAC-verified).
//   5. No provider API keys, webhook secrets, or signing secrets are ever returned
//      in any response DTO (compile-time asserted in @repo/types engagement/campaigns.schemas.ts).

import type {
  CampaignDto,
  CampaignDetailDto,
  CreateCampaignDto,
  UpdateCampaignDto,
  CampaignTemplateDto,
  CreateCampaignTemplateDto,
  UpdateCampaignTemplateDto,
  CampaignRecipientDto,
  CampaignMetricsDto,
  ListCampaignsQuery,
  ListCampaignRecipientsQuery,
  ListCampaignTemplatesQuery,
  OffsetPaginationMeta,
} from "@repo/types";
import type { ApiClient } from "../http/client.js";
import { toQueryString } from "../http/query.js";

export class CampaignsApi {
  constructor(private readonly client: ApiClient) {}

  // ─── Campaign templates ───────────────────────────────────────────────────

  /**
   * GET /api/v1/campaigns/templates
   *
   * Returns paginated list of campaign templates for the tenant.
   * Permissions: campaigns.view (Marketing/Admin/Owner, all-scope).
   */
  async listTemplates(
    query: Partial<ListCampaignTemplatesQuery> = {},
  ): Promise<{ items: CampaignTemplateDto[]; meta: OffsetPaginationMeta }> {
    const qs = toQueryString(query as Record<string, string | number | boolean | undefined>);
    return this.client.requestPaginated<CampaignTemplateDto>(
      "GET",
      `/api/v1/campaigns/templates${qs}`,
    );
  }

  /**
   * POST /api/v1/campaigns/templates
   *
   * Creates a campaign template.
   * LOCK-D4 / AC-78: For channel='sms' or channel='whatsapp', `dlt_template_id`
   * MUST be a non-empty string. The zod schema enforces this at form-validation time.
   * A missing dlt_template_id for SMS/WhatsApp → 422 DLT_TEMPLATE_ID_REQUIRED from BE.
   *
   * @param body - CreateCampaignTemplateDto (channel-discriminated union).
   * @param idempotencyKey - Client-generated UUID for safe retry. Default: new UUID.
   *
   * Permissions: campaigns.create (Marketing/Admin/Owner).
   */
  async createTemplate(
    body: CreateCampaignTemplateDto,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<CampaignTemplateDto> {
    return this.client.request<CampaignTemplateDto>(
      "POST",
      "/api/v1/campaigns/templates",
      { body, idempotencyKey },
    );
  }

  /**
   * GET /api/v1/campaigns/templates/:id
   * Permissions: campaigns.view.
   */
  async getTemplate(id: string): Promise<CampaignTemplateDto> {
    return this.client.request<CampaignTemplateDto>(
      "GET",
      `/api/v1/campaigns/templates/${id}`,
    );
  }

  /**
   * PATCH /api/v1/campaigns/templates/:id
   *
   * Updates a campaign template. Defense-in-depth: the service re-validates
   * dlt_template_id presence for sms/whatsapp on update.
   *
   * @param idempotencyKey - Default: new UUID.
   * Permissions: campaigns.edit.
   */
  async updateTemplate(
    id: string,
    body: UpdateCampaignTemplateDto,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<CampaignTemplateDto> {
    return this.client.request<CampaignTemplateDto>(
      "PATCH",
      `/api/v1/campaigns/templates/${id}`,
      { body, idempotencyKey },
    );
  }

  /**
   * DELETE /api/v1/campaigns/templates/:id (soft-delete)
   * Permissions: campaigns.delete.
   */
  async deleteTemplate(
    id: string,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<CampaignTemplateDto> {
    return this.client.request<CampaignTemplateDto>(
      "DELETE",
      `/api/v1/campaigns/templates/${id}`,
      { idempotencyKey },
    );
  }

  // ─── Campaigns ───────────────────────────────────────────────────────────

  /**
   * GET /api/v1/campaigns
   *
   * Returns paginated list of campaigns for the tenant (CRM Marketing view).
   * Permissions: campaigns.view (all-scope).
   */
  async list(
    query: Partial<ListCampaignsQuery> = {},
  ): Promise<{ items: CampaignDto[]; meta: OffsetPaginationMeta }> {
    const qs = toQueryString(query as Record<string, string | number | boolean | undefined>);
    return this.client.requestPaginated<CampaignDto>(
      "GET",
      `/api/v1/campaigns${qs}`,
    );
  }

  /**
   * POST /api/v1/campaigns
   *
   * Creates a campaign in 'draft' status. Recipients are NOT materialized at
   * create time — materialization happens at send() time.
   *
   * @param body - CreateCampaignDto.
   * @param idempotencyKey - Default: new UUID.
   * Permissions: campaigns.create.
   */
  async create(
    body: CreateCampaignDto,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<CampaignDetailDto> {
    return this.client.request<CampaignDetailDto>(
      "POST",
      "/api/v1/campaigns",
      { body, idempotencyKey },
    );
  }

  /**
   * GET /api/v1/campaigns/:id
   *
   * Returns full campaign detail including template and segment definition.
   * Permissions: campaigns.view.
   */
  async get(id: string): Promise<CampaignDetailDto> {
    return this.client.request<CampaignDetailDto>("GET", `/api/v1/campaigns/${id}`);
  }

  /**
   * PATCH /api/v1/campaigns/:id
   *
   * Updates a draft or scheduled campaign. Only draft/scheduled campaigns can be edited.
   * Permissions: campaigns.edit.
   */
  async update(
    id: string,
    body: UpdateCampaignDto,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<CampaignDetailDto> {
    return this.client.request<CampaignDetailDto>(
      "PATCH",
      `/api/v1/campaigns/${id}`,
      { body, idempotencyKey },
    );
  }

  /**
   * DELETE /api/v1/campaigns/:id (soft-delete)
   * Permissions: campaigns.delete.
   */
  async delete(
    id: string,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<CampaignDetailDto> {
    return this.client.request<CampaignDetailDto>(
      "DELETE",
      `/api/v1/campaigns/${id}`,
      { idempotencyKey },
    );
  }

  /**
   * POST /api/v1/campaigns/:id/send
   *
   * Triggers campaign send:
   *   1. Materializes segment into campaign_recipients (skips non-consented/suppressed, AC-29, AC-30).
   *   2. Dispatches via CampaignSendPort (sync-seam default, LOCK-D1).
   *
   * SECURITY / COMPLIANCE:
   *   - Consent gate (marketing_opt_in = true) is NON-BYPASSABLE (AC-42, Rule C-1).
   *   - Suppression check per-recipient at dispatch time (AC-30, Rule C-2).
   *   - DLT gate: sms/whatsapp template must have dlt_template_id → 422 if absent (AC-31, LOCK-D4).
   *   - Idempotent per-recipient: (campaign_id, recipient) unique — double-send = no-op (AC-27).
   *   - Empty segment returns status='sent', metrics.sent=0, no error (AC-34).
   *
   * @param idempotencyKey - Default: new UUID.
   * Permissions: campaigns.send (Marketing/Admin/Owner).
   */
  async send(
    id: string,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<CampaignDetailDto> {
    return this.client.request<CampaignDetailDto>(
      "POST",
      `/api/v1/campaigns/${id}/send`,
      { body: {}, idempotencyKey },
    );
  }

  /**
   * POST /api/v1/campaigns/:id/pause
   *
   * Pauses a campaign that is actively sending.
   * Halts dispatch for remaining queued recipients (AC-35).
   * Permissions: campaigns.send.
   */
  async pause(
    id: string,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<CampaignDetailDto> {
    return this.client.request<CampaignDetailDto>(
      "POST",
      `/api/v1/campaigns/${id}/pause`,
      { body: {}, idempotencyKey },
    );
  }

  /**
   * POST /api/v1/campaigns/:id/cancel
   *
   * Cancels a scheduled or paused campaign.
   * Queued recipients → status='failed', error='campaign_cancelled'.
   * Audit-log entry written (AC-36).
   * Permissions: campaigns.send.
   */
  async cancel(
    id: string,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<CampaignDetailDto> {
    return this.client.request<CampaignDetailDto>(
      "POST",
      `/api/v1/campaigns/${id}/cancel`,
      { body: {}, idempotencyKey },
    );
  }

  /**
   * GET /api/v1/campaigns/:id/recipients
   *
   * Returns paginated recipient rows with per-recipient delivery status.
   * Used for the CRM delivery report table.
   * Permissions: campaigns.view.
   */
  async listRecipients(
    id: string,
    query: Partial<ListCampaignRecipientsQuery> = {},
  ): Promise<{ items: CampaignRecipientDto[]; meta: OffsetPaginationMeta }> {
    const qs = toQueryString(query as Record<string, string | number | boolean | undefined>);
    return this.client.requestPaginated<CampaignRecipientDto>(
      "GET",
      `/api/v1/campaigns/${id}/recipients${qs}`,
    );
  }

  /**
   * GET /api/v1/campaigns/:id/metrics
   *
   * Returns aggregate campaign metrics (sent/delivered/read/failed counts).
   * Updated in real time as provider webhooks arrive (AC-37).
   * Permissions: campaigns.view.
   */
  async getMetrics(id: string): Promise<CampaignMetricsDto> {
    return this.client.request<CampaignMetricsDto>(
      "GET",
      `/api/v1/campaigns/${id}/metrics`,
    );
  }
}
