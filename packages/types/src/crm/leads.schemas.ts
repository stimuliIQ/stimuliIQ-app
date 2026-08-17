// Leads contract — Phase 2, Wave 2 (docs/plans/phase-2.md task #2).
//
// Lead pipeline (docs/03 §7.11, §7.12):
//   Stages: new → contacted → qualified → counselling → negotiation → won | lost
//   Owner: `owner_id` (FK users) — this is the field that makes counsellor
//   `own`/`assigned` scope real in P2 (resolves the P1 deferral; see
//   phase-2.md §"Preconditions" + §"Risks #5").
//
// Scope rules (docs/03 §9, backend enforces via ScopeInterceptor):
//   - Counsellor: `own` (owner_id = current_user) OR `assigned`
//     (owner_id = current_user OR same branch).
//   - Marketing: `all`.
//   - BranchManager: `branch` (leads where branch_id matches actor's branch).
//   - Owner/Admin: `all`.
//
// ConvertLeadRequest (lead → student + optional order/enrollment):
//   The conversion is an atomic $transaction in the backend:
//   1. Create `student_profile` (using `studentFields`).
//   2. Set `leads.converted_student_id` and `leads.stage = won`.
//   3. If `programId` + `batchId` are provided: call the commerce service to
//      create an order (with `source = conversion`) and enrollment in one
//      transaction. If commerce fields are omitted: student is created without
//      an order (staff can create the order separately later).
//   This shape is the ONLY place a lead becomes a student — there is no
//   separate "mark as won" + "create student" flow. The conversion action
//   itself sets stage = won atomically.
//
// `program_interest` is a UUID FK to programs (not a string) — db-architect
// made it a FK in P2 schema (phase-2.md task description). The create/update
// request accepts a `programInterestId` UUID.
//
// `source` is a free-form string (docs/03 §7.11: "lead source + UTM") — not
// an enum in P2 since sources vary by business (e.g. "referral", "website",
// "walk-in", "facebook", "instagram", "naukri"). The backend may validate
// against a configurable list; contract keeps it as a non-empty string.
//
// `utm` is a JSON blob stored as-is; shape here is a typed helper.

import { z } from "zod";
import { UuidSchema, PhoneSchema, IsoDateTimeSchema, BooleanQueryFlagSchema } from "../common/primitives.js";
import { PageQuerySchema } from "../common/pagination.js";
import { CreateStudentRequestSchema } from "./students.schemas.js";
import { LifecycleStageSchema } from "./lifecycle.schemas.js";

// ─────────────────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────────────────

/**
 * Lead pipeline stages — SIMPLIFIED to a 4-stage model (2026-07 UX redesign):
 *   new       — a fresh lead ("stranger"), no contact yet
 *   follow_up — we're in touch; a callback is scheduled (see slaDueAt / followUpAt)
 *   won       — ready to enrol (convert to student)
 *   lost       — not proceeding
 *
 * Replaces the former 7-stage funnel (contacted/qualified/counselling/negotiation
 * all collapsed into `follow_up`). A lead can be converted to a student from ANY
 * non-lost, not-yet-converted stage in one click (no linear stepping) — see
 * ConvertLeadRequest + leads.service.ts.
 */
export const LeadStageSchema = z.enum(["new", "follow_up", "won", "lost"]);
export type LeadStage = z.infer<typeof LeadStageSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Sub-schemas
// ─────────────────────────────────────────────────────────────────────────

/** UTM tracking parameters stored on the lead (from `leads.utm` JSON column). */
export const LeadUtmSchema = z.object({
  source: z.string().optional(),
  medium: z.string().optional(),
  campaign: z.string().optional(),
  term: z.string().optional(),
  content: z.string().optional(),
});
export type LeadUtm = z.infer<typeof LeadUtmSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Requests
// ─────────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/crm/leads
 *
 * Creates a new lead. `phone` must be unique per tenant (server-enforced;
 * a duplicate phone is a 409 conflict). `email` is optional but recommended.
 *
 * Clients must NOT send `id`, `tenantId`, `stage` (defaults to `new`),
 * `used`, `convertedStudentId`, or `score` — these are server-managed.
 *
 * `Idempotency-Key` header required (docs/04 §2.6).
 */
