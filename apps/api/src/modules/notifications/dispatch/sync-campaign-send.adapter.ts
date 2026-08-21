// apps/api/src/modules/notifications/dispatch/sync-campaign-send.adapter.ts
//
// SyncCampaignSendAdapter — synchronous, idempotent per-recipient campaign send adapter.
// (ADR-0020 extension, LOCK-D1, docs/plans/phase-6.md §2)
//
// This is the DEFAULT binding for CAMPAIGN_SEND_PORT. Each call to send() dispatches
// a single campaign recipient inline in the request/job cycle:
//   email    → MailProvider.send()
//   sms      → SmsProvider.sendSms()
//   whatsapp → WhatsAppProvider.sendTemplate()
//
// IDEMPOTENCY (AC-27, AC-28):
//   - In-request: a per-instance `Set<string>` prevents double-dispatch in the same call.
//   - Cross-request: the caller (CampaignService) checks campaign_recipients.status before
//     calling send(). If status is not 'queued', the row is already processed — no-op.
//   - The DB partial-unique on (campaign_id, COALESCE(lead_id, student_id, user_id)) WHERE
//     deleted_at IS NULL prevents duplicate recipient rows at the DB level (AC-28).
//
// THROTTLING SEAM:
//   throttle() is a no-op in this adapter. When BullMQ is introduced, the queue's
//   rateLimiter option replaces this hook. Callers MUST call throttle() before send()
//   so the migration requires zero change to CampaignService.
//
// DLT GATE (Rule C-3, defense-in-depth):
//   SMS/WhatsApp sends without dltTemplateId return error='DLT_TEMPLATE_ID_REQUIRED'
//   without a provider call. The service layer already enforces this; this is a second layer.
//
// SECURITY:
//   - Never logs full phone/email (masked).
//   - Never includes API keys or secrets in results.
//   - provider errors are returned as error strings (no raw stack traces in result).

import { Injectable, Logger, Inject } from "@nestjs/common";
import type { CampaignSendPort, RecipientSendJob, RecipientSendResult } from "./campaign-send.port";
import { MAIL_PROVIDER, type MailProvider } from "../providers/mail/mail-provider.interface";
import { wrapInBrandedShell } from "./email-layout";
import { WHATSAPP_PROVIDER, type WhatsAppProvider } from "../providers/whatsapp/whatsapp-provider.interface";
import { SMS_PROVIDER, type SmsProvider } from "../../auth/providers/sms/sms-provider.interface";

@Injectable()
export class SyncCampaignSendAdapter implements CampaignSendPort {
  private readonly logger = new Logger(SyncCampaignSendAdapter.name);

  /**
   * In-request deduplication.
   * Guards against double-dispatch within the same send cycle (e.g. retry without restart).
   * Cross-request idempotency comes from the DB campaign_recipients.status check in the service.
   */
  private readonly seenKeys = new Set<string>();

  constructor(
    @Inject(MAIL_PROVIDER) private readonly mail: MailProvider,
    @Inject(WHATSAPP_PROVIDER) private readonly whatsapp: WhatsAppProvider,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
  ) {}

  /**
   * Throttle hook — no-op in the sync adapter.
   *
   * BullMQ migration: the queue's rateLimiter option provides per-channel throttling.
   * If a sync rate-limiter is needed (e.g. `p-throttle`), inject it here and await
   * a delay. Do NOT change the caller signature.
   */
  async throttle(_channel: "email" | "whatsapp" | "sms"): Promise<void> {
    // No-op — sync adapter; throttling is BullMQ queue-level or provider-level.
  }

