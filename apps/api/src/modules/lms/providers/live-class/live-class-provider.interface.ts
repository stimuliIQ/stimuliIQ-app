// apps/api/src/modules/lms/providers/live-class/live-class-provider.interface.ts
//
// Vendor-swappable live-class interface (CLAUDE.md §3.7: "all external calls go
// through a provider interface — never call a vendor SDK directly from a feature
// module"). The Wave-3 LiveClass module (docs/plans/phase-9-completion.md T20)
// depends ONLY on this interface via the LIVE_CLASS_PROVIDER DI token. Zoom is the
// primary adapter (Server-to-Server OAuth + Meetings API v2); Google Meet is the
// secondary adapter (Workspace service account + Calendar API conferenceData).
// Swapping vendors means implementing this interface and rebinding the DI token —
// zero changes to the LiveClass feature module.
//
// References:
//   docs/04-trd-architecture.md §2.10 (provider table: LiveClassProvider → Zoom, swap Meet)
//   docs/plans/phase-9-completion.md T15/T20
//
// ─── SECURITY CONTRACT ───────────────────────────────────────────────────────
//
// 1. createMeeting MUST NEVER return the host's `hostJoinUrl` (Zoom `start_url` /
//    equivalent) to a non-host caller. The LiveClass service (Wave-3) MUST only
//    surface `hostJoinUrl` to the RBAC-verified host/faculty/mentor, never a student.
//
// 2. getJoinUrl scopes the returned URL to (providerMeetingId, userId) where the
//    vendor supports it (Zoom: per-registrant join URL). Where the vendor does NOT
//    support per-user URL scoping (Google Meet: one shared `hangoutLink`), the
//    adapter documents this limitation explicitly — access control then relies on
//    the vendor's own meeting security (Meet's host-admission "knock to join",
//    domain restriction) as a defence-in-depth layer, with the backend's own
//    enrollment + RBAC + scope gate remaining the PRIMARY control (checked by the
//    caller BEFORE this method is invoked — see mintSignedHlsUrl's identical
//    contract in video-provider.interface.ts).
//
// 3. verifyWebhookSignature MUST FAIL CLOSED: if the webhook secret is not
//    configured, OR the vendor has no verifiable signature scheme for a given event
//    channel, return false — NEVER true. Callers MUST treat false as a rejected
//    webhook (HTTP 401/400).
//
// 4. All API tokens, client secrets, service-account private keys, and webhook
//    secrets are consumed only inside the concrete provider classes. They MUST
//    NEVER appear in any return value, log line, error message, or thrown string
//    from this interface or its implementations.
//
// 5. parseRecordingEvent normalises provider-specific webhook payloads (meeting
//    started/ended, participant joined/left, recording ready) so the LiveClass
//    module never branches on the provider name. `providerMeetingId` is used only
//    to look up the internal `live_classes` row; it must not be forwarded to the
//    client. This is the same event stream the Wave-3 "attendance auto-sync ≤60s
//    of join" requirement consumes for participant_joined/participant_left events.
//
// 6. The constructor MUST NOT throw when keys are absent (lazy validation, same
//    pattern as CloudflareStreamVideoProvider / RazorpayPaymentProvider). The app
//    must boot with LIVE_CLASS_PROVIDER=noop and no live-class keys configured.

// ─────────────────────────────────────────────────────────────────────────────
// createMeeting
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateMeetingInput {
  /** Meeting title shown to attendees (e.g. "Batch 12 — Week 3 — DSA Live Session"). */
  topic: string;
  /** Scheduled start time (UTC instant). */
  startTime: Date;
  /** Scheduled duration in minutes. */
  durationMinutes: number;
  /**
   * Internal user id of the hosting faculty/mentor. Embedded as metadata where the
   * vendor supports it (Zoom: not sent to the API directly — used by the caller to
   * resolve the host's Zoom user for /users/{userId}/meetings; Google Meet: used to
   * resolve the impersonated Workspace mailbox when multi-host is introduced later).
   */
  hostUserId: string;
  /** Host's display name, used for Google Meet organizer display where relevant. */
  hostDisplayName?: string;
  /** Host's email — REQUIRED for Google Meet (Calendar event organizer). */
  hostEmail?: string;
  /** IANA timezone (e.g. "Asia/Kolkata"). Default: "Asia/Kolkata" (India-first). */
  timezone?: string;
}

export interface CreateMeetingResult {
  /**
   * The provider-internal meeting/event identifier (stored in `live_classes.provider_meeting_id`).
   * Zoom: the numeric meeting id (stringified). Google Meet: the Calendar event id.
   * MUST NEVER be forwarded to the client — internal reference only.
   */
  providerMeetingId: string;

  /**
   * The HOST-ONLY start/join URL (Zoom `start_url`; Google Meet: the same
   * `hangoutLink` the calendar event carries, since Meet has no separate host URL).
   *
   * SECURITY: the LiveClass service MUST only return this to the verified host
   * (RBAC `liveclass.host` / own-scope faculty/mentor), NEVER to a student caller.
   */
  hostJoinUrl?: string;