export const CreateLeadRequestSchema = z
  .object({
    name: z.string().min(1).max(200),
    phone: PhoneSchema,
    email: z.string().email().max(254).optional(),
    programInterestId: UuidSchema.optional().describe(
      "FK to programs.id — the program this lead is interested in.",
    ),
    source: z
      .string()
      .min(1)
      .max(120)
      .describe("Lead source label, e.g. 'website', 'referral', 'facebook'."),
    branchId: UuidSchema.optional().describe("Branch this lead is associated with."),
    ownerId: UuidSchema.optional().describe(
      "User to assign as lead owner. If omitted, backend may apply round-robin assignment.",
    ),
    utm: LeadUtmSchema.optional(),
    score: z.number().int().min(0).max(100).optional().describe("Manual lead score 0–100."),
    slaDueAt: z.string().datetime({ offset: true }).optional().describe("SLA follow-up deadline."),
  })
  .strict();
export type CreateLeadRequest = z.infer<typeof CreateLeadRequestSchema>;

/**
 * PATCH /api/v1/crm/leads/:id
 *
 * Partial update of mutable lead fields. Stage transitions use the dedicated
 * PATCH /crm/leads/:id/stage endpoint (which writes an audit log entry for
 * the kanban move). Owner changes use PATCH /crm/leads/:id/owner.
 * `convertedStudentId` is NOT settable here — use the /convert endpoint.
 *
 * `Idempotency-Key` header required.
 */
export const UpdateLeadRequestSchema = z
  .object({
    name: z.string().min(1).max(200),
    phone: PhoneSchema,
    email: z.string().email().max(254),
    programInterestId: UuidSchema,
    source: z.string().min(1).max(120),
    branchId: UuidSchema,
    utm: LeadUtmSchema,
    score: z.number().int().min(0).max(100),
    slaDueAt: z.string().datetime({ offset: true }).nullable(),
  })
  .partial()
  .strict();
export type UpdateLeadRequest = z.infer<typeof UpdateLeadRequestSchema>;

// `BooleanQueryFlagSchema` used to be defined locally here, for the owner filters below
// only, with a note that retro-fitting the other `z.coerce.boolean()` filters was "a
// separate, behaviour-changing edit". That edit has now happened: the footgun it warned
// about was shipping soft-deleted rows into every CRM list, so the schema moved to
// ../common/primitives.js and the `includeDeleted` filters across faculty/students/
// batches/courses/mentors now use it too. Imported at the top of this file.

/**
 * The lead-list filter shape WITHOUT the cross-field rule below. Exported separately
 * because `ExportLeadsParamsSchema` needs `.omit()`, and `.omit()` does not exist on the
 * ZodEffects that `.superRefine()` produces.
 */
export const ListLeadsQueryBaseSchema = z
  .object({
    stage: LeadStageSchema.optional(),
    ownerId: UuidSchema.optional().describe("Filter by assigned owner."),
    /**
     * "Assigned to me" — resolved SERVER-SIDE from the session, so the client never has
     * to know its own user id to ask this (and cannot ask it on someone else's behalf).
     * This is the filter that makes a `marketing` user, whose scope is tenant-wide `all`,
     * able to narrow a 5,000-lead pipeline down to the handful actually on their desk.
     * Mutually exclusive with `ownerId` and `unassigned` — sending more than one is a 422.
     */
    mine: BooleanQueryFlagSchema.optional().describe("If true, filter to leads owned by the caller."),
    /**
     * Leads with no owner at all. This is the queue that must never be silently empty —
     * an unassigned lead is one nobody is accountable for.
     */
    unassigned: BooleanQueryFlagSchema.optional().describe("If true, filter to leads with no owner."),
    /** Filter by the staff user who keyed the lead in (null/absent = inbound web leads). */
    createdById: UuidSchema.optional().describe("Filter by the staff user who created the lead."),
    source: z.string().min(1).max(120).optional(),
    branchId: UuidSchema.optional(),
    programInterestId: UuidSchema.optional(),
    slaOverdue: z.coerce
      .boolean()
      .optional()
      .describe("If true, filter to leads where sla_due_at < now and stage not won/lost."),
    search: z.string().min(1).max(200).optional().describe("Match by name, phone, or email."),
  })
  .merge(PageQuerySchema)
  .strict();

/** GET /api/v1/crm/leads — filter/paginate the lead pipeline. */
export const ListLeadsQuerySchema = ListLeadsQueryBaseSchema
  .superRefine((data, ctx) => {
    // These three answer the same question ("whose lead is this?") in incompatible ways.
    // Silently letting one win would make a saved view lie about what it is showing.
    const ownerFilters = [data.ownerId ? "ownerId" : null, data.mine ? "mine" : null, data.unassigned ? "unassigned" : null].filter(
      (key): key is string => key !== null,
    );
    if (ownerFilters.length > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [ownerFilters[1]!],
        message: `Only one owner filter may be used at a time (got: ${ownerFilters.join(", ")}).`,
      });
    }
  });
export type ListLeadsQuery = z.infer<typeof ListLeadsQuerySchema>;

