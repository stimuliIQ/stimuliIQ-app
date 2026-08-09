// apps/api/src/modules/campaigns/campaigns.service.ts
//
// CampaignsService — business logic for WS-2 Campaigns (docs/plans/phase-6.md task #7).
// (CLAUDE.md §3.3: "service — business logic, transactions, idempotency, emits domain
// events post-commit. No Prisma in controllers.")
//
// ─── CONSENT/SUPPRESSION/DLT GATING (India DPDP compliance) ─────────────────
//
// Rule C-1 (marketing_opt_in gate — AC-29, AC-42):
//   The repository's findLeadsForSegment/findStudentsForSegment ALWAYS add
//   marketing_opt_in=true to the WHERE clause. Non-bypassable — no caller can skip it.
//
// Rule C-2 (suppression gate — AC-30, AC-33):
//   Before each individual send, isSuppressed() is checked. A match transitions the
//   recipient to failed/suppressed. The suppression check is per-dispatch, not per-segment,
//   so late unsubscribers are caught (AC-33).
//
// Rule C-3 (DLT template id gate — AC-31, AC-78, LOCK-D4):
//   At campaign send time, we reject if the template's dlt_template_id is null/empty
//   for SMS/WhatsApp channels. This is the SERVICE-LAYER check (defense-in-depth; the
//   SyncCampaignSendAdapter also enforces this).
//
// ─── IDEMPOTENCY (AC-27, AC-28) ──────────────────────────────────────────────
//
// Per-recipient idempotency is enforced by:
//   1. The DB partial-unique on (campaign_id, COALESCE(lead_id, student_id, user_id))
//      WHERE deleted_at IS NULL. insertRecipient() catches P2002 and returns null (no-op).
//   2. Before calling CAMPAIGN_SEND_PORT.send(), we check the recipient's current status.
//      If already 'sent'/'delivered'/'read'/'failed', the send is skipped (no-op).
//   3. The SyncCampaignSendAdapter has an in-request dedupeKey set to prevent double-send.
//
// ─── WEBHOOK INGESTION (AC-37, AC-38, AC-39, AC-40) ─────────────────────────
//
// handleWebhookEvent() is called AFTER HMAC verification by the controller.
// - Looks up the recipient by providerMessageId.
// - AC-38 idempotency: if the row is already in a final state (delivered/read/failed),
//   the update is skipped (not downgraded). Returns 200.
// - AC-40 race: if no matching row found, returns silently (200, no 500).
// - A forged/duplicate receipt cannot corrupt status because:
//   (a) HMAC verification must pass first (controller rejects forged webhooks).
//   (b) The status only ever advances (queued→sent→delivered→read|failed).
//
// ─── AUDIT ───────────────────────────────────────────────────────────────────
//
// Every mutating action writes an audit_logs entry via the Prisma audit extension
// (applied in prisma.service.ts). The service does NOT need to write audit rows manually —
// the extension handles it. Soft-delete also triggers the extension.
//
// SECURITY:
//   - MAIL_WEBHOOK_SECRET / WHATSAPP_APP_SECRET are passed to verifyWebhookSignature()
//     by the controller; they are NEVER accessible in this service.
//   - provider_message_id is NOT a secret; it is the public message ID.
//   - No provider API key or webhook secret appears in any log or response.

import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import type {
  CampaignDto,
  CampaignDetailDto,
  CampaignTemplateDto,
  CampaignRecipientDto,
  CampaignMetricsDto,
  CreateCampaignTemplateDto,
  UpdateCampaignTemplateDto,
  CreateCampaignDto,
  UpdateCampaignDto,
  SegmentDefDto,
  ListCampaignsQuery,
  ListCampaignRecipientsQuery,
  ListCampaignTemplatesQuery,
  CampaignWebhookEventDto,
} from "@repo/types";
import { CampaignsRepository } from "./campaigns.repository";
import { validateEnv } from "../../config/env";
import { PaginatedResult } from "../../common/dto/paginated-result";
import {
  CAMPAIGN_SEND_PORT,
  type CampaignSendPort,
  TemplateRegistry,
} from "../notifications/dispatch/index";
import type { CampaignTemplateRow, CampaignRow, CampaignRecipientRow } from "./campaigns.repository";

// ─────────────────────────────────────────────────────────────────────────────
// Status ordering for idempotent webhook updates (AC-38)
// Higher index = more advanced state. Never downgrade.
// ─────────────────────────────────────────────────────────────────────────────
const STATUS_ORDER: Record<string, number> = {
  queued: 0,
  sent: 1,
  delivered: 2,
  read: 3,
  failed: 4, // terminal
};

function isStatusAdvance(current: string, next: string): boolean {
  // Only update if next state is strictly more advanced, OR if we're moving failed→failed
  // (e.g. updating the error detail). failed is terminal — cannot be overwritten by
  // non-failed states.
  if (current === "failed") return false; // AC-38: terminal, never overwrite
  if (current === "read") return false;   // read is the final success state
  return (STATUS_ORDER[next] ?? 0) > (STATUS_ORDER[current] ?? 0);
}

