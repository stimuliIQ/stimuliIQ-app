// Staff leave management — the contract shared by the CRM screens and the NestJS module.
// Backs `model LeaveType`, `LeaveQuota`, `Holiday`, `LeaveSetting` and `LeaveRequest`.
// Spec: docs/specs/leave-management.md. ADR-0065.
//
// WHY DURATIONS TRAVEL AS `days: number` BUT ARE STORED AS `halfDays: number`:
//   Half-day leave is a hard requirement, and 0.5 is not exactly representable in binary
//   floating point. The database therefore stores integer half-day units, exactly the way
//   money is stored as integer paise (CLAUDE.md §3.6), and every DTO here carries BOTH:
//   `halfDays` is the authoritative integer, `days` is `halfDays / 2` for display. A client
//   that adds up `days` to make a total is doing float arithmetic on its own display value
//   and can be off by a rounding error; a client that adds up `halfDays` cannot.
//
// WHY `computeLeaveDuration` LIVES HERE AND NOT IN THE API:
//   The apply form has to show "3.5 working days" while the applicant is still typing —
//   it cannot round-trip a request per keystroke — and the API has to be the authority,
//   because a client can send anything. Two implementations of "how long is this leave"
//   would drift, and the first symptom of the drift would be a balance that disagrees with
//   the number the applicant was shown when they committed to the dates. So there is one
//   function, run identically in the browser and in the service. This is the same reasoning
//   as `buildOnboardingAnswerIssues` (P12), for the same reason: the calculation, not the
//   shape, is the thing both sides must agree on.
//
// Endpoint surface (all CRM, JwtAuthGuard + PermissionsGuard + ScopeInterceptor):
//   GET    /crm/leave/requests                 `leave.view`     scope-filtered: own → mine
//   GET    /crm/leave/requests/:id             `leave.view`     own scope → 404 for others'
//   POST   /crm/leave/requests                 `leave.request`  applicant is always the actor
//   POST   /crm/leave/requests/:id/cancel      `leave.request`  own row, withdraw
//   POST   /crm/leave/requests/:id/approve     `leave.approve`  super_admin only
//   POST   /crm/leave/requests/:id/reject      `leave.approve`  super_admin only, reason required
//   GET    /crm/leave/balances                 `leave.view`     own scope → mine
//   GET    /crm/leave/calendar                 `leave.calendar.view`  team-wide, no reasons
//   GET    /crm/leave/types                    `leave.view`     the apply form needs these
//   POST   /crm/leave/types                    `leave.manage`
//   PATCH  /crm/leave/types/:id                `leave.manage`
//   DELETE /crm/leave/types/:id                `leave.manage`
//   GET    /crm/leave/quotas                   `leave.view`
//   PUT    /crm/leave/quotas                   `leave.manage`   bulk-upserts one whole year
//   GET    /crm/leave/holidays                 `leave.view`
//   POST   /crm/leave/holidays                 `leave.manage`
//   PATCH  /crm/leave/holidays/:id             `leave.manage`
//   DELETE /crm/leave/holidays/:id             `leave.manage`
//   GET    /crm/leave/settings                 `leave.view`
//   PATCH  /crm/leave/settings                 `leave.manage`

import { z } from "zod";

import { IsoDateSchema, IsoDateTimeSchema, UuidSchema } from "../common/primitives.js";
import { PageQuerySchema } from "../common/pagination.js";

// ── Enums ─────────────────────────────────────────────────────────────────────────────

/** Which part of a boundary day is taken. Only the first and last day of a range can be half. */
export const LeaveDayPartSchema = z.enum(["full", "first_half", "second_half"]);
export type LeaveDayPart = z.infer<typeof LeaveDayPartSchema>;

export const LeaveRequestStatusSchema = z.enum([
  "pending",
  // Two-step approval (ADR-0070): the applicant's team lead has approved and it is now
  // waiting on their manager. `pending` is deliberately NOT renamed — it still means "not
  // yet decided", every existing row carries that meaning, and a single-step chain (the
  // applicant is a lead, a manager, HR, or on no team yet) still goes straight from
  // `pending` to `approved`, exactly as it always did.
  "lead_approved",
  "approved",
  "rejected",
  "cancelled",
]);
export type LeaveRequestStatus = z.infer<typeof LeaveRequestStatusSchema>;

