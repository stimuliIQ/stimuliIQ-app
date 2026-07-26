// apps/api/src/modules/commerce/commerce.module.ts
//
// Wires the Commerce feature module (docs/04-trd-architecture.md §2.2 template).
//
// IMPORTANT: WebhookController is registered as a SEPARATE controller that does NOT
// have JwtAuthGuard or PermissionsGuard applied — the Razorpay webhook HMAC signature
// is the only authentication for that endpoint. See commerce.controller.ts.
//
// QUEUE_DRIVER GATE (docs/plans/phase-9-completion.md T18 / R1):
//   INVOICE_GEN_PORT / WEBHOOK_PROCESSOR_PORT are bound via useFactory, branching on
//   QUEUE_DRIVER (default "sync", required for the Jest unit suite):
//     QUEUE_DRIVER=sync   → SyncInvoiceGenAdapter / SyncWebhookProcessorAdapter (inline).
//     QUEUE_DRIVER=bullmq → BullMqInvoiceGenAdapter / BullMqWebhookProcessorAdapter
//       (enqueue + return fast; apps/api/src/worker.ts processes the job by
//       constructing the SAME Sync*Adapter classes — zero duplicated business logic).
//   SyncInvoiceGenAdapter/SyncWebhookProcessorAdapter remain bare-registered below
//   (their own class token) so the worker can resolve the exact singleton via
//   `app.get(SyncInvoiceGenAdapter)` / `app.get(SyncWebhookProcessorAdapter)`.

import { Module, Logger } from "@nestjs/common";
import { validateEnv } from "../../config/env";
import { AuthModule } from "../auth/auth.module";
import { RateLimitModule } from "../../common/rate-limit/rate-limit.module";
import { PaymentProviderModule } from "./providers/payment/payment-provider.module";
import { StorageProviderModule } from "../storage/providers/storage/storage-provider.module";
import { ReportPdfModule } from "../exports/providers/pdf/report-pdf.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { MailProviderModule } from "../notifications/providers/mail/mail-provider.module";
import { StudentsModule } from "../students/students.module";
import { CommerceController } from "./commerce.controller";
import { WebhookController } from "./webhook.controller";
import { CommerceService } from "./commerce.service";
import { CommerceRepository } from "./commerce.repository";
import {
  SyncInvoiceGenAdapter,
  INVOICE_GEN_PORT,
  WEBHOOK_PROCESSOR_PORT,
  type InvoiceGenPort,
  type WebhookProcessorPort,
} from "./invoice-gen.seam";
import { SyncWebhookProcessorAdapter } from "./webhook-processor.adapter";
import { BullMqInvoiceGenAdapter } from "./bullmq-invoice-gen.adapter";
import { BullMqWebhookProcessorAdapter } from "./bullmq-webhook-processor.adapter";
import { SyncReceiptGenAdapter, RECEIPT_GEN_PORT, type ReceiptGenPort } from "./receipt-gen.seam";
import { BullMqReceiptGenAdapter } from "./bullmq-receipt-gen.adapter";
import { CompanyProfileService } from "../platform/company-profile.service";
import { SettingsRepository } from "../platform/settings.repository";

const bootLogger = new Logger("CommerceModule");

function createInvoiceGenPort(sync: SyncInvoiceGenAdapter): InvoiceGenPort {
  const env = validateEnv();
  if (env.QUEUE_DRIVER === "bullmq") {
    bootLogger.log("[CommerceModule] QUEUE_DRIVER=bullmq — binding BullMqInvoiceGenAdapter.");
    return new BullMqInvoiceGenAdapter();
  }
  return sync;
}

function createWebhookProcessorPort(sync: SyncWebhookProcessorAdapter): WebhookProcessorPort {
  const env = validateEnv();
  if (env.QUEUE_DRIVER === "bullmq") {
    bootLogger.log("[CommerceModule] QUEUE_DRIVER=bullmq — binding BullMqWebhookProcessorAdapter.");
    return new BullMqWebhookProcessorAdapter();
  }
  return sync;
}

function createReceiptGenPort(sync: SyncReceiptGenAdapter): ReceiptGenPort {
  const env = validateEnv();
  if (env.QUEUE_DRIVER === "bullmq") {
    bootLogger.log("[CommerceModule] QUEUE_DRIVER=bullmq — binding BullMqReceiptGenAdapter.");
    return new BullMqReceiptGenAdapter();
  }
  return sync;
}

@Module({
  imports: [
    AuthModule,
    PaymentProviderModule,
    StorageProviderModule,
    ReportPdfModule,
    RateLimitModule,
    // Phase-9 Completion T31 / R3: notifyPaymentReceipt (post-verifyPayment).
    NotificationsModule,
    // Resolves order.studentId -> {userId, email, phone, name}.
    StudentsModule,
    // sendPaymentLinks: emails pay-link(s) directly to the student.
    MailProviderModule,
  ],
  controllers: [
    CommerceController,
    WebhookController,
  ],
  providers: [
    CommerceService,
    CommerceRepository,

    // Company profile (Settings → Company) consumed by the invoice generator to stamp
    // the configured company name on invoices. Bare-registered here (rather than importing
    // PlatformModule) so the worker context resolves the same graph without pulling in
    // PlatformModule's controllers; SettingsRepository is stateless (wraps PrismaService).
    CompanyProfileService,
    SettingsRepository,

    // Bare-registered so QUEUE_DRIVER=sync can reuse the instance directly AND the
    // worker (QUEUE_DRIVER=bullmq) can resolve the same singleton via app.get().
    SyncInvoiceGenAdapter,
    SyncWebhookProcessorAdapter,
    SyncReceiptGenAdapter,

    {
      provide: INVOICE_GEN_PORT,
      useFactory: createInvoiceGenPort,
      inject: [SyncInvoiceGenAdapter],
    },
    {
      provide: WEBHOOK_PROCESSOR_PORT,
      useFactory: createWebhookProcessorPort,
      inject: [SyncWebhookProcessorAdapter],
    },
    {
      provide: RECEIPT_GEN_PORT,
      useFactory: createReceiptGenPort,
      inject: [SyncReceiptGenAdapter],
    },
  ],
  exports: [
    CommerceService,
    CommerceRepository,
  ],
})
export class CommerceModule {}