/**
 * T5/R2 (docs/plans/phase-9-completion.md): env-configurable cap on how many queued
 * recipients a single POST /campaigns/:id/send invocation dispatches (env-configurable,
 * default 500 — see CAMPAIGN_SEND_BATCH_SIZE, config/env.ts).
 */
function resolveCampaignSendBatchSize(): number {
  return validateEnv().CAMPAIGN_SEND_BATCH_SIZE;
}

@Injectable()
export class CampaignsService {
  private readonly logger = new Logger(CampaignsService.name);

  constructor(
    private readonly repo: CampaignsRepository,
    private readonly templateRegistry: TemplateRegistry,
    @Inject(CAMPAIGN_SEND_PORT) private readonly campaignSendPort: CampaignSendPort,
  ) {}

  // ─── Campaign Templates ───────────────────────────────────────────────────

  async createTemplate(tenantId: string, actorId: string, dto: CreateCampaignTemplateDto): Promise<CampaignTemplateDto> {
    // LOCK-D4 / AC-78: assert dlt_template_id for sms/whatsapp (defense-in-depth;
    // the zod schema already enforces this, but we assert here too).
    if ((dto.channel === "sms" || dto.channel === "whatsapp") && !dto.dltTemplateId) {
      throw new UnprocessableEntityException({
        code: "campaigns.DLT_TEMPLATE_ID_REQUIRED",
        title: "DLT template ID required",
        detail: `campaign_templates with channel="${dto.channel}" must have a non-empty dlt_template_id. ` +
          "Register the template with the India DLT portal and supply the approved template ID.",
      });
    }

    const subject = dto.channel === "email" ? (dto as { subject: string }).subject : null;
    const row = await this.repo.createTemplate(tenantId, {
      channel: dto.channel,
      name: dto.name,
      subject,
      body: dto.body,
      dltTemplateId: dto.dltTemplateId ?? null,
      variables: dto.variables ?? [],
    });

    this.logger.log(
      `[Campaigns] template created: id=${row.id} channel=${row.channel} tenant=${tenantId} actor=${actorId}`,
    );
    return this.mapTemplateDto(row);
  }

  async getTemplate(tenantId: string, id: string): Promise<CampaignTemplateDto> {
    const row = await this.repo.findTemplateById(tenantId, id);
    if (!row) throw new NotFoundException({ code: "campaigns.template_not_found", title: "Template not found" });
    return this.mapTemplateDto(row);
  }

  async listTemplates(tenantId: string, query: ListCampaignTemplatesQuery): Promise<PaginatedResult<CampaignTemplateDto>> {
    const { rows, total } = await this.repo.listTemplates(tenantId, {
      channel: query.channel as "email" | "whatsapp" | "sms" | undefined,
      page: query.page,
      pageSize: query.pageSize,
    });
    return new PaginatedResult(rows.map((r) => this.mapTemplateDto(r)), {
      page: query.page,
      pageSize: query.pageSize,
      total,
      hasMore: query.page * query.pageSize < total,
    });
  }

  async updateTemplate(
    tenantId: string,
    actorId: string,
    id: string,
    dto: UpdateCampaignTemplateDto,
  ): Promise<CampaignTemplateDto> {
    const existing = await this.repo.findTemplateById(tenantId, id);
    if (!existing) throw new NotFoundException({ code: "campaigns.template_not_found", title: "Template not found" });

    // LOCK-D4 defense-in-depth: if updating dltTemplateId on an sms/whatsapp template,
    // it cannot be cleared to null/empty.
    if (
      (existing.channel === "sms" || existing.channel === "whatsapp") &&
      dto.dltTemplateId !== undefined &&
      !dto.dltTemplateId
    ) {
      throw new UnprocessableEntityException({
        code: "campaigns.DLT_TEMPLATE_ID_REQUIRED",
        title: "DLT template ID required",
        detail: `Cannot clear dlt_template_id on a ${existing.channel} template.`,
      });
    }

    const updated = await this.repo.updateTemplate(tenantId, id, {
      name: dto.name,
      subject: dto.subject !== undefined ? dto.subject : undefined,
      body: dto.body,
      dltTemplateId: dto.dltTemplateId,
      variables: dto.variables,
    });
    if (!updated) throw new NotFoundException({ code: "campaigns.template_not_found", title: "Template not found" });

    this.logger.log(
      `[Campaigns] template updated: id=${id} tenant=${tenantId} actor=${actorId}`,
    );
    return this.mapTemplateDto(updated);
  }

