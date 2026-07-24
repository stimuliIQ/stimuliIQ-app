// Unified student lifecycle — the single source of truth for
// "where is this person in the Lead → … → Certified journey?".
//
// DESIGN (lifecycle-redesign P1): the lifecycle stage is DERIVED, not stored.
// The system already tracks the underlying facts across three disjoint enums —
// `Lead.stage`, `StudentProfile.status`, `Enrollment.status`/`progressPct` —
// plus the commerce order/payment state and certificate issuance. Rather than
// add a 15th enum column and a forward-only migration + backfill (which would
// touch the core tables and ~147 test suites), we compute the unified stage
// on read from those existing signals. This keeps a single canonical answer
// for the UI without duplicating state that could drift.
//
// `resolveLifecycleStage()` is a PURE function shared by FE and BE: the API
// computes it onto student/lead DTOs, and the CRM/LMS render it as one chip.

import { z } from "zod";
// TYPE-ONLY imports (erased at runtime) — this module is deliberately a runtime
// LEAF so `students.schemas.ts` can import `LifecycleStageSchema` from here without
// creating a circular value dependency. The input enums are re-declared locally as
// value arrays and pinned to the canonical types by the parity assertions below, so
// any drift in the source enums fails the typecheck rather than silently diverging.
import type { LeadStage } from "./leads.schemas.js";
import type { StudentStatus } from "./students.schemas.js";
import type { EnrollmentStatus } from "./enrollments.schemas.js";

// Kept in lock-step with LeadStageSchema (leads.schemas.ts) via the parity guards
// below. The 4-stage model (2026-07 redesign): new → follow_up → won | lost.
const LEAD_STAGE_VALUES = ["new", "follow_up", "won", "lost"] as const;
const STUDENT_STATUS_VALUES = ["lead", "active", "alumni"] as const;
const ENROLLMENT_STATUS_VALUES = ["active", "completed", "dropped"] as const;

// Bidirectional equality guards: if the canonical enum in leads/students/enrollments
// schemas ever changes, one of these assignments stops type-checking and forces this
// leaf to be updated in lock-step (no runtime coupling, no silent drift).
const _leadFwd: LeadStage = null as unknown as (typeof LEAD_STAGE_VALUES)[number];
const _leadRev: (typeof LEAD_STAGE_VALUES)[number] = null as unknown as LeadStage;
const _studentFwd: StudentStatus = null as unknown as (typeof STUDENT_STATUS_VALUES)[number];
const _studentRev: (typeof STUDENT_STATUS_VALUES)[number] = null as unknown as StudentStatus;
const _enrollFwd: EnrollmentStatus = null as unknown as (typeof ENROLLMENT_STATUS_VALUES)[number];
const _enrollRev: (typeof ENROLLMENT_STATUS_VALUES)[number] = null as unknown as EnrollmentStatus;
// The six `_`-prefixed consts above exist ONLY for their type side (the eslint
// no-unused-vars rule allows the leading-underscore names); they compile to dead
// assignments that a bundler drops.

const LeadStageSchema = z.enum(LEAD_STAGE_VALUES);
const StudentStatusSchema = z.enum(STUDENT_STATUS_VALUES);
const EnrollmentStatusSchema = z.enum(ENROLLMENT_STATUS_VALUES);

// ─────────────────────────────────────────────────────────────────────────
// Enum — the 13 forward stages from the product brief, plus two terminal
// off-ramps (`lost`, `dropped`) that any real pipeline needs. Ordered from
// first touch to fully certified; the two terminals sit outside the ladder.
// ─────────────────────────────────────────────────────────────────────────

