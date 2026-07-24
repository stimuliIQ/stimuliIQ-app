// Notification contracts — Phase 6, Wave 2 (docs/plans/phase-6.md task #2).
//
// Covers WS-1 (Notifications core):
//   - NotificationDto              — single in-app notification row (own-scope read)
//   - ListNotificationsQuerySchema — GET /me/notifications query params (unread filter + cursor pagination)
//   - MarkReadDtoSchema            — POST /me/notifications/:id/read body (empty, action endpoint)
//   - NotificationPrefsDto        — GET/PUT /me/notification-prefs: type×channel matrix + quiet hours
//   - NotificationStreamEvent     — SSE event shape for GET /me/notifications/stream
//   - UnsubscribeDtoSchema        — POST /unsubscribe/:token (public, no auth — signed token in path)
//
// Architecture decisions (LOCKED per docs/specs/phase-6-engagement.md):
//   LOCK-D3: Real-time = SSE + polling fallback. NotificationStreamEvent is the SSE payload;
//            polling uses the same NotificationDto list endpoint with unread=true.
//   LOCK-D4: India DLT/DPDP compliance is enforced in service layer; DTOs reflect the
//            multi-channel fan-out shape without carrying provider secrets.
//
// Security assertions at the bottom of this file:
//   - NotificationDto and NotificationPrefsDto MUST NOT carry provider secrets
//     (apiKey, webhookSecret, signingSecret, dltTemplateId) — compile-time asserted.
//   - NotificationStreamEvent MUST NOT carry cross-user data (providerMessageId,
//     recipientPhone, recipientEmail, rawPayload) — compile-time asserted.
//
// Money/dates: dates are ISO-8601 (IsoDateTimeSchema). No money fields here.
// IDs: all UUIDs (UuidSchema). Channels and types as enums (same values as Prisma enums).

import { z } from "zod";
import { UuidSchema, IsoDateTimeSchema } from "../common/primitives.js";

// ─────────────────────────────────────────────────────────────────────────
// Enums (mirroring the Prisma enums added in schema.prisma P6 migration)
// ─────────────────────────────────────────────────────────────────────────

/**
 * The type of notification — identifies which domain event triggered it.
 * Values match the Prisma `NotificationType` enum (P6 migration).
 * `live_reminder` path is wired (LOCK-4: no live-class feature yet; template ready).
 */
export const NotificationTypeSchema = z.enum([
  "grade_ready",
  "certificate_ready",
  "live_reminder",
  "forum_reply",
  "announcement",
  "lead_confirmation",
  "booking_confirmation",
  "payment_receipt",
  "welcome",
]);
export type NotificationType = z.infer<typeof NotificationTypeSchema>;

/**
 * The delivery channel for a notification.
 * Values match the Prisma `NotificationChannel` enum.
 * `in_app` cannot be disabled by the user (AC-7).
 * Push is OUT of P6 (CONFLICT-P6-1) — enum is extensible for a later phase.
 */
export const NotificationChannelSchema = z.enum(["in_app", "email", "sms", "whatsapp"]);
export type NotificationChannel = z.infer<typeof NotificationChannelSchema>;

// ─────────────────────────────────────────────────────────────────────────
// NotificationDto — single in-app notification row (own-scope read)
// Returned by GET /me/notifications and GET /me/notifications/:id.
// ─────────────────────────────────────────────────────────────────────────

/**
 * The per-channel fan-out record stored in `notifications.channels` JSON.
 * Reflects which channels were used and whether each send succeeded.
 * MUST NOT contain provider message IDs, API keys, or external secrets.
 */
export const NotificationChannelsRecordSchema = z.object({
  in_app: z.boolean().describe("Always true — in-app cannot be disabled."),
  email: z.boolean().describe("Whether the email channel was used for this notification."),
  sms: z.boolean().describe("Whether the SMS channel was used."),
  whatsapp: z.boolean().describe("Whether the WhatsApp channel was used."),
}).strict();
export type NotificationChannelsRecord = z.infer<typeof NotificationChannelsRecordSchema>;