  async deleteTemplate(tenantId: string, actorId: string, id: string): Promise<CampaignTemplateDto> {
    const existing = await this.repo.findTemplateById(tenantId, id);
    if (!existing) throw new NotFoundException({ code: "campaigns.template_not_found", title: "Template not found" });

    const deleted = await this.repo.softDeleteTemplate(tenantId, id);
    if (!deleted) throw new NotFoundException({ code: "campaigns.template_not_found", title: "Template not found" });

    this.logger.log(
      `[Campaigns] template deleted: id=${id} tenant=${tenantId} actor=${actorId}`,
    );
    return this.mapTemplateDto({ ...deleted, deletedAt: new Date() });
  }

  // ─── Campaigns ────────────────────────────────────────────────────────────

  async createCampaign(tenantId: string, actorId: string, dto: CreateCampaignDto): Promise<CampaignDetailDto> {
    // Validate that the template exists and channel matches.
    const template = await this.repo.findTemplateById(tenantId, dto.templateId);
    if (!template) {
      throw new NotFoundException({ code: "campaigns.template_not_found", title: "Template not found" });
    }
    if (template.channel !== dto.channel) {
      throw new UnprocessableEntityException({
        code: "campaigns.channel_mismatch",
        title: "Channel mismatch",
        detail: `Campaign channel="${dto.channel}" does not match template channel="${template.channel}".`,
      });
    }

    const scheduleAt = dto.scheduleAt ? new Date(dto.scheduleAt) : null;
    if (scheduleAt && scheduleAt <= new Date()) {
      throw new UnprocessableEntityException({
        code: "campaigns.schedule_in_past",
        title: "Schedule time must be in the future",
      });
    }

    const row = await this.repo.createCampaign(tenantId, {
      channel: dto.channel,
      templateId: dto.templateId,
      name: dto.name,
      segment: dto.segment,
      scheduleAt,
      createdById: actorId,
    });

    this.logger.log(
      `[Campaigns] campaign created: id=${row.id} channel=${row.channel} tenant=${tenantId} actor=${actorId}`,
    );
    return this.mapCampaignDetailDto(row);
  }

  async getCampaign(tenantId: string, id: string): Promise<CampaignDetailDto> {
    const row = await this.repo.findCampaignById(tenantId, id);
    if (!row) throw new NotFoundException({ code: "campaigns.not_found", title: "Campaign not found" });
    return this.mapCampaignDetailDto(row);
  }

  async listCampaigns(tenantId: string, query: ListCampaignsQuery): Promise<PaginatedResult<CampaignDto>> {
    const { rows, total } = await this.repo.listCampaigns(tenantId, {
      status: query.status as "draft" | "scheduled" | "sending" | "sent" | "paused" | "cancelled" | "failed" | undefined,
      channel: query.channel as "email" | "whatsapp" | "sms" | undefined,
      page: query.page,
      pageSize: query.pageSize,
    });
    return new PaginatedResult(rows.map((r) => this.mapCampaignDto(r)), {
      page: query.page,
      pageSize: query.pageSize,
      total,
      hasMore: query.page * query.pageSize < total,
    });
  }

  async updateCampaign(
    tenantId: string,
    actorId: string,
    id: string,
    dto: UpdateCampaignDto,
  ): Promise<CampaignDetailDto> {
    const existing = await this.repo.findCampaignById(tenantId, id);
    if (!existing) throw new NotFoundException({ code: "campaigns.not_found", title: "Campaign not found" });

    if (existing.status !== "draft") {
      throw new UnprocessableEntityException({
        code: "campaigns.not_editable",
        title: "Only draft campaigns can be edited",
      });
    }

    if (dto.templateId) {
      const template = await this.repo.findTemplateById(tenantId, dto.templateId);
      if (!template) throw new NotFoundException({ code: "campaigns.template_not_found", title: "Template not found" });
      if (template.channel !== existing.channel) {
        throw new UnprocessableEntityException({
          code: "campaigns.channel_mismatch",
          title: "Channel mismatch",
          detail: `New template channel="${template.channel}" does not match campaign channel="${existing.channel}".`,
        });
      }
    }

    const scheduleAt = dto.scheduleAt !== undefined ? (dto.scheduleAt ? new Date(dto.scheduleAt) : null) : undefined;
    const updated = await this.repo.updateCampaignFields(tenantId, id, {
      name: dto.name,
      templateId: dto.templateId,
      segment: dto.segment,
      scheduleAt,
    });
    if (!updated) throw new NotFoundException({ code: "campaigns.not_found", title: "Campaign not found" });

    this.logger.log(`[Campaigns] campaign updated: id=${id} tenant=${tenantId} actor=${actorId}`);
    return this.mapCampaignDetailDto(updated);
  }

  async deleteCampaign(tenantId: string, actorId: string, id: string): Promise<CampaignDetailDto> {
    const existing = await this.repo.findCampaignById(tenantId, id);
    if (!existing) throw new NotFoundException({ code: "campaigns.not_found", title: "Campaign not found" });

    const deleted = await this.repo.softDeleteCampaign(tenantId, id);
    if (!deleted) throw new NotFoundException({ code: "campaigns.not_found", title: "Campaign not found" });

    this.logger.log(`[Campaigns] campaign deleted: id=${id} tenant=${tenantId} actor=${actorId}`);
    return this.mapCampaignDetailDto({ ...deleted, deletedAt: new Date() });
  }

