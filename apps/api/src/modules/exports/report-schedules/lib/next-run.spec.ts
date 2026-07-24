// apps/api/src/modules/exports/report-schedules/lib/next-run.spec.ts
//
// Unit tests for `computeNextRunAt()` (docs/plans/phase-7.md Wave 2 task #11).

import { computeNextRunAt } from "./next-run";

describe("computeNextRunAt()", () => {
  it("advances a daily cadence by exactly 1 day, preserving time-of-day", () => {
    const from = new Date("2026-07-04T09:30:00.000Z");
    expect(computeNextRunAt(from, "daily")).toEqual(new Date("2026-07-05T09:30:00.000Z"));
  });

  it("advances a weekly cadence by exactly 7 days", () => {
    const from = new Date("2026-07-04T09:30:00.000Z");
    expect(computeNextRunAt(from, "weekly")).toEqual(new Date("2026-07-11T09:30:00.000Z"));
  });

  it("advances a monthly cadence by 1 calendar month", () => {
    const from = new Date("2026-07-04T09:30:00.000Z");
    expect(computeNextRunAt(from, "monthly")).toEqual(new Date("2026-08-04T09:30:00.000Z"));
  });

  it("monthly cadence rolls over correctly across a year boundary", () => {
    const from = new Date("2026-12-15T00:00:00.000Z");
    expect(computeNextRunAt(from, "monthly")).toEqual(new Date("2027-01-15T00:00:00.000Z"));
  });

  it("never mutates the input Date", () => {
    const from = new Date("2026-07-04T09:30:00.000Z");
    const original = from.getTime();
    computeNextRunAt(from, "daily");
    expect(from.getTime()).toBe(original);
  });
});