/**
 * A single in-app notification row.
 *
 * SECURITY: This DTO is scoped to the authenticated user's OWN notifications.
 * The backend MUST filter on `user_id = currentUser.id` before returning any row.
 * IDOR→404 on any attempt to read another user's notification (AC-5, AC-72).
 *
 * `payload` is a free-form JSON object typed by `type` on the backend.
 * The frontend renders a human-readable message by switching on `type`.
 * MUST NOT carry: provider secrets, API keys, raw suppression-list internals.
 */
export const NotificationDtoSchema = z
  .object({
    id: UuidSchema.describe("Notification row ID."),
    type: NotificationTypeSchema.describe("Notification type — maps to a template for display."),
    /**
     * Per-channel fan-out record. Shows which channels were used.
     * Does NOT carry raw provider message IDs or secrets.
     */
    channels: NotificationChannelsRecordSchema,
    /**
     * Typed payload for rendering the notification text.
     * Keys depend on `type`:
     *   grade_ready:           { submissionId, assignmentTitle, score }
     *   certificate_ready:     { certificateId, programTitle }
     *   forum_reply:           { threadId, postId, threadTitle, authorName }
     *   announcement:          { title, body }
     *   lead_confirmation:     { leadId }
     *   booking_confirmation:  { bookingId, programTitle, slotDate }
     *   payment_receipt:       { orderId, amountPaise, currency }
     *   welcome:               { userName }
     *   live_reminder:         { eventTitle, startsAt }
     * MUST NOT carry: email, phone, providerKey, rawSecret, dltTemplateId.
     */
    payload: z.record(z.string(), z.unknown()).describe("Typed notification payload — keyed by type."),
    /** ISO-8601 datetime when the user marked this notification as read. Null = unread. */
    readAt: IsoDateTimeSchema.nullable().describe("Read timestamp. null = unread."),
    /** ISO-8601 datetime when the notification was created. */
    createdAt: IsoDateTimeSchema.describe("Creation timestamp. Use for sort-by-newest."),
  })
  .strict();
export type NotificationDto = z.infer<typeof NotificationDtoSchema>;

// ─────────────────────────────────────────────────────────────────────────
// ListNotificationsQuery — GET /me/notifications query params
// ─────────────────────────────────────────────────────────────────────────

/**
 * Query parameters for GET /api/v1/me/notifications.
 *
 * Uses cursor pagination (PaginationMetaSchema from common/envelope.ts) as
 * docs/04 §2.14 specifies cursor pagination for large lists. In-app notification
 * lists can grow unbounded per user; cursor pagination avoids offset drift.
 *
 * `unread=true` is the polling fallback signal (LOCK-D3): the LMS client polls
 * this endpoint when SSE is unavailable to maintain the unread badge count.
 */
export const ListNotificationsQuerySchema = z
  .object({
    /** When true, returns only notifications where `readAt` is null. */
    unread: z
      .enum(["true", "false"])
      .optional()
      .transform((v) => v === "true")
      .describe("If 'true', return only unread notifications. Used as the SSE polling fallback."),
    /** Notification type filter. Optional. */
    type: NotificationTypeSchema.optional().describe("Filter by notification type."),
    /** Opaque cursor from the previous page's meta.nextCursor. */
    cursor: z.string().optional().describe("Cursor for the next page (from meta.nextCursor)."),
    /** Items per page. Default 20, max 50. */
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(50)
      .default(20)
      .describe("Items per page, max 50."),
  })
  .strict();
export type ListNotificationsQuery = z.infer<typeof ListNotificationsQuerySchema>;

// ─────────────────────────────────────────────────────────────────────────
// MarkReadDto — POST /me/notifications/:id/read body (empty action body)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Body for POST /api/v1/me/notifications/:id/read.
 *
 * Action endpoint — no body fields required. The notification ID comes from
 * the path param; own-scope is enforced by the RBAC guard (IDOR→404, AC-5).
 * Idempotent: marking an already-read notification as read is a no-op.
 */
export const MarkReadDtoSchema = z.object({}).strict();
export type MarkReadDto = z.infer<typeof MarkReadDtoSchema>;

/**
 * Response for POST /me/notifications/:id/read and POST /me/notifications/read-all.
 * Returns the updated count of remaining unread notifications for the badge update.
 */