  // ─── Campaign Send ────────────────────────────────────────────────────────

  /**
   * Send a campaign: materialize segment → per-recipient dispatch (idempotent).
   *
   * CONSENT gate (Rule C-1): the repository's segment queries enforce marketing_opt_in=true.
   * SUPPRESSION gate (Rule C-2): checked per-recipient before dispatch.
   * DLT gate (Rule C-3 / LOCK-D4): rejected upfront for sms/whatsapp without dlt_template_id.
   *
   * Idempotency (AC-27): the partial-unique prevents duplicate recipient rows;
   * the status check prevents double-dispatch.
   */
  async sendCampaign(tenantId: string, actorId: string, id: string): Promise<CampaignDetailDto> {
    const campaign = await this.repo.findCampaignById(tenantId, id);
    if (!campaign) throw new NotFoundException({ code: "campaigns.not_found", title: "Campaign not found" });

    const template = campaign.template;

    // LOCK-D4 / Rule C-3 (AC-31): reject SMS/WhatsApp sends without DLT template ID.
    if ((campaign.channel === "sms" || campaign.channel === "whatsapp") && !template.dltTemplateId) {
      throw new UnprocessableEntityException({
        code: "campaigns.DLT_TEMPLATE_ID_REQUIRED",
        title: "DLT template ID required",
        detail: `Cannot send ${campaign.channel} campaign: the template (id=${template.id}) has no dlt_template_id. ` +
          "Register the template on the India DLT portal and update the template before sending.",
      });
    }

    // T5/R2: "sending" is also acceptable here — a campaign whose recipient count
    // exceeds CAMPAIGN_SEND_BATCH_SIZE stays in "sending" (not "sent") after a capped
    // batch (see below), so a follow-up call to this same endpoint must be able to
    // resume dispatching the remaining queued recipients.
    if (!["draft", "scheduled", "paused", "sending"].includes(campaign.status)) {
      throw new UnprocessableEntityException({
        code: "campaigns.not_sendable",
        title: "Campaign cannot be sent",
        detail: `Campaign status="${campaign.status}" is not sendable. Expected: draft, scheduled, paused, or sending (to resume).`,
      });
    }

    // Transition to sending (no-op if already sending — a resumed batch).
    await this.repo.updateCampaignStatus(tenantId, id, "sending");

    // Materialize segment into campaign_recipients (idempotent — partial-unique no-ops
    // duplicates, safe to re-run on a resumed batch).
    const segment = campaign.segment as SegmentDefDto;
    await this.materializeSegment(tenantId, id, segment);

    // Dispatch queued recipients, bounded by CAMPAIGN_SEND_BATCH_SIZE (T5/R2).
    const dispatched = await this.dispatchQueuedRecipients(tenantId, id, campaign, template);

    // Recompute + persist metrics.
    const metrics = await this.repo.countRecipientsByStatus(id, tenantId);
    await this.repo.updateCampaignMetrics(tenantId, id, metrics);

    // T5/R2: only transition to "sent" once NO recipients remain queued — a batch capped
    // by CAMPAIGN_SEND_BATCH_SIZE must NOT be mislabelled "sent" while recipients still
    // await dispatch on a follow-up call. Also respects a paused/cancelled state that
    // intervened mid-send.
    const refreshed = await this.repo.findCampaignById(tenantId, id);
    const stillQueued = metrics["queued"] ?? 0;
    if (refreshed && refreshed.status === "sending" && stillQueued === 0) {
      await this.repo.updateCampaignStatus(tenantId, id, "sent");
    }

    this.logger.log(
      `[Campaigns] send complete: id=${id} tenant=${tenantId} actor=${actorId} ` +
        `dispatched=${dispatched} total=${metrics["total"]} failed=${metrics["failed"]} ` +
        `queuedRemaining=${stillQueued}`,
    );

    const final = await this.repo.findCampaignById(tenantId, id);
    return this.mapCampaignDetailDto(final ?? campaign);
  }

  async pauseCampaign(tenantId: string, actorId: string, id: string): Promise<CampaignDetailDto> {
    const campaign = await this.repo.findCampaignById(tenantId, id);
    if (!campaign) throw new NotFoundException({ code: "campaigns.not_found", title: "Campaign not found" });

    if (!["sending", "scheduled"].includes(campaign.status)) {
      throw new UnprocessableEntityException({
        code: "campaigns.cannot_pause",
        title: "Campaign cannot be paused",
        detail: `Campaign status="${campaign.status}" cannot be paused.`,
      });
    }

    const updated = await this.repo.updateCampaignStatus(tenantId, id, "paused");
    this.logger.log(`[Campaigns] campaign paused: id=${id} tenant=${tenantId} actor=${actorId}`);
    return this.mapCampaignDetailDto(updated ?? campaign);
  }