export const LifecycleStageSchema = z.enum([
  "new_lead", //             a lead has landed, not yet assigned to anyone
  "assigned", //             assigned to a counsellor/owner, not yet contacted
  "contacted", //            first outreach made
  "interested", //           qualified / in counselling — showing intent
  "registration_started", // in negotiation — converting to a student
  "registered", //           converted to a student record, no program yet
  "program_assigned", //     enrolled into a program+batch, payment not done
  "payment_pending", //      an order exists and is awaiting payment
  "payment_completed", //    payment captured, not yet actively learning
  "active_student", //       enrollment active, no lesson progress yet
  "learning_in_progress", // actively progressing through the course
  "course_completed", //     all completion criteria met, course finished
  "certified", //            certificate issued — journey complete
  // ── terminal off-ramps (not part of the forward ladder) ──
  "lost", //                 lead marked lost before converting
  "dropped", //              enrolled student who withdrew / was dropped
]);
export type LifecycleStage = z.infer<typeof LifecycleStageSchema>;

/**
 * Forward-ladder ordinal for each stage. Used to pick the FURTHEST-ALONG stage
 * when multiple signals are present (e.g. a converted lead that is also a
 * paying student). Terminal stages are handled separately and are NOT ranked
 * here (they win only when there is no further forward progress).
 */
const STAGE_ORDINAL: Record<Exclude<LifecycleStage, "lost" | "dropped">, number> = {
  new_lead: 0,
  assigned: 1,
  contacted: 2,
  interested: 3,
  registration_started: 4,
  registered: 5,
  program_assigned: 6,
  payment_pending: 7,
  payment_completed: 8,
  active_student: 9,
  learning_in_progress: 10,
  course_completed: 11,
  certified: 12,
};

// ─────────────────────────────────────────────────────────────────────────
// Resolver input — a normalized bundle of the signals the caller has on hand.
// Every field is optional so the SAME function works from the lead side (only
// `lead` known) and the student side (student + enrollment + order + cert).
// ─────────────────────────────────────────────────────────────────────────

export const LifecycleSignalsSchema = z.object({
  /** The originating/associated lead, if any. */
  lead: z
    .object({
      stage: LeadStageSchema,
      /** Whether an owner (counsellor) is assigned — distinguishes new_lead vs assigned. */
      hasOwner: z.boolean().default(false),
      /** Set once the lead has been converted to a student. */
      converted: z.boolean().default(false),
    })
    .nullable()
    .optional(),
  /** The student record, once one exists (post-conversion). */
  student: z
    .object({
      status: StudentStatusSchema,
    })
    .nullable()
    .optional(),
  /**
   * The student's most-advanced enrollment, if any. `progressPct` is 0–100.
   */
  enrollment: z
    .object({
      status: EnrollmentStatusSchema,
      progressPct: z.number().int().min(0).max(100).default(0),
    })
    .nullable()
    .optional(),
  /** Commerce order state for the enrollment, if an order exists. */
  order: z
    .object({
      /** True once payment is captured/paid for this order. */
      paid: z.boolean().default(false),
    })
    .nullable()
    .optional(),
  /** Whether an active certificate has been issued for this student. */
  hasCertificate: z.boolean().default(false).optional(),
});
export type LifecycleSignals = z.infer<typeof LifecycleSignalsSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Resolver
// ─────────────────────────────────────────────────────────────────────────

/**
 * Resolve the unified lifecycle stage from whatever signals the caller has.
 *
 * Strategy: build the set of forward-ladder stages each present signal
 * implies, then return the furthest-along one. Terminal off-ramps (`lost`,
 * `dropped`) only win when there is genuinely no forward progress beyond them,
 * so a student who dropped mid-course reads `dropped`, but a lead that was
 * marked lost yet later converted reads by its student progress instead.
 *
 * The function never throws — with an empty bundle it returns `new_lead`
 * (the safe "just arrived" default).
 */
