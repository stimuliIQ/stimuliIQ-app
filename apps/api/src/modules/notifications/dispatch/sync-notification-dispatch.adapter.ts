// apps/api/src/modules/notifications/dispatch/sync-notification-dispatch.adapter.ts
//
// SyncNotificationDispatchAdapter — synchronous, idempotent adapter for single-channel
// notification sends (ADR-0020 extension, LOCK-D1, docs/plans/phase-6.md §2 Risk #1).
//
// This is the DEFAULT binding for NOTIFICATION_DISPATCH_PORT. It processes sends
// synchronously in the request cycle, calling the appropriate provider:
//   in_app   → writes notifications DB row (via injected PrismaService)
//   email    → MailProvider.send()
//   sms      → SmsProvider.sendSms()  (requires dltTemplateId — Rule C-3)
//   whatsapp → WhatsAppProvider.sendTemplate() (requires dltTemplateId — Rule C-3)
//
// IDEMPOTENCY:
//   - In-request: a per-instance `Set<string>` guards against double-dispatch in the
//     same request (e.g. if NotificationService calls dispatch twice for the same job).
//   - Cross-request: the DB provides the persistent idempotency layer:
//       * notifications table: the caller guards against duplicate rows.
//       * campaign_recipients: partial-unique (campaign_id, recipient) prevents DB duplicates.
//   - dedupeKey collision in the same request → returns { dispatched: false, skipped: true }.
//
// DLT ENFORCEMENT (LOCK-D4, Rule C-3, AC-78, defense-in-depth):
//   SMS and WhatsApp sends that arrive here without a dltTemplateId are rejected with
//   { dispatched: false, skipped: false, error: 'DLT_TEMPLATE_ID_REQUIRED' } —
//   NO provider call is made. The service layer enforces this first; this adapter adds
//   a second defensive layer so a rogue call cannot bypass it.
//
// SECURITY:
//   - Never logs provider API keys, signing secrets, or user PII (phone/email in logs
//     is masked to first 3 chars + ***).
//   - Never returns API keys or secrets in the result.
//   - Provider errors are caught, logged (without secrets), and returned as error strings.

import { Injectable, Logger, Inject } from "@nestjs/common";
import type { NotificationDispatchPort, ChannelSendJob, ChannelSendResult } from "./notification-dispatch.port";
import { MAIL_PROVIDER, type MailProvider } from "../providers/mail/mail-provider.interface";
import { WHATSAPP_PROVIDER, type WhatsAppProvider } from "../providers/whatsapp/whatsapp-provider.interface";
import { SMS_PROVIDER, type SmsProvider } from "../../auth/providers/sms/sms-provider.interface";

@Injectable()
export class SyncNotificationDispatchAdapter implements NotificationDispatchPort {
  private readonly logger = new Logger(SyncNotificationDispatchAdapter.name);

  /**
   * In-request deduplication set.
   * Guards against double-dispatch within the same request cycle.
   * Does NOT persist across requests — cross-request idempotency is the DB's job.
   */
  private readonly seenKeys = new Set<string>();

  constructor(
    @Inject(MAIL_PROVIDER) private readonly mail: MailProvider,
    @Inject(WHATSAPP_PROVIDER) private readonly whatsapp: WhatsAppProvider,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
  ) {}