  async cancelCampaign(tenantId: string, actorId: string, id: string): Promise<CampaignDetailDto> {
    const campaign = await this.repo.findCampaignById(tenantId, id);
    if (!campaign) throw new NotFoundException({ code: "campaigns.not_found", title: "Campaign not found" });

    if (!["scheduled", "sending", "paused"].includes(campaign.status)) {
      throw new UnprocessableEntityException({
        code: "campaigns.cannot_cancel",
        title: "Campaign cannot be cancelled",
        detail: `Campaign status="${campaign.status}" cannot be cancelled.`,
      });
    }

    // Bulk-fail all queued recipients (AC-36).
    const failedCount = await this.repo.bulkFailQueuedRecipients(id, tenantId, "campaign_cancelled");
    await this.repo.updateCampaignStatus(tenantId, id, "cancelled");

    // Recompute metrics.
    const metrics = await this.repo.countRecipientsByStatus(id, tenantId);
    await this.repo.updateCampaignMetrics(tenantId, id, metrics);

    this.logger.log(
      `[Campaigns] campaign cancelled: id=${id} tenant=${tenantId} actor=${actorId} queued_failed=${failedCount}`,
    );

    const final = await this.repo.findCampaignById(tenantId, id);
    return this.mapCampaignDetailDto(final ?? campaign);
  }

  // ─── Provider Webhook Ingestion ───────────────────────────────────────────

  /**
   * Handle a verified provider webhook event.
   * MUST only be called after HMAC verification in the controller (AC-39).
   *
   * AC-38: duplicate/replayed webhook is a no-op.
   * AC-40: unknown providerMessageId (race) → 200, silent discard.
   * AC-39: forged webhook already rejected by controller before reaching here.
   * A forged/duplicate receipt CANNOT corrupt status because:
   *   - The HMAC verification in the controller is the first gate.
   *   - isStatusAdvance() ensures status only ever moves forward.
   */
  async handleWebhookEvent(dto: CampaignWebhookEventDto): Promise<void> {
    const recipient = await this.repo.findRecipientByProviderMessageId(dto.providerMessageId);

    // AC-40: unknown providerMessageId (race condition) — silently discard.
    if (!recipient) {
      this.logger.warn(
        `[Campaigns] webhook: no recipient found for providerMessageId="${dto.providerMessageId}" — discarding.`,
      );
      return;
    }

    // Map event type to RecipientStatus.
    const newStatus = this.mapWebhookEventToStatus(dto.event);

    // AC-38: idempotent — if already in a more-advanced or equal state, skip update.
    if (!isStatusAdvance(recipient.status, newStatus)) {
      this.logger.debug(
        `[Campaigns] webhook: recipient=${recipient.id} already at status="${recipient.status}" — ` +
          `event="${dto.event}" → no-op (idempotent).`,
      );
      return;
    }

    const now = new Date(dto.occurredAt ?? Date.now());
    await this.repo.updateRecipientStatus(recipient.tenantId, recipient.id, {
      status: newStatus,
      deliveredAt: newStatus === "delivered" ? now : undefined,
      readAt: newStatus === "read" ? now : undefined,
      error: newStatus === "failed" ? (dto.errorDetail ?? "provider_failed") : undefined,
    });

    // Re-aggregate campaign metrics (async, best-effort).
    await this.refreshCampaignMetrics(recipient.campaignId, recipient.tenantId);

    this.logger.log(
      `[Campaigns] webhook processed: recipient=${recipient.id} ` +
        `providerMessageId="${dto.providerMessageId}" event="${dto.event}" status="${newStatus}"`,
    );

    // Hard-bounce: add to suppression list.
    if (dto.event === "bounced" || dto.event === "complained") {
      await this.addBounceToSuppression(recipient);
    }
  }

  // ─── Metrics + Recipients ─────────────────────────────────────────────────

  async getCampaignMetrics(tenantId: string, id: string): Promise<CampaignMetricsDto> {
    const campaign = await this.repo.findCampaignById(tenantId, id);
    if (!campaign) throw new NotFoundException({ code: "campaigns.not_found", title: "Campaign not found" });
    return this.parseMetrics(campaign.metrics);
  }

  async listRecipients(
    tenantId: string,
    campaignId: string,
    query: ListCampaignRecipientsQuery,
  ): Promise<PaginatedResult<CampaignRecipientDto>> {
    const campaign = await this.repo.findCampaignById(tenantId, campaignId);
    if (!campaign) throw new NotFoundException({ code: "campaigns.not_found", title: "Campaign not found" });

    const { rows, total } = await this.repo.findRecipientsByStatus(campaignId, tenantId, {
      status: query.status as "queued" | "sent" | "delivered" | "read" | "failed" | undefined,
      page: query.page,
      pageSize: query.pageSize,
    });

    return new PaginatedResult(rows.map((r) => this.mapRecipientDto(r)), {
      page: query.page,
      pageSize: query.pageSize,
      total,
      hasMore: query.page * query.pageSize < total,
    });
  }