/**
 * THE TWO STATUS SETS, DEFINED ONCE.
 *
 * Before the two-step chain landed, every place that had to know "which requests are still
 * live?" spelled the answer out as a string literal — ten of them across the leave service
 * and repository. Adding a third live status that way is the kind of change where missing
 * ONE site does not break a test: it silently stops counting somebody's days against their
 * balance for the hours a request sits with the manager, and lets two requests be approved
 * against one allowance. It fails in the direction nobody checks.
 *
 * So the sets live here and every call site imports them. `leaveStatusSetsCoverEveryStatus`
 * below is asserted in the spec, so a future status added to the enum without being
 * classified fails loudly rather than quietly.
 */

/** Not yet a committed absence, but real enough to block an overlap and count as pending. */
export const LEAVE_UNCOMMITTED_STATUSES = ["pending", "lead_approved"] as const;

/** Everything that is not finished with: uncommitted, plus the approved absences themselves. */
export const LEAVE_LIVE_STATUSES = ["pending", "lead_approved", "approved"] as const;

/** Terminal — deducts nothing, blocks nothing, and can never move again. */
export const LEAVE_TERMINAL_STATUSES = ["rejected", "cancelled"] as const;

/**
 * Every status is either live or terminal. Asserted in leave.spec.ts so that adding a value
 * to `LeaveRequestStatusSchema` without deciding which set it belongs to fails the build
 * rather than quietly dropping out of the balance arithmetic.
 */
export function leaveStatusSetsCoverEveryStatus(): boolean {
  const classified = new Set<string>([...LEAVE_LIVE_STATUSES, ...LEAVE_TERMINAL_STATUSES]);
  return LeaveRequestStatusSchema.options.every((status) => classified.has(status));
}

/** Weekday index as used by `Date.getUTCDay()` — 0 = Sunday … 6 = Saturday. */
export const WeekdaySchema = z.number().int().min(0).max(6);

// ── Duration calculation (the shared authority) ───────────────────────────────────────

/**
 * Why a request could not be measured. Every one of these is a hard stop, not a warning:
 * `computeLeaveDuration` returns `halfDays: 0` whenever `issues` is non-empty, so a caller
 * that ignores `issues` gets a zero rather than a plausible-looking wrong number.
 */
export type LeaveDurationIssueCode =
  | "invalid_date"
  | "end_before_start"
  | "range_too_long"
  | "cross_year"
  | "no_working_days"
  | "half_day_not_allowed"
  | "invalid_day_part";

export interface LeaveDurationIssue {
  code: LeaveDurationIssueCode;
  /** User-facing sentence. Rendered verbatim by the apply form and by the API's 422 detail. */
  message: string;
}

export interface LeaveDurationInput {
  /** `YYYY-MM-DD`. */
  startDate: string;
  /** `YYYY-MM-DD`. */
  endDate: string;
  startDayPart: LeaveDayPart;
  endDayPart: LeaveDayPart;
  /** Non-working weekdays, 0 = Sunday. */
  weeklyOffDays: readonly number[];
  /** Mandatory holidays as `YYYY-MM-DD`. Optional holidays are NOT included — they are working days. */
  holidayDates: readonly string[];
  /** From the chosen leave type. When false, any half-day part is an issue. */
  allowHalfDay?: boolean;
}

export interface LeaveDurationResult {
  /** Authoritative integer duration. 0 whenever `issues` is non-empty. */
  halfDays: number;
  /** `halfDays / 2`, for display only. */
  days: number;
  /** The working days actually consumed, `YYYY-MM-DD`, ascending. Excludes offs and holidays. */
  workingDates: readonly string[];
  issues: readonly LeaveDurationIssue[];
}

const MS_PER_DAY = 86_400_000;

/**
 * Defensive ceiling on the iterated range. Without it, a client sending a hundred-year span
 * makes the server build a 36,500-element array before anything gets to reject it — the
 * calculation runs before the business rules, so it has to defend itself.
 */
export const MAX_LEAVE_RANGE_DAYS = 400;

/** Parses `YYYY-MM-DD` into a UTC-midnight timestamp. Returns NaN for anything malformed. */
function parseIsoDateUtc(value: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return Number.NaN;
  const [, y, m, d] = match;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  const ts = Date.UTC(year, month - 1, day);
  // Reject impossible dates that Date.UTC silently rolls over (2026-02-30 → 2026-03-02).
  const rolled = new Date(ts);
  if (rolled.getUTCFullYear() !== year || rolled.getUTCMonth() !== month - 1 || rolled.getUTCDate() !== day) {
    return Number.NaN;
  }
  return ts;
}