/**
 * GET /api/v1/crm/leads/assignable-users
 *
 * The people a lead can be handed to. Deliberately NOT the Admin ▸ Users list: that one
 * is gated on `users.view`, which only super_admin/admin hold, so a counsellor or a
 * marketing rep could never populate an owner picker from it. This endpoint is gated on
 * `leads.view` instead and returns the minimum a picker needs — no email-less PII dump,
 * no credential/2FA state, no soft-deleted or deactivated accounts.
 *
 * `openLeadCount` is included because the person doing the assigning needs to see who is
 * already buried before they add one more; it is the same "currently-open owned leads"
 * number the round-robin balances on.
 */
export const AssignableUserSchema = z
  .object({
    id: UuidSchema,
    name: z.string(),
    email: z.string().nullable().describe("Shown as a disambiguator when two staff share a name."),
    roleKeys: z.array(z.string()).describe("Role keys held by this user, e.g. ['counsellor']."),
    openLeadCount: z.number().int().min(0).describe("Leads they currently own that are not won/lost."),
  })
  .strict();
export type AssignableUser = z.infer<typeof AssignableUserSchema>;

/** GET /api/v1/crm/leads/assignable-users query. */
export const ListAssignableUsersQuerySchema = z
  .object({
    search: z.string().min(1).max(200).optional().describe("Match by name or email."),
  })
  .strict();
export type ListAssignableUsersQuery = z.infer<typeof ListAssignableUsersQuerySchema>;

/**
 * PATCH /api/v1/crm/leads/:id/stage
 *
 * Kanban stage transition. The backend writes an audit log row for the
 * before/after stage change. Only valid transitions are accepted server-side
 * (e.g. `lost` cannot move back to `won`; `won` is terminal for conversion).
 * In P2 the contract does not enumerate valid transitions — the backend service
 * owns the state machine.
 *
 * `Idempotency-Key` header required.
 */
export const MoveLeadStageRequestSchema = z
  .object({
    stage: LeadStageSchema,
    reason: z.string().max(500).optional().describe("Optional reason for the stage change (for activity log)."),
    /**
     * Scheduled follow-up date/time. Set when moving a lead to `follow_up` so the
     * callback surfaces in the SLA/tasks queue — the backend writes it to the lead's
     * `slaDueAt`. Ignored (and cleared) for terminal stages (won/lost).
     */
    followUpAt: IsoDateTimeSchema.optional().describe("Scheduled follow-up datetime (used when stage=follow_up)."),
  })
  .strict();
export type MoveLeadStageRequest = z.infer<typeof MoveLeadStageRequestSchema>;

/**
 * PATCH /api/v1/crm/leads/:id/owner
 *
 * Manual owner assignment. The backend records the previous owner and writes
 * an audit log row. If `ownerId` is null, the lead is unassigned.
 *
 * `Idempotency-Key` header required.
 */
export const AssignLeadOwnerRequestSchema = z
  .object({
    ownerId: UuidSchema.nullable().describe("User to assign as owner, or null to unassign."),
    reason: z.string().max(500).optional(),
  })
  .strict();
export type AssignLeadOwnerRequest = z.infer<typeof AssignLeadOwnerRequestSchema>;

/**
 * POST /api/v1/crm/leads/:id/convert
 *
 * Converts a won lead into a student (+ optionally creates an order/enrollment).
 * This is the ATOMIC lead→student conversion transaction (phase-2.md §"Success
 * criteria 8" + §"Risks" on conversion atomicity):
 *
 *   DB $transaction:
 *   1. Validate lead is not `lost` and not already converted (convert-from-any-stage:
 *      the redesign lets staff convert a New/Follow-up/Won lead in one click).
 *   2. Create `student_profile` using `studentFields` (flat merge per students.schemas.ts).
 *   3. Set `leads.converted_student_id = new student_profiles.id`.
 *   4. Set `leads.stage = won`.
 *   5. If `programId` + `batchId` provided:
 *      a. Create an order (source = conversion, server computes amount).
 *      b. Create an enrollment (source = conversion, linked to order).
 *   6. Write audit log row.
 *
 * `studentFields` is a subset of CreateStudentRequest — required fields are
 * `name`, `email`, `courseType`. Phone is taken from the lead if not overridden.
 *
 * `Idempotency-Key` header required (critical — prevents double-conversion on retry).
 */