  // ─── Private: segment materialization ────────────────────────────────────

  /**
   * Materialize the segment definition into campaign_recipients.
   * Rule C-1 is enforced by the repository's WHERE clause (non-bypassable).
   */
  private async materializeSegment(
    tenantId: string,
    campaignId: string,
    segment: SegmentDefDto,
  ): Promise<void> {
    const PAGE_SIZE = 200;
    let page = 1;
    let hasMore = true;

    // Paginate leads and students independently to exhaustion. Never spread the raw
    // `segment` object into a repo query (mass-assignment) — only whitelisted fields are
    // passed. `both` continues while EITHER source still has more pages (H-1 fix).
    while (hasMore) {
      let leadsTotal = 0;
      let studentsTotal = 0;

      if (segment.source === "leads" || segment.source === "both") {
        const { rows, total } = await this.repo.findLeadsForSegment(tenantId, {
          stages: segment.stages,
          programIds: segment.programIds,
          statuses: segment.statuses,
          sources: segment.sources,
          page,
          pageSize: PAGE_SIZE,
        });
        leadsTotal = total;

        for (const lead of rows) {
          // Rule C-1 is already enforced by the repo query. Double-check here for clarity.
          if (!lead.marketingOptIn) continue;
          const to = lead.email ?? lead.phone;
          if (!to) continue;

          await this.repo.insertRecipient(tenantId, {
            campaignId,
            leadId: lead.id,
            to,
          });
        }
      }

      if (segment.source === "students" || segment.source === "both") {
        const { rows, total } = await this.repo.findStudentsForSegment(tenantId, {
          programIds: segment.programIds,
          batchIds: segment.batchIds,
          statuses: segment.statuses,
          page,
          pageSize: PAGE_SIZE,
        });
        studentsTotal = total;

        for (const student of rows) {
          if (!student.marketingOptIn) continue;
          const to = student.email ?? student.phone;
          if (!to) continue;

          await this.repo.insertRecipient(tenantId, {
            campaignId,
            studentId: student.id,
            userId: student.userId,
            to,
          });
        }
      }

      const leadsHasMore = segment.source !== "students" && page * PAGE_SIZE < leadsTotal;
      const studentsHasMore = segment.source !== "leads" && page * PAGE_SIZE < studentsTotal;
      hasMore = leadsHasMore || studentsHasMore;
      page++;
    }
  }

  /**
   * Dispatch queued recipients for the campaign, bounded by CAMPAIGN_SEND_BATCH_SIZE
   * (T5/R2, docs/plans/phase-9-completion.md). Per-recipient: Rule C-2 suppression check
   * → render template → send via port.
   *
   * A capped batch is NOT the full queue for large campaigns — the sync-seam send loop
   * (P6/P7 decision; no BullMQ yet) runs inside the HTTP request, so an unbounded fetch
   * risked holding the request open for minutes on a large recipient list. Any recipients
   * left `queued` after this batch are logged; sendCampaign() leaves the campaign in
   * "sending" status so a follow-up call resumes from where this batch left off.
   */
  private async dispatchQueuedRecipients(
    tenantId: string,
    campaignId: string,
    campaign: CampaignRow,
    template: CampaignTemplateRow,
  ): Promise<number> {
    const batchSize = resolveCampaignSendBatchSize();
    const recipients = await this.repo.findQueuedRecipients(campaignId, tenantId, batchSize);
    let dispatched = 0;

    for (const recipient of recipients) {
      // Check if campaign was paused/cancelled mid-send (AC-35, AC-36).
      const refreshed = await this.repo.findCampaignById(tenantId, campaignId);
      if (refreshed && !["sending"].includes(refreshed.status)) {
        this.logger.log(`[Campaigns] dispatch halted for campaign=${campaignId} status=${refreshed.status}`);
        break;
      }

      await this.dispatchSingleRecipient(tenantId, recipient, campaign, template);
      dispatched++;
    }

    // T5/R2: log when this batch didn't clear the whole queue, so a large campaign's
    // multi-batch progress is visible in structured logs (not just silently incomplete).
    if (recipients.length === batchSize) {
      const stillQueued = await this.repo.countQueuedRecipients(campaignId, tenantId);
      if (stillQueued > 0) {
        this.logger.log(
          `[Campaigns] batch cap reached for campaign=${campaignId}: dispatched=${dispatched} ` +
            `of this batch (cap=${batchSize}); ${stillQueued} recipient(s) still queued — ` +
            "call POST /campaigns/:id/send again to continue.",
        );
      }
    }

    return dispatched;
  }

