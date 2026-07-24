// apps/api/src/modules/notifications/dispatch/quiet-hours.helper.spec.ts
//
// Unit tests for the quiet-hours defer helper.
// (docs/plans/phase-6.md task #4; docs/specs/phase-6-engagement.md AC-9/AC-10/Part 4)
//
// Covers:
//   - AC-9:  Non-urgent notifications during quiet window → defer=true
//   - AC-10: Urgent notifications during quiet window → defer=false (bypass)
//   - Boundary cases: start inclusive, end inclusive (send), midnight-spanning
//   - Timezone evaluation in user's configured tz
//   - null/undefined quiet hours → always send
//   - in_app channel: never defers (always send)
//   - All URGENT_NOTIFICATION_TYPES bypass quiet hours
//   - Invalid timezone → treated as no quiet hours (send now)

import {
  isInQuietHours,
  URGENT_NOTIFICATION_TYPES,
  parseHHmm,
  getLocalMinutesOfDay,
  isTimeInWindow,
} from "./quiet-hours.helper";
import type { QuietHours } from "@repo/types";

// ─────────────────────────────────────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a Date that corresponds to a given HH:mm time in Asia/Kolkata.
 * IST = UTC+5:30 (no DST), so we can calculate precisely.
 * Format: YYYY-MM-DDTHH:mm:ss.sssZ
 */
function makeIstTime(hhmm: string, date: string = "2026-01-15"): Date {
  const [hh, mm] = hhmm.split(":").map(Number);
  // IST is UTC+5:30; to get a Date representing hh:mm IST, subtract 5h30m from the target local time.
  const utcHour = (hh! - 5 + 24) % 24;
  const utcMinute = (mm! - 30 + 60) % 60;
  const dayAdjust = hh! < 5 || (hh! === 5 && mm! < 30) ? -1 : 0;
  const d = new Date(`${date}T${String(utcHour).padStart(2, "0")}:${String(utcMinute).padStart(2, "0")}:00.000Z`);
  if (dayAdjust < 0) {
    d.setUTCDate(d.getUTCDate() + dayAdjust);
  }
  return d;
}

const IST_QUIET: QuietHours = { start: "22:00", end: "07:00", tz: "Asia/Kolkata" };

// ─────────────────────────────────────────────────────────────────────────────
// parseHHmm
// ─────────────────────────────────────────────────────────────────────────────

