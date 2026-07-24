// apps/api/src/queues/queue-names.ts
//
// Canonical BullMQ queue names (docs/plans/phase-9-completion.md T18 / R1). Both the
// producer side (BullMq*Adapter classes) and the worker entrypoint
// (apps/api/src/worker.ts) import this file so the names never drift out of sync.

export const QUEUE_NAMES = {
  /** Single-channel notification sends (email/sms/whatsapp/in_app) — NotificationDispatchPort. */
  NOTIFICATION_DISPATCH: "notification-dispatch",
  /** Per-recipient bulk campaign sends — CampaignSendPort. */
  CAMPAIGN_SEND: "campaign-send",
  /** Invoice PDF generation for a paid order — InvoiceGenPort. */
  INVOICE_GEN: "invoice-gen",
  /** Razorpay payment webhook event processing — WebhookProcessorPort (commerce). */
  WEBHOOK_PROCESSOR: "webhook-processor",
  /** Video transcode-status webhook event processing — VideoWebhookProcessorPort (lms). */
  VIDEO_WEBHOOK: "video-webhook",
  /** Certificate PDF render (RPC-style: producer awaits the job result) — CertificatePdfPort. */
  CERTIFICATE_GEN: "certificate-gen",
  /** Report/export PDF render (RPC-style: producer awaits the job result) — ReportPdfPort. */
  REPORT_GEN: "report-gen",
  /** Per-recipient live-class "starting soon" reminder (delayed job) — LiveClassReminderPort. */
  LIVE_CLASS_REMINDER: "live-class-reminder",
  /** EMI installment dunning reminder email (fire-and-forget) — EmiDunningPort (T24). */
  EMI_DUNNING: "emi-dunning",
  /** Invoice/receipt PDF render + StorageProvider upload (fire-and-forget) — ReceiptGenPort (T27). */
  RECEIPT_GEN: "receipt-gen",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];