  /** Zoom meeting passcode (if the meeting requires one). Undefined for Google Meet. */
  passcode?: string;

  /** Which provider created this meeting. Stored in `live_classes.provider`. */
  provider: "noop" | "zoom" | "google_meet";
}

// ─────────────────────────────────────────────────────────────────────────────
// getJoinUrl
// ─────────────────────────────────────────────────────────────────────────────

export interface GetJoinUrlInput {
  /** The provider meeting id returned by createMeeting. */
  providerMeetingId: string;
  /** Internal user id of the joiner — embedded in the scoped URL where supported. */
  userId: string;
  /** Display name shown in the meeting roster. */
  userName: string;
  /** Email — REQUIRED for Zoom registrant-scoped join URLs; used for Meet attendee add. */
  userEmail?: string;
  /** Whether this caller is the host or an attendee. Hosts get hostJoinUrl-equivalent. */
  role: "host" | "attendee";
}

export interface GetJoinUrlResult {
  /**
   * The join URL to hand to the client.
   *
   * Zoom (attendee): a per-registrant join URL from the Meeting Registrants API —
   *   scoped to (providerMeetingId, userEmail); a different student's URL will not
   *   admit this user (defence-in-depth on top of the backend's own enrollment gate).
   * Zoom (host): the meeting's `start_url` (same as createMeeting's hostJoinUrl).
   * Google Meet: the shared `hangoutLink` — NOT per-user scoped (see interface-level
   *   SECURITY CONTRACT point 2). Every enrolled student receives the same link;
   *   the backend's enrollment/RBAC/scope gate is what actually authorizes them
   *   BEFORE this method is called.
   * Noop: a deterministic fake URL encoding (providerMeetingId, userId, role).
   */
  url: string;
  /** When the returned URL/registration expires, if the vendor provides a TTL. */
  expiresAt?: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// endMeeting
// ─────────────────────────────────────────────────────────────────────────────

export interface EndMeetingInput {
  providerMeetingId: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// verifyWebhookSignature
// ─────────────────────────────────────────────────────────────────────────────

export interface VerifyWebhookSignatureInput {
  /**
   * The raw HTTP request body — MUST be the original bytes received from the
   * provider, NOT the parsed JSON.
   *
   * Zoom: the signature source string is `v0:<timestamp>:<rawBody>` using the
   *   `x-zm-request-timestamp` header value.
   * Google Meet: Calendar API push notifications carry NO vendor-signed HMAC —
   *   verifyWebhookSignature() FAILS CLOSED (always returns false) for this
   *   provider; attendance/recording sync for Google Meet must be POLLED via the
   *   Meet REST API instead of trusted via webhook (documented in the adapter).
   * Noop: HMAC-SHA256(rawBody, test secret), mirroring NoopVideoProvider.
   *
   * ─── RAW-BODY NOTE FOR THE WAVE-3 BACKEND-BUILDER (LiveClass webhook controller) ──
   * Same contract as VerifyWebhookSignatureInput in video-provider.interface.ts:
   *   1. `NestFactory.create(AppModule, { rawBody: true })` in main.ts (already set).
   *   2. Read `req.rawBody` (Buffer) in the webhook controller — never re-serialize
   *      the parsed body, the bytes must match exactly what Zoom/Meet signed.
   *   3. Zoom sends the `x-zm-signature` header AND `x-zm-request-timestamp` header
   *      — both are required; pass timestampHeader through.
   *   4. The webhook route MUST be @Public() (no JwtAuthGuard), CSRF-excluded, and
   *      return 401 immediately when verifyWebhookSignature() is false — never
   *      process the payload first.
   *   5. Zoom's `endpoint.url_validation` challenge (sent once, at webhook
   *      subscription time) is NOT an authenticated event — it has no signature to
   *      verify. Handle it explicitly BEFORE calling verifyWebhookSignature(); see
   *      `buildZoomUrlValidationResponse()` exported from zoom-live-class.provider.ts.
   */
  rawBody: string | Buffer;

  /**
   * The value of the provider's signature header, verbatim.
   * Zoom: `x-zm-signature` header, e.g. "v0=60493ec9388b...".
   * Noop: any string (HMAC-SHA256 hex of rawBody with the test webhook secret).
   */
  signatureHeader: string;

  /**
   * REQUIRED for Zoom: the `x-zm-request-timestamp` header value, used to build
   * the `v0:<timestamp>:<rawBody>` source string. Ignored by other adapters.
   */
  timestampHeader?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// parseRecordingEvent — normalised webhook event (join/leave/start/end/recording)
// ─────────────────────────────────────────────────────────────────────────────

export type LiveClassWebhookEventType =
  | "meeting_started"
  | "meeting_ended"
  | "participant_joined"
  | "participant_left"
  | "recording_ready";

export interface LiveClassWebhookEvent {
  /** Which normalised event this is. */
  type: LiveClassWebhookEventType;