describe("parseHHmm", () => {
  it("parses valid 24-hour time strings", () => {
    expect(parseHHmm("22:00")).toBe(1320);
    expect(parseHHmm("07:00")).toBe(420);
    expect(parseHHmm("00:00")).toBe(0);
    expect(parseHHmm("23:59")).toBe(1439);
    expect(parseHHmm("12:30")).toBe(750);
  });

  it("returns null for invalid formats", () => {
    expect(parseHHmm("24:00")).toBeNull();
    expect(parseHHmm("22:60")).toBeNull();
    expect(parseHHmm("invalid")).toBeNull();
    expect(parseHHmm("")).toBeNull();
    expect(parseHHmm("7:00")).toBeNull(); // must be HH:mm
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// isTimeInWindow
// ─────────────────────────────────────────────────────────────────────────────

describe("isTimeInWindow", () => {
  // Non-midnight-spanning window: 09:00–18:00
  describe("same-day window [09:00, 18:00)", () => {
    const start = 9 * 60; // 540
    const end = 18 * 60; // 1080

    it("inside the window → true", () => {
      expect(isTimeInWindow(600, start, end)).toBe(true);  // 10:00
      expect(isTimeInWindow(540, start, end)).toBe(true);  // 09:00 (start inclusive)
      expect(isTimeInWindow(1079, start, end)).toBe(true); // 17:59
    });

    it("at end boundary → false (end is inclusive = NOT in window)", () => {
      // AC-9 Part 4: "end is inclusive — treat end as 'now exiting quiet'; send"
      expect(isTimeInWindow(1080, start, end)).toBe(false); // 18:00 exactly → outside
    });

    it("before start → false", () => {
      expect(isTimeInWindow(0, start, end)).toBe(false);   // 00:00
      expect(isTimeInWindow(539, start, end)).toBe(false); // 08:59
    });

    it("after end → false", () => {
      expect(isTimeInWindow(1081, start, end)).toBe(false); // 18:01
      expect(isTimeInWindow(1439, start, end)).toBe(false); // 23:59
    });
  });

  // Midnight-spanning window: 22:00–07:00
  describe("midnight-spanning window [22:00, 07:00)", () => {
    const start = 22 * 60; // 1320
    const end = 7 * 60;    // 420

    it("before midnight (23:30) → true (in quiet window)", () => {
      expect(isTimeInWindow(23 * 60 + 30, start, end)).toBe(true);
    });

    it("at start (22:00) → true (start inclusive)", () => {
      expect(isTimeInWindow(1320, start, end)).toBe(true);
    });

    it("after midnight (03:00) → true (in quiet window)", () => {
      expect(isTimeInWindow(3 * 60, start, end)).toBe(true);
    });

    it("at end (07:00) → false (end is inclusive = exiting quiet)", () => {
      expect(isTimeInWindow(420, start, end)).toBe(false);
    });

    it("midday (12:00) → false (outside quiet window)", () => {
      expect(isTimeInWindow(12 * 60, start, end)).toBe(false);
    });

    it("just before start (21:59) → false", () => {
      expect(isTimeInWindow(21 * 60 + 59, start, end)).toBe(false);
    });

    it("just before end (06:59) → true", () => {
      expect(isTimeInWindow(6 * 60 + 59, start, end)).toBe(true);
    });
  });

  // Degenerate: start === end → never in window
  it("start === end → never in window", () => {
    expect(isTimeInWindow(600, 600, 600)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getLocalMinutesOfDay
// ─────────────────────────────────────────────────────────────────────────────

describe("getLocalMinutesOfDay", () => {
  it("returns correct minutes for Asia/Kolkata", () => {
    // 2026-01-15T23:30:00 IST = 2026-01-15T18:00:00 UTC
    const date = new Date("2026-01-15T18:00:00.000Z");
    const minutes = getLocalMinutesOfDay(date, "Asia/Kolkata");
    expect(minutes).toBe(23 * 60 + 30); // 23:30 → 1410 minutes
  });

  it("returns correct minutes for UTC", () => {
    const date = new Date("2026-01-15T14:00:00.000Z");
    const minutes = getLocalMinutesOfDay(date, "UTC");
    expect(minutes).toBe(14 * 60); // 14:00 → 840 minutes
  });

  it("throws for invalid timezone", () => {
    const date = new Date();
    expect(() => getLocalMinutesOfDay(date, "Invalid/Timezone")).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// isInQuietHours — main function
// ─────────────────────────────────────────────────────────────────────────────

describe("isInQuietHours", () => {

  // ─── Rule 1: No quiet hours → never defer ────────────────────────────────

  describe("no quiet hours configured", () => {
    it("null quietHours → defer=false", () => {
      const result = isInQuietHours({
        quietHours: null,
        notificationType: "announcement",
        channel: "email",
        now: new Date(),
      });
      expect(result.defer).toBe(false);
    });

    it("undefined quietHours → defer=false", () => {
      const result = isInQuietHours({
        quietHours: undefined,
        notificationType: "grade_ready",
        channel: "sms",
        now: new Date(),
      });
      expect(result.defer).toBe(false);
    });
  });

  // ─── Rule 2: Urgent types bypass quiet hours (AC-10) ─────────────────────

  describe("urgent notification types bypass quiet hours", () => {
    // 23:30 IST = well inside 22:00–07:00 IST window
    const nowInQuiet = makeIstTime("23:30");

    it("certificate_ready during quiet hours → defer=false (urgent bypass)", () => {
      const result = isInQuietHours({
        quietHours: IST_QUIET,
        notificationType: "certificate_ready",
        channel: "email",
        now: nowInQuiet,
      });
      expect(result.defer).toBe(false);
    });

    it("payment_receipt during quiet hours → defer=false (urgent bypass)", () => {
      const result = isInQuietHours({
        quietHours: IST_QUIET,
        notificationType: "payment_receipt",
        channel: "whatsapp",
        now: nowInQuiet,
      });
      expect(result.defer).toBe(false);
    });

    it("URGENT_NOTIFICATION_TYPES contains the expected types", () => {
      expect(URGENT_NOTIFICATION_TYPES.has("certificate_ready")).toBe(true);
      expect(URGENT_NOTIFICATION_TYPES.has("payment_receipt")).toBe(true);
    });

    it("non-urgent types are NOT in URGENT_NOTIFICATION_TYPES", () => {
      expect(URGENT_NOTIFICATION_TYPES.has("announcement")).toBe(false);
      expect(URGENT_NOTIFICATION_TYPES.has("grade_ready")).toBe(false);
      expect(URGENT_NOTIFICATION_TYPES.has("forum_reply")).toBe(false);
      expect(URGENT_NOTIFICATION_TYPES.has("welcome")).toBe(false);
    });
  });

  // ─── Rule 3a: in_app channel never defers (AC-7, AC-9) ───────────────────

  describe("in_app channel", () => {
    const nowInQuiet = makeIstTime("23:30");

    it("in_app during quiet hours → defer=false (AC-7: in-app always on)", () => {
      const result = isInQuietHours({
        quietHours: IST_QUIET,
        notificationType: "announcement",
        channel: "in_app",
        now: nowInQuiet,
      });
      expect(result.defer).toBe(false);
    });

    it("in_app urgent type during quiet hours → defer=false", () => {
      const result = isInQuietHours({
        quietHours: IST_QUIET,
        notificationType: "certificate_ready",
        channel: "in_app",
        now: nowInQuiet,
      });
      expect(result.defer).toBe(false);
    });
  });

  // ─── Rule 3b: Non-urgent, non-in_app during quiet hours → defer (AC-9) ──

  describe("non-urgent external channels during quiet hours", () => {
    // 23:30 IST = inside 22:00–07:00 window
    const nowInQuiet = makeIstTime("23:30");

    it("announcement email at 23:30 IST → defer=true", () => {
      const result = isInQuietHours({
        quietHours: IST_QUIET,
        notificationType: "announcement",
        channel: "email",
        now: nowInQuiet,
      });
      expect(result.defer).toBe(true);
      expect(result.deferUntil).toBeInstanceOf(Date);
    });

    it("grade_ready sms at 23:30 IST → defer=true", () => {
      const result = isInQuietHours({
        quietHours: IST_QUIET,
        notificationType: "grade_ready",
        channel: "sms",
        now: nowInQuiet,
      });
      expect(result.defer).toBe(true);
    });

    it("forum_reply whatsapp at 23:30 IST → defer=true", () => {
      const result = isInQuietHours({
        quietHours: IST_QUIET,
        notificationType: "forum_reply",
        channel: "whatsapp",
        now: nowInQuiet,
      });
      expect(result.defer).toBe(true);
    });

    it("deferUntil is after now", () => {
      const result = isInQuietHours({
        quietHours: IST_QUIET,
        notificationType: "announcement",
        channel: "email",
        now: nowInQuiet,
      });
      expect(result.defer).toBe(true);
      expect(result.deferUntil!.getTime()).toBeGreaterThan(nowInQuiet.getTime());
    });
  });

  // ─── Rule 4: Outside quiet window → send now ─────────────────────────────

  describe("outside quiet window", () => {
    // 12:00 IST = noon, well outside 22:00–07:00
    const nowOutside = makeIstTime("12:00");

    it("announcement email at 12:00 IST → defer=false", () => {
      const result = isInQuietHours({
        quietHours: IST_QUIET,
        notificationType: "announcement",
        channel: "email",
        now: nowOutside,
      });
      expect(result.defer).toBe(false);
    });
  });

  // ─── Boundary cases (AC-9 Part 4 edge cases) ─────────────────────────────

  describe("boundary cases", () => {
    it("at start boundary (22:00 IST) → defer=true (start is inclusive)", () => {
      const nowAtStart = makeIstTime("22:00");
      const result = isInQuietHours({
        quietHours: IST_QUIET,
        notificationType: "announcement",
        channel: "email",
        now: nowAtStart,
      });
      expect(result.defer).toBe(true);
    });

    it("at end boundary (07:00 IST) → defer=false (end is inclusive = exiting)", () => {
      const nowAtEnd = makeIstTime("07:00");
      const result = isInQuietHours({
        quietHours: IST_QUIET,
        notificationType: "announcement",
        channel: "email",
        now: nowAtEnd,
      });
      expect(result.defer).toBe(false);
    });

    it("just after midnight (00:30 IST) → defer=true (inside midnight-spanning window)", () => {
      const nowAfterMidnight = makeIstTime("00:30");
      const result = isInQuietHours({
        quietHours: IST_QUIET,
        notificationType: "grade_ready",
        channel: "email",
        now: nowAfterMidnight,
      });
      expect(result.defer).toBe(true);
    });

    it("UTC timezone quiet hours work correctly", () => {
      const utcQuiet: QuietHours = { start: "22:00", end: "07:00", tz: "UTC" };
      // 23:00 UTC = inside the window
      const now = new Date("2026-01-15T23:00:00.000Z");
      const result = isInQuietHours({
        quietHours: utcQuiet,
        notificationType: "announcement",
        channel: "email",
        now,
      });
      expect(result.defer).toBe(true);
    });

    it("invalid timezone → send now (safe fallback)", () => {
      const badQuiet: QuietHours = { start: "22:00", end: "07:00", tz: "Invalid/Zone" };
      const result = isInQuietHours({
        quietHours: badQuiet,
        notificationType: "announcement",
        channel: "email",
        now: new Date(),
      });
      // Invalid timezone → treated as no quiet hours → send now (defer=false).
      expect(result.defer).toBe(false);
    });
  });

  // ─── All channels are checked correctly ───────────────────────────────────

  describe("all non-in_app channels defer during quiet hours", () => {
    const nowInQuiet = makeIstTime("23:30");
    const channels: Array<"email" | "sms" | "whatsapp"> = ["email", "sms", "whatsapp"];

    for (const channel of channels) {
      it(`${channel} channel defers during quiet hours`, () => {
        const result = isInQuietHours({
          quietHours: IST_QUIET,
          notificationType: "announcement",
          channel,
          now: nowInQuiet,
        });
        expect(result.defer).toBe(true);
      });
    }
  });
});
