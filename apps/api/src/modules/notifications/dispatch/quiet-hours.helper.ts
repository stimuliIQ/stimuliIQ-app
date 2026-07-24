// apps/api/src/modules/notifications/dispatch/quiet-hours.helper.ts
//
// Quiet-hours defer helper — pure, unit-testable, zero dependencies.
// (docs/specs/phase-6-engagement.md AC-9/AC-10; docs/plans/phase-6.md task #4)
//
// PURPOSE:
//   Given a user's quiet_hours {start, end, tz} and a notification type, determines
//   whether the send should be deferred (held until the quiet window exits) or sent now.
//
//   Rules (from AC-9/AC-10/Part 4 edge cases in docs/specs/phase-6-engagement.md):
//     1. If no quiet hours are configured (quietHours = null/undefined), always send now.
//     2. If the notification type is URGENT (in URGENT_NOTIFICATION_TYPES), always send now,
//        regardless of quiet hours. (AC-10: "urgent overrides quiet hours.")
//     3. If the current time in the user's timezone falls in [start, end):
//          - 'in_app' channel: ALWAYS send now (in-app cannot be deferred — AC-7, AC-9).
//          - Other channels (email, sms, whatsapp): DEFER.
//     4. If the current time is at or after `end` (i.e., outside the quiet window): send now.
//
// URGENCY:
//   Urgency is a STATIC PROPERTY of the notification type — determined by a config constant
//   (URGENT_NOTIFICATION_TYPES below). This resolves the AC-10 open question by the PM spec.
//   No DB column is added; the static config governs urgency. To mark a type urgent, add it
//   to URGENT_NOTIFICATION_TYPES.
//
// BOUNDARY CASES (AC-9 Part 4 "Edge Cases"):
//   - start === current time: INSIDE quiet window (start is inclusive; defer non-urgent).
//   - end === current time: OUTSIDE quiet window (end is inclusive — "now exiting quiet"; send).
//   - Midnight-spanning window (e.g. 22:00–07:00): handled by modular arithmetic.
//     If start > end (wraps midnight), the window is: [start, 24:00) ∪ [00:00, end).
//   - quietHours.tz is an invalid IANA timezone: treated as "no quiet hours" (send now),
//     logged as a warning.
//
// NOTE ON DEFERRED SENDS:
//   The current sync-seam adapter returns { defer: true, deferUntil: Date } but does NOT
//   actually delay the send (there is no task scheduler in sync mode). The caller
//   (NotificationService) MUST:
//     - Store the notification in-app (in_app channel always sends now).
//     - For deferred channels: record the desired delivery time in the dispatch job or
//       skip the external send (and rely on a future scheduled task to retry).
//   With BullMQ: the adapter schedules the job with a delay calculated from deferUntil.
//
// EXPORTS:
//   - URGENT_NOTIFICATION_TYPES    — Set of NotificationType values that bypass quiet hours.
//   - isInQuietHours()             — pure function, returns { defer, deferUntil }.
//   - QuietHours                   — re-exported type from @repo/types for convenience.

import type { NotificationType, QuietHours } from "@repo/types";

