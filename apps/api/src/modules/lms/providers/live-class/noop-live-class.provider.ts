// apps/api/src/modules/lms/providers/live-class/noop-live-class.provider.ts
//
// Test / sandbox double for LiveClassProvider. Used in unit tests, integration
// tests, and local dev environments where no real Zoom/Google Meet credentials
// are present or desired. Selected automatically when LIVE_CLASS_PROVIDER=noop
// (the default) or when no LIVE_CLASS_PROVIDER env var is set.
//
// This class is NEVER bound in production — LiveClassProviderModule binds the
// real adapter when LIVE_CLASS_PROVIDER=zoom or LIVE_CLASS_PROVIDER=google_meet.
//
// ─── BEHAVIOUR ───────────────────────────────────────────────────────────────
//
//   createMeeting:
//     Returns a DETERMINISTIC fake meeting id + host join URL, so tests can assert
//     on shape without hitting any real vendor.
//
//   getJoinUrl:
//     Returns a deterministic fake URL encoding (providerMeetingId, userId, role).
//
//   endMeeting:
//     No-op; logs at debug level.
//
//   verifyWebhookSignature:
//     Real HMAC-SHA256 over rawBody with a configurable test secret — same
//     fail-closed-when-absent behaviour as the real adapters, so webhook
//     controller tests can exercise both the accept and reject paths.
//
//   parseRecordingEvent:
//     Accepts a "noop" fixture payload shape so integration tests can exercise
//     the live-class webhook path without a live Zoom/Meet account.

import { Injectable, Logger } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  LiveClassProvider,
  CreateMeetingInput,
  CreateMeetingResult,
  GetJoinUrlInput,
  GetJoinUrlResult,
  EndMeetingInput,
  VerifyWebhookSignatureInput,
  LiveClassWebhookEvent,
  LiveClassWebhookEventType,
} from "./live-class-provider.interface";

export interface NoopLiveClassProviderOptions {
  /** Secret used for HMAC-SHA256 in verifyWebhookSignature. */
  webhookSecret?: string;
  /** When true, simulates the webhook secret being absent (fail closed). */
  simulateWebhookSecretAbsent?: boolean;
}

export const DEFAULT_NOOP_LIVE_CLASS_WEBHOOK_SECRET = "noop-test-live-class-webhook-secret";
const PROVIDER_NAME = "noop" as const;

/** Constant-time hex comparison — mirrors timingSafeEqualHex in the video provider. */
function timingSafeEqualHexLocal(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) {
    timingSafeEqual(aBuf, aBuf);
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

@Injectable()
export class NoopLiveClassProvider implements LiveClassProvider {
  private readonly logger = new Logger(NoopLiveClassProvider.name);
  private readonly webhookSecret: string | undefined;
  private readonly simulateWebhookSecretAbsent: boolean;
  private meetingCounter = 0;

  constructor(options: NoopLiveClassProviderOptions = {}) {
    this.simulateWebhookSecretAbsent = options.simulateWebhookSecretAbsent ?? false;
    this.webhookSecret = this.simulateWebhookSecretAbsent
      ? undefined
      : (options.webhookSecret ?? DEFAULT_NOOP_LIVE_CLASS_WEBHOOK_SECRET);

    this.logger.warn(
      "[NoopLiveClassProvider] Running with the no-op/test live-class provider. " +
        "No real Zoom/Google Meet meetings are created. Do NOT use this in production. " +
        "Set LIVE_CLASS_PROVIDER=zoom or LIVE_CLASS_PROVIDER=google_meet with real " +
        "credentials for production/staging.",
    );
  }

  async createMeeting(input: CreateMeetingInput): Promise<CreateMeetingResult> {
    this.meetingCounter += 1;
    const providerMeetingId = `noop-meeting-${Date.now()}-${this.meetingCounter}`;
    return {
      providerMeetingId,
      hostJoinUrl: `https://noop.liveclass.local/start/${providerMeetingId}?host=${encodeURIComponent(input.hostUserId)}`,
      passcode: "000000",
      provider: PROVIDER_NAME,
    };
  }

  async getJoinUrl(input: GetJoinUrlInput): Promise<GetJoinUrlResult> {
    const { providerMeetingId, userId, role } = input;
    const url =
      `https://noop.liveclass.local/join/${encodeURIComponent(providerMeetingId)}` +
      `?userId=${encodeURIComponent(userId)}&role=${role}`;
    return { url, expiresAt: new Date(Date.now() + 5 * 60_000) };
  }

  async endMeeting(input: EndMeetingInput): Promise<void> {
    this.logger.debug(`[NoopLiveClassProvider] endMeeting: ${input.providerMeetingId} (no-op)`);
  }

  verifyWebhookSignature(input: VerifyWebhookSignatureInput): boolean {
    if (this.simulateWebhookSecretAbsent || !this.webhookSecret) {
      this.logger.warn(
        "[NoopLiveClassProvider] verifyWebhookSignature: webhook secret absent — " +
          "returning false (fail closed).",
      );
      return false;
    }
    const { rawBody, signatureHeader } = input;
    const expectedHex = createHmac("sha256", this.webhookSecret).update(rawBody).digest("hex");
    return timingSafeEqualHexLocal(expectedHex, signatureHeader);
  }

  parseRecordingEvent(
    payload: Record<string, unknown>,
    _headers?: Record<string, string>,
  ): LiveClassWebhookEvent | null {
    // Fixture shape: { noop: true, type, providerMeetingId, occurredAt?, participant?, recording? }
    if (payload["noop"] !== true) return null;

    const type = payload["type"] as LiveClassWebhookEventType | undefined;
    const providerMeetingId = payload["providerMeetingId"];
    if (!type || typeof providerMeetingId !== "string") return null;

    const occurredAtRaw = payload["occurredAt"];
    const occurredAt =
      typeof occurredAtRaw === "string" || occurredAtRaw instanceof Date
        ? new Date(occurredAtRaw)
        : new Date();

    const event: LiveClassWebhookEvent = { type, providerMeetingId, occurredAt };

    const participant = payload["participant"] as Record<string, unknown> | undefined;
    if (participant) {
      event.participant = {
        email: typeof participant["email"] === "string" ? participant["email"] : undefined,
        name: typeof participant["name"] === "string" ? participant["name"] : undefined,
        registrantId:
          typeof participant["registrantId"] === "string" ? participant["registrantId"] : undefined,
      };
    }

    const recording = payload["recording"] as Record<string, unknown> | undefined;
    if (recording && typeof recording["downloadUrl"] === "string") {
      event.recording = {
        downloadUrl: recording["downloadUrl"],
        durationS: typeof recording["durationS"] === "number" ? recording["durationS"] : undefined,
      };
    }

    return event;
  }

  /** Test helper — computes a valid HMAC signature for a given raw body. */
  static makeWebhookSignature(
    rawBody: string | Buffer,
    secret: string = DEFAULT_NOOP_LIVE_CLASS_WEBHOOK_SECRET,
  ): string {
    return createHmac("sha256", secret).update(rawBody).digest("hex");
  }
}
