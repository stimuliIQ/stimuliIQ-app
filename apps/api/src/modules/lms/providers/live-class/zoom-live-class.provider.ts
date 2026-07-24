// apps/api/src/modules/lms/providers/live-class/zoom-live-class.provider.ts
//
// Zoom implementation of LiveClassProvider using Server-to-Server OAuth (S2S OAuth)
// + Zoom Meetings API v2 (docs/04-trd-architecture.md §2.10, docs/plans/phase-9-completion.md
// T15). Bound to the LIVE_CLASS_PROVIDER DI token when LIVE_CLASS_PROVIDER=zoom.
// Feature modules NEVER import this class directly — they inject LIVE_CLASS_PROVIDER.
//
// ─── AUTH STRATEGY: Server-to-Server OAuth ───────────────────────────────────
//
//   1. Create a "Server-to-Server OAuth" app in the Zoom Marketplace
//      (marketplace.zoom.us → Develop → Build App → Server-to-Server OAuth).
//   2. Grant scopes: meeting:write:meeting, meeting:write:registrant,
//      meeting:read:meeting, meeting:update:meeting.
//   3. Note the Account ID, Client ID, Client Secret (ZOOM_ACCOUNT_ID/ZOOM_CLIENT_ID/
//      ZOOM_CLIENT_SECRET).
//   4. Access tokens are minted per-call (cached in-memory until near expiry):
//        POST https://zoom.us/oauth/token?grant_type=account_credentials&account_id=<ACCOUNT_ID>
//        Authorization: Basic base64(client_id:client_secret)
//      Response: { access_token, token_type, expires_in, scope }
//
// ─── MEETING CREATION ─────────────────────────────────────────────────────────
//
//   POST https://api.zoom.us/v2/users/me/meetings
//   Body: {
//     topic, type: 2 (scheduled), start_time (ISO 8601), duration (minutes),
//     timezone,
//     settings: {
//       join_before_host: false,
//       waiting_room: false,          // registrant approval replaces the waiting room
//       approval_type: 0,             // auto-approve registrants (0 = automatically approve)
//       registration_type: 1,         // attendees register once, get a unique join_url
//       auto_recording: "cloud",      // enables recording.completed webhook for playback
//     },
//   }
//   Response includes: id, start_url (HOST-ONLY — never given to a student), password.
//
//   NOTE: "/users/me/meetings" creates the meeting under the S2S app's own Zoom user
//   (the license the credentials belong to) — Zoom S2S OAuth apps operate as a single
//   Zoom user/account, not per-faculty Zoom accounts. `hostUserId`/`hostDisplayName`
//   from CreateMeetingInput are NOT sent to Zoom; they identify our INTERNAL host for
//   attendance/audit purposes only (stored by the caller in `live_classes.host_user_id`).
//
// ─── PER-USER JOIN URL (getJoinUrl, attendee) ────────────────────────────────
//
//   Because the meeting is created with registration_type=1, each attendee gets a
//   DISTINCT join_url via the Meeting Registrants API:
//     POST https://api.zoom.us/v2/meetings/{meetingId}/registrants
//     Body: { email, first_name }
//     Response: { registrant_id, join_url }  ← per-user, defence-in-depth scoping.
//   For role="host", getJoinUrl fetches the meeting's start_url via GET /meetings/{id}.
//
// ─── WEBHOOK VERIFICATION ─────────────────────────────────────────────────────
//
//   Zoom sends: `x-zm-signature: v0=<hex>` and `x-zm-request-timestamp: <unix_ts>`.
//   message = `v0:${timestamp}:${rawBody}`
//   expected = HMAC-SHA256(message, ZOOM_WEBHOOK_SECRET_TOKEN) [hex]
//   signature = `v0=${expected}`
//   FAIL CLOSED when ZOOM_WEBHOOK_SECRET_TOKEN is absent.
//
//   Zoom's one-time `endpoint.url_validation` challenge (sent when you first save the
//   webhook subscription URL in the Zoom Marketplace) carries NO signature — it must
//   be handled by the webhook controller BEFORE calling verifyWebhookSignature(), using
//   buildZoomUrlValidationResponse() exported below.
//
// ─── SECURITY INVARIANTS ──────────────────────────────────────────────────────
//
//   - ZOOM_CLIENT_SECRET / ZOOM_WEBHOOK_SECRET_TOKEN / access tokens: consumed only
//     inside this file; never logged, never returned, never in any error message.
//   - hostJoinUrl (start_url) is returned from createMeeting/getJoinUrl(role="host")
//     but the CALLER (LiveClass service) is responsible for RBAC-gating it to hosts only.
//   - All signature comparisons use node:crypto timingSafeEqual (constant-time).
//   - Constructor MUST NOT throw when keys are absent (lazy validation, same pattern
//     as RazorpayPaymentProvider / CloudflareStreamVideoProvider).

