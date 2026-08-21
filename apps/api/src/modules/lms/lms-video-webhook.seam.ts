// apps/api/src/modules/lms/lms-video-webhook.seam.ts
//
// VideoWebhookProcessorPort — synchronous inline processor for transcode-status webhooks.
//
// ADR-0020 pattern (from P2's WebhookProcessorPort / SyncWebhookProcessorAdapter):
//   - VideoWebhookProcessorPort is the DI interface (symbol token).
//   - SyncVideoWebhookProcessorAdapter implements it SYNCHRONOUSLY for P3.
//   - BullMQ migration: swap SyncVideoWebhookProcessorAdapter → BullMq variant by
//     rebinding VIDEO_WEBHOOK_PROCESSOR_PORT in lms.module.ts. Zero changes to the
//     webhook controller.
//
// SECURITY: verifyWebhookSignature() is called by the controller BEFORE this port is
// called. This processor TRUSTS the payload is authentic.
//
// IDEMPOTENCY: every path checks existing state before mutating:
//   - If status is already the target value → no-op.
//   - If video row not found → no-op (warn only).
//   - If TranscodeEvent is null (non-transcode event type) → safe ignore.

import { Injectable, Logger } from "@nestjs/common";
import type { TranscodeEvent } from "./providers/video/video-provider.interface";
import { LmsRepository } from "./lms.repository";

// ─────────────────────────────────────────────────────────────────────────────
// Port interface
// ─────────────────────────────────────────────────────────────────────────────

export interface VideoWebhookProcessorPort {
  /**
   * Process a verified transcode-status event. Idempotent by providerAssetId + status.
   *
   * BullMQ migration: replace sync call with queue.add() and handle in a worker:
   *   await this.queue.add('transcode-status', event, {
   *     jobId: `transcode-${event.providerAssetId}-${event.status}`,
   *     attempts: 5,
   *     backoff: { type: 'exponential', delay: 1000 },
   *   });
   */
  process(event: TranscodeEvent): Promise<void>;
}

export const VIDEO_WEBHOOK_PROCESSOR_PORT = Symbol("VIDEO_WEBHOOK_PROCESSOR_PORT");

// ─────────────────────────────────────────────────────────────────────────────
// Synchronous adapter (P3 — BullMQ not yet wired)
// ─────────────────────────────────────────────────────────────────────────────

@Injectable()
export class SyncVideoWebhookProcessorAdapter implements VideoWebhookProcessorPort {
  private readonly logger = new Logger(SyncVideoWebhookProcessorAdapter.name);

  constructor(private readonly lmsRepository: LmsRepository) {}

  async process(event: TranscodeEvent): Promise<void> {
    const { providerAssetId, status, durationS } = event;

    this.logger.log(
      `[VideoWebhook] Processing transcode event: providerAssetId=${providerAssetId} status=${status}`,
    );

    // Find the video row by provider_asset_id (tenant-agnostic lookup — the webhook
    // does not carry a tenant_id; we look up by the globally-unique provider asset id).
    const video = await this.lmsRepository.findVideoByProviderAssetId(providerAssetId);

    if (!video) {
      this.logger.warn(
        `[VideoWebhook] No video row found for providerAssetId=${providerAssetId}, ignoring`,
      );
      return;
    }

    // Idempotency: if already at the target status and durationS is already set, no-op.
    if (video.status === status && (durationS === undefined || video.durationS === durationS)) {
      this.logger.log(
        `[VideoWebhook] Idempotent no-op, video ${video.id} already has status=${status}`,
      );
      return;
    }

    // Update status (and optionally duration_s if the event includes it).
    await this.lmsRepository.updateVideoTranscodeStatus(video.id, {
      status,
      durationS: durationS ?? undefined,
    });

    this.logger.log(
      `[VideoWebhook] Updated video ${video.id} → status=${status}` +
        (durationS !== undefined ? ` durationS=${durationS}` : ""),
    );
  }
}