// ─────────────────────────────────────────────────────────────────────────────
// URGENT_NOTIFICATION_TYPES
//
// Notification types that bypass quiet hours and are always sent immediately.
// Urgency is a STATIC property of the type (no DB column needed).
//
// LOCATION: this is the authoritative definition. Import from here in:
//   - NotificationService (fan-out loop)
//   - CampaignService (transactional sends have no urgency concept; campaigns are never urgent)
//
// To make a type urgent: add it to this constant and document the reason.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Notification types that are always dispatched immediately, even during quiet hours.
 * (docs/plans/phase-6.md task #4, AC-10)
 *
 * Rationale per type:
 *   certificate_ready — achievement notification; students want to share immediately.
 *     Deferred cert notifications could arrive hours after the student has already
 *     shared from the LMS; urgency ensures the notification channel fires at cert time.
 *   payment_receipt   — financial transaction confirmation; regulatorily expected promptly.
 */
export const URGENT_NOTIFICATION_TYPES = new Set<NotificationType>([
  "certificate_ready",
  "payment_receipt",
]);

// ─────────────────────────────────────────────────────────────────────────────
// Result type
// ─────────────────────────────────────────────────────────────────────────────

export interface QuietHoursResult {
  /**
   * True → the send should be deferred.
   * The channel is in the quiet window and the notification type is not urgent.
   */
  defer: boolean;
  /**
   * The Date at which the quiet window exits (i.e., when to send).
   * Only meaningful when defer=true.
   * Callers use this to schedule a delayed send.
   */
  deferUntil?: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main pure function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Determines whether a notification should be deferred based on quiet hours.
 *
 * @param params.quietHours - The user's quiet hours config (null/undefined = no quiet hours).
 * @param params.notificationType - The type of notification being sent.
 * @param params.channel - The delivery channel ('in_app' never defers).
 * @param params.now - The current time (injectable for testing; defaults to new Date()).
 * @returns QuietHoursResult { defer, deferUntil }
 */
export function isInQuietHours(params: {
  quietHours: QuietHours | null | undefined;
  notificationType: NotificationType;
  channel: "in_app" | "email" | "sms" | "whatsapp";
  now?: Date;
}): QuietHoursResult {
  const { quietHours, notificationType, channel } = params;
  const now = params.now ?? new Date();

  // Rule 1: No quiet hours configured → always send now.
  if (!quietHours) {
    return { defer: false };
  }

  // Rule 2: Urgent notification type → always send now (AC-10).
  if (URGENT_NOTIFICATION_TYPES.has(notificationType)) {
    return { defer: false };
  }

  // Rule 3: in_app channel always fires immediately (AC-7, AC-9).
  if (channel === "in_app") {
    return { defer: false };
  }

  // ─── Evaluate current time in user's timezone ──────────────────────────
  let localMinutes: number;
  try {
    localMinutes = getLocalMinutesOfDay(now, quietHours.tz);
  } catch {
    // Invalid timezone string → treat as no quiet hours, log warning.
    // (caller logs; this function is pure so we return send-now without side effects)
    return { defer: false };
  }

  const startMinutes = parseHHmm(quietHours.start);
  const endMinutes = parseHHmm(quietHours.end);

  if (startMinutes === null || endMinutes === null) {
    // Malformed time strings → no quiet hours.
    return { defer: false };
  }

  const inQuiet = isTimeInWindow(localMinutes, startMinutes, endMinutes);

  if (!inQuiet) {
    return { defer: false };
  }

  // ─── Compute deferUntil (the next time the quiet window exits) ─────────
  const deferUntil = computeDeferUntil(now, quietHours.tz, endMinutes);
  return { defer: true, deferUntil };
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parses "HH:mm" to total minutes since midnight.
 * Returns null on invalid format.
 */
export function parseHHmm(hhmm: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (!match) return null;
  const h = parseInt(match[1]!, 10);
  const m = parseInt(match[2]!, 10);
  return h * 60 + m;
}

/**
 * Returns the current time in a given IANA timezone as total minutes since midnight.
 * Throws if the timezone string is invalid.
 */
export function getLocalMinutesOfDay(date: Date, tz: string): number {
  // Use Intl.DateTimeFormat to extract local time parts in the given timezone.
  // This handles DST, UTC offsets, and all IANA identifiers.
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, // throws RangeError if invalid
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  // Intl returns 24 for midnight in "24h" mode on some engines; normalise to 0.
  const normHour = hour === 24 ? 0 : hour;
  return normHour * 60 + minute;
}

/**
 * Determines whether `currentMinutes` falls inside the quiet window [start, end).
 *
 * Boundary semantics (AC-9 Part 4):
 *   start is inclusive  (currentMinutes === start → inside quiet window → defer).
 *   end   is inclusive  (currentMinutes === end   → outside quiet window → send).
 *
 * Midnight-spanning windows (e.g. start=1320=22:00, end=420=07:00):
 *   Window wraps midnight. A time is in the window if:
 *     currentMinutes >= start  OR  currentMinutes < end
 *
 * Non-spanning windows (e.g. start=60=01:00, end=540=09:00):
 *   currentMinutes >= start  AND  currentMinutes < end
 */
export function isTimeInWindow(
  currentMinutes: number,
  startMinutes: number,
  endMinutes: number,
): boolean {
  if (startMinutes < endMinutes) {
    // Same-day window: [start, end)
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }

  if (startMinutes > endMinutes) {
    // Midnight-spanning window: [start, 1440) ∪ [0, end)
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }

  // start === end: degenerate window (zero duration) → never quiet.
  return false;
}

/**
 * Computes the next Date at which the quiet window ends (i.e., endMinutes in user's TZ).
 * If `endMinutes` has already passed today in the user's timezone, computes tomorrow's end.
 *
 * Used as deferUntil so callers (or BullMQ) know when to retry the send.
 */
function computeDeferUntil(now: Date, tz: string, endMinutes: number): Date {
  try {
    // Get current local date parts.
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = fmt.formatToParts(now);
    const year = parseInt(parts.find((p) => p.type === "year")?.value ?? "2000", 10);
    const month = parseInt(parts.find((p) => p.type === "month")?.value ?? "1", 10) - 1;
    const day = parseInt(parts.find((p) => p.type === "day")?.value ?? "1", 10);

    // Build a candidate UTC date for the quiet-hours end today in the user's timezone.
    // We use a trick: build the local date string and parse via Date.
    // Format: "YYYY-MM-DDTHH:mm" in local timezone is not directly parseable without
    // knowing the UTC offset. Instead, we binary-search or use a stable approach.
    //
    // APPROACH: Construct the date by adding/subtracting from `now`.
    const localCurrentMinutes = getLocalMinutesOfDay(now, tz);
    let minutesDelta = endMinutes - localCurrentMinutes;
    if (minutesDelta <= 0) {
      // end has already passed today — aim for tomorrow
      minutesDelta += 24 * 60;
    }

    void year; void month; void day; // used for documentation context above

    const deferUntil = new Date(now.getTime() + minutesDelta * 60 * 1000);
    return deferUntil;
  } catch {
    // Fallback: 8 hours from now.
    return new Date(now.getTime() + 8 * 60 * 60 * 1000);
  }
}
