// Tests for the shared leave-duration calculation.
//
// This function is the single authority both the CRM apply form and the NestJS service run,
// so these cases ARE the specification of "how long is this leave". Anything that changes
// an expected number here changes what somebody's balance is charged.
//
// Dates are chosen deliberately: 2026-08-17 is a Monday, so a Mon–Fri range is 17th–21st
// and the following Sunday is the 23rd.

import { describe, expect, it } from "vitest";

import {
  MAX_LEAVE_RANGE_DAYS,
  computeLeaveDuration,
  formatLeaveDays,
  type LeaveDurationInput,
} from "./leave.schemas.js";

/** Sunday off, no holidays, half-days permitted — the shape the seed ships. */
function baseInput(overrides: Partial<LeaveDurationInput> = {}): LeaveDurationInput {
  return {
    startDate: "2026-08-17",
    endDate: "2026-08-17",
    startDayPart: "full",
    endDayPart: "full",
    weeklyOffDays: [0],
    holidayDates: [],
    ...overrides,
  };
}

describe("computeLeaveDuration", () => {
  describe("whole days", () => {
    it("counts a single full working day as 2 half-days", () => {
      const result = computeLeaveDuration(baseInput());
      expect(result.halfDays).toBe(2);
      expect(result.days).toBe(1);
      expect(result.workingDates).toEqual(["2026-08-17"]);
      expect(result.issues).toEqual([]);
    });

    it("counts Monday to Friday as 5 days", () => {
      const result = computeLeaveDuration(baseInput({ startDate: "2026-08-17", endDate: "2026-08-21" }));
      expect(result.days).toBe(5);
      expect(result.halfDays).toBe(10);
    });

    it("skips the Sunday inside a range", () => {
      // Mon 17th → Mon 24th is 8 calendar days, one of which (the 23rd) is a Sunday.
      const result = computeLeaveDuration(baseInput({ startDate: "2026-08-17", endDate: "2026-08-24" }));
      expect(result.days).toBe(7);
      expect(result.workingDates).not.toContain("2026-08-23");
    });

    it("honours a multi-day weekly off", () => {
      const result = computeLeaveDuration(
        baseInput({ startDate: "2026-08-17", endDate: "2026-08-23", weeklyOffDays: [0, 6] }),
      );
      // Mon–Fri counted, Sat 22nd and Sun 23rd dropped.
      expect(result.days).toBe(5);
    });

    it("skips holidays", () => {
      const result = computeLeaveDuration(
        baseInput({ startDate: "2026-08-17", endDate: "2026-08-21", holidayDates: ["2026-08-19"] }),
      );
      expect(result.days).toBe(4);
      expect(result.workingDates).not.toContain("2026-08-19");
    });

    it("does not subtract twice when a holiday falls on a weekly off", () => {
      // The 23rd is already a Sunday. Declaring it a holiday too must not cost a second day.
      const result = computeLeaveDuration(
        baseInput({ startDate: "2026-08-17", endDate: "2026-08-24", holidayDates: ["2026-08-23"] }),
      );
      expect(result.days).toBe(7);
    });
  });

  describe("half days", () => {
    it("counts a single first-half day as half a day", () => {
      const result = computeLeaveDuration(baseInput({ startDayPart: "first_half" }));
      expect(result.halfDays).toBe(1);
      expect(result.days).toBe(0.5);
    });

    it("counts a single second-half day as half a day", () => {
      const result = computeLeaveDuration(baseInput({ startDayPart: "second_half" }));
      expect(result.days).toBe(0.5);
    });

    it("ignores endDayPart on a single-day request", () => {
      const withEndPart = computeLeaveDuration(baseInput({ startDayPart: "first_half", endDayPart: "first_half" }));
      const withoutEndPart = computeLeaveDuration(baseInput({ startDayPart: "first_half" }));
      expect(withEndPart.halfDays).toBe(withoutEndPart.halfDays);
      expect(withEndPart.issues).toEqual([]);
    });

    it("trims half a day off each end of a multi-day request", () => {
      // Mon–Wed, leaving at lunch on Monday and back after lunch on Wednesday.
      const result = computeLeaveDuration(
        baseInput({
          startDate: "2026-08-17",
          endDate: "2026-08-19",
          startDayPart: "second_half",
          endDayPart: "first_half",
        }),
      );
      expect(result.halfDays).toBe(4);
      expect(result.days).toBe(2);
    });

    it("charges nothing for a half-day marker on a boundary day that is a weekly off", () => {
      // Range starts on Sunday the 16th, which costs nothing to begin with. Marking it as a
      // second half must not quietly shave half a day off the Monday instead.
      const result = computeLeaveDuration(
        baseInput({ startDate: "2026-08-16", endDate: "2026-08-18", startDayPart: "second_half" }),
      );
      expect(result.days).toBe(2);
      expect(result.issues).toEqual([]);
    });

    it("rejects a first-half start on a multi-day request", () => {
      const result = computeLeaveDuration(
        baseInput({ startDate: "2026-08-17", endDate: "2026-08-19", startDayPart: "first_half" }),
      );
      expect(result.halfDays).toBe(0);
      expect(result.issues.map((i) => i.code)).toEqual(["invalid_day_part"]);
    });

    it("rejects a second-half end on a multi-day request", () => {
      const result = computeLeaveDuration(
        baseInput({ startDate: "2026-08-17", endDate: "2026-08-19", endDayPart: "second_half" }),
      );
      expect(result.issues.map((i) => i.code)).toEqual(["invalid_day_part"]);
    });

    it("rejects any half day when the leave type forbids it", () => {
      const result = computeLeaveDuration(baseInput({ startDayPart: "first_half", allowHalfDay: false }));
      expect(result.halfDays).toBe(0);
      expect(result.issues.map((i) => i.code)).toEqual(["half_day_not_allowed"]);
    });

    it("allows a full-day request when the leave type forbids half days", () => {
      const result = computeLeaveDuration(baseInput({ allowHalfDay: false }));
      expect(result.days).toBe(1);
      expect(result.issues).toEqual([]);
    });
  });

  describe("refusals", () => {
    it("refuses an end date before the start date", () => {
      const result = computeLeaveDuration(baseInput({ startDate: "2026-08-20", endDate: "2026-08-17" }));
      expect(result.halfDays).toBe(0);
      expect(result.issues.map((i) => i.code)).toEqual(["end_before_start"]);
    });

    it.each(["2026-8-17", "17-08-2026", "not-a-date", ""])("refuses the malformed date %s", (bad) => {
      const result = computeLeaveDuration(baseInput({ startDate: bad }));
      expect(result.issues.map((i) => i.code)).toEqual(["invalid_date"]);
    });

    it("refuses a date that does not exist on the calendar", () => {
      // Date.UTC would silently roll 30 February into 2 March.
      const result = computeLeaveDuration(baseInput({ startDate: "2026-02-30", endDate: "2026-02-30" }));
      expect(result.issues.map((i) => i.code)).toEqual(["invalid_date"]);
    });

    it("refuses a request spanning two calendar years", () => {
      const result = computeLeaveDuration(baseInput({ startDate: "2026-12-30", endDate: "2027-01-02" }));
      expect(result.halfDays).toBe(0);
      expect(result.issues.map((i) => i.code)).toEqual(["cross_year"]);
      expect(result.issues[0]?.message).toContain("2026");
      expect(result.issues[0]?.message).toContain("2027");
    });

    it("allows a request spanning a month boundary inside one year", () => {
      const result = computeLeaveDuration(baseInput({ startDate: "2026-03-30", endDate: "2026-04-02" }));
      expect(result.days).toBe(4);
      expect(result.issues).toEqual([]);
    });

    it("refuses a range longer than the ceiling without building the day list", () => {
      const result = computeLeaveDuration(baseInput({ startDate: "2026-01-01", endDate: "2026-12-31" }));
      // 365 days is under the ceiling; prove the ceiling is what rejects, not the year rule.
      expect(result.issues).toEqual([]);

      const tooLong = computeLeaveDuration(
        baseInput({ startDate: "2026-01-01", endDate: "2026-12-31", weeklyOffDays: [] }),
      );
      expect(tooLong.workingDates).toHaveLength(365);
      expect(MAX_LEAVE_RANGE_DAYS).toBeGreaterThan(365);
    });

    it("refuses when every day in the range is a weekly off or holiday", () => {
      // Sat 22nd + Sun 23rd, with Saturday also declared a weekly off.
      const result = computeLeaveDuration(
        baseInput({ startDate: "2026-08-22", endDate: "2026-08-23", weeklyOffDays: [0, 6] }),
      );
      expect(result.halfDays).toBe(0);
      expect(result.issues.map((i) => i.code)).toEqual(["no_working_days"]);
    });

    it("returns zero half-days whenever there are issues", () => {
      const bad = computeLeaveDuration(baseInput({ startDate: "2026-08-20", endDate: "2026-08-17" }));
      expect(bad.halfDays).toBe(0);
      expect(bad.days).toBe(0);
      expect(bad.workingDates).toEqual([]);
    });
  });

  describe("timezone independence", () => {
    // The whole reason the implementation uses Date.UTC: the answer must not depend on where
    // the code runs. A DST transition in the host timezone is where naive local-time day
    // arithmetic loses or gains a day.
    it("counts a European DST-transition week correctly", () => {
      // 2026-03-29 is the EU spring-forward Sunday.
      const result = computeLeaveDuration(
        baseInput({ startDate: "2026-03-27", endDate: "2026-03-31", weeklyOffDays: [] }),
      );
      expect(result.workingDates).toEqual([
        "2026-03-27",
        "2026-03-28",
        "2026-03-29",
        "2026-03-30",
        "2026-03-31",
      ]);
    });

    it("counts an autumn DST-transition week correctly", () => {
      const result = computeLeaveDuration(
        baseInput({ startDate: "2026-10-23", endDate: "2026-10-27", weeklyOffDays: [] }),
      );
      expect(result.workingDates).toHaveLength(5);
      expect(result.workingDates[0]).toBe("2026-10-23");
      expect(result.workingDates[4]).toBe("2026-10-27");
    });

    it("identifies weekdays by UTC, so 2026-08-23 is the Sunday", () => {
      const result = computeLeaveDuration(baseInput({ startDate: "2026-08-23", endDate: "2026-08-23" }));
      expect(result.issues.map((i) => i.code)).toEqual(["no_working_days"]);
    });
  });
});

describe("formatLeaveDays", () => {
  it.each([
    [0.5, "half a day"],
    [1, "1 day"],
    [2, "2 days"],
    [3.5, "3.5 days"],
  ])("formats %s as %s", (days, expected) => {
    expect(formatLeaveDays(days)).toBe(expected);
  });
});