export const ConvertLeadRequestSchema = z
  .object({
    studentFields: CreateStudentRequestSchema.describe(
      "Fields for the new student_profile row. `name`/`phone` default from the lead if omitted.",
    ),
    programId: UuidSchema.optional().describe(
      "If provided (with batchId), an order + enrollment are created atomically. " +
        "Omit to create the student without an order (order can be created separately).",
    ),
    batchId: UuidSchema.optional().describe(
      "Required if programId is provided. The batch to enroll the new student into.",
    ),
    couponCode: z
      .string()
      .min(1)
      .max(50)
      .optional()
      .describe("Optional coupon to apply to the order (if programId/batchId are provided)."),
    notes: z.string().max(500).optional().describe("Conversion notes for the audit log."),
  })
  .strict()
  .superRefine((data, ctx) => {
    // If one of programId/batchId is provided, both must be provided.
    const hasProgramId = !!data.programId;
    const hasBatchId = !!data.batchId;
    if (hasProgramId !== hasBatchId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: hasProgramId ? ["batchId"] : ["programId"],
        message: "Both programId and batchId must be provided together to create an order/enrollment on conversion.",
      });
    }
  });
export type ConvertLeadRequest = z.infer<typeof ConvertLeadRequestSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Response DTOs
// ─────────────────────────────────────────────────────────────────────────

/** Row shape for the lead pipeline list / kanban. */
export const LeadSummarySchema = z.object({
  id: UuidSchema,
  name: z.string(),
  phone: z.string(),
  email: z.string().nullable(),
  stage: LeadStageSchema,
  source: z.string(),
  programInterestId: UuidSchema.nullable(),
  programInterestTitle: z.string().nullable(),
  branchId: UuidSchema.nullable(),
  branchName: z.string().nullable(),
  ownerId: UuidSchema.nullable(),
  ownerName: z.string().nullable(),
  // ── Accountability (lead-ownership pass) ────────────────────────────────
  // On the SUMMARY, not just the detail, so the pipeline table can answer
  // "whose is this, who gave it to them, and have they touched it yet?"
  // without a per-row fetch.
  /** Staff user who keyed this lead in. null = inbound (website form / API). */
  createdById: UuidSchema.nullable(),
  createdByName: z.string().nullable().describe("null means the lead came in from the public site, not a person."),
  /** Staff user who set the current owner. null = round-robin, nobody assigned it by hand. */
  assignedById: UuidSchema.nullable(),
  assignedByName: z.string().nullable(),
  /** When the current owner was set. */
  assignedAt: IsoDateTimeSchema.nullable(),
  /** First logged call/whatsapp/email/note. null = NOBODY HAS CONTACTED THIS LEAD YET. */
  firstContactedAt: IsoDateTimeSchema.nullable(),
  /** Most recent logged activity — drives the "going cold" sort. */
  lastActivityAt: IsoDateTimeSchema.nullable(),
  score: z.number().int().nullable(),
  slaDueAt: IsoDateTimeSchema.nullable(),
  convertedStudentId: UuidSchema.nullable(),
  // Unified lifecycle stage (lifecycle-redesign P1) — DERIVED from this lead's
  // stage + owner + conversion state so the pipeline and the student directory
  // speak one vocabulary. For an unconverted lead this tracks the pre-sales rungs
  // (new_lead → assigned → contacted → interested → registration_started); once
  // converted, the student record's own richer signals take over.
  lifecycleStage: LifecycleStageSchema,
  // Marketing lead-popup context (nullable — most leads never set these).
  // In the summary (not just the detail) so the pipeline list/board can show
  // what a popup lead actually asked for when programInterestId is null.
  courseInterest: z.string().nullable(),
  college: z.string().nullable(),
  language: z.string().nullable(),
  createdAt: IsoDateTimeSchema,
});
export type LeadSummary = z.infer<typeof LeadSummarySchema>;

/** Full lead detail including UTM + conversion context. */
export const LeadDetailSchema = LeadSummarySchema.extend({
  utm: LeadUtmSchema.nullable(),
  // Free-text message the visitor typed into the marketing popup's message box
  // (detail-only — long text, not needed on the pipeline list/board).
  message: z.string().nullable(),
  activityCount: z.number().int().min(0),
  bookingCount: z.number().int().min(0),
  updatedAt: IsoDateTimeSchema,
  deletedAt: IsoDateTimeSchema.nullable(),
});
export type LeadDetail = z.infer<typeof LeadDetailSchema>;

/** Response for POST /crm/leads/:id/convert */
export const ConvertLeadResponseSchema = z.object({
  leadId: UuidSchema,
  studentId: UuidSchema.describe("Newly created student_profiles.id."),
  orderId: UuidSchema.nullable().describe("Created order id, or null if no order was created."),
  enrollmentId: UuidSchema.nullable().describe("Created enrollment id, or null if no order was created."),
});
export type ConvertLeadResponse = z.infer<typeof ConvertLeadResponseSchema>;