export const MarkReadResponseSchema = z
  .object({
    /** Remaining unread count for the current user after the mark-read operation. */
    unreadCount: z
      .number()
      .int()
      .min(0)
      .describe("Remaining unread notification count after this operation."),
  })
  .strict();
export type MarkReadResponse = z.infer<typeof MarkReadResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────
// NotificationPrefsDto — GET/PUT /me/notification-prefs
// ─────────────────────────────────────────────────────────────────────────

/**
 * Quiet hours configuration for a user's notification preferences.
 * When set, non-urgent channels (email, SMS, WhatsApp) are deferred
 * outside the user's active window. In-app always fires immediately (AC-9).
 *
 * `start` and `end` are "HH:mm" 24-hour strings in the user's timezone.
 * The service evaluates `current_time_in_tz` against [start, end) to decide
 * whether to defer. Midnight-spanning windows (e.g. 22:00–07:00) are handled
 * by comparing modularly (AC-9, edge cases in docs/specs Part 4 WS-1).
 */
export const QuietHoursSchema = z
  .object({
    /** 24-hour time string "HH:mm" — start of the quiet window (inclusive). */
    start: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "must be HH:mm in 24-hour format")
      .describe("Start of quiet hours (inclusive), e.g. '22:00'."),
    /** 24-hour time string "HH:mm" — end of the quiet window (inclusive per AC-9 boundary). */
    end: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "must be HH:mm in 24-hour format")
      .describe("End of quiet hours (inclusive), e.g. '07:00'."),
    /** IANA timezone identifier, e.g. 'Asia/Kolkata'. */
    tz: z
      .string()
      .min(1)
      .max(64)
      .describe("IANA timezone string, e.g. 'Asia/Kolkata'. Used to evaluate local time."),
  })
  .strict();
export type QuietHours = z.infer<typeof QuietHoursSchema>;

/**
 * A single cell in the type×channel matrix: whether a given notification type
 * should be delivered via a given channel for this user.
 *
 * The matrix is stored as a JSON object on `notification_prefs.matrix`.
 * Example:
 *   { grade_ready: { in_app: true, email: true, sms: false, whatsapp: false } }
 *
 * `in_app` cannot be false (the backend enforces in-app is always on, AC-7).
 */
export const ChannelPrefsSchema = z
  .object({
    in_app: z.literal(true).describe("In-app is always enabled and cannot be disabled."),
    email: z.boolean(),
    sms: z.boolean(),
    whatsapp: z.boolean(),
  })
  .strict();
export type ChannelPrefs = z.infer<typeof ChannelPrefsSchema>;

/**
 * The full notification preferences matrix for a user.
 * Each `NotificationType` key maps to a `ChannelPrefs` object.
 * On PUT, the backend upserts the `notification_prefs` row (AC-19).
 * On GET, the backend returns system defaults if no row exists (AC-18).
 */
export const NotificationPrefMatrixSchema = z
  .object({
    grade_ready: ChannelPrefsSchema.optional(),
    certificate_ready: ChannelPrefsSchema.optional(),
    live_reminder: ChannelPrefsSchema.optional(),
    forum_reply: ChannelPrefsSchema.optional(),
    announcement: ChannelPrefsSchema.optional(),
    lead_confirmation: ChannelPrefsSchema.optional(),
    booking_confirmation: ChannelPrefsSchema.optional(),
    payment_receipt: ChannelPrefsSchema.optional(),
    welcome: ChannelPrefsSchema.optional(),
  })
  .strict();
export type NotificationPrefMatrix = z.infer<typeof NotificationPrefMatrixSchema>;

/**
 * Input DTO for PUT /api/v1/me/notification-prefs.
 * All fields are optional — a partial update replaces only the supplied keys.
 * The backend upserts the row; missing keys retain their current/default value.
 *
 * Own-scope enforced by guard: the user can only update their OWN prefs (AC-20).
 * Audit-log entry written on every successful PUT (AC-19, docs/phase-6.md DoD).
 *
 * SECURITY: This DTO MUST NOT accept userId as a client-supplied field.
 * The userId is always derived from the authenticated session — never trusted from body.
 */
