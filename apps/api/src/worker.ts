// apps/api/src/worker.ts
//
// BullMQ worker process entrypoint (docs/plans/phase-9-completion.md T18 / R1).
//
// Run with: `pnpm --filter @stimuliiq/api run worker` (dev) or
// `node dist/worker.js` (prod, after `pnpm --filter @stimuliiq/api run build`).
//
// This process boots the SAME NestJS AppModule as the HTTP API (via
// `NestFactory.createApplicationContext`, NOT `NestFactory.create` — no HTTP
// listener), then registers a BullMQ `Worker` per queue (queue-names.ts). Each
// worker's processor function delegates to the EXACT SAME `Sync*Adapter` class the
// API process uses when QUEUE_DRIVER=sync — there is only ONE implementation of
// "what happens when a notification/campaign-recipient/invoice/webhook-event/PDF-
// render job runs"; QUEUE_DRIVER only decides whether that implementation runs
// inline (sync) or here, off the request path (bullmq).
//
// This process is ONLY useful when the API is deployed with QUEUE_DRIVER=bullmq —
// with QUEUE_DRIVER=sync (the default), nothing ever gets enqueued and every queue
// stays empty. It is still safe to run either way (idle workers block on Redis,
// consuming no CPU).
//
// GRACEFUL SHUTDOWN: on SIGTERM/SIGINT, every Worker is closed (waits for in-flight
// jobs to finish, per BullMQ's `worker.close()` contract) before the Nest application
// context is closed and the process exits.

import "reflect-metadata";
import type { Worker as BullMqWorker } from "bullmq";
import type { ChannelSendJob } from "./modules/notifications/dispatch/notification-dispatch.port";
import type { RecipientSendJob } from "./modules/notifications/dispatch/campaign-send.port";
import type { InvoiceGenPayload, WebhookEventPayload } from "./modules/commerce/invoice-gen.seam";
import type { ReceiptGenPayload } from "./modules/commerce/receipt-gen.seam";
import type { TranscodeEvent } from "./modules/lms/providers/video/video-provider.interface";
import type { CertificatePdfInput } from "./modules/certificates/providers/pdf/certificate-pdf-port.interface";
import type { ReportPdfInput } from "./modules/exports/providers/pdf/report-pdf-port.interface";
import type { LiveClassReminderJob } from "./modules/live-classes/reminders/bullmq-live-class-reminder.adapter";
import type { EmiDunningReminderInput } from "./modules/emi/dunning/emi-dunning.port";