  /**
   * The provider's internal meeting id. Used to look up the `live_classes` row
   * (by `provider_meeting_id`). MUST NOT be forwarded to the client.
   */
  providerMeetingId: string;

  /** When the event occurred (from the provider payload, UTC). */
  occurredAt: Date;

  /**
   * Present for participant_joined / participant_left events. Used by the
   * Wave-3 "attendance auto-sync ≤60s of join" requirement to resolve the
   * internal student by email/registrant id and write an attendance row.
   */
  participant?: {
    email?: string;
    name?: string;
    /**
     * Zoom: the registrant id from the Meeting Registrants API (if the caller
     * used getJoinUrl's registrant-scoped flow) — the most reliable correlation
     * key back to the internal userId. Absent for Google Meet (no per-user join
     * registration exists on that vendor).
     */
    registrantId?: string;
  };

  /** Present for recording_ready events. */
  recording?: {
    /**
     * The provider's recording download/playback URL. SECURITY: this is a
     * vendor-authenticated URL (Zoom requires an OAuth/download token; it is
     * NOT a public URL) — the LiveClass module must fetch and re-host it via
     * StorageProvider rather than ever returning it directly to a client.
     */
    downloadUrl: string;
    durationS?: number;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider interface
// ─────────────────────────────────────────────────────────────────────────────

export interface LiveClassProvider {
  /**
   * Schedules a new live class meeting.
   *
   * FAIL CLOSED: if API credentials are not configured, this MUST throw (never
   * return a fabricated meeting id). The caller (LiveClass service) catches the
   * throw and returns 503 — never silently creates a `live_classes` row with no
   * real vendor meeting behind it.
   */
  createMeeting(input: CreateMeetingInput): Promise<CreateMeetingResult>;

  /**
   * Resolves a join URL scoped to (providerMeetingId, userId) where the vendor
   * supports per-user scoping (see interface-level SECURITY CONTRACT point 2).
   *
   * The LiveClass service (Wave-3) MUST:
   *   1. Verify active enrollment + RBAC (`liveclass.join`, scope=own) BEFORE
   *      calling this method — identical contract to VideoProvider.mintSignedHlsUrl.
   *   2. Write an audit-log row after a successful resolution.
   *   3. Never cache the returned URL across requests for a different user.
   */
  getJoinUrl(input: GetJoinUrlInput): Promise<GetJoinUrlResult>;

  /**
   * Ends/cancels a scheduled or in-progress meeting.
   *
   * Zoom: PUT /meetings/{id}/status { action: "end" } — force-ends an in-progress
   *   meeting immediately.
   * Google Meet: deletes the calendar event (revokes FUTURE calendar-based access);
   *   Meet has no API to force-eject participants from an ALREADY-JOINED call —
   *   this is a documented vendor limitation, not an adapter bug.
   */
  endMeeting(input: EndMeetingInput): Promise<void>;

  /**
   * Verifies the signature of an inbound provider webhook.
   *
   * SECURITY — FAIL CLOSED: returns false whenever the secret is unconfigured OR
   * the vendor/channel has no verifiable signature scheme. See interface-level
   * doc on VerifyWebhookSignatureInput.rawBody for the Google Meet caveat.
   */
  verifyWebhookSignature(input: VerifyWebhookSignatureInput): boolean;

  /**
   * Parses a provider-specific webhook payload into a normalised
   * LiveClassWebhookEvent. Called AFTER verifyWebhookSignature returns true.
   *
   * Returns null if the payload does not represent a recognised live-class event
   * (e.g. an unrelated Zoom event type, or Zoom's `endpoint.url_validation`
   * challenge which the controller must handle separately — see
   * buildZoomUrlValidationResponse in zoom-live-class.provider.ts).
   *
   * MUST NOT throw on unexpected payload shapes — parse defensively.
   */
  parseRecordingEvent(
    payload: Record<string, unknown>,
    headers?: Record<string, string>,
  ): LiveClassWebhookEvent | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// DI token
// ─────────────────────────────────────────────────────────────────────────────

/**
 * NestJS DI injection token for the LiveClassProvider.
 *
 * Wave-3 LiveClass services import and inject this token — NEVER import
 * ZoomLiveClassProvider, GoogleMeetLiveClassProvider, or any other concrete
 * class from a feature module.
 *
 * The LiveClassProviderModule binds this token to the adapter selected by the
 * LIVE_CLASS_PROVIDER env variable (see live-class-provider.module.ts).
 *
 * Test wiring (unit tests — bind the Noop provider directly):
 *
 *   import { NoopLiveClassProvider } from './providers/live-class/noop-live-class.provider';
 *
 *   const noop = new NoopLiveClassProvider();
 *   const module = await Test.createTestingModule({
 *     providers: [
 *       LiveClassService,
 *       { provide: LIVE_CLASS_PROVIDER, useValue: noop },
 *     ],
 *   }).compile();
 */
export const LIVE_CLASS_PROVIDER = Symbol("LIVE_CLASS_PROVIDER");
