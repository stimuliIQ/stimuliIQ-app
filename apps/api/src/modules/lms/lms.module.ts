// apps/api/src/modules/lms/lms.module.ts
//
// Wires the LMS feature module (docs/04 §2.2 template).
//
// Controllers:
//   LmsController         — mounted at /api/v1/me/* (dashboard, enrollments, curriculum)
//   LessonsController     — mounted at /api/v1/lessons/* (lesson detail, stream-url)
//   VideoWebhookController — mounted at /api/v1/lms/videos/webhook (transcode webhook, @Public)
//
// Providers:
//   LmsService            — business logic (enrollment gate + stream-url mint + dashboard)
//   LmsRepository         — Prisma data access
//   SyncVideoWebhookProcessorAdapter — webhook processing (BullMQ seam per ADR-0020)
//   VIDEO_WEBHOOK_PROCESSOR_PORT DI token → SyncVideoWebhookProcessorAdapter
//
// Imports:
//   VideoProviderModule   — provides VIDEO_PROVIDER token (Noop/Cloudflare/Mux)
//   AuthModule            — provides JwtAuthGuard, PermissionsGuard, ScopeInterceptor
//   PrismaModule          — provides PrismaService for the repository
//
// CSRF EXCLUSION: POST /lms/videos/webhook is excluded from CsrfMiddleware in
// app.module.ts (alongside the existing commerce/payments/webhook + public/bookings).
//
// QUEUE_DRIVER GATE (docs/plans/phase-9-completion.md T18 / R1):
//   VIDEO_WEBHOOK_PROCESSOR_PORT is bound via useFactory, branching on QUEUE_DRIVER
//   (default "sync", required for the Jest unit suite):
//     QUEUE_DRIVER=sync   → SyncVideoWebhookProcessorAdapter (inline DB update).
//     QUEUE_DRIVER=bullmq → BullMqVideoWebhookProcessorAdapter (enqueue + return fast;
//       apps/api/src/worker.ts processes the job via the SAME SyncVideoWebhookProcessorAdapter
//       singleton, resolved with `app.get(SyncVideoWebhookProcessorAdapter)`).
//   No changes needed to VideoWebhookController either way.

import { Module, Logger } from "@nestjs/common";
import { validateEnv } from "../../config/env";
import { AuthModule } from "../auth/auth.module";
import { CommonScopeModule } from "../common-scope/common-scope.module";
import { StorageProviderModule } from "../storage/providers/storage/storage-provider.module";
import { CertificatesModule } from "../certificates/certificates.module";
import { GamificationModule } from "../gamification/gamification.module";
import { VideoProviderModule } from "./providers/video/video-provider.module";
import { LmsController } from "./lms.controller";
import { LessonsController } from "./lessons.controller";
import { VideoWebhookController } from "./video-webhook.controller";
import { LmsProgressController } from "./lms-progress.controller";
import { VideoLibraryController } from "./video-library.controller";
import { LmsService } from "./lms.service";
import { LmsRepository } from "./lms.repository";
import { LmsProgressService } from "./lms-progress.service";
import { VideoLibraryService } from "./video-library.service";
import { VideoLibraryRepository } from "./video-library.repository";
import {
  SyncVideoWebhookProcessorAdapter,
  VIDEO_WEBHOOK_PROCESSOR_PORT,
  type VideoWebhookProcessorPort,
} from "./lms-video-webhook.seam";
import { BullMqVideoWebhookProcessorAdapter } from "./bullmq-video-webhook-processor.adapter";

const bootLogger = new Logger("LmsModule");

function createVideoWebhookProcessorPort(sync: SyncVideoWebhookProcessorAdapter): VideoWebhookProcessorPort {
  const env = validateEnv();
  if (env.QUEUE_DRIVER === "bullmq") {
    bootLogger.log("[LmsModule] QUEUE_DRIVER=bullmq, binding BullMqVideoWebhookProcessorAdapter.");
    return new BullMqVideoWebhookProcessorAdapter();
  }
  return sync;
}

@Module({
  imports: [
    AuthModule,
    VideoProviderModule,
    // T26: EnrollmentScopeRepository.resolveProgramIdsForFaculty — faculty "assigned"
    // scope resolution for the video-library module.
    CommonScopeModule,
    // Phase-9-completion gap #2: STORAGE_PROVIDER token for the resource
    // signed-download-url mint (mirrors CertificatesModule's usage).
    StorageProviderModule,
    // Automatic certificate issuance on lesson-completion reaching 100% progress
    // (LmsProgressService.markComplete -> CertificatesService.autoIssueOnCompletion).
    // No import cycle: CertificatesModule imports AuthModule/CertificatePdfModule/
    // StorageProviderModule/NotificationsModule/StudentsModule — none of which import
    // LmsModule.
    CertificatesModule,
    // Points/badges/streaks on lesson completion (LmsProgressService.markComplete ->
    // GamificationService.awardForLessonCompleted). GamificationModule imports only
    // AuthModule, so there is no cycle.
    GamificationModule,
  ],
  controllers: [
    LmsController,
    LessonsController,
    VideoWebhookController,
    // Wave 4b: progress ping, mark-complete, progress rollup.
    LmsProgressController,
    // Phase-9 Completion T26: video-library ingest (/crm/videos*).
    VideoLibraryController,
  ],
  providers: [
    LmsService,
    LmsRepository,

    // Wave 4b: progress business logic.
    LmsProgressService,

    // Phase-9 Completion T26: video-library ingest.
    VideoLibraryService,
    VideoLibraryRepository,

    // Bare-registered so QUEUE_DRIVER=sync can reuse the instance directly AND the
    // worker (QUEUE_DRIVER=bullmq) can resolve the same singleton via app.get().
    SyncVideoWebhookProcessorAdapter,
    {
      provide: VIDEO_WEBHOOK_PROCESSOR_PORT,
      useFactory: createVideoWebhookProcessorPort,
      inject: [SyncVideoWebhookProcessorAdapter],
    },
  ],
  // Export LmsRepository, LmsService, and LmsProgressService so other modules
  // (e.g. future certificate or analytics modules) can import them without
  // duplicating the DI wiring.
  exports: [
    LmsService,
    LmsRepository,
    LmsProgressService,
  ],
})
export class LmsModule {}