export const NotificationPrefsDtoSchema = z
  .object({
    /** Partial type×channel matrix. Absent keys retain their current or default value. */
    matrix: NotificationPrefMatrixSchema.optional(),
    /**
     * Quiet hours configuration. Set to null to remove quiet hours.
     * When null/absent from PUT body, quiet hours are unchanged.
     */
    quietHours: QuietHoursSchema.nullable().optional(),
    /**
     * Leaderboard opt-in flag. Stored on the user's gamification prefs.
     * When true, the student appears on the batch leaderboard with their displayName.
     * LOCK-D5: leaderboard is opt-in; no PII on the leaderboard endpoint.
     */
    leaderboardOptIn: z
      .boolean()
      .optional()
      .describe("Whether this user opts into the batch leaderboard. Default: false."),
    /**
     * Display name or alias for the leaderboard. Used instead of the real name when
     * the student opts in. If null, the system uses the student's first name only.
     * LOCK-D5: the leaderboard NEVER shows email, phone, or enrollment ID.
     */
    leaderboardDisplayName: z
      .string()
      .min(1)
      .max(64)
      .nullable()
      .optional()
      .describe("Alias shown on the leaderboard. Null = use first name only."),
  })
  .strict();
export type NotificationPrefsDto = z.infer<typeof NotificationPrefsDtoSchema>;

/**
 * Full notification preferences response (GET /me/notification-prefs).
 * Includes the resolved matrix + quiet hours + leaderboard prefs.
 * On no row: system defaults are returned (not a 404) per AC-18.
 */
export const NotificationPrefsResponseSchema = z
  .object({
    matrix: NotificationPrefMatrixSchema,
    quietHours: QuietHoursSchema.nullable(),
    leaderboardOptIn: z.boolean(),
    leaderboardDisplayName: z.string().nullable(),
    updatedAt: IsoDateTimeSchema.nullable().describe("When the prefs row was last updated. Null if defaults."),
  })
  .strict();
export type NotificationPrefsResponse = z.infer<typeof NotificationPrefsResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────
// NotificationStreamEvent — SSE event shape for GET /me/notifications/stream
// ─────────────────────────────────────────────────────────────────────────

/**
 * The payload emitted on the Server-Sent-Events stream.
 * GET /api/v1/me/notifications/stream — authenticated, own-scoped (AC-14, AC-15).
 *
 * Each SSE message is `event: notification` with `data:` containing the JSON
 * serialisation of this type. The client uses this to:
 *   1. Increment the unread badge count.
 *   2. Show a toast with `type` + a human-readable render of `payload`.
 *   3. Optionally prepend the notification to the in-app list without a re-fetch.
 *
 * LOCK-D3: The SSE stream is the primary real-time mechanism. The polling fallback
 * (`GET /me/notifications?unread=true`) uses `NotificationDto` and carries the same data.
 *
 * SECURITY (compile-time asserted below):
 *   - MUST NOT carry `providerMessageId`, `recipientEmail`, `recipientPhone`.
 *   - MUST NOT carry any inter-user data (only the authenticated user's own data is streamed).
 *   - The stream endpoint REJECTS unauthenticated requests with 401 before opening (AC-15).
 */
export const NotificationStreamEventSchema = z
  .object({
    /** The SSE event sub-type. Always "notification" for new-notification events. */
    event: z.literal("notification"),
    /** The new notification — same shape as NotificationDto. */
    data: NotificationDtoSchema,
  })
  .strict();
export type NotificationStreamEvent = z.infer<typeof NotificationStreamEventSchema>;

/**
 * SSE event for unread-count updates (emitted without a full notification payload).
 * The client uses this to update the badge after mark-all-read.
 */
export const UnreadCountEventSchema = z
  .object({
    event: z.literal("unread_count"),
    data: z.object({ unreadCount: z.number().int().min(0) }).strict(),
  })
  .strict();
export type UnreadCountEvent = z.infer<typeof UnreadCountEventSchema>;