/** Formats a UTC-midnight timestamp back to `YYYY-MM-DD`. */
function formatIsoDateUtc(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

/**
 * How many working half-days a leave request consumes.
 *
 * Deliberately pure and UTC-only: every date in this feature is a calendar date with no time
 * component, and doing the arithmetic in local time would make the answer depend on the
 * browser's timezone — a Mumbai applicant and a UK-hosted API would disagree about which day
 * a request starts on. `Date.UTC` sidesteps that entirely.
 *
 * Weekly offs and mandatory holidays are skipped. Optional (restricted) holidays are NOT
 * skipped: taking one is a choice the person makes by applying for leave on it, so it costs
 * a day like any other.
 *
 * Half-day parts apply to the boundary days, and only in the direction that makes sense.
 * `second_half` on the START day means the applicant works the morning and leaves at lunch;
 * `first_half` on the END day means they are back after lunch. The opposite pairings —
 * `first_half` starting a multi-day request, `second_half` ending one — describe somebody
 * who is off Monday morning, back Monday afternoon, and off again Tuesday. That is not one
 * leave request, so it is rejected as `invalid_day_part` rather than quietly reinterpreted
 * into whichever reading the code happened to implement.
 *
 * On a single-day request only `startDayPart` is read; `endDayPart` is ignored rather than
 * combined, because "first half AND second half" and "first half OR second half" are both
 * things a caller could plausibly mean and neither is worth guessing.
 *
 * A half-day marker on a boundary day that turns out to be a weekly off or a holiday costs
 * nothing — that day already contributes zero, and deducting from it would credit the
 * applicant half a day they never asked for.
 *
 * This function knows nothing about the chosen leave type beyond the `allowHalfDay` flag it
 * is handed. Do not give it a `leaveType` field: quota, balance and type-existence checks
 * need the database and belong to the service.
 */
export function computeLeaveDuration(input: LeaveDurationInput): LeaveDurationResult {
  const issues: LeaveDurationIssue[] = [];
  const empty = (): LeaveDurationResult => ({ halfDays: 0, days: 0, workingDates: [], issues });

  const start = parseIsoDateUtc(input.startDate);
  const end = parseIsoDateUtc(input.endDate);
  if (Number.isNaN(start) || Number.isNaN(end)) {
    issues.push({ code: "invalid_date", message: "Pick a valid start and end date." });
    return empty();
  }

  if (end < start) {
    issues.push({ code: "end_before_start", message: "The end date can't be before the start date." });
    return empty();
  }

  // Checked before the day loop, not inside it — the point is to never allocate the array.
  if ((end - start) / MS_PER_DAY + 1 > MAX_LEAVE_RANGE_DAYS) {
    issues.push({
      code: "range_too_long",
      message: `A single request can't cover more than ${MAX_LEAVE_RANGE_DAYS} days.`,
    });
    return empty();
  }

  const startYear = new Date(start).getUTCFullYear();
  const endYear = new Date(end).getUTCFullYear();
  if (startYear !== endYear) {
    issues.push({
      code: "cross_year",
      message:
        `Leave can't run from ${startYear} into ${endYear} in one request, because the yearly ` +
        "allowance is counted per year. Apply for each year separately.",
    });
    return empty();
  }

  const isSingleDay = start === end;
  const usesHalfDay = input.startDayPart !== "full" || (!isSingleDay && input.endDayPart !== "full");

  if (usesHalfDay && input.allowHalfDay === false) {
    issues.push({
      code: "half_day_not_allowed",
      message: "This leave type has to be taken as whole days.",
    });
    return empty();
  }

  if (!isSingleDay && input.startDayPart === "first_half") {
    issues.push({
      code: "invalid_day_part",
      message:
        "On leave of more than one day, the first day can only be a full day or a second half, " +
        "taking just the first half would mean coming back the same afternoon.",
    });
    return empty();
  }

  if (!isSingleDay && input.endDayPart === "second_half") {
    issues.push({
      code: "invalid_day_part",
      message:
        "On leave of more than one day, the last day can only be a full day or a first half, " +
        "taking just the second half would mean working that morning after being away.",
    });
    return empty();
  }

  const offs = new Set(input.weeklyOffDays);
  const holidays = new Set(input.holidayDates);

  const workingDates: string[] = [];
  for (let ts = start; ts <= end; ts += MS_PER_DAY) {
    const iso = formatIsoDateUtc(ts);
    if (offs.has(new Date(ts).getUTCDay())) continue;
    if (holidays.has(iso)) continue;
    workingDates.push(iso);
  }

  if (workingDates.length === 0) {
    issues.push({
      code: "no_working_days",
      message: "Those dates are all weekly offs or holidays, so there's no leave to apply for.",
    });
    return empty();
  }

  let halfDays = workingDates.length * 2;

  // The deduction applies to the boundary DATE, not to the first/last entry of
  // `workingDates`. If a range starts on a Sunday, "second half of the start day" marks a
  // day that already contributes nothing, and moving the deduction onto Monday instead
  // would silently shorten leave the applicant did not shorten. Nothing is deducted, and
  // that is not an error — the form was filled in reasonably, the marker just costs nothing.
  const startIsWorking = workingDates[0] === input.startDate;
  const endIsWorking = workingDates[workingDates.length - 1] === input.endDate;

  if (isSingleDay) {
    if (input.startDayPart !== "full" && startIsWorking) halfDays -= 1;
  } else {
    if (input.startDayPart === "second_half" && startIsWorking) halfDays -= 1;
    if (input.endDayPart === "first_half" && endIsWorking) halfDays -= 1;
  }

  // Cannot happen with the arithmetic above (a working day is worth 2 and at most 1 is taken
  // off each end), but a duration of zero or less must never reach the database as a real
  // request — it would consume no balance while blocking the days on the calendar.
  if (halfDays <= 0) {
    issues.push({
      code: "no_working_days",
      message: "Those dates don't add up to any leave. Check the half-day options.",
    });
    return empty();
  }

  return { halfDays, days: halfDays / 2, workingDates, issues };
}

/** `3` → "3 days", `1` → "1 day", `0.5` → "half a day", `3.5` → "3.5 days". */
export function formatLeaveDays(days: number): string {
  if (days === 0.5) return "half a day";
  if (days === 1) return "1 day";
  return `${days} days`;
}

// ── Leave types ───────────────────────────────────────────────────────────────────────

export const LeaveTypeSchema = z.object({
  id: UuidSchema,
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  paid: z.boolean(),
  allowHalfDay: z.boolean(),
  active: z.boolean(),
  sortOrder: z.number().int(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type LeaveType = z.infer<typeof LeaveTypeSchema>;

const LEAVE_TYPE_KEY_RE = /^[a-z][a-z0-9_]*$/;

export const CreateLeaveTypeRequestSchema = z
  .object({
    key: z
      .string()
      .min(2)
      .max(40)
      .regex(LEAVE_TYPE_KEY_RE, "must be lowercase letters, digits and underscores"),
    name: z.string().min(1).max(60),
    description: z.string().max(500).nullish(),
    paid: z.boolean().default(true),
    allowHalfDay: z.boolean().default(true),
    active: z.boolean().default(true),
    sortOrder: z.number().int().min(0).max(999).default(0),
  })
  .strict();
export type CreateLeaveTypeRequest = z.infer<typeof CreateLeaveTypeRequestSchema>;

/** `key` is deliberately absent: it is immutable after create so historical rows stay joinable. */
export const UpdateLeaveTypeRequestSchema = z
  .object({
    name: z.string().min(1).max(60).optional(),
    description: z.string().max(500).nullish(),
    paid: z.boolean().optional(),
    allowHalfDay: z.boolean().optional(),
    active: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(999).optional(),
  })
  .strict();
export type UpdateLeaveTypeRequest = z.infer<typeof UpdateLeaveTypeRequestSchema>;

export const ListLeaveTypesQuerySchema = z
  .object({
    /** Omit to get active types only — what the apply form wants. Setup passes `false`. */
    activeOnly: z
      .preprocess((v) => (typeof v === "string" ? v.toLowerCase() !== "false" : v), z.boolean())
      .default(true),
  })
  .strict();
export type ListLeaveTypesQuery = z.infer<typeof ListLeaveTypesQuerySchema>;

// ── Yearly allocations ────────────────────────────────────────────────────────────────

/**
 * Bounds on the year. Not "any integer" — a typo'd 202 or 20266 in the year picker would
 * create an allocation nobody can ever see, since every read is scoped to a real year.
 */
export const LeaveYearSchema = z.coerce.number().int().min(2000).max(2100);

export const LeaveQuotaSchema = z.object({
  id: UuidSchema,
  leaveTypeId: UuidSchema,
  leaveTypeName: z.string(),
  year: z.number().int(),
  halfDays: z.number().int(),
  days: z.number(),
});
export type LeaveQuota = z.infer<typeof LeaveQuotaSchema>;

/**
 * The whole year saved at once, not one allocation at a time. The setup screen shows a grid
 * of every leave type against the year, and saving it as a single PUT is what makes the
 * result deterministic — a per-row PATCH would leave a half-applied year on the first
 * network failure, and nobody would know which half.
 *
 * `days` is accepted in 0.5 steps and converted to half-days server-side.
 */
export const SaveLeaveQuotasRequestSchema = z
  .object({
    year: LeaveYearSchema,
    allocations: z
      .array(
        z
          .object({
            leaveTypeId: UuidSchema,
            days: z
              .number()
              .min(0)
              .max(365)
              .refine((v) => Number.isInteger(v * 2), "must be a whole or half number of days"),
          })
          .strict(),
      )
      .max(50),
  })
  .strict();
export type SaveLeaveQuotasRequest = z.infer<typeof SaveLeaveQuotasRequestSchema>;

export const ListLeaveQuotasQuerySchema = z.object({ year: LeaveYearSchema }).strict();
export type ListLeaveQuotasQuery = z.infer<typeof ListLeaveQuotasQuerySchema>;

// ── Holidays ──────────────────────────────────────────────────────────────────────────

export const HolidaySchema = z.object({
  id: UuidSchema,
  date: IsoDateSchema,
  name: z.string(),
  description: z.string().nullable(),
  optional: z.boolean(),
});
export type Holiday = z.infer<typeof HolidaySchema>;

export const CreateHolidayRequestSchema = z
  .object({
    date: IsoDateSchema,
    name: z.string().min(1).max(120),
    description: z.string().max(500).nullish(),
    /** Restricted/optional holiday: shown on the calendar, still counted as a working day. */
    optional: z.boolean().default(false),
  })
  .strict();
export type CreateHolidayRequest = z.infer<typeof CreateHolidayRequestSchema>;

export const UpdateHolidayRequestSchema = z
  .object({
    date: IsoDateSchema.optional(),
    name: z.string().min(1).max(120).optional(),
    description: z.string().max(500).nullish(),
    optional: z.boolean().optional(),
  })
  .strict();
export type UpdateHolidayRequest = z.infer<typeof UpdateHolidayRequestSchema>;

export const ListHolidaysQuerySchema = z.object({ year: LeaveYearSchema }).strict();
export type ListHolidaysQuery = z.infer<typeof ListHolidaysQuerySchema>;

// ── Working-week settings ─────────────────────────────────────────────────────────────

export const LeaveSettingSchema = z.object({
  weeklyOffDays: z.array(WeekdaySchema),
});
export type LeaveSetting = z.infer<typeof LeaveSettingSchema>;

export const UpdateLeaveSettingRequestSchema = z
  .object({
    // At most 6: a seven-day weekend would make every request zero-length and every balance
    // permanently full, which is a configuration nobody means and the duration function
    // would report as `no_working_days` forever.
    weeklyOffDays: z.array(WeekdaySchema).max(6),
  })
  .strict();
export type UpdateLeaveSettingRequest = z.infer<typeof UpdateLeaveSettingRequestSchema>;

// ── Requests ──────────────────────────────────────────────────────────────────────────

export const LeaveRequestSummarySchema = z.object({
  id: UuidSchema,
  userId: UuidSchema,
  userName: z.string(),
  leaveTypeId: UuidSchema,
  leaveTypeName: z.string(),
  startDate: IsoDateSchema,
  endDate: IsoDateSchema,
  startDayPart: LeaveDayPartSchema,
  endDayPart: LeaveDayPartSchema,
  halfDays: z.number().int(),
  days: z.number(),
  status: LeaveRequestStatusSchema,
  createdAt: IsoDateTimeSchema,
});
export type LeaveRequestSummary = z.infer<typeof LeaveRequestSummarySchema>;

export const LeaveRequestDetailSchema = LeaveRequestSummarySchema.extend({
  userEmail: z.string().nullable(),
  reason: z.string(),
  /**
   * The FINAL decision — who approved or turned it down. On a two-step chain this is the
   * manager; the team lead who performed step one is the `leadApproved*` trio below.
   */
  reviewedById: UuidSchema.nullable(),
  reviewedByName: z.string().nullable(),
  reviewedAt: IsoDateTimeSchema.nullable(),
  reviewNote: z.string().nullable(),
  /**
   * Step one of a two-step chain (ADR-0070). Null on a single-step one — honestly so:
   * there was no first step, rather than one nobody performed. On a DIRECT approval by HR
   * or the owner this names the same person as `reviewedBy`, which is the trail saying
   * one person did both rather than implying a step that never happened.
   */
  leadApprovedById: UuidSchema.nullable(),
  leadApprovedByName: z.string().nullable(),
  leadApprovedAt: IsoDateTimeSchema.nullable(),
  leadApprovalNote: z.string().nullable(),
  cancelledAt: IsoDateTimeSchema.nullable(),
  updatedAt: IsoDateTimeSchema,
});
export type LeaveRequestDetail = z.infer<typeof LeaveRequestDetailSchema>;

/**
 * No `userId`: the applicant is always the authenticated actor. Accepting one would let
 * anyone holding `leave.request` file leave in a colleague's name, and there is no use case
 * for applying on someone else's behalf that is worth that.
 *
 * No duration either — the server computes `halfDays` from its own holiday and weekly-off
 * data and ignores anything the client thinks the answer is.
 */
export const CreateLeaveRequestRequestSchema = z
  .object({
    leaveTypeId: UuidSchema,
    startDate: IsoDateSchema,
    endDate: IsoDateSchema,
    startDayPart: LeaveDayPartSchema.default("full"),
    endDayPart: LeaveDayPartSchema.default("full"),
    reason: z.string().trim().min(3, "Say why you need the leave.").max(1000),
  })
  .strict();
export type CreateLeaveRequestRequest = z.infer<typeof CreateLeaveRequestRequestSchema>;

export const ApproveLeaveRequestRequestSchema = z
  .object({ note: z.string().trim().max(1000).nullish() })
  .strict();
export type ApproveLeaveRequestRequest = z.infer<typeof ApproveLeaveRequestRequestSchema>;

/**
 * The reason is MANDATORY, and it is emailed to the applicant verbatim. A rejection with no
 * explanation is the thing that makes people re-apply for the same dates, and the reviewer
 * is the only person who knows why.
 */
export const RejectLeaveRequestRequestSchema = z
  .object({ reason: z.string().trim().min(3, "Tell them why it's being turned down.").max(1000) })
  .strict();
export type RejectLeaveRequestRequest = z.infer<typeof RejectLeaveRequestRequestSchema>;

export const ListLeaveRequestsQuerySchema = z
  .object({
    ...PageQuerySchema.shape,
    status: LeaveRequestStatusSchema.optional(),
    leaveTypeId: UuidSchema.optional(),
    /** Ignored unless the caller's `leave.view` scope is `all` — own-scope callers see only themselves. */
    userId: UuidSchema.optional(),
    year: LeaveYearSchema.optional(),
  })
  .strict();
export type ListLeaveRequestsQuery = z.infer<typeof ListLeaveRequestsQuerySchema>;

// ── Balances ──────────────────────────────────────────────────────────────────────────

/**
 * `remainingDays` counts PENDING requests against you, not just approved ones.
 *
 * That is the whole point of the field. If remaining were `entitled - used`, somebody with
 * a 12-day allowance could queue five 10-day requests, see "12 days left" the entire time,
 * and hand the approver a pile that only makes sense two at a time. Holding pending days
 * against the balance is also what makes the block-on-over-application check at apply time
 * agree with the check at approval time — otherwise the form lets a request through that
 * the approver is then forced to refuse.
 *
 * `usedDays` and `pendingDays` are both reported separately so the screen can show where
 * the allowance went, rather than a single number the applicant has to take on trust.
 */
export const LeaveBalanceSchema = z.object({
  leaveTypeId: UuidSchema,
  leaveTypeName: z.string(),
  paid: z.boolean(),
  allowHalfDay: z.boolean(),
  /** Null when no allocation has been set for the year — distinct from an allocation of zero. */
  entitledDays: z.number().nullable(),
  /** Approved leave, already deducted. */
  usedDays: z.number(),
  /** Submitted and awaiting a decision. Held against `remainingDays` until decided. */
  pendingDays: z.number(),
  /** `entitledDays - usedDays - pendingDays`. Null when there is no allocation for the year. */
  remainingDays: z.number().nullable(),
});
export type LeaveBalance = z.infer<typeof LeaveBalanceSchema>;

export const LeaveBalancesResponseSchema = z.object({
  year: z.number().int(),
  userId: UuidSchema,
  userName: z.string(),
  balances: z.array(LeaveBalanceSchema),
});
export type LeaveBalancesResponse = z.infer<typeof LeaveBalancesResponseSchema>;

export const GetLeaveBalancesQuerySchema = z
  .object({
    year: LeaveYearSchema.optional(),
    /** Ignored unless the caller's scope is `all`. */
    userId: UuidSchema.optional(),
  })
  .strict();
export type GetLeaveBalancesQuery = z.infer<typeof GetLeaveBalancesQuerySchema>;

// ── Calendar ──────────────────────────────────────────────────────────────────────────

/**
 * One person's absence as everyone else sees it. There is deliberately NO `reason` field:
 * the calendar answers "who is out on Thursday", which the team needs in order to plan, and
 * "why are they out", which is between the applicant and the approver. Only the requester's
 * own rows carry it, and they get it from the request detail endpoint, not from here.
 */
export const LeaveCalendarEntrySchema = z.object({
  id: UuidSchema,
  userId: UuidSchema,
  userName: z.string(),
  leaveTypeName: z.string(),
  startDate: IsoDateSchema,
  endDate: IsoDateSchema,
  startDayPart: LeaveDayPartSchema,
  endDayPart: LeaveDayPartSchema,
  status: LeaveRequestStatusSchema,
  /** True for the caller's own leave — the CRM tints these differently. */
  isSelf: z.boolean(),
});
export type LeaveCalendarEntry = z.infer<typeof LeaveCalendarEntrySchema>;

export const LeaveCalendarResponseSchema = z.object({
  from: IsoDateSchema,
  to: IsoDateSchema,
  weeklyOffDays: z.array(WeekdaySchema),
  holidays: z.array(HolidaySchema),
  /** Approved leave for everyone, plus the caller's own still-pending requests. */
  entries: z.array(LeaveCalendarEntrySchema),
});
export type LeaveCalendarResponse = z.infer<typeof LeaveCalendarResponseSchema>;

export const GetLeaveCalendarQuerySchema = z
  .object({
    from: IsoDateSchema,
    to: IsoDateSchema,
    /**
     * `team` narrows the calendar to the viewer's own team (P17-5). Default is the whole
     * company, which is what the calendar has always shown and what makes it useful for
     * "who else is out that week".
     *
     * The narrowing is a CONVENIENCE, not a privacy control — the projection behind this
     * endpoint never selects `reason` at any setting, so there is nothing here for a wider
     * view to leak. See LEAVE_CALENDAR_SELECT.
     */
    scope: z.enum(["company", "team"]).default("company"),
  })
  .strict()
  .refine((v) => v.from <= v.to, { message: "`from` must not be after `to`", path: ["from"] });
export type GetLeaveCalendarQuery = z.infer<typeof GetLeaveCalendarQuerySchema>;

// ── Apply-form bootstrap ──────────────────────────────────────────────────────────────

/**
 * Everything the apply form needs to compute a duration in the browser, in one call. Split
 * out rather than making the form fetch types + holidays + settings separately, because the
 * three have to be consistent with each other: a form holding last week's holiday list would
 * show a day count the API then disagrees with, at the moment the applicant hits save.
 */
export const LeaveApplyContextSchema = z.object({
  year: z.number().int(),
  weeklyOffDays: z.array(WeekdaySchema),
  /** Mandatory holidays only — optional ones are working days and must not be skipped. */
  holidayDates: z.array(IsoDateSchema),
  types: z.array(LeaveTypeSchema),
  balances: z.array(LeaveBalanceSchema),
});
export type LeaveApplyContext = z.infer<typeof LeaveApplyContextSchema>;

export const GetLeaveApplyContextQuerySchema = z.object({ year: LeaveYearSchema.optional() }).strict();
export type GetLeaveApplyContextQuery = z.infer<typeof GetLeaveApplyContextQuerySchema>;
