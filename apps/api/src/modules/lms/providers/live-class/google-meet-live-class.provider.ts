// apps/api/src/modules/lms/providers/live-class/google-meet-live-class.provider.ts
//
// Google Meet implementation of LiveClassProvider via the Google Calendar API's
// `conferenceData` (docs/04-trd-architecture.md §2.10, docs/plans/phase-9-completion.md
// T15). Bound to the LIVE_CLASS_PROVIDER DI token when LIVE_CLASS_PROVIDER=google_meet.
// Feature modules NEVER import this class directly — they inject LIVE_CLASS_PROVIDER.
//
// ─── AUTH STRATEGY: Workspace service account + domain-wide delegation ──────
//
//   1. Create a Google Cloud project, enable the "Google Calendar API".
//   2. Create a Service Account, generate a JSON key
//      (GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY).
//   3. In the Google Workspace Admin Console (admin.google.com) → Security →
//      API Controls → Domain-wide Delegation: authorize the service account's
//      Client ID for scope `https://www.googleapis.com/auth/calendar.events`.
//   4. GOOGLE_MEET_IMPERSONATE_USER_EMAIL: a real Workspace mailbox the service
//      account impersonates (domain-wide delegation requires an actual user —
//      service accounts cannot own a Calendar/Meet resource themselves).
//   5. Access tokens are minted via the OAuth2 JWT-bearer flow (RFC 7523):
//        a) Build + RS256-sign a JWT assertion:
//             iss: GOOGLE_SERVICE_ACCOUNT_EMAIL
//             sub: GOOGLE_MEET_IMPERSONATE_USER_EMAIL  (impersonation)
//             scope: "https://www.googleapis.com/auth/calendar.events"
//             aud: "https://oauth2.googleapis.com/token"
//             iat/exp: now / now+3600
//        b) POST https://oauth2.googleapis.com/token
//             grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=<jwt>
//           Response: { access_token, expires_in, token_type }
//
// Signing uses `jose` (already a project dependency).
//
// ─── MEETING CREATION ─────────────────────────────────────────────────────────
//
//   POST https://www.googleapis.com/calendar/v3/calendars/{calendarId}/events?conferenceDataVersion=1
//   Body: {
//     summary: topic,
//     start: { dateTime, timeZone }, end: { dateTime, timeZone },
//     conferenceData: {
//       createRequest: { requestId: <uuid>, conferenceSolutionKey: { type: "hangoutsMeet" } },
//     },
//   }
//   Response: { id (event id), conferenceData: { entryPoints: [{ entryPointType: "video", uri }] } }
//
// ─── PER-USER JOIN URL LIMITATION (documented, not a bug) ────────────────────
//
//   Unlike Zoom, Google Meet has NO per-attendee join-URL scoping at the Calendar
//   API level — every invitee (and, if the event is not restricted, anyone with the
//   link) receives the SAME `hangoutLink`. getJoinUrl() therefore returns the same
//   URL for every attendee. Access control for Google Meet relies on:
//     (a) the backend's OWN enrollment/RBAC/scope gate — checked BEFORE this method
//         is called (the PRIMARY control, identical requirement to Zoom/Video);
//     (b) Meet's built-in host-admission ("knock to join") when the organizer is
//         present, and Workspace domain restriction if the target Workspace is
//         configured to require sign-in.
//   This is a deliberate, documented vendor limitation — Google Meet is the
//   secondary/fallback adapter for this reason.
//
// ─── endMeeting LIMITATION (documented, not a bug) ───────────────────────────
//
//   Google Calendar API has NO "force end an in-progress video call" operation.
//   endMeeting() deletes the calendar event, which revokes FUTURE calendar-based
//   access to the join link for anyone who has not already joined — it does NOT
//   eject already-connected participants from an active call.
//
// ─── WEBHOOKS — NOT SUPPORTED FOR MEET EVENTS (documented, not a bug) ────────
//
//   Calendar API push notifications (watch()) only fire on CALENDAR changes
//   (event created/updated/deleted), not on Meet-specific participant join/leave
//   or recording-ready events, and carry no vendor HMAC signature the way Zoom's
//   webhooks do. verifyWebhookSignature() therefore ALWAYS returns false (fail
//   closed) and parseRecordingEvent() ALWAYS returns null for this adapter.
//   Attendance sync for Google Meet must be implemented by POLLING the Google
//   Meet REST API (`conferenceRecords.participants.list`, a separate, newer API)
//   from the Wave-3 LiveClass module — not via this webhook seam.
//
// ─── SECURITY INVARIANTS ──────────────────────────────────────────────────────
//
//   - GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY / access tokens: consumed only inside
//     this file; never logged, never returned, never in any error message.
//   - Constructor MUST NOT throw when keys are absent (lazy validation).

import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { SignJWT, importPKCS8, type CryptoKey } from "jose";
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
// Google API response shapes (internal, not exported)
// ─────────────────────────────────────────────────────────────────────────────