  /**
   * Dispatch a single recipient. Applies:
   *   Rule C-2 (suppression check) → skip if suppressed (error='suppressed', AC-30, AC-33).
   *   Renders template body with recipient variables.
   *   Calls campaignSendPort.send() (idempotent by dedupeKey).
   *   Updates recipient status.
   */
  private async dispatchSingleRecipient(
    tenantId: string,
    recipient: CampaignRecipientRow,
    campaign: CampaignRow,
    template: CampaignTemplateRow,
  ): Promise<void> {
    const channel = campaign.channel as "email" | "sms" | "whatsapp";

    // Rule C-2: suppression check (AC-30, AC-33).
    const isSuppressed = await this.repo.isSuppressed({
      tenantId,
      channel,
      email: channel === "email" ? recipient.to : undefined,
      phone: channel !== "email" ? recipient.to : undefined,
      userId: recipient.userId ?? undefined,
    });

    if (isSuppressed) {
      await this.repo.updateRecipientStatus(tenantId, recipient.id, {
        status: "failed",
        error: "suppressed",
      });
      this.logger.debug(
        `[Campaigns] recipient suppressed: id=${recipient.id} to=${recipient.to.slice(0, 3)}*** ` +
          `campaignId=${campaign.id}`,
      );
      return;
    }

    // Render campaign template body with variable substitution.
    //
    // Built from CAMPAIGN_TEMPLATE_VARIABLES (@repo/types) so the set the sender fills and
    // the set the CRM's editor advertises cannot drift apart. They had: templates were
    // authored with {{name}}/{{program_title}} while only `to` and `campaignName` were ever
    // substituted, and unknown placeholders are deliberately left as-is — so real sends went
    // out reading "Hi {{name}},".
    const substitutions = buildRecipientVariables(recipient, campaign);
    const renderedBody = this.templateRegistry.renderRaw(template.body, substitutions);

    const renderedSubject =
      channel === "email" && template.subject
        ? this.templateRegistry.renderRaw(template.subject, substitutions)
        : undefined;

    // Dispatch via the port (idempotent by dedupeKey).
    await this.campaignSendPort.throttle(channel);

    const result = await this.campaignSendPort.send({
      dedupeKey: `campaign-recipient:${recipient.id}`,
      campaignRecipientId: recipient.id,
      campaignId: campaign.id,
      tenantId,
      channel,
      to: recipient.to,
      subject: renderedSubject,
      body: renderedBody,
      dltTemplateId: template.dltTemplateId ?? undefined,
      whatsappTemplateName: template.name,
      emailTags: [{ name: "campaign_id", value: campaign.id }],
    });

    if (result.sent) {
      await this.repo.updateRecipientStatus(tenantId, recipient.id, {
        status: "sent",
        providerMessageId: result.providerMessageId,
        sentAt: new Date(),
      });
    } else if (result.error) {
      await this.repo.updateRecipientStatus(tenantId, recipient.id, {
        status: "failed",
        error: result.error,
      });
    }
  }

  // ─── Private: webhook + metrics ──────────────────────────────────────────

  private mapWebhookEventToStatus(
    event: CampaignWebhookEventDto["event"],
  ): "sent" | "delivered" | "read" | "failed" {
    switch (event) {
      case "delivered": return "delivered";
      case "read":      return "read";
      case "failed":
      case "bounced":
      case "complained": return "failed";
      default:           return "failed";
    }
  }

  private async refreshCampaignMetrics(campaignId: string, tenantId: string): Promise<void> {
    try {
      const metrics = await this.repo.countRecipientsByStatus(campaignId, tenantId);
      await this.repo.updateCampaignMetrics(tenantId, campaignId, metrics);
    } catch (err) {
      // Best-effort; don't fail the request for a metrics refresh error.
      this.logger.warn(`[Campaigns] metrics refresh failed: campaignId=${campaignId} err=${String(err)}`);
    }
  }

  /**
   * Add a hard-bounce or complaint to the suppression list (AC-37 + email best-practice).
   * SECURITY: never logs or returns the suppression record's internal fields.
   *
   * IDEMPOTENT + MONOTONIC (Phase-7 Wave 2 security hardening batch A, item 2b — AC-60):
   * delegates to CampaignsRepository#createBounceSuppression, which is backed by a
   * DB-level partial-unique index on (tenant_id, channel, email/phone) — a concurrent or
   * replayed bounce/complaint event for the same recipient can insert AT MOST one active
   * suppression row; a duplicate is a genuine no-op (not a swallowed generic error).
   */
  private async addBounceToSuppression(recipient: CampaignRecipientRow): Promise<void> {
    try {
      const channel = recipient.to.includes("@") ? "email" : "sms";
      const inserted = await this.repo.createBounceSuppression({
        tenantId: recipient.tenantId,
        email: channel === "email" ? recipient.to : null,
        phone: channel !== "email" ? recipient.to : null,
        channel: channel as "email" | "sms" | "whatsapp" | "in_app",
      });
      if (!inserted) {
        this.logger.debug(
          `[Campaigns] suppression already active for recipient=${recipient.id} — no-op (idempotent, AC-60).`,
        );
      }
    } catch (err) {
      this.logger.warn(`[Campaigns] bounce suppression insert failed: ${String(err)}`);
    }
  }