export function resolveLifecycleStage(signals: LifecycleSignals): LifecycleStage {
  const { lead, student, enrollment, order, hasCertificate } = signals;

  // 1. Certificate is the top of the ladder — unambiguous terminal-in-a-good-way.
  if (hasCertificate) return "certified";

  // 2. A dropped enrollment is a terminal off-ramp: the student was enrolled
  //    and left. It wins over any lower forward stage (they got further than a
  //    lead), but certified above already short-circuited the happy path.
  if (enrollment?.status === "dropped") return "dropped";

  const candidates: number[] = [];

  // 3. Enrollment-derived forward stages.
  if (enrollment) {
    if (enrollment.status === "completed" || enrollment.progressPct >= 100) {
      candidates.push(STAGE_ORDINAL.course_completed);
    } else if (enrollment.progressPct > 0) {
      candidates.push(STAGE_ORDINAL.learning_in_progress);
    } else {
      // Active enrollment with no progress yet = an active student.
      candidates.push(STAGE_ORDINAL.active_student);
    }
  }

  // 4. Commerce-derived forward stages.
  if (order) {
    candidates.push(order.paid ? STAGE_ORDINAL.payment_completed : STAGE_ORDINAL.payment_pending);
  } else if (enrollment) {
    // Enrolled with no order (manual/roster enrollment): the program+batch are
    // assigned even though there is no commerce record.
    candidates.push(STAGE_ORDINAL.program_assigned);
  }

  // 5. Student-record-derived stage: existing but not yet enrolled = registered.
  if (student) {
    candidates.push(STAGE_ORDINAL.registered);
  }

  // 6. Lead-derived forward stages (only meaningful before conversion; once a
  //    student exists the student/enrollment signals above dominate anyway).
  if (lead && !lead.converted) {
    switch (lead.stage) {
      case "new":
        candidates.push(lead.hasOwner ? STAGE_ORDINAL.assigned : STAGE_ORDINAL.new_lead);
        break;
      case "follow_up":
        // "In touch, callback scheduled" — the single mid-funnel state. Maps to the
        // derived lifecycle `contacted` phase (the old contacted/qualified/counselling/
        // negotiation stages all collapsed into follow_up).
        candidates.push(STAGE_ORDINAL.contacted);
        break;
      case "won":
        // Won but not yet materialized as a student record — treat as registered.
        candidates.push(STAGE_ORDINAL.registered);
        break;
      case "lost":
        // No forward progress at all AND lost AND never converted → terminal.
        if (candidates.length === 0 && !student) return "lost";
        break;
    }
  }

  if (candidates.length === 0) return "new_lead";

  const maxOrdinal = Math.max(...candidates);
  const stage = (Object.keys(STAGE_ORDINAL) as Array<Exclude<LifecycleStage, "lost" | "dropped">>).find(
    (key) => STAGE_ORDINAL[key] === maxOrdinal,
  );
  return stage ?? "new_lead";
}

// ─────────────────────────────────────────────────────────────────────────
// Presentation helpers — shared so all three apps label the stage identically.
// ─────────────────────────────────────────────────────────────────────────

/** Human-readable label for a lifecycle stage (Title Case). */
export const LIFECYCLE_STAGE_LABELS: Record<LifecycleStage, string> = {
  new_lead: "New Lead",
  assigned: "Assigned",
  contacted: "Contacted",
  interested: "Interested",
  registration_started: "Registration Started",
  registered: "Registered",
  program_assigned: "Program Assigned",
  payment_pending: "Payment Pending",
  payment_completed: "Payment Completed",
  active_student: "Active Student",
  learning_in_progress: "Learning In Progress",
  course_completed: "Course Completed",
  certified: "Certified",
  lost: "Lost",
  dropped: "Dropped",
};

/**
 * Coarse phase grouping for coloring the chip: pre-sales (lead), sales
 * (converting), enrolled (paying/active), success (done), or off-ramp.
 */
export type LifecyclePhase = "lead" | "sales" | "enrolled" | "success" | "off_ramp";

export const LIFECYCLE_STAGE_PHASE: Record<LifecycleStage, LifecyclePhase> = {
  new_lead: "lead",
  assigned: "lead",
  contacted: "lead",
  interested: "lead",
  registration_started: "sales",
  registered: "sales",
  program_assigned: "sales",
  payment_pending: "sales",
  payment_completed: "enrolled",
  active_student: "enrolled",
  learning_in_progress: "enrolled",
  course_completed: "success",
  certified: "success",
  lost: "off_ramp",
  dropped: "off_ramp",
};
