// apps/api/src/modules/live-classes/live-classes.module.ts
//
// Wires the Phase-9 Live Class feature module (docs/plans/phase-9-completion.md T20).
// Three controllers, one service+repository pair, one webhook processor seam, one
// reminder seam:
//   - LiveClassesController      — CRM schedule/update/cancel/list/get/join (/crm/live-classes*).
//   - MyLiveClassesController    — LMS student/faculty/mentor read+join (/me/live-classes*).
//   - LiveClassWebhookController — provider webhook, HMAC-authenticated (/live-classes/webhook).
//
// Imports:
//   AuthModule              — JwtAuthGuard, PermissionsGuard, ScopeInterceptor.
//   CommonScopeModule        — EnrollmentScopeRepository (faculty/mentor/student batch resolution).
//   LiveClassProviderModule  — LIVE_CLASS_PROVIDER token (Zoom/Google Meet/Noop, T15).
//
// QUEUE_DRIVER gate (T18/R1, mirrors dispatch.module.ts exactly): LIVE_CLASS_REMINDER_PORT
// binds SyncLiveClassReminderAdapter (QUEUE_DRIVER=sync, default) or
// BullMqLiveClassReminderAdapter (QUEUE_DRIVER=bullmq).

import { Module, Logger } from "@nestjs/common";
import { validateEnv } from "../../config/env";
import { AuthModule } from "../auth/auth.module";
import { CommonScopeModule } from "../common-scope/common-scope.module";
import { LiveClassProviderModule } from "../lms/providers/live-class/live-class-provider.module";
import { LiveClassesController } from "./live-classes.controller";
import { MyLiveClassesController } from "./my-live-classes.controller";
import { LiveClassWebhookController } from "./live-class-webhook.controller";
import { LiveClassesService } from "./live-classes.service";
import { LiveClassesRepository } from "./live-classes.repository";
import { LIVE_CLASS_WEBHOOK_PORT, SyncLiveClassWebhookProcessorAdapter } from "./live-class-webhook.seam";
import {
  LIVE_CLASS_REMINDER_PORT,
  SyncLiveClassReminderAdapter,
  type LiveClassReminderPort,
} from "./reminders/live-class-reminder.port";
import { BullMqLiveClassReminderAdapter } from "./reminders/bullmq-live-class-reminder.adapter";

const bootLogger = new Logger("LiveClassesModule");

function createReminderPort(): LiveClassReminderPort {
  const env = validateEnv();
  if (env.QUEUE_DRIVER === "bullmq") {
    bootLogger.log("[LiveClassesModule] QUEUE_DRIVER=bullmq, binding BullMqLiveClassReminderAdapter.");
    return new BullMqLiveClassReminderAdapter();
  }
  return new SyncLiveClassReminderAdapter();
}

@Module({
  imports: [AuthModule, CommonScopeModule, LiveClassProviderModule],
  controllers: [LiveClassesController, MyLiveClassesController, LiveClassWebhookController],
  providers: [
    LiveClassesService,
    LiveClassesRepository,
    // Webhook processor — sync seam today (ADR-0020); swap to a BullMQ variant by
    // rebinding this token, zero changes to the webhook controller.
    { provide: LIVE_CLASS_WEBHOOK_PORT, useClass: SyncLiveClassWebhookProcessorAdapter },
    // Reminder seam — QUEUE_DRIVER gate (T18/R1).
    { provide: LIVE_CLASS_REMINDER_PORT, useFactory: createReminderPort },
  ],
  exports: [LiveClassesRepository],
})
export class LiveClassesModule {}