  // ─── Private: DTO mapping ─────────────────────────────────────────────────

  private mapTemplateDto(row: CampaignTemplateRow): CampaignTemplateDto {
    if (row.channel === "email") {
      return {
        id: row.id,
        tenantId: row.tenantId,
        channel: "email",
        name: row.name,
        subject: row.subject ?? "",
        body: row.body,
        htmlBody: null,
        dltTemplateId: row.dltTemplateId,
        variables: toVariableKeys(row.variables),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };
    }
    // whatsapp or sms — dltTemplateId is non-null (enforced by schema + service).
    return {
      id: row.id,
      tenantId: row.tenantId,
      channel: row.channel as "whatsapp" | "sms",
      name: row.name,
      body: row.body,
      dltTemplateId: row.dltTemplateId ?? "",
      variables: toVariableKeys(row.variables),
      subject: null,
      htmlBody: null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private mapCampaignDto(row: CampaignRow): CampaignDto {
    return {
      id: row.id,
      name: row.name,
      channel: row.channel as "email" | "whatsapp" | "sms",
      status: row.status as "draft" | "scheduled" | "sending" | "sent" | "paused" | "cancelled" | "failed",
      scheduleAt: row.scheduleAt?.toISOString() ?? null,
      metrics: this.parseMetrics(row.metrics),
      createdAt: row.createdAt.toISOString(),
      createdByName: row.createdByName ?? "Unknown",
    };
  }

  private mapCampaignDetailDto(row: CampaignRow): CampaignDetailDto {
    return {
      ...this.mapCampaignDto(row),
      segment: row.segment as SegmentDefDto,
      template: this.mapTemplateDto(row.template),
      sentAt: null, // tracked via metrics/status
      pausedAt: null,
      cancelledAt: null,
    };
  }

  private mapRecipientDto(row: CampaignRecipientRow): CampaignRecipientDto {
    return {
      id: row.id,
      campaignId: row.campaignId,
      leadId: row.leadId,
      studentId: row.studentId,
      to: row.to,
      status: row.status as "queued" | "sent" | "delivered" | "read" | "failed",
      providerMessageId: row.providerMessageId,
      error: row.error,
      sentAt: row.sentAt?.toISOString() ?? null,
      deliveredAt: row.deliveredAt?.toISOString() ?? null,
      readAt: row.readAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private parseMetrics(raw: unknown): CampaignMetricsDto {
    const m = (raw as Record<string, number>) ?? {};
    return {
      total: m["total"] ?? 0,
      queued: m["queued"] ?? 0,
      sent: m["sent"] ?? 0,
      delivered: m["delivered"] ?? 0,
      read: m["read"] ?? 0,
      failed: m["failed"] ?? 0,
      suppressed: m["suppressed"] ?? 0,
    };
  }
}

/**
 * The substitution map for one recipient — exactly the keys in CAMPAIGN_TEMPLATE_VARIABLES.
 *
 * A recipient is one of lead / student / user (the model guarantees exactly one), so name
 * and programme are read from whichever is present. Missing data becomes an EMPTY STRING
 * rather than being left out: an absent key would make `renderRaw` leave the raw
 * `{{name}}` in the message, which is precisely the failure this replaced. A blank reads
 * as an imperfect mail-merge; braces read as broken software.
 */
function buildRecipientVariables(
  recipient: CampaignRecipientRow,
  campaign: CampaignRow,
): Record<string, string> {
  const name =
    recipient.student?.user.name ?? recipient.lead?.name ?? recipient.user?.name ?? "";
  const programTitle =
    recipient.student?.enrollments[0]?.program.title ?? recipient.lead?.programInterest?.title ?? "";

  return {
    name,
    to: recipient.to,
    program_title: programTitle,
    campaign_name: campaign.name,
  };
}

/**
 * `campaign_templates.variables` is a Prisma `Json` column, and what is actually in it
 * depends on who wrote the row: the seed wrote `[{ key, label }]` objects while the DTO has
 * always declared `string[]`, and the mapper simply cast — so the CRM rendered
 * "{{[object Object]}}" for every seeded template and the edit form round-tripped that
 * string back into the record.
 *
 * Normalising on the way OUT makes the declared contract true for both shapes, without a
 * data migration and without breaking rows written by either era.
 */
function toVariableKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (typeof entry === "string") return entry;
      if (entry && typeof entry === "object" && "key" in entry) {
        const key = (entry as { key: unknown }).key;
        return typeof key === "string" ? key : null;
      }
      return null;
    })
    .filter((key): key is string => Boolean(key));
}
