// apps/api/src/modules/live-classes/live-class-webhook.seam.ts
//
// LiveClassWebhookProcessorPort — synchronous inline processor for verified live-class
// provider events (meeting_started/ended, participant_joined/left, recording_ready).
// Mirrors lms-video-webhook.seam.ts's ADR-0020 pattern exactly:
//   - LiveClassWebhookProcessorPort is the DI interface (symbol token).
//   - SyncLiveClassWebhookProcessorAdapter implements it SYNCHRONOUSLY.
//   - BullMQ migration: swap in a BullMq variant by rebinding LIVE_CLASS_WEBHOOK_PORT in
//     live-classes.module.ts. Zero changes to the webhook controller.
//
// SECURITY: verifyWebhookSignature() is called by the controller BEFORE this port is
// called — this processor TRUSTS the payload is authentic.
//
// ATTENDANCE AUTO-SYNC (T20, "<=60s of join"): `participant_joined` writes the attendance
// row INLINE, in the same webhook-handling call — the vendor's own webhook delivery
// latency (typically seconds) is the only latency in the chain, comfortably inside the
// 60-second bound; there is no additional queueing/polling delay introduced here.
//
// IDEMPOTENCY: every path checks/derives state before mutating —
//   - participant_joined: `upsertLiveAttendance` is itself idempotent (check-then-create).
//   - meeting_started/ended: no-op if the live class is already at/past the target status.
//   - recording_ready: no-op if `recordingUrl` is already set to the same value.
//   - Unresolvable providerMeetingId (no matching live_classes row) → warn + no-op (never throws).

import { Injectable, Logger } from "@nestjs/common";
import type { LiveClassWebhookEvent } from "../lms/providers/live-class/live-class-provider.interface";
import { LiveClassesRepository } from "./live-classes.repository";

export interface LiveClassWebhookProcessorPort {
  process(event: LiveClassWebhookEvent): Promise<void>;
}

export const LIVE_CLASS_WEBHOOK_PORT = Symbol("LIVE_CLASS_WEBHOOK_PORT");

@Injectable()
export class SyncLiveClassWebhookProcessorAdapter implements LiveClassWebhookProcessorPort {
  private readonly logger = new Logger(SyncLiveClassWebhookProcessorAdapter.name);

  constructor(private readonly repository: LiveClassesRepository) {}

  async process(event: LiveClassWebhookEvent): Promise<void> {
    const liveClass = await this.repository.findByProviderMeetingId(event.providerMeetingId);
    if (!liveClass) {
      this.logger.warn(
        `[LiveClassWebhook] No live_classes row found for providerMeetingId=${event.providerMeetingId} — ignoring`,
      );
      return;
    }

    switch (event.type) {
      case "meeting_started": {
        if (liveClass.status === "scheduled") {
          await this.repository.update(liveClass.id, { status: "live" });
        }
        return;
      }

      case "meeting_ended": {
        if (liveClass.status === "scheduled" || liveClass.status === "live") {
          await this.repository.update(liveClass.id, { status: "completed" });
        }
        return;
      }

      case "participant_joined": {
        const email = event.participant?.email;
        if (!email) {
          this.logger.debug("[LiveClassWebhook] participant_joined with no email — cannot resolve internal user, ignoring");
          return;
        }
        const enrollment = await this.repository.findActiveEnrollmentForBatchByEmail(
          liveClass.tenantId,
          liveClass.batchId,
          email,
        );
        if (!enrollment) {
          this.logger.debug(
            `[LiveClassWebhook] participant_joined email=${email.slice(0, 3)}*** has no active enrollment in batchId=${liveClass.batchId} — ignoring`,
          );
          return;
        }
        await this.repository.upsertLiveAttendance({
          tenantId: liveClass.tenantId,
          enrollmentId: enrollment.enrollmentId,
          liveClassId: liveClass.id,
          markedAt: event.occurredAt,
        });
        return;
      }

      case "participant_left":
        // No attendance mutation on leave (attendance is a "was present" marker, not a
        // duration tracker in this schema) — safe no-op.
        return;

      case "recording_ready": {
        const downloadUrl = event.recording?.downloadUrl;
        if (!downloadUrl || liveClass.recordingUrl === downloadUrl) {
          return; // idempotent no-op.
        }
        // NOTE (follow-up, docs/phase-9-followups.md): the LiveClassProvider interface's
        // doc comment recommends fetching + re-hosting via StorageProvider rather than
        // storing the vendor-authenticated URL directly. The shipped `LiveClassDetail` DTO
        // (packages/types/src/live/live-classes.schemas.ts) instead types `recordingUrl`
        // as the direct "Provider-hosted recording link" — this adapter follows the DTO's
        // shipped contract (store the vendor URL as-is). A re-host pipeline is a
        // reasonable follow-up if provider-side link expiry becomes a problem.
        await this.repository.update(liveClass.id, { recordingUrl: downloadUrl });
        return;
      }

      default:
        return;
    }
  }
}