import { Injectable, Logger } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import { validateEnv } from "../../../../config/env";
import type {
  LiveClassProvider,
  CreateMeetingInput,
  CreateMeetingResult,
  GetJoinUrlInput,
  GetJoinUrlResult,
  EndMeetingInput,
  VerifyWebhookSignatureInput,
  LiveClassWebhookEvent,
} from "./live-class-provider.interface";

// ─────────────────────────────────────────────────────────────────────────────
// Zoom API response shapes (internal, not exported)
// ─────────────────────────────────────────────────────────────────────────────

interface ZoomOAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number; // seconds
  scope: string;
}

interface ZoomCreateMeetingResponse {
  id: number;
  start_url: string;
  join_url: string;
  password?: string;
}

interface ZoomGetMeetingResponse {
  id: number;
  start_url: string;
}

interface ZoomRegistrantResponse {
  registrant_id: string;
  join_url: string;
}

interface ZoomErrorResponse {
  code?: number;
  message?: string;
}

const ZOOM_OAUTH_BASE = "https://zoom.us/oauth/token";
const ZOOM_API_BASE = "https://api.zoom.us/v2";
const PROVIDER_NAME = "zoom" as const;

// ─────────────────────────────────────────────────────────────────────────────
// Zoom webhook endpoint.url_validation challenge helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds the response Zoom expects for its one-time `endpoint.url_validation`
 * webhook-subscription challenge. This is NOT a signed event — the webhook
 * controller MUST detect `payload.event === "endpoint.url_validation"` and return
 * this response directly, BEFORE calling verifyWebhookSignature().
 *
 *   Zoom sends: { event: "endpoint.url_validation", payload: { plainToken } }
 *   Expected response body: { plainToken, encryptedToken }
 *     encryptedToken = HMAC-SHA256(plainToken, ZOOM_WEBHOOK_SECRET_TOKEN) [hex]
 *
 * Reference: https://developers.zoom.us/docs/api/webhooks/#validate-your-webhook-endpoint
 */
export function buildZoomUrlValidationResponse(
  plainToken: string,
  webhookSecretToken: string,
): { plainToken: string; encryptedToken: string } {
  const encryptedToken = createHmac("sha256", webhookSecretToken).update(plainToken).digest("hex");
  return { plainToken, encryptedToken };
}