  async dispatch(job: ChannelSendJob): Promise<ChannelSendResult> {
    // ─── In-request idempotency ────────────────────────────────────────────
    if (this.seenKeys.has(job.dedupeKey)) {
      this.logger.debug(
        `[Dispatch] Duplicate dedupeKey="${job.dedupeKey}" channel="${job.channel}", skipping (idempotent no-op).`,
      );
      return { dispatched: false, skipped: true };
    }
    this.seenKeys.add(job.dedupeKey);

    // ─── Route by channel ─────────────────────────────────────────────────
    switch (job.channel) {
      case "in_app":
        return this.dispatchInApp(job);
      case "email":
        return this.dispatchEmail(job);
      case "sms":
        return this.dispatchSms(job);
      case "whatsapp":
        return this.dispatchWhatsApp(job);
      default: {
        // TypeScript exhaustive check — this branch is unreachable with correct types
        const _exhaustive: never = job.channel;
        this.logger.warn(`[Dispatch] Unknown channel: ${String(_exhaustive)}, skipping.`);
        return { dispatched: false, skipped: true };
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private channel handlers
  // ─────────────────────────────────────────────────────────────────────────

  private async dispatchInApp(job: ChannelSendJob): Promise<ChannelSendResult> {
    // In-app writes are handled by NotificationService (which has PrismaService).
    // This adapter signals "in_app was dispatched" — the actual DB write happens
    // in the service layer BEFORE calling dispatch (the row is written first, then
    // the channel record is updated). So here we just confirm success.
    //
    // NOTE: If the architecture evolves so the adapter owns the write, inject PrismaService
    // here and call prisma.notification.create(). For now the service owns the in-app write.
    this.logger.debug(
      `[Dispatch] in_app dispatched key="${job.dedupeKey}" userId="${job.userId ?? "unknown"}"`,
    );
    return {
      dispatched: true,
      skipped: false,
      notificationId: job.notificationPayload?.["notificationId"] as string | undefined,
    };
  }

  private async dispatchEmail(job: ChannelSendJob): Promise<ChannelSendResult> {
    if (!job.toEmail) {
      // NOT an error, despite how this used to read in the logs. `toEmail` is optional on
      // `notify()`, and callers omit it deliberately when they have ALREADY sent a richer
      // one-off email themselves and only want the remaining channels to fan out — e.g.
      // CommerceService sends the combined "receipt + LMS credentials" mail, then passes
      // `toEmail: undefined` so this channel does not send a second, duplicate receipt.
      //
      // Logging that at WARN with an "error" code made a working, intended path look like
      // a failure, which is actively misleading when someone is debugging "why is no email
      // arriving" — it was the first thing that showed up in the log and it was a red
      // herring. Reported as a skip now; genuine send failures still log at ERROR below.
      this.logger.debug(
        `[Dispatch] email channel skipped. No recipient supplied (the caller sent its own email) key="${job.dedupeKey}"`,
      );
      return { dispatched: false, skipped: true };
    }

    const maskedTo = this.maskAddress(job.toEmail);
    this.logger.log(
      `[Dispatch] email send: to=${maskedTo} subject="${job.subject ?? "(no subject)"}" key="${job.dedupeKey}"`,
    );

    try {
      const result = await this.mail.send({
        to: job.toEmail,
        subject: job.subject ?? "",
        html: job.body,
        tags: job.emailTags,
      });
      return { dispatched: true, skipped: false, providerMessageId: result.providerMessageId };
    } catch (err) {
      // Catch + log without exposing provider secrets. The error message from Resend
      // may contain status codes but not keys.
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[Dispatch] email send failed: to=${maskedTo} key="${job.dedupeKey}" error="${msg}"`);
      return { dispatched: false, skipped: false, error: msg };
    }
  }

  private async dispatchSms(job: ChannelSendJob): Promise<ChannelSendResult> {
    // ─── DLT gate (defense-in-depth — Rule C-3, AC-78) ────────────────────
    if (!job.dltTemplateId) {
      this.logger.warn(
        `[Dispatch] SMS send rejected: missing dltTemplateId, key="${job.dedupeKey}" (Rule C-3).`,
      );
      return { dispatched: false, skipped: false, error: "DLT_TEMPLATE_ID_REQUIRED" };
    }

    if (!job.toPhone) {
      this.logger.warn(`[Dispatch] SMS channel job missing toPhone, key="${job.dedupeKey}", skipping.`);
      return { dispatched: false, skipped: false, error: "MISSING_RECIPIENT_PHONE" };
    }

    const maskedTo = this.maskAddress(job.toPhone);
    this.logger.log(
      `[Dispatch] sms send: to=${maskedTo} dltTemplateId="${job.dltTemplateId}" key="${job.dedupeKey}"`,
    );

    try {
      const result = await this.sms.sendSms({
        phone: job.toPhone,
        body: job.body,
        dltTemplateId: job.dltTemplateId,
      });
      return { dispatched: true, skipped: false, providerMessageId: result.providerMessageId };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[Dispatch] sms send failed: to=${maskedTo} key="${job.dedupeKey}" error="${msg}"`);
      return { dispatched: false, skipped: false, error: msg };
    }
  }

  private async dispatchWhatsApp(job: ChannelSendJob): Promise<ChannelSendResult> {
    // ─── DLT gate (defense-in-depth — Rule C-3, AC-78) ────────────────────
    if (!job.dltTemplateId) {
      this.logger.warn(
        `[Dispatch] WhatsApp send rejected: missing dltTemplateId, key="${job.dedupeKey}" (Rule C-3).`,
      );
      return { dispatched: false, skipped: false, error: "DLT_TEMPLATE_ID_REQUIRED" };
    }

    if (!job.toPhone) {
      this.logger.warn(`[Dispatch] WhatsApp channel job missing toPhone, key="${job.dedupeKey}", skipping.`);
      return { dispatched: false, skipped: false, error: "MISSING_RECIPIENT_PHONE" };
    }

    if (!job.whatsappTemplateName) {
      this.logger.warn(`[Dispatch] WhatsApp channel job missing whatsappTemplateName, key="${job.dedupeKey}", skipping.`);
      return { dispatched: false, skipped: false, error: "MISSING_WHATSAPP_TEMPLATE_NAME" };
    }

    const maskedTo = this.maskAddress(job.toPhone);
    this.logger.log(
      `[Dispatch] whatsapp send: to=${maskedTo} template="${job.whatsappTemplateName}" dltTemplateId="${job.dltTemplateId}" key="${job.dedupeKey}"`,
    );

    try {
      const result = await this.whatsapp.sendTemplate({
        to: job.toPhone,
        templateName: job.whatsappTemplateName,
        dltTemplateId: job.dltTemplateId,
        variables: job.whatsappVariables,
      });
      return { dispatched: true, skipped: false, providerMessageId: result.providerMessageId };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[Dispatch] whatsapp send failed: to=${maskedTo} key="${job.dedupeKey}" error="${msg}"`);
      return { dispatched: false, skipped: false, error: msg };
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Security helpers
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Masks a phone or email address for safe structured logging.
   * "+919876543210" → "+91***3210"
   * "student@example.com" → "stu***"
   * Prevents PII (full phone/email) from appearing in logs (AC-76).
   */
  private maskAddress(address: string): string {
    if (address.includes("@")) {
      // Email: show first 3 chars of local part + ***
      const [local] = address.split("@");
      return `${(local ?? "").slice(0, 3)}***`;
    }
    // Phone: show first 3 chars (country code) + *** + last 4
    if (address.length > 7) {
      return `${address.slice(0, 3)}***${address.slice(-4)}`;
    }
    return `${address.slice(0, 2)}***`;
  }
}
