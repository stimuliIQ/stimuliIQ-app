// apps/api/src/modules/emi/dunning/emi-dunning.port.ts
//
// EmiDunningPort — sends a "your EMI installment is due/overdue" reminder email
// (T24, docs/plans/phase-9-completion.md). Same ADR-0020 producer/port seam as every
// other Phase-9 queue integration in this codebase (LiveClassReminderPort,
// InvoiceGenPort, VideoWebhookProcessorPort):
//   - EMI_DUNNING_PORT is the DI interface (symbol token).
//   - SyncEmiDunningAdapter is the QUEUE_DRIVER=sync (default) implementation — sends
//     the email INLINE via MailProvider (mirrors ReportScheduleDispatchScheduler's
//     direct `mail.send()` call — a dunning reminder has no fitting
//     `NotificationType` enum value (grade_ready/certificate_ready/live_reminder/
//     forum_reply/announcement/lead_confirmation/booking_confirmation/payment_receipt/
//     welcome — none fit "payment due"), so this bypasses NotificationsService.notify()
//     entirely and calls MailProvider directly, same as the report-schedule dispatcher).
//   - BullMqEmiDunningAdapter is the QUEUE_DRIVER=bullmq implementation, enqueuing a
//     fire-and-forget job consumed by apps/api/src/worker.ts.
//
// FOLLOW-UP (documented gap, not a silent omission): a dedicated `payment_due`
// NotificationType enum value would let this route through the SMS/WhatsApp channels
// too via NotificationsService; today it is EMAIL-ONLY (SMS also blocked separately —
// SmsProvider.sendSms() requires a DLT-registered template id, not yet provisioned
// per docs/plans/phase-9-completion.md DECISION 4). Tracked as a phase-9 follow-up.

import { Injectable, Inject, Logger } from "@nestjs/common";
import { Queue } from "bullmq";
import { getBullMqConnectionOptions } from "../../../queues/queue-connection";
import { QUEUE_NAMES } from "../../../queues/queue-names";
import { FIRE_AND_FORGET_JOB_OPTIONS } from "../../../queues/job-options";
import { MAIL_PROVIDER, type MailProvider } from "../../notifications/providers/mail/mail-provider.interface";
import { renderBrandedEmail, escapeEmailHtml } from "../../notifications/dispatch/email-layout";

export interface EmiDunningReminderInput {
  tenantId: string;
  emiPlanId: string;
  installmentId: string;
  installmentNo: number;
  amountPaise: number;
  currency: string;
  dueDate: string; // ISO date
  dunningAttempts: number;
  toEmail: string;
  studentName: string;
}

export interface EmiDunningPort {
  /** Sends (or enqueues) a dunning reminder. MUST be idempotent per (installmentId, dunningAttempts). */
  sendReminder(input: EmiDunningReminderInput): Promise<void>;
}

export const EMI_DUNNING_PORT = Symbol("EMI_DUNNING_PORT");

function formatAmount(amountPaise: number, currency: string): string {
  return `${currency} ${(amountPaise / 100).toFixed(2)}`;
}

function buildEmailHtml(input: EmiDunningReminderInput): string {
  return renderBrandedEmail({
    title: "EMI installment reminder",
    greeting: `Dear ${escapeEmailHtml(input.studentName)},`,
    paragraphs: [
      `This is a reminder that installment #${input.installmentNo} of your EMI plan is due.`,
    ],
    details: [
      { label: "Installment", value: `#${input.installmentNo}` },
      { label: "Amount", value: `<strong>${formatAmount(input.amountPaise, input.currency)}</strong>` },
      { label: "Due date", value: new Date(input.dueDate).toLocaleDateString("en-IN") },
    ],
    closing: ["Please complete the payment at your earliest convenience to avoid disruption to your enrollment."],
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Sync adapter (QUEUE_DRIVER=sync, default)
// ─────────────────────────────────────────────────────────────────────────────

@Injectable()
export class SyncEmiDunningAdapter implements EmiDunningPort {
  private readonly logger = new Logger(SyncEmiDunningAdapter.name);

  constructor(@Inject(MAIL_PROVIDER) private readonly mail: MailProvider) {}

  async sendReminder(input: EmiDunningReminderInput): Promise<void> {
    try {
      await this.mail.send({
        to: input.toEmail,
        subject: `Reminder: EMI installment #${input.installmentNo} is due`,
        html: buildEmailHtml(input),
        tags: [{ name: "category", value: "emi_dunning" }],
      });
    } catch (err) {
      // Never let a mail-provider failure break the caller's mutation flow (mirrors
      // ReportScheduleDispatchScheduler's sanitized, non-fatal mail-failure logging).
      this.logger.error(
        `[EmiDunning] mail send failed installmentId=${input.installmentId}: ${err instanceof Error ? err.message : "unknown error"}`,
      );
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BullMQ adapter (QUEUE_DRIVER=bullmq)
// ─────────────────────────────────────────────────────────────────────────────

@Injectable()
export class BullMqEmiDunningAdapter implements EmiDunningPort {
  private readonly logger = new Logger(BullMqEmiDunningAdapter.name);
  private readonly queue: Queue<EmiDunningReminderInput>;

  constructor() {
    this.queue = new Queue<EmiDunningReminderInput>(QUEUE_NAMES.EMI_DUNNING, {
      connection: getBullMqConnectionOptions(),
    });
  }

  async sendReminder(input: EmiDunningReminderInput): Promise<void> {
    await this.queue.add("reminder", input, {
      ...FIRE_AND_FORGET_JOB_OPTIONS,
      jobId: `emi-dunning:${input.installmentId}:${input.dunningAttempts}`,
    });
    this.logger.debug(`[BullMqEmiDunning] enqueued installmentId=${input.installmentId}`);
  }
}
