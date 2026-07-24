// apps/api/src/modules/notifications/dispatch/dispatch.module.ts
//
// DispatchModule — NestJS module that binds the dispatch seam + template registry.
// (docs/plans/phase-6.md task #4; docs/plans/phase-9-completion.md T18 / R1)
//
// Exported providers (consumed by NotificationsModule #6 and CampaignsModule #7):
//
//   NOTIFICATION_DISPATCH_PORT → SyncNotificationDispatchAdapter (QUEUE_DRIVER=sync,
//     default) or BullMqNotificationDispatchAdapter (QUEUE_DRIVER=bullmq)
//     Used by: NotificationService (fan-out per-channel sends)
//     Idempotent by dedupeKey (in-request Set on sync; BullMQ jobId on bullmq);
//     DB-level idempotency via notifications table either way.
//
//   CAMPAIGN_SEND_PORT → SyncCampaignSendAdapter (sync) or BullMqCampaignSendAdapter (bullmq)
//     Used by: CampaignService (per-recipient bulk sends)
//     Idempotent by dedupeKey; DB-level via campaign_recipients partial-unique.
//
//   TemplateRegistry → injectable service
//     Used by: NotificationService (renderAll) + CampaignService (renderRaw)
//     Stateless pure renderer — no DI dependencies, no network calls.
//
// Provider dependencies:
//   - MailProviderModule     (exports MAIL_PROVIDER)
//   - WhatsAppProviderModule (exports WHATSAPP_PROVIDER)
//   - SmsProviderModule      (exports SMS_PROVIDER — T16/B3: fail-closed noop|msg91
//     useFactory, mirrors MailProviderModule/WhatsAppProviderModule exactly). Imported
//     directly here (not via AuthModule) to avoid coupling DispatchModule to AuthModule's
//     full controller/guard surface — SmsProviderModule is a tiny, side-effect-free leaf
//     module, safe to import from both AuthModule and DispatchModule (Nest shares the
//     single SMS_PROVIDER instance across both import sites).
//
// QUEUE_DRIVER GATE (T18 / R1 — supersedes the earlier "BullMQ MIGRATION" TODO below):
//   QUEUE_DRIVER=sync   (default; REQUIRED for the Jest unit suite) → Sync*Adapter,
//     `new`-ed directly with its provider dependencies resolved via `inject`.
//   QUEUE_DRIVER=bullmq → BullMq*Adapter, which enqueues onto a named queue and returns
//     immediately; the actual provider call happens in the worker process
//     (apps/api/src/worker.ts), which constructs a fresh
//     `new SyncNotificationDispatchAdapter(mail, whatsapp, sms)` /
//     `new SyncCampaignSendAdapter(mail, whatsapp, sms)` directly, resolving
//     MAIL_PROVIDER/WHATSAPP_PROVIDER/SMS_PROVIDER from the SAME NestJS application
//     context AppModule boots with — zero duplicated provider-call logic between the
//     sync and async paths.
//
//   Bound via `useFactory` (ADR-0023/DEFECT-1 pattern, identical rationale to every
//   other provider module in this codebase): constructing via `new` inside the factory
//   avoids NestJS `useClass` DI-reflection pitfalls and lets us branch on QUEUE_DRIVER
//   without two separate provider declarations per token.

import { Module, Logger } from "@nestjs/common";
import { validateEnv } from "../../../config/env";
import { MailProviderModule } from "../providers/mail/mail-provider.module";
import { WhatsAppProviderModule } from "../providers/whatsapp/whatsapp-provider.module";
import { SmsProviderModule } from "../../auth/providers/sms/sms-provider.module";
import { MAIL_PROVIDER, type MailProvider } from "../providers/mail/mail-provider.interface";
import { WHATSAPP_PROVIDER, type WhatsAppProvider } from "../providers/whatsapp/whatsapp-provider.interface";
import { SMS_PROVIDER, type SmsProvider } from "../../auth/providers/sms/sms-provider.interface";
import { NOTIFICATION_DISPATCH_PORT, type NotificationDispatchPort } from "./notification-dispatch.port";
import { CAMPAIGN_SEND_PORT, type CampaignSendPort } from "./campaign-send.port";
import { SyncNotificationDispatchAdapter } from "./sync-notification-dispatch.adapter";
import { SyncCampaignSendAdapter } from "./sync-campaign-send.adapter";
import { BullMqNotificationDispatchAdapter } from "./bullmq-notification-dispatch.adapter";
import { BullMqCampaignSendAdapter } from "./bullmq-campaign-send.adapter";
import { TemplateRegistry } from "./template-registry";

const bootLogger = new Logger("DispatchModule");

function createNotificationDispatchPort(
  mail: MailProvider,
  whatsapp: WhatsAppProvider,
  sms: SmsProvider,
): NotificationDispatchPort {
  const env = validateEnv();
  if (env.QUEUE_DRIVER === "bullmq") {
    bootLogger.log("[DispatchModule] QUEUE_DRIVER=bullmq — binding BullMqNotificationDispatchAdapter.");
    return new BullMqNotificationDispatchAdapter();
  }
  return new SyncNotificationDispatchAdapter(mail, whatsapp, sms);
}

function createCampaignSendPort(
  mail: MailProvider,
  whatsapp: WhatsAppProvider,
  sms: SmsProvider,
): CampaignSendPort {
  const env = validateEnv();
  if (env.QUEUE_DRIVER === "bullmq") {
    bootLogger.log("[DispatchModule] QUEUE_DRIVER=bullmq — binding BullMqCampaignSendAdapter.");
    return new BullMqCampaignSendAdapter();
  }
  return new SyncCampaignSendAdapter(mail, whatsapp, sms);
}

@Module({
  imports: [
    MailProviderModule,
    WhatsAppProviderModule,
    SmsProviderModule,
  ],
  providers: [
    // ─── Dispatch adapters (QUEUE_DRIVER gate — T18/R1) ────────────────────
    {
      provide: NOTIFICATION_DISPATCH_PORT,
      useFactory: createNotificationDispatchPort,
      inject: [MAIL_PROVIDER, WHATSAPP_PROVIDER, SMS_PROVIDER],
    },
    {
      provide: CAMPAIGN_SEND_PORT,
      useFactory: createCampaignSendPort,
      inject: [MAIL_PROVIDER, WHATSAPP_PROVIDER, SMS_PROVIDER],
    },

    // ─── Template registry (stateless, injectable) ────────────────────────
    TemplateRegistry,
  ],
  exports: [
    NOTIFICATION_DISPATCH_PORT,
    CAMPAIGN_SEND_PORT,
    TemplateRegistry,
    // Re-export SmsProviderModule (not the bare SMS_PROVIDER token — Nest requires
    // re-exporting the providing module for a token not declared in THIS module's
    // own `providers` array) so importing modules can inject SMS_PROVIDER if needed.
    SmsProviderModule,
  ],
})
export class DispatchModule {}