interface GoogleOAuthTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

interface GoogleCalendarEventResponse {
  id: string;
  conferenceData?: {
    entryPoints?: Array<{ entryPointType?: string; uri?: string }>;
  };
  hangoutLink?: string;
}

interface GoogleErrorResponse {
  error?: { message?: string; status?: string };
}

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3";
const CALENDAR_EVENTS_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const PROVIDER_NAME = "google_meet" as const;

@Injectable()
export class GoogleMeetLiveClassProvider implements LiveClassProvider {
  private readonly logger = new Logger(GoogleMeetLiveClassProvider.name);

  private readonly serviceAccountEmail: string | undefined;
  private readonly serviceAccountPrivateKeyRaw: string | undefined;
  private readonly impersonateUserEmail: string | undefined;
  private readonly calendarId: string;

  private signingKeyCache: CryptoKey | undefined;
  private cachedToken: { accessToken: string; expiresAtMs: number } | undefined;

  constructor() {
    const env = validateEnv();
    this.serviceAccountEmail = env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    this.serviceAccountPrivateKeyRaw = env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
    this.impersonateUserEmail = env.GOOGLE_MEET_IMPERSONATE_USER_EMAIL;
    this.calendarId = env.GOOGLE_MEET_CALENDAR_ID || "primary";

    const missing: string[] = [];
    if (!this.serviceAccountEmail) missing.push("GOOGLE_SERVICE_ACCOUNT_EMAIL");
    if (!this.serviceAccountPrivateKeyRaw) missing.push("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY");
    if (!this.impersonateUserEmail) missing.push("GOOGLE_MEET_IMPERSONATE_USER_EMAIL");
    if (missing.length > 0) {
      this.logger.warn(
        `[GoogleMeetLiveClassProvider] Missing env vars: ${missing.join(", ")}. ` +
          "Meeting creation/join/end will fail until these are set. App boot continues " +
          "Set LIVE_CLASS_PROVIDER=noop in .env for local dev.",
      );
    }
    this.logger.warn(
      "[GoogleMeetLiveClassProvider] verifyWebhookSignature/parseRecordingEvent are NOT " +
        "supported for this adapter (Calendar API push notifications carry no vendor HMAC " +
        "and do not cover Meet-specific participant events). Attendance sync must poll the " +
        "Google Meet REST API instead, see file header.",
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Private: lazy credential + OAuth helpers
  // ───────────────────────────────────────────────────────────────────────────

  private requireCredentials(): { email: string; privateKeyRaw: string; impersonate: string } {
    if (!this.serviceAccountEmail || !this.serviceAccountPrivateKeyRaw || !this.impersonateUserEmail) {
      throw new Error(
        "[GoogleMeetLiveClassProvider] GOOGLE_SERVICE_ACCOUNT_EMAIL / " +
          "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY / GOOGLE_MEET_IMPERSONATE_USER_EMAIL not " +
          "configured. Cannot perform this Google Meet operation. Add them to .env " +
          "(see .env.example) or set LIVE_CLASS_PROVIDER=noop for local dev.",
      );
    }
    return {
      email: this.serviceAccountEmail,
      privateKeyRaw: this.serviceAccountPrivateKeyRaw,
      impersonate: this.impersonateUserEmail,
    };
  }

  private async requireSigningKey(pemRaw: string): Promise<CryptoKey> {
    if (!this.signingKeyCache) {
      // Service-account JSON keys often carry literal "\n" sequences when passed via
      // env vars (the real newlines get escaped) — unescape before importing.
      const pemContent = pemRaw.replace(/\\n/g, "\n").trim();
      try {
        this.signingKeyCache = await importPKCS8(pemContent, "RS256");
      } catch (importErr) {
        throw new Error(
          "[GoogleMeetLiveClassProvider] Failed to import GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY " +
            `as an RS256 private key: ${String(importErr)}.`,
        );
      }
    }
    return this.signingKeyCache;
  }

  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.cachedToken && this.cachedToken.expiresAtMs - 60_000 > now) {
      return this.cachedToken.accessToken;
    }

    const { email, privateKeyRaw, impersonate } = this.requireCredentials();
    const key = await this.requireSigningKey(privateKeyRaw);

    const nowS = Math.floor(now / 1000);
    const expS = nowS + 3600;

    let assertion: string;
    try {
      assertion = await new SignJWT({
        scope: CALENDAR_EVENTS_SCOPE,
      })
        .setProtectedHeader({ alg: "RS256" })
        .setIssuer(email)
        .setSubject(impersonate) // domain-wide delegation: impersonate the Workspace user
        .setAudience(GOOGLE_TOKEN_URL)
        .setIssuedAt(nowS)
        .setExpirationTime(expS)
        .sign(key);
    } catch (signErr) {
      throw new Error(`[GoogleMeetLiveClassProvider] Failed to sign OAuth JWT assertion: ${String(signErr)}`);
    }

    let response: Response;
    try {
      response = await fetch(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
          assertion,
        }).toString(),
      });
    } catch (networkErr) {
      this.logger.error(`[GoogleMeetLiveClassProvider] Network error minting OAuth token: ${String(networkErr)}`);
      throw new Error("[GoogleMeetLiveClassProvider] Network error calling Google OAuth. Check connectivity and retry.");
    }

    if (!response.ok) {
      this.logger.error(`[GoogleMeetLiveClassProvider] OAuth token request failed: HTTP ${response.status}`);
      throw new Error(`[GoogleMeetLiveClassProvider] Google OAuth token request returned HTTP ${response.status}.`);
    }

    const data = (await response.json()) as GoogleOAuthTokenResponse;
    this.cachedToken = { accessToken: data.access_token, expiresAtMs: now + data.expires_in * 1000 };
    return data.access_token;
  }

  private async calendarFetch<T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const accessToken = await this.getAccessToken();

    let response: Response;
    try {
      response = await fetch(`${GOOGLE_CALENDAR_API_BASE}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (networkErr) {
      this.logger.error(`[GoogleMeetLiveClassProvider] Network error on ${method} ${path}: ${String(networkErr)}`);
      throw new Error(`[GoogleMeetLiveClassProvider] Network error calling Google Calendar API (${method} ${path}).`);
    }

    if (!response.ok) {
      let errText = "";
      try {
        const errJson = (await response.json()) as GoogleErrorResponse;
        errText = errJson.error?.message ?? response.statusText;
      } catch {
        errText = response.statusText;
      }
      this.logger.error(
        `[GoogleMeetLiveClassProvider] API error on ${method} ${path}: HTTP ${response.status} · ${errText}`,
      );
      throw new Error(`[GoogleMeetLiveClassProvider] Google Calendar API returned HTTP ${response.status}: ${errText}`);
    }

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
    const endTime = new Date(input.startTime.getTime() + input.durationMinutes * 60_000);

    const body: Record<string, unknown> = {
      summary: input.topic,
      start: { dateTime: input.startTime.toISOString(), timeZone: timezone },
      end: { dateTime: endTime.toISOString(), timeZone: timezone },
      conferenceData: {
        createRequest: {
          requestId: randomUUID(),
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      },
      ...(input.hostEmail ? { attendees: [{ email: input.hostEmail, organizer: true }] } : {}),
    };

    const event = await this.calendarFetch<GoogleCalendarEventResponse>(
      "POST",
      `/calendars/${encodeURIComponent(this.calendarId)}/events?conferenceDataVersion=1`,
      body,
    );

    const meetUri =
      event.hangoutLink ??
      event.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")?.uri;

    if (!meetUri) {
      throw new Error(
        "[GoogleMeetLiveClassProvider] Calendar event created but no Meet conference link was " +
          "returned (conferenceData may still be provisioning. This is a transient Google-side " +
          "condition; retry createMeeting).",
      );
    }

    return {
      providerMeetingId: event.id,
      hostJoinUrl: meetUri,
      provider: PROVIDER_NAME,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // getJoinUrl — SAME URL for every attendee (documented limitation, see file header)
  // ───────────────────────────────────────────────────────────────────────────

  async getJoinUrl(input: GetJoinUrlInput): Promise<GetJoinUrlResult> {
    const event = await this.calendarFetch<GoogleCalendarEventResponse>(
      "GET",
      `/calendars/${encodeURIComponent(this.calendarId)}/events/${encodeURIComponent(input.providerMeetingId)}`,
    );

    const meetUri =
      event.hangoutLink ??
      event.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")?.uri;

    if (!meetUri) {
      throw new Error(
        `[GoogleMeetLiveClassProvider] Calendar event ${input.providerMeetingId} has no Meet ` +
          "conference link.",
      );
    }

    return { url: meetUri };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // endMeeting — deletes the calendar event (see LIMITATION doc in file header)
  // ───────────────────────────────────────────────────────────────────────────

  async endMeeting(input: EndMeetingInput): Promise<void> {
    await this.calendarFetch<void>(
      "DELETE",
      `/calendars/${encodeURIComponent(this.calendarId)}/events/${encodeURIComponent(input.providerMeetingId)}`,
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  // verifyWebhookSignature / parseRecordingEvent — NOT SUPPORTED (fail closed)
  // ───────────────────────────────────────────────────────────────────────────

  verifyWebhookSignature(_input: VerifyWebhookSignatureInput): boolean {
    this.logger.warn(
      "[GoogleMeetLiveClassProvider] verifyWebhookSignature: Google Meet has no vendor-signed " +
        "webhook scheme for participant/recording events. Rejecting (fail closed). Use polling " +
        "(Google Meet REST API conferenceRecords.participants.list) for attendance sync instead.",
    );
    return false;
  }

  parseRecordingEvent(_payload: Record<string, unknown>): LiveClassWebhookEvent | null {
    return null;
  }
}