async function bootstrapWorker(): Promise<void> {
  const { validateEnv, isProductionEnv } = await import("./config/env");
  const env = validateEnv();

  if (env.QUEUE_DRIVER !== "bullmq") {
    // Not a hard error — the worker can run idle — but this is almost always a
    // misconfiguration (deploying a worker process with nothing to consume).
    console.warn(
      `[worker] QUEUE_DRIVER=${env.QUEUE_DRIVER}. No producer in the API process will ever enqueue a ` +
        "job onto these queues. Set QUEUE_DRIVER=bullmq on the API deployment for this worker to do anything.",
    );
  }

  const { NestFactory } = await import("@nestjs/core");
  const { AppModule } = await import("./app.module");
  const { Worker } = await import("bullmq");
  const { getBullMqConnectionOptions } = await import("./queues/queue-connection");
  const { QUEUE_NAMES } = await import("./queues/queue-names");
  const { FIRE_AND_FORGET_JOB_OPTIONS: _unused } = await import("./queues/job-options");
  void _unused; // job options are set by the PRODUCER (Queue.add); the Worker only needs concurrency.

  const { MAIL_PROVIDER } = await import("./modules/notifications/providers/mail/mail-provider.interface");
  const { WHATSAPP_PROVIDER } = await import(
    "./modules/notifications/providers/whatsapp/whatsapp-provider.interface"
  );
  const { SMS_PROVIDER } = await import("./modules/auth/providers/sms/sms-provider.interface");
  const { SyncNotificationDispatchAdapter } = await import(
    "./modules/notifications/dispatch/sync-notification-dispatch.adapter"
  );
  const { SyncCampaignSendAdapter } = await import("./modules/notifications/dispatch/sync-campaign-send.adapter");
  const { SyncInvoiceGenAdapter } = await import("./modules/commerce/invoice-gen.seam");
  const { SyncWebhookProcessorAdapter } = await import("./modules/commerce/webhook-processor.adapter");
  const { SyncReceiptGenAdapter } = await import("./modules/commerce/receipt-gen.seam");
  const { SyncVideoWebhookProcessorAdapter } = await import("./modules/lms/lms-video-webhook.seam");
  const { SyncCertificatePdfAdapter } = await import(
    "./modules/certificates/providers/pdf/sync-certificate-pdf.adapter"
  );
  const { SyncReportPdfAdapter } = await import("./modules/exports/providers/pdf/sync-report-pdf.adapter");
  const { NotificationsService } = await import("./modules/notifications/notifications.service");
  const { SyncEmiDunningAdapter } = await import("./modules/emi/dunning/emi-dunning.port");

  console.log(`[worker] Booting application context (NODE_ENV=${env.NODE_ENV}, APP_ENV=${env.APP_ENV})...`);
  const app = await NestFactory.createApplicationContext(AppModule, {
    // No HTTP listener — this process never calls app.listen(). Logging stays on the
    // console/pino defaults already configured by AppModule's LoggerModule.
  });

  // ─── Resolve the SAME singletons the API process uses for QUEUE_DRIVER=sync ────
  const mail = app.get(MAIL_PROVIDER);
  const whatsapp = app.get(WHATSAPP_PROVIDER);
  const sms = app.get(SMS_PROVIDER);

  const notificationDispatch = new SyncNotificationDispatchAdapter(mail, whatsapp, sms);
  const campaignSend = new SyncCampaignSendAdapter(mail, whatsapp, sms);
  // CommerceModule / LmsModule bare-register these classes under their own token —
  // app.get() resolves the identical singleton the API process would use.
  const invoiceGen = app.get(SyncInvoiceGenAdapter);
  const webhookProcessor = app.get(SyncWebhookProcessorAdapter);
  const videoWebhookProcessor = app.get(SyncVideoWebhookProcessorAdapter);
  const receiptGen = app.get(SyncReceiptGenAdapter);
  // Stateless — no DI dependencies, safe to construct directly (same as the module
  // factories do for QUEUE_DRIVER=sync).
  const certificatePdf = new SyncCertificatePdfAdapter();
  const reportPdf = new SyncReportPdfAdapter();
  // NotificationsModule exports NotificationsService — resolves the SAME singleton the
  // API process would use for an inline notify() call (T20 live-class reminder worker).
  const notificationsService = app.get(NotificationsService);
  // Stateless aside from the injected MailProvider — safe to construct directly (same
  // as certificatePdf/reportPdf above).
  const emiDunning = new SyncEmiDunningAdapter(mail);

  const connection = getBullMqConnectionOptions();
  // Heterogeneous Worker<T> instances (one per queue, each with its own job-data type)
  // share only the close()/on() surface used below; `any` here is the pragmatic escape
  // hatch for a container of otherwise-incompatible generic instantiations.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const workers: BullMqWorker<any, any, string>[] = [];

  // ─── Fire-and-forget queues ──────────────────────────────────────────────────

  workers.push(
    new Worker<ChannelSendJob>(
      QUEUE_NAMES.NOTIFICATION_DISPATCH,
      async (job) => {
        const result = await notificationDispatch.dispatch(job.data);
        if (result.error) {
          // Throw so BullMQ retries with backoff (FIRE_AND_FORGET_JOB_OPTIONS on the
          // producer side already configured attempts + exponential backoff).
          throw new Error(result.error);
        }
        return result;
      },
      { connection, concurrency: 10 },
    ),
  );

  workers.push(
    new Worker<RecipientSendJob>(
      QUEUE_NAMES.CAMPAIGN_SEND,
      async (job) => {
        const result = await campaignSend.send(job.data);
        if (result.error) {
          throw new Error(result.error);
        }
        return result;
      },
      { connection, concurrency: 10 },
    ),
  );

  workers.push(
    new Worker<InvoiceGenPayload>(
      QUEUE_NAMES.INVOICE_GEN,
      async (job) => {
        await invoiceGen.enqueue(job.data);
      },
      { connection, concurrency: 5 },
    ),
  );

  workers.push(
    new Worker<ReceiptGenPayload>(
      QUEUE_NAMES.RECEIPT_GEN,
      async (job) => {
        await receiptGen.enqueue(job.data);
      },
      { connection, concurrency: 5 },
    ),
  );

  workers.push(
    new Worker<WebhookEventPayload>(
      QUEUE_NAMES.WEBHOOK_PROCESSOR,
      async (job) => {
        await webhookProcessor.process(job.data);
      },
      { connection, concurrency: 5 },
    ),
  );

  workers.push(
    new Worker<TranscodeEvent>(
      QUEUE_NAMES.VIDEO_WEBHOOK,
      async (job) => {
        await videoWebhookProcessor.process(job.data);
      },
      { connection, concurrency: 5 },
    ),
  );

  workers.push(
    new Worker<LiveClassReminderJob>(
      QUEUE_NAMES.LIVE_CLASS_REMINDER,
      async (job) => {
        const { userId, tenantId, title, startsAt, toEmail, toPhone } = job.data;
        await notificationsService.notify(
          userId,
          tenantId,
          "live_reminder",
          { eventTitle: title, startsAt },
          { toEmail, toPhone },
        );
      },
      { connection, concurrency: 10 },
    ),
  );

  workers.push(
    new Worker<EmiDunningReminderInput>(
      QUEUE_NAMES.EMI_DUNNING,
      async (job) => {
        await emiDunning.sendReminder(job.data);
      },
      { connection, concurrency: 10 },
    ),
  );

  // ─── RPC-style (producer awaits the result) queues ────────────────────────────

  workers.push(
    new Worker<CertificatePdfInput>(
      QUEUE_NAMES.CERTIFICATE_GEN,
      async (job) => {
        const result = await certificatePdf.render(job.data);
        return {
          bytesBase64: Buffer.from(result.bytes).toString("base64"),
          contentType: result.contentType,
        };
      },
      // Lower concurrency — PDF rendering is CPU-bound.
      { connection, concurrency: 2 },
    ),
  );

  workers.push(
    new Worker<ReportPdfInput>(
      QUEUE_NAMES.REPORT_GEN,
      async (job) => {
        const result = await reportPdf.render(job.data);
        return {
          bytesBase64: Buffer.from(result.bytes).toString("base64"),
          contentType: result.contentType,
        };
      },
      { connection, concurrency: 2 },
    ),
  );

  for (const worker of workers) {
    worker.on("failed", (job, err) => {
      console.error(`[worker] job failed: queue=${worker.name} jobId=${job?.id ?? "?"} error=${String(err)}`);
    });
  }

  console.log(
    `[worker] Ready, listening on queues: ${workers.map((w) => w.name).join(", ")} ` +
      `(isProduction=${isProductionEnv(env)})`,
  );

  // ─── Graceful shutdown ─────────────────────────────────────────────────────────
  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[worker] Received ${signal}. Closing workers (waiting for in-flight jobs)...`);
    await Promise.all(workers.map((w) => w.close()));
    await app.close();
    console.log("[worker] Shutdown complete.");
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

bootstrapWorker().catch((error: unknown) => {
  console.error("[worker] fatal error during bootstrap:", error);
  process.exit(1);
});