  async send(job: RecipientSendJob): Promise<RecipientSendResult> {
    // ─── In-request idempotency ────────────────────────────────────────────
    if (this.seenKeys.has(job.dedupeKey)) {
      this.logger.debug(
        `[CampaignSend] Duplicate dedupeKey="${job.dedupeKey}", skipping (idempotent no-op).`,
      );
      return { sent: false, queued: false };
    }
    this.seenKeys.add(job.dedupeKey);

    // ─── DLT gate (defense-in-depth — Rule C-3, AC-78, AC-31) ────────────
    if ((job.channel === "sms" || job.channel === "whatsapp") && !job.dltTemplateId) {
      this.logger.warn(
        `[CampaignSend] ${job.channel} send rejected: missing dltTemplateId, ` +
          `campaignRecipientId="${job.campaignRecipientId}" (Rule C-3).`,
      );
      return { sent: false, queued: false, error: "DLT_TEMPLATE_ID_REQUIRED" };
    }

    // ─── Throttle (no-op sync, hook preserved for migration) ──────────────
    await this.throttle(job.channel);

    // ─── Route by channel ─────────────────────────────────────────────────
    switch (job.channel) {
      case "email":
        return this.sendEmail(job);
      case "sms":
        return this.sendSms(job);
      case "whatsapp":
        return this.sendWhatsApp(job);
      default: {
        const _exhaustive: never = job.channel;
        this.logger.warn(`[CampaignSend] Unknown channel: ${String(_exhaustive)}`);
        return { sent: false, queued: false, error: "UNKNOWN_CHANNEL" };
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private channel handlers
  // ─────────────────────────────────────────────────────────────────────────

  private async sendEmail(job: RecipientSendJob): Promise<RecipientSendResult> {
    const maskedTo = this.maskAddress(job.to);
    this.logger.log(
      `[CampaignSend] email: to=${maskedTo} subject="${job.subject ?? "(none)"}" ` +
        `campaignId="${job.campaignId}" recipientId="${job.campaignRecipientId}"`,
    );

    try {
      const result = await this.mail.send({
        to: job.to,
        subject: job.subject ?? "",
        // Campaign bodies are CRM-authored fragments; the branded shell adds the
        // logo header / footer so every outbound email shares one trusted look.
        // Skip wrapping when the author already supplied a full HTML document.
        html: /<html[\s>]/i.test(job.body) ? job.body : wrapInBrandedShell(job.body),
        tags: job.emailTags,
      });
      return { sent: true, queued: false, providerMessageId: result.providerMessageId };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `[CampaignSend] email failed: to=${maskedTo} recipientId="${job.campaignRecipientId}" error="${msg}"`,
      );
      return { sent: false, queued: false, error: msg };
    }
  }

  private async sendSms(job: RecipientSendJob): Promise<RecipientSendResult> {
    // dltTemplateId is guaranteed non-null here (gate above), but TypeScript narrowing.
    const dltTemplateId = job.dltTemplateId!;
    const maskedTo = this.maskAddress(job.to);
    this.logger.log(
      `[CampaignSend] sms: to=${maskedTo} dltTemplateId="${dltTemplateId}" ` +
        `campaignId="${job.campaignId}" recipientId="${job.campaignRecipientId}"`,
    );

    try {
      const result = await this.sms.sendSms({
        phone: job.to,
        body: job.body,
        dltTemplateId,
      });
      return { sent: true, queued: false, providerMessageId: result.providerMessageId };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `[CampaignSend] sms failed: to=${maskedTo} recipientId="${job.campaignRecipientId}" error="${msg}"`,
      );
      return { sent: false, queued: false, error: msg };
    }
  }

  private async sendWhatsApp(job: RecipientSendJob): Promise<RecipientSendResult> {
    const dltTemplateId = job.dltTemplateId!;  
    const templateName = job.whatsappTemplateName;

    if (!templateName) {
      this.logger.warn(
        `[CampaignSend] whatsapp send missing whatsappTemplateName, recipientId="${job.campaignRecipientId}"`,
      );
      return { sent: false, queued: false, error: "MISSING_WHATSAPP_TEMPLATE_NAME" };
    }

    const maskedTo = this.maskAddress(job.to);
    this.logger.log(
      `[CampaignSend] whatsapp: to=${maskedTo} template="${templateName}" dltTemplateId="${dltTemplateId}" ` +
        `campaignId="${job.campaignId}" recipientId="${job.campaignRecipientId}"`,
    );

    try {
      const result = await this.whatsapp.sendTemplate({
        to: job.to,
        templateName,
        dltTemplateId,
        variables: job.whatsappVariables,
      });
      return { sent: true, queued: false, providerMessageId: result.providerMessageId };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `[CampaignSend] whatsapp failed: to=${maskedTo} recipientId="${job.campaignRecipientId}" error="${msg}"`,
      );
      return { sent: false, queued: false, error: msg };
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Security helpers
  // ─────────────────────────────────────────────────────────────────────────

  private maskAddress(address: string): string {
    if (address.includes("@")) {
      const [local] = address.split("@");
      return `${(local ?? "").slice(0, 3)}***`;
    }
    if (address.length > 7) {
      return `${address.slice(0, 3)}***${address.slice(-4)}`;
    }
    return `${address.slice(0, 2)}***`;
  }
}
