// The two things in marketing-targets.schemas.ts that are LOGIC rather than shape, and so
// can be wrong while still typechecking: the month<->date conversion and the
// completed/pending/percent summary. Both are run identically by the API and the CRM, so a
// bug here shows up as a dashboard card disagreeing with the report it is reviewed against.
import { describe, it, expect } from "vitest";

import {
  MarketingTargetProgressSchema,
  TargetMonthSchema,
  UpsertMarketingTargetRequestSchema,
  summariseTargetMetric,
  targetMonthEnd,
  targetMonthToDate,
  toTargetMonth,
} from "./marketing-targets.schemas.js";

describe("TargetMonth", () => {
  it("accepts a real month", () => {
    expect(TargetMonthSchema.safeParse("2026-03").success).toBe(true);
    expect(TargetMonthSchema.safeParse("2026-12").success).toBe(true);
    expect(TargetMonthSchema.safeParse("2026-01").success).toBe(true);
  });

  it("rejects month 00 and 13, a full date, and free text", () => {
    for (const bad of ["2026-00", "2026-13", "2026-3", "2026-03-01", "March 2026", "", "0000"]) {
      expect(TargetMonthSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("converts to the first of the month in UTC", () => {
    expect(targetMonthToDate("2026-03").toISOString()).toBe("2026-03-01T00:00:00.000Z");
    expect(targetMonthToDate("2026-01").toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("gives an EXCLUSIVE upper bound, including across a year boundary", () => {
    expect(targetMonthEnd("2026-03").toISOString()).toBe("2026-04-01T00:00:00.000Z");
    // December must roll into January of the NEXT year, not month 13 of the same one.
    expect(targetMonthEnd("2026-12").toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("covers February in a leap year without a gap or an overlap", () => {
    // 2028 is a leap year: the window must include the 29th and stop before March.
    const start = targetMonthToDate("2028-02");
    const end = targetMonthEnd("2028-02");
    const feb29 = new Date("2028-02-29T23:59:59.999Z");
    expect(feb29 >= start && feb29 < end).toBe(true);
    expect(end.toISOString()).toBe("2028-03-01T00:00:00.000Z");
  });

  it("round-trips a Date back to its month", () => {
    expect(toTargetMonth(new Date("2026-03-17T09:00:00.000Z"))).toBe("2026-03");
    // Single-digit months must be zero-padded, or the regex above rejects them.
    expect(toTargetMonth(new Date("2026-01-01T00:00:00.000Z"))).toBe("2026-01");
    expect(toTargetMonth(new Date("2026-12-31T23:59:59.999Z"))).toBe("2026-12");
  });

  it("every month of a year survives the round trip", () => {
    for (let m = 1; m <= 12; m++) {
      const month = `2026-${String(m).padStart(2, "0")}`;
      expect(TargetMonthSchema.safeParse(month).success).toBe(true);
      expect(toTargetMonth(targetMonthToDate(month))).toBe(month);
    }
  });
});

describe("summariseTargetMetric", () => {
  it("splits a part-done target into completed and pending", () => {
    expect(summariseTargetMetric(40, 23)).toEqual({
      target: 40,
      completed: 23,
      pending: 17,
      percent: 23 / 40,
      met: false,
    });
  });

  it("clamps pending at zero when the target is beaten, a bar must not run backwards", () => {
    const over = summariseTargetMetric(40, 55);
    expect(over.pending).toBe(0);
    expect(over.percent).toBe(1);
    expect(over.met).toBe(true);
  });

  it("treats exactly hitting the target as met", () => {
    expect(summariseTargetMetric(40, 40).met).toBe(true);
    expect(summariseTargetMetric(40, 39).met).toBe(false);
  });

  it("reports percent null (not 0, not 1) when no target is set", () => {
    // 0 would render an empty bar and 1 a full one; both claim something untrue about
    // performance. Null is the only honest answer, and the UI hides the card on it.
    const none = summariseTargetMetric(0, 12);
    expect(none.percent).toBeNull();
    expect(none.met).toBe(false);
    expect(none.pending).toBe(0);
    expect(none.completed).toBe(12);
  });

  it("never returns a negative or fractional figure, whatever it is handed", () => {
    const weird = summariseTargetMetric(-5, -3);
    expect(weird).toEqual({ target: 0, completed: 0, pending: 0, percent: null, met: false });
    expect(summariseTargetMetric(10.9, 3.7)).toMatchObject({ target: 10, completed: 3, pending: 7 });
  });

  it("produces something MarketingTargetProgressSchema accepts", () => {
    const row = {
      targetId: "11111111-1111-1111-1111-111111111111",
      userId: "22222222-2222-2222-2222-222222222222",
      userName: "Rahul",
      userEmail: "rahul@stimuliiq.test",
      roleKeys: ["marketing"],
      month: "2026-03",
      conversions: summariseTargetMetric(40, 23),
      revenuePaise: summariseTargetMetric(50_000_00, 28_750_00),
      note: null,
      setByName: "Owner",
      updatedAt: "2026-03-01T00:00:00.000Z",
    };
    expect(MarketingTargetProgressSchema.safeParse(row).success).toBe(true);
  });
});

describe("UpsertMarketingTargetRequest", () => {
  const base = {
    userId: "22222222-2222-2222-2222-222222222222",
    month: "2026-03",
  };

  it("accepts a conversions-only target", () => {
    const r = UpsertMarketingTargetRequestSchema.safeParse({
      ...base,
      conversionsTarget: 40,
      revenueTargetPaise: 0,
    });
    expect(r.success).toBe(true);
  });

  it("accepts a revenue-only target", () => {
    const r = UpsertMarketingTargetRequestSchema.safeParse({
      ...base,
      conversionsTarget: 0,
      revenueTargetPaise: 500_000_00,
    });
    expect(r.success).toBe(true);
  });

  it("REJECTS a target that measures nothing, that is what deleting is for", () => {
    const r = UpsertMarketingTargetRequestSchema.safeParse({
      ...base,
      conversionsTarget: 0,
      revenueTargetPaise: 0,
    });
    expect(r.success).toBe(false);
  });

  it("rejects fractional or negative rupees, paise are integer minor units", () => {
    for (const revenueTargetPaise of [-1, 1500.5]) {
      const r = UpsertMarketingTargetRequestSchema.safeParse({
        ...base,
        conversionsTarget: 0,
        revenueTargetPaise,
      });
      expect(r.success).toBe(false);
    }
  });

  it("rejects an unknown field rather than silently dropping it", () => {
    const r = UpsertMarketingTargetRequestSchema.safeParse({
      ...base,
      conversionsTarget: 10,
      revenueTargetPaise: 0,
      completed: 99, // progress is derived; accepting this would let a client fake it
    });
    expect(r.success).toBe(false);
  });
});
