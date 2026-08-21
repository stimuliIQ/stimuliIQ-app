// Monthly marketing targets — the contract shared by the CRM screens and the NestJS module.
// Backs `model MarketingTarget`. Spec: docs/specs/marketing-targets.md. ADR-0067.
//
// WHY A TARGET CARRIES TWO NUMBERS
//   A marketing target is one sentence: "close N deals worth ₹X this month." Storing the
//   two halves as separate rows would let somebody set the deals number for March and
//   forget the rupees one, leaving a dashboard card half-blank with no way to tell whether
//   that was deliberate. So one row, two numbers, and EITHER may be 0 — which means "not
//   measured on this" and hides that card. A missing row means "no target at all"; a zero
//   means "deliberately not measured". Those are different states and the UI shows both.
//
// WHY PROGRESS IS NEVER STORED
//   `MarketingTargetProgress` below has `completed` and `pending` fields, and NOTHING ever
//   writes them to the database. They are recomputed on every read from leads
//   (`converted_at` inside the month) and payments (`paid_at` inside the month). A stored
//   counter drifts the first time a lead is reassigned, a conversion is undone or a payment
//   is refunded — and it drifts silently, in the direction that flatters the number. This is
//   the same call `leave.schemas.ts` makes for balances, for the same reason.
//
// WHY `pending` IS NOT JUST `target - completed` ON THE CLIENT
//   It is clamped at 0. Once somebody passes their target the honest reading of "pending"
//   is "nothing left to do", not a negative number, and a progress bar driven off a negative
//   would run backwards. `summariseTargetMetric` below is the one place that decides this,
//   and it is run identically by the API and by the dashboard card — the same discipline as
//   `computeLeaveDuration` and `buildOnboardingAnswerIssues`.
//
// Endpoint surface (all CRM, JwtAuthGuard + PermissionsGuard):
//   GET    /crm/marketing-targets/me           `marketing_targets.view`    own row + progress
//   GET    /crm/marketing-targets              `marketing_targets.manage`  every row + progress
//   PUT    /crm/marketing-targets              `marketing_targets.manage`  upsert one person/month
//   DELETE /crm/marketing-targets/:id          `marketing_targets.manage`  soft delete
//
// `marketing_targets.manage` is seeded to super_admin ALONE, outside the permission catalog
// the admin catch-all iterates — same device as `leave.approve`/`leave.manage`. Setting the
// number somebody is judged against is the owner's call, not every operational admin's.

import { z } from "zod";

import { IsoDateTimeSchema, UuidSchema } from "../common/primitives.js";

// ── Period ────────────────────────────────────────────────────────────────────────────

/**
 * A target month as `YYYY-MM`.
 *
 * The wire format is deliberately NOT a full date. A target belongs to a month, and letting
 * `2026-03-17` travel would force every consumer to decide whether that means March or is a
 * bug. The API normalises this to the first of the month before it touches the database.
 */
export const TargetMonthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Month must be YYYY-MM")
  .describe("Target month, e.g. '2026-03'.");
export type TargetMonth = z.infer<typeof TargetMonthSchema>;

/**
 * `2026-03` → `{ year: 2026, month: 3 }`. Throws on anything TargetMonthSchema would
 * reject, so the two helpers below can index the parts without `noUncheckedIndexedAccess`
 * complaining about a shape the regex has already guaranteed.
 */
function splitTargetMonth(month: TargetMonth): { year: number; month: number } {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!match) throw new RangeError(`Invalid target month: ${month}`);
  return { year: Number(match[1]), month: Number(match[2]) };
}

/** `2026-03` → `2026-03-01T00:00:00.000Z`. The DB stores the first of the month. */
export function targetMonthToDate(month: TargetMonth): Date {
  const { year, month: mon } = splitTargetMonth(month);
  return new Date(Date.UTC(year, mon - 1, 1));
}

/** `2026-03` → the exclusive upper bound `2026-04-01T00:00:00.000Z`. */
export function targetMonthEnd(month: TargetMonth): Date {
  const { year, month: mon } = splitTargetMonth(month);
  return new Date(Date.UTC(year, mon, 1));
}

