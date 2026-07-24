// apps/api/src/modules/notifications/dispatch/campaign-send.port.ts
//
// CampaignSendPort — the async-work seam for per-recipient bulk campaign sends.
// (docs/04-trd-architecture.md §2.8/§2.9; docs/plans/phase-6.md §2 "Queue seam decision")
//
// BullMQ STATUS (updated — docs/plans/phase-9-completion.md T18/R1, ADR-0056): BullMQ
// IS installed and wired. CAMPAIGN_SEND_PORT is bound to SyncCampaignSendAdapter
// (QUEUE_DRIVER=sync, default — required for the Jest unit suite) or
// BullMqCampaignSendAdapter (QUEUE_DRIVER=bullmq) via a useFactory gate in
// dispatch.module.ts.
//
// DECISION (historical — P6/ADR-0039, port SHAPE unchanged, driver selection
// superseded by ADR-0056):
//   - CampaignSendPort is the interface both Sync and BullMq adapters implement.
//   - Correctness guaranteed by the DB-level `campaign_recipients` partial-unique
//     constraint: (campaign_id, COALESCE(lead_id, student_id, user_id)) WHERE deleted_at IS NULL,
//     PLUS BullMQ `jobId: dedupeKey` deduplication (bullmq path).
//
// See bullmq-campaign-send.adapter.ts for the real adapter and
// apps/api/src/worker.ts for the worker process that consumes the queue.
//
// THROTTLING SEAM:
//   The sync adapter includes a rate-limiter hook (`throttle(channel)`). In the sync
//   adapter this is a no-op (no real rate-limit applies in-request for a few recipients).
//   The BullMQ adapter is also a no-op — worker-level rate limiting is a `limiter`
//   option on the BullMQ Worker constructor (worker.ts), not a per-call hook.
//   The hook signature is preserved so callers needed zero changes across either driver.
//
// IDEMPOTENCY:
//   The `dedupeKey` is `<campaignId>:<recipientId>` (campaign_recipients.id).
//   The adapter checks campaign_recipients.status: if 'sent'/'delivered'/'read'/'failed',
//   the send is a no-op (replay-safe). This satisfies AC-27 (exactly-once per recipient).
//
// CONSENT / SUPPRESSION:
//   The CampaignService MUST check consent + suppression before calling send().
//   This port does NOT re-check — it trusts the caller has gated on Rule C-1 and C-2.
//   Defense-in-depth: the DLT gate (Rule C-3) IS re-checked by this adapter for SMS/WA.

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A per-recipient send job dispatched by CampaignService.
 * One job = one recipient in a campaign.
 *
 * SECURITY: Must NOT carry provider API keys, signing secrets, or suppression
 * internals. The adapter reads those from the injected provider instances.
 */
export interface RecipientSendJob {
  // ─── Job identity ─────────────────────────────────────────────────────────

  /**
   * Idempotency key for this send.
   * Format: `campaign-recipient:<campaignRecipientId>`.
   * On BullMQ: used as jobId.
   */
  dedupeKey: string;

  /** campaign_recipients.id — used to look up status and update after send. */
  campaignRecipientId: string;

  /** campaign.id — for campaign-level status aggregation. */
  campaignId: string;

  /** Tenant ID for all DB writes. */
  tenantId: string;

  // ─── Channel + recipient ──────────────────────────────────────────────────

  /** Delivery channel: 'email' | 'whatsapp' | 'sms'. Never 'in_app'. */
  channel: "email" | "whatsapp" | "sms";

  /** Resolved recipient address: email or E.164 phone. */
  to: string;

  // ─── Rendered content ─────────────────────────────────────────────────────

  /** Subject line (required for email). */
  subject?: string;

  /** Rendered message body: HTML for email; plain text for SMS/WA. */
  body: string;

  // ─── India DLT compliance (LOCK-D4, Rule C-3, AC-78) ─────────────────────

  /**
   * REQUIRED for channel='sms' and channel='whatsapp'.
   * The adapter REJECTS the send and marks the recipient as 'failed' with
   * error='DLT_TEMPLATE_ID_REQUIRED' when this is absent/empty.
   * Defense-in-depth: the CampaignService already checks at send time (AC-31).
   */
  dltTemplateId?: string;

  /**
   * WhatsApp template name — required for whatsapp channel.
   * Passed to WhatsAppProvider.sendTemplate().
   */
  whatsappTemplateName?: string;

  /**
   * WhatsApp template variable substitutions.
   * Passed to WhatsAppProvider.sendTemplate() as the `variables` array.
   */
  whatsappVariables?: string[];

  /** Email tracking tags (never PII). */
  emailTags?: Array<{ name: string; value: string }>;
}

/**
 * Result returned by CampaignSendPort.send().
 * The CampaignService uses this to update campaign_recipients.status.
 */
export interface RecipientSendResult {
  /**
   * Whether the send was issued to the provider.
   * false when dedupeKey already seen (idempotent skip).
   */
  sent: boolean;

  /**
   * Whether the job was enqueued for async processing.
   * true on BullMQ adapter; false on sync adapter (already sent synchronously).
   */
  queued: boolean;

  /**
   * Provider-assigned message ID.
   * Stored in campaign_recipients.provider_message_id.
   * NEVER contains API keys or secrets.
   */
  providerMessageId?: string;

  /** Error message if the send failed. */
  error?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Port interface
// ─────────────────────────────────────────────────────────────────────────────

/**
 * CampaignSendPort — per-recipient send DI port for CampaignModule.
 *
 * CampaignService injects this to dispatch individual sends for each campaign
 * recipient. The sync adapter calls providers inline; BullMQ adapter enqueues.
 *
 * CONTRACT:
 *   - Idempotent by dedupeKey.
 *   - DLT gate enforced for SMS/WhatsApp (defense-in-depth after service-layer check).
 *   - Never re-checks consent/suppression (caller responsibility).
 *   - The throttle() hook is called before each external provider call.
 */
export interface CampaignSendPort {
  /**
   * Dispatch a per-recipient campaign send.
   * Returns the result so the caller can update campaign_recipients.status.
   */
  send(job: RecipientSendJob): Promise<RecipientSendResult>;

  /**
   * Rate-limiter hook. Called before each external provider send.
   * Sync adapter: no-op (resolves immediately).
   * BullMQ adapter: sets queue rate-limiter on the job; this method is no-op there too
   * since rate-limiting is declarative on the queue options.
   *
   * If a real sync rate-limiter is needed (e.g. p-throttle), inject it here.
   * Currently a stub hook so the migration path is zero-change.
   */
  throttle(channel: "email" | "whatsapp" | "sms"): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// DI Token
// ─────────────────────────────────────────────────────────────────────────────

/** DI token for injecting CampaignSendPort into CampaignModule. */
export const CAMPAIGN_SEND_PORT = Symbol("CAMPAIGN_SEND_PORT");