// ─────────────────────────────────────────────────────────────────────────
// UnsubscribeDto — POST /api/v1/unsubscribe/:token (public, no auth)
// ─────────────────────────────────────────────────────────────────────────

/**
 * The signed unsubscribe token is passed as a URL path parameter (not in the body).
 * The service derives: HMAC(NOTIFICATION_SIGNING_SECRET, userId + channel + nonce)
 * and compares; on mismatch → 400 INVALID_TOKEN (AC-24).
 *
 * This DTO is the query-param/body shape for the unsubscribe confirmation page.
 * The actual token is in the path: GET /unsubscribe/:token (preview page)
 * and POST /unsubscribe/:token (submit confirmation).
 *
 * AC-21: The token MUST NOT be directly decodable to user_id or email without
 * the signing secret (NOTIFICATION_SIGNING_SECRET — env-only, never in response).
 * AC-22: On valid token → NotificationSuppression row created; response 200 + message.
 * AC-77: Raw user_id and email are NOT recoverable from the URL without HMAC key.
 *
 * Public endpoint — no cookieAuth, no CSRF (unauthenticated, AC-22).
 */
export const UnsubscribeDtoSchema = z.object({}).strict();
export type UnsubscribeDto = z.infer<typeof UnsubscribeDtoSchema>;

/**
 * Response for a valid unsubscribe action.
 * Minimal — no PII, no user details, no channel internals.
 */
export const UnsubscribeResponseSchema = z
  .object({
    message: z
      .string()
      .describe("User-facing confirmation message, e.g. 'You have been unsubscribed.'"),
    channel: NotificationChannelSchema.describe(
      "The channel that was unsubscribed. Shown in the confirmation UI.",
    ),
  })
  .strict();
export type UnsubscribeResponse = z.infer<typeof UnsubscribeResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Compile-time type assertions — no provider secret in any notification DTO
//
// Hard requirement (docs/plans/phase-6.md task #2, docs/specs AC-76):
//   - NotificationDto MUST NOT contain provider secrets or raw suppression internals.
//   - NotificationStreamEvent MUST NOT carry cross-user signals.
//   - NotificationPrefsDto MUST NOT carry userId (own-scope — session-derived).
// ─────────────────────────────────────────────────────────────────────────

/** Fields that must NEVER appear in any notification-facing DTO. */
type ForbiddenNotificationField =
  | "apiKey"
  | "webhookSecret"
  | "signingSecret"
  | "dltTemplateId"
  | "providerMessageId"
  | "recipientEmail"
  | "recipientPhone"
  | "rawSecret"
  | "msgAuthKey"
  | "resendApiKey"
  | "whatsappAccessToken";

type AssertNoForbiddenFields<T, ForbiddenKeys extends string> = [
  ForbiddenKeys extends keyof T ? "FORBIDDEN FIELD DETECTED" : "ok",
] extends ["ok"]
  ? true
  : never;

// These must all evaluate to `true`. A `never` → compile error → security bug caught.
type _AssertNotificationDtoNoSecret = AssertNoForbiddenFields<
  NotificationDto,
  ForbiddenNotificationField
>;
type _AssertStreamEventNoSecret = AssertNoForbiddenFields<
  NotificationStreamEvent,
  ForbiddenNotificationField
>;
type _AssertPrefsDtoNoUserId = AssertNoForbiddenFields<NotificationPrefsDto, "userId">;
type _AssertUnsubscribeResponseNoSecret = AssertNoForbiddenFields<
  UnsubscribeResponse,
  ForbiddenNotificationField
>;

const _assertNotifDto: _AssertNotificationDtoNoSecret = true;
const _assertStreamEvent: _AssertStreamEventNoSecret = true;
const _assertPrefsDto: _AssertPrefsDtoNoUserId = true;
const _assertUnsubscribeResp: _AssertUnsubscribeResponseNoSecret = true;

export type {
  _AssertNotificationDtoNoSecret,
  _AssertStreamEventNoSecret,
  _AssertPrefsDtoNoUserId,
  _AssertUnsubscribeResponseNoSecret,
};
void _assertNotifDto;
void _assertStreamEvent;
void _assertPrefsDto;
void _assertUnsubscribeResp;
