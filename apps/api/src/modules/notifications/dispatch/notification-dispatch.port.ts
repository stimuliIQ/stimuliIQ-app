// apps/api/src/modules/notifications/dispatch/notification-dispatch.port.ts
//
// NotificationDispatchPort — the async-work seam for single-notification channel sends.
// (docs/04-trd-architecture.md §2.8/§2.9; docs/plans/phase-6.md §2 "Queue seam decision")
//
// BullMQ STATUS (updated — docs/plans/phase-9-completion.md T18/R1, ADR-0056): BullMQ
// IS installed and wired. NOTIFICATION_DISPATCH_PORT is bound to
// SyncNotificationDispatchAdapter (QUEUE_DRIVER=sync, default — required for the Jest
// unit suite) or BullMqNotificationDispatchAdapter (QUEUE_DRIVER=bullmq) via a
// useFactory gate in dispatch.module.ts. Idempotency: the DB-level `notifications` row
// uniqueness (sync path) PLUS BullMQ `jobId: dedupeKey` deduplication (bullmq path).
//
// DECISION (historical — P6/ADR-0039, port SHAPE unchanged, driver selection
// superseded by ADR-0056):
//   - NotificationDispatchPort is the interface both Sync and BullMq adapters implement.
//   - The seam: rebinding via QUEUE_DRIVER requires zero changes to callers.
//
// See bullmq-notification-dispatch.adapter.ts for the real adapter and
// apps/api/src/worker.ts for the worker process that consumes the queue.
//
// CHANNEL SEMANTICS:
//   - 'in_app': writes a `notifications` row (no external provider). Always succeeds
//     unless a DB constraint fires (soft-idempotency — caller checks before dispatch).
//   - 'email':    calls MailProvider.send()
//   - 'sms':      calls SmsProvider.sendSms() — requires dltTemplateId (Rule C-3)
//   - 'whatsapp': calls WhatsAppProvider.sendTemplate() — requires dltTemplateId (Rule C-3)
//
// IDEMPOTENCY:
//   The `dedupeKey` field is used to prevent double-dispatch:
//     - For in-app: the `notifications` table PK / caller must guard uniqueness.
//     - For external channels: the adapter records the dedupeKey in memory (in-request) and
//       returns { skipped: true } for a second call with the same key within the same request.
//     - On BullMQ: dedupeKey maps to `jobId` (Bull deduplicates by jobId in the queue).
//   The DB-level idempotency contracts (points_ledger, campaign_recipients partial-uniques)
//   are the correctness layer; this key is the in-adapter performance layer.

import type { NotificationChannel } from "@repo/types";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A fully-rendered, single-channel send job.
 * Produced by NotificationService after resolving prefs + templates.
 * The adapter calls the right provider based on `channel`.
 *
 * SECURITY: Never carries provider secrets, API keys, or signing secrets.
 * The adapter reads those from the provider instances (injected via DI).
 */
export interface ChannelSendJob {
  /**
   * Target channel for this send.
   * 'in_app' → write notifications row; no external provider.
   * 'email'  → MailProvider.send()
   * 'sms'    → SmsProvider.sendSms() (requires dltTemplateId — Rule C-3)
   * 'whatsapp' → WhatsAppProvider.sendTemplate() (requires dltTemplateId — Rule C-3)
   */
  channel: NotificationChannel;

  /**
   * Unique idempotency key for this send job.
   * Format: `<notificationId>:<channel>` for notification fan-out.
   *         `<campaignRecipientId>:<channel>` for campaign sends.
   * On BullMQ: used as jobId. Synchronously: used to detect double-dispatch.
   */
  dedupeKey: string;

  // ─── Recipient ─────────────────────────────────────────────────────────────

  /** Recipient email address — required when channel='email'. */
  toEmail?: string;
  /** Recipient phone in E.164 format — required when channel='sms' or 'whatsapp'. */
  toPhone?: string;
  /** Recipient user ID — used to write the in_app notifications row. */
  userId?: string;
  /** Tenant ID — required for all in-app row writes. */
  tenantId?: string;