/** A Date (or the current instant) → `YYYY-MM`, in UTC. */
export function toTargetMonth(date: Date = new Date()): TargetMonth {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

// ── Progress ──────────────────────────────────────────────────────────────────────────

/**
 * One metric's worth of progress: what was asked for, what has happened, what is left.
 *
 * `target` 0 means the metric is deliberately not measured this month — the UI hides the
 * card rather than showing a permanently-complete 0/0.
 */
export const TargetMetricProgressSchema = z
  .object({
    target: z.number().int().min(0).describe("What was set. 0 = not measured on this metric."),
    completed: z.number().int().min(0).describe("Derived on read. Never stored."),
    pending: z
      .number()
      .int()
      .min(0)
      .describe("max(target - completed, 0). Clamped: once you are past the target nothing is left."),
    /**
     * completed / target, clamped to [0, 1] for bar widths. `null` when target is 0 —
     * NOT 0 and NOT 1, because "no target" has no percentage and rendering either would
     * claim something untrue about performance.
     */
    percent: z.number().min(0).max(1).nullable(),
    /** True once completed >= target, and only when a target was actually set. */
    met: z.boolean(),
  })
  .strict();
export type TargetMetricProgress = z.infer<typeof TargetMetricProgressSchema>;

/**
 * THE one definition of completed/pending/percent/met, run identically in the browser and
 * in the API. Two implementations would drift, and the first symptom would be a dashboard
 * card that disagrees with the report the same person is reviewed against.
 */
export function summariseTargetMetric(target: number, completed: number): TargetMetricProgress {
  const safeTarget = Math.max(0, Math.trunc(target));
  const safeCompleted = Math.max(0, Math.trunc(completed));
  return {
    target: safeTarget,
    completed: safeCompleted,
    pending: Math.max(safeTarget - safeCompleted, 0),
    percent: safeTarget === 0 ? null : Math.min(safeCompleted / safeTarget, 1),
    met: safeTarget > 0 && safeCompleted >= safeTarget,
  };
}

// ── Rows ──────────────────────────────────────────────────────────────────────────────

/**
 * A target plus its live progress, for one person and one month.
 *
 * `targetId` is null when NOBODY HAS SET A TARGET. The row is still returned, with zeroed
 * targets and real `completed` figures, because "Rahul closed 6 deals against no target" is
 * information the super admin needs — dropping him from the list would read as "no activity"
 * and quietly hide the fact that nobody set him a number.
 */
export const MarketingTargetProgressSchema = z
  .object({
    targetId: UuidSchema.nullable().describe("null when no target has been set for this person/month."),
    userId: UuidSchema,
    userName: z.string(),
    userEmail: z.string().email(),
    roleKeys: z.array(z.string()).describe("e.g. ['marketing']. How the person is employed."),
    month: TargetMonthSchema,

    conversions: TargetMetricProgressSchema,
    /** Rupees in PAISE throughout — integer minor units, never a float (CLAUDE.md §3.6). */
    revenuePaise: TargetMetricProgressSchema,

    note: z.string().nullable(),
    setByName: z.string().nullable().describe("Who set the number. null when no target exists."),
    updatedAt: IsoDateTimeSchema.nullable(),
  })
  .strict();
export type MarketingTargetProgress = z.infer<typeof MarketingTargetProgressSchema>;

/**
 * GET /crm/marketing-targets/me
 *
 * `hasTarget: false` is a first-class answer, not an error: a marketing person opening the
 * dashboard before anyone has set their number must get a clear "no target set yet", not an
 * empty card or a 404.
 */
export const MyMarketingTargetDtoSchema = z
  .object({
    month: TargetMonthSchema,
    hasTarget: z.boolean(),
    progress: MarketingTargetProgressSchema,
  })
  .strict();
export type MyMarketingTargetDto = z.infer<typeof MyMarketingTargetDtoSchema>;

/**
 * GET /crm/marketing-targets — the whole team for one month, plus the roll-up.
 *
 * `totals` sums the individual targets rather than being its own settable number: a team
 * total that could be edited independently would be a second source of truth, free to
 * disagree with the sum of its parts.
 */
export const MarketingTargetsListDtoSchema = z
  .object({
    month: TargetMonthSchema,
    rows: z.array(MarketingTargetProgressSchema),
    totals: z
      .object({
        conversions: TargetMetricProgressSchema,
        revenuePaise: TargetMetricProgressSchema,
        peopleWithTarget: z.number().int().min(0),
        peopleMeetingTarget: z.number().int().min(0),
      })
      .strict(),
  })
  .strict();
export type MarketingTargetsListDto = z.infer<typeof MarketingTargetsListDtoSchema>;

// ── Requests ──────────────────────────────────────────────────────────────────────────

export const MarketingTargetsQuerySchema = z
  .object({
    /** Defaults to the current month server-side when omitted. */
    month: TargetMonthSchema.optional(),
  })
  .strict();
export type MarketingTargetsQuery = z.infer<typeof MarketingTargetsQuerySchema>;

/**
 * PUT /crm/marketing-targets — set (or replace) one person's number for one month.
 *
 * An UPSERT rather than POST-create + PATCH-edit: "the target for Rahul in March" is one
 * fact, and a create/edit split would make the caller ask whether it exists first and race
 * with anyone else doing the same.
 */
export const UpsertMarketingTargetRequestSchema = z
  .object({
    userId: UuidSchema,
    month: TargetMonthSchema,
    conversionsTarget: z.number().int().min(0).max(100_000),
    /** Paise. 100_000_000_00 = ₹100 crore, comfortably above any real monthly target. */
    revenueTargetPaise: z.number().int().min(0).max(100_000_000_00),
    note: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine((value) => value.conversionsTarget > 0 || value.revenueTargetPaise > 0, {
    // A row with both numbers at zero measures nothing and would render as a card that
    // is permanently 0/0. Deleting the target is the way to say "no target".
    message: "Set at least one of a conversions target or a revenue target.",
    path: ["conversionsTarget"],
  });
export type UpsertMarketingTargetRequest = z.infer<typeof UpsertMarketingTargetRequestSchema>;