/** Constant-time hex string comparison (mirrors timingSafeEqualHex in the video provider). */
export function timingSafeEqualHexZoom(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) {
    timingSafeEqual(aBuf, aBuf);
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider implementation
// ─────────────────────────────────────────────────────────────────────────────

@Injectable()
export class ZoomLiveClassProvider implements LiveClassProvider {
  private readonly logger = new Logger(ZoomLiveClassProvider.name);

  private readonly accountId: string | undefined;
  private readonly clientId: string | undefined;
  private readonly clientSecret: string | undefined;
  private readonly webhookSecretToken: string | undefined;

  // In-memory S2S OAuth access-token cache (per process). Re-minted ~60s before expiry.
  private cachedToken: { accessToken: string; expiresAtMs: number } | undefined;

  constructor() {
    const env = validateEnv();
    this.accountId = env.ZOOM_ACCOUNT_ID;
    this.clientId = env.ZOOM_CLIENT_ID;
    this.clientSecret = env.ZOOM_CLIENT_SECRET;
    this.webhookSecretToken = env.ZOOM_WEBHOOK_SECRET_TOKEN;

    const missing: string[] = [];
    if (!this.accountId) missing.push("ZOOM_ACCOUNT_ID");
    if (!this.clientId) missing.push("ZOOM_CLIENT_ID");
    if (!this.clientSecret) missing.push("ZOOM_CLIENT_SECRET");
    if (missing.length > 0) {
      this.logger.warn(
        `[ZoomLiveClassProvider] Missing env vars: ${missing.join(", ")}. ` +
          "Meeting creation/join/end will fail until these are set. App boot continues " +
          "— set LIVE_CLASS_PROVIDER=noop in .env for local dev.",
      );
    }
    if (!this.webhookSecretToken) {
      this.logger.warn(
        "[ZoomLiveClassProvider] ZOOM_WEBHOOK_SECRET_TOKEN is not configured. " +
          "Webhook signature verification will FAIL CLOSED — all incoming webhooks will " +
          "be rejected until this secret is set.",
      );
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Private: lazy credential + OAuth token helpers
  // ───────────────────────────────────────────────────────────────────────────

  private requireCredentials(): { accountId: string; clientId: string; clientSecret: string } {
    if (!this.accountId || !this.clientId || !this.clientSecret) {
      throw new Error(
        "[ZoomLiveClassProvider] ZOOM_ACCOUNT_ID / ZOOM_CLIENT_ID / ZOOM_CLIENT_SECRET " +
          "not configured — cannot perform this Zoom API operation. " +
          "Add them to .env (see .env.example) or set LIVE_CLASS_PROVIDER=noop for local dev.",
      );
    }
    return { accountId: this.accountId, clientId: this.clientId, clientSecret: this.clientSecret };
  }

  /** Mints (or returns a cached) S2S OAuth access token. */
  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.cachedToken && this.cachedToken.expiresAtMs - 60_000 > now) {
      return this.cachedToken.accessToken;
    }

    const { accountId, clientId, clientSecret } = this.requireCredentials();
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

    let response: Response;
    try {
      response = await fetch(
        `${ZOOM_OAUTH_BASE}?grant_type=account_credentials&account_id=${encodeURIComponent(accountId)}`,
        {
          method: "POST",
          headers: { Authorization: `Basic ${basicAuth}` },
        },
      );
    } catch (networkErr) {
      this.logger.error(`[ZoomLiveClassProvider] Network error minting OAuth token: ${String(networkErr)}`);
      throw new Error("[ZoomLiveClassProvider] Network error calling Zoom OAuth. Check connectivity and retry.");
    }

    if (!response.ok) {
      this.logger.error(`[ZoomLiveClassProvider] OAuth token request failed: HTTP ${response.status}`);
      throw new Error(`[ZoomLiveClassProvider] Zoom OAuth token request returned HTTP ${response.status}.`);
    }

    const data = (await response.json()) as ZoomOAuthTokenResponse;
    this.cachedToken = {
      accessToken: data.access_token,
      expiresAtMs: now + data.expires_in * 1000,
    };
    return data.access_token;
  }

  private async zoomFetch<T>(
    method: "GET" | "POST" | "PATCH" | "PUT",
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const accessToken = await this.getAccessToken();

    let response: Response;
    try {
      response = await fetch(`${ZOOM_API_BASE}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (networkErr) {
      this.logger.error(`[ZoomLiveClassProvider] Network error on ${method} ${path}: ${String(networkErr)}`);
      throw new Error(`[ZoomLiveClassProvider] Network error calling Zoom API (${method} ${path}).`);
    }

    if (!response.ok) {
      let errText = "";
      try {
        const errJson = (await response.json()) as ZoomErrorResponse;
        errText = errJson.message ?? response.statusText;
      } catch {
        errText = response.statusText;
      }
      this.logger.error(`[ZoomLiveClassProvider] API error on ${method} ${path}: HTTP ${response.status} — ${errText}`);
      throw new Error(`[ZoomLiveClassProvider] Zoom API returned HTTP ${response.status}: ${errText}`);
    }

    // 204 No Content (e.g. meeting status update) — no body to parse.
    if (response.status === 204) {
      return undefined as unknown as T;
    }
    return response.json() as Promise<T>;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // createMeeting
  // ───────────────────────────────────────────────────────────────────────────

  async createMeeting(input: CreateMeetingInput): Promise<CreateMeetingResult> {
    const timezone = input.timezone ?? "Asia/Kolkata";

    const body = {
      topic: input.topic,
      type: 2, // scheduled meeting
      start_time: input.startTime.toISOString(),
      duration: input.durationMinutes,
      timezone,
      settings: {
        join_before_host: false,
        waiting_room: false,
        approval_type: 0, // auto-approve registrants
        registration_type: 1, // each registrant gets a unique join_url
        auto_recording: "cloud",
      },
    };

    const meeting = await this.zoomFetch<ZoomCreateMeetingResponse>("POST", "/users/me/meetings", body);

    return {
      providerMeetingId: String(meeting.id),
      hostJoinUrl: meeting.start_url,
      passcode: meeting.password,
      provider: PROVIDER_NAME,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // getJoinUrl
  // ───────────────────────────────────────────────────────────────────────────

  async getJoinUrl(input: GetJoinUrlInput): Promise<GetJoinUrlResult> {
    if (input.role === "host") {
      const meeting = await this.zoomFetch<ZoomGetMeetingResponse>(
        "GET",
        `/meetings/${encodeURIComponent(input.providerMeetingId)}`,
      );
      return { url: meeting.start_url };
    }

    if (!input.userEmail) {
      throw new Error(
        "[ZoomLiveClassProvider] getJoinUrl: userEmail is required for attendee registration " +
          "(Zoom Meeting Registrants API requires an email).",
      );
    }

    const [firstName, ...rest] = input.userName.trim().split(/\s+/);
    const registrant = await this.zoomFetch<ZoomRegistrantResponse>(
      "POST",
      `/meetings/${encodeURIComponent(input.providerMeetingId)}/registrants`,
      {
        email: input.userEmail,
        first_name: firstName || input.userName,
        ...(rest.length > 0 ? { last_name: rest.join(" ") } : {}),
      },
    );

    return { url: registrant.join_url };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // endMeeting
  // ───────────────────────────────────────────────────────────────────────────

  async endMeeting(input: EndMeetingInput): Promise<void> {
    await this.zoomFetch<void>("PUT", `/meetings/${encodeURIComponent(input.providerMeetingId)}/status`, {
      action: "end",
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // verifyWebhookSignature — FAIL CLOSED, constant-time
  // ───────────────────────────────────────────────────────────────────────────

  verifyWebhookSignature(input: VerifyWebhookSignatureInput): boolean {
    if (!this.webhookSecretToken) {
      this.logger.warn(
        "[ZoomLiveClassProvider] verifyWebhookSignature called but ZOOM_WEBHOOK_SECRET_TOKEN " +
          "is not configured — rejecting webhook (fail closed).",
      );
      return false;
    }
    if (!input.timestampHeader) {
      this.logger.warn(
        "[ZoomLiveClassProvider] verifyWebhookSignature: missing x-zm-request-timestamp header " +
          "— rejecting (fail closed).",
      );
      return false;
    }

    const rawBodyStr = Buffer.isBuffer(input.rawBody) ? input.rawBody.toString("utf8") : input.rawBody;
    const message = `v0:${input.timestampHeader}:${rawBodyStr}`;
    const expectedHex = createHmac("sha256", this.webhookSecretToken).update(message, "utf8").digest("hex");
    const expectedHeader = `v0=${expectedHex}`;

    return timingSafeEqualHexZoom(expectedHeader, input.signatureHeader);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // parseRecordingEvent — normalise Zoom webhook payload
  // ───────────────────────────────────────────────────────────────────────────

  parseRecordingEvent(payload: Record<string, unknown>): LiveClassWebhookEvent | null {
    const event = typeof payload["event"] === "string" ? (payload["event"] as string) : null;
    if (!event) return null;

    const eventTs = payload["event_ts"];
    const occurredAt = typeof eventTs === "number" ? new Date(eventTs) : new Date();

    const payloadObj = payload["payload"] as Record<string, unknown> | undefined;
    const object = payloadObj?.["object"] as Record<string, unknown> | undefined;
    const meetingId = object?.["id"];
    if (!meetingId) return null;
    const providerMeetingId = String(meetingId);

    switch (event) {
      case "meeting.started":
        return { type: "meeting_started", providerMeetingId, occurredAt };

      case "meeting.ended":
        return { type: "meeting_ended", providerMeetingId, occurredAt };

      case "meeting.participant_joined": {
        const participant = object?.["participant"] as Record<string, unknown> | undefined;
        return {
          type: "participant_joined",
          providerMeetingId,
          occurredAt,
          participant: {
            email: typeof participant?.["email"] === "string" ? (participant["email"] as string) : undefined,
            name:
              typeof participant?.["user_name"] === "string" ? (participant["user_name"] as string) : undefined,
            registrantId:
              typeof participant?.["registrant_id"] === "string"
                ? (participant["registrant_id"] as string)
                : undefined,
          },
        };
      }

      case "meeting.participant_left": {
        const participant = object?.["participant"] as Record<string, unknown> | undefined;
        return {
          type: "participant_left",
          providerMeetingId,
          occurredAt,
          participant: {
            email: typeof participant?.["email"] === "string" ? (participant["email"] as string) : undefined,
            name:
              typeof participant?.["user_name"] === "string" ? (participant["user_name"] as string) : undefined,
            registrantId:
              typeof participant?.["registrant_id"] === "string"
                ? (participant["registrant_id"] as string)
                : undefined,
          },
        };
      }

      case "recording.completed": {
        const recordingFiles = object?.["recording_files"] as Array<Record<string, unknown>> | undefined;
        const firstFile = recordingFiles?.find(
          (f) => typeof f["play_url"] === "string" || typeof f["download_url"] === "string",
        );
        const downloadUrl =
          (firstFile?.["download_url"] as string | undefined) ?? (firstFile?.["play_url"] as string | undefined);
        if (!downloadUrl) return null;

        const durationRaw = object?.["duration"];
        return {
          type: "recording_ready",
          providerMeetingId,
          occurredAt,
          recording: {
            downloadUrl,
            durationS: typeof durationRaw === "number" ? durationRaw * 60 : undefined,
          },
        };
      }

      default:
        // Unrecognised event type (e.g. endpoint.url_validation, meeting.created) — safe ignore.
        return null;
    }
  }
}