  // ─── Rendered content ──────────────────────────────────────────────────────

  /** Email/SMS/WhatsApp subject line. Required for email channel. */
  subject?: string;
  /**
   * Rendered message body.
   * Email: HTML string. SMS: plain text. WhatsApp: template param vars (as body text).
   * In-app: plain text summary stored in the notification payload.
   */
  body: string;

  // ─── India DLT compliance (LOCK-D4, Rule C-3, AC-78) ──────────────────────

  /**
   * REQUIRED for channel='sms' and channel='whatsapp'.
   * DLT-registered approved template identifier (India TRAI compliance).
   * The adapter REJECTS an SMS/WhatsApp send without this field before any provider call.
   * Email channel: this field is ignored.
   */
  dltTemplateId?: string;

  /**
   * WhatsApp template name (for whatsapp channel).
   * Maps to WhatsAppProvider.sendTemplate() templateName parameter.
   */
  whatsappTemplateName?: string;

  /**
   * WhatsApp template variables (for whatsapp channel).
   * Maps to WhatsAppProvider.sendTemplate() variables parameter.
   */
  whatsappVariables?: string[];

  // ─── In-app notification context (channel='in_app' only) ──────────────────

  /**
   * Notification type — stored in the notifications row.
   * Only used when channel='in_app'.
   */
  notificationType?: string;

  /**
   * Typed payload stored in notifications.payload JSON.
   * Only used when channel='in_app'.
   */
  notificationPayload?: Record<string, unknown>;

  /**
   * Which channels were used for this notification fan-out (stored in notifications.channels).
   * Only used when channel='in_app'.
   */
  channelsRecord?: Record<string, boolean>;

  // ─── Email tags (optional, never PII) ─────────────────────────────────────

  /** Email tags for provider tracking. MUST NOT carry PII. */
  emailTags?: Array<{ name: string; value: string }>;
}

/**
 * Result returned by NotificationDispatchPort.dispatch().
 */
export interface ChannelSendResult {
  /**
   * Whether the send was issued to the provider (or in-app row was written).
   * false when skipped due to idempotency (dedupeKey already seen).
   */
  dispatched: boolean;
  /**
   * Whether this dispatch was a no-op (duplicate dedupeKey detected).
   * When true, no provider call was made and no DB row was written.
   */
  skipped: boolean;
  /**
   * Provider-assigned message ID.
   * Present when dispatched=true and channel is not 'in_app'.
   * Stored in campaign_recipients.provider_message_id for delivery tracking.
   * NEVER contains secrets, API keys, or signing secrets.
   */
  providerMessageId?: string;
  /**
   * For in_app channel: the ID of the written notifications row.
   */
  notificationId?: string;
  /** Error message if the dispatch failed (provider threw). */
  error?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Port interface
// ─────────────────────────────────────────────────────────────────────────────

/**
 * NotificationDispatchPort — the DI-token-bound interface for single-channel sends.
 *
 * NotificationService (fan-out) and CampaignService (bulk send) both inject this port.
 * The sync adapter calls the provider synchronously; the BullMQ adapter enqueues the job.
 *
 * CONTRACT: Implementations MUST be idempotent by `job.dedupeKey`.
 */
export interface NotificationDispatchPort {
  /**
   * Dispatch a single-channel send job.
   *
   * Idempotent: calling with the same dedupeKey within the same adapter lifetime
   * returns { dispatched: false, skipped: true }. On BullMQ: jobId deduplication.
   *
   * Never throws for suppression or dedupe — returns skipped=true.
   * May throw for genuine provider errors (network failure, auth error).
   */
  dispatch(job: ChannelSendJob): Promise<ChannelSendResult>;
}

// ─────────────────────────────────────────────────────────────────────────────
// DI Token
// ─────────────────────────────────────────────────────────────────────────────

/** DI token for injecting NotificationDispatchPort into feature modules. */
export const NOTIFICATION_DISPATCH_PORT = Symbol("NOTIFICATION_DISPATCH_PORT");
