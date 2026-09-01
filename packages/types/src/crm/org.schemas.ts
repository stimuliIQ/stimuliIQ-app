// Org hierarchy — teams, managers, team leads (docs/specs/org-teams.md, ADR-0069).
//
// WHY THIS FILE EXISTS: the product had no employee hierarchy of any kind. A grep of the
// schema for `team|manager|supervisor|reportsTo` returned nothing; the only org-partitioning
// column was `user_roles.branch_id`, a flat per-assignment tag. `branch_manager` was a role
// key with no FK to the branch it managed and no subordinates. The visible cost was leave:
// the approver list was hardcoded to "every active super_admin", so one person signed off
// every absence in the company.
//
// SHAPE: Manager -> Team Lead -> Members, held as two nullable pointers ON THE TEAM
// (`managerUserId`, `leadUserId`) rather than a recursive `users.reports_to_id`. A recursive
// parent pointer needs cycle detection on every write and an unbounded walk on every
// approval. Two pointers give a FIXED-DEPTH chain — member -> lead -> manager -> super_admin,
// at most three hops — which resolves in one read and cannot form a cycle by construction.
// The cycle question does not get answered here; it gets designed away.
//
// MEMBERSHIP is exactly one team per person, stored as a nullable `users.team_id` rather
// than a join table. One column makes the wrong state unrepresentable; a join needs a
// partial-unique index to say the same thing and can drift. Two teams would mean two leads
// and two managers, which makes "who approves your leave" a non-function.
//
// BRANCHES ARE UNTOUCHED. A branch is a PLACE (which centre a batch or student belongs to);
// a team is PEOPLE (who reports to whom). `Team.branchId` is a label, and nothing scopes on
// it — the branch axis stays exactly where it was.

import { z } from "zod";
import { UuidSchema, IsoDateTimeSchema } from "../common/primitives.js";
import { PageQuerySchema } from "../common/pagination.js";

// ─────────────────────────────────────────────────────────────────────────
// Team DTOs
// ─────────────────────────────────────────────────────────────────────────

export const TeamNameSchema = z.string().trim().min(1).max(120);

/** A person as they appear on a team: enough to render a row, never more. */
export const TeamPersonSchema = z.object({
  id: UuidSchema,
  name: z.string(),
  email: z.string(),
});
export type TeamPerson = z.infer<typeof TeamPersonSchema>;

export const TeamSchema = z.object({
  id: UuidSchema,
  name: TeamNameSchema,
  /**
   * Both nullable ON PURPOSE. A team is routinely created before its lead is hired or
   * named, and a NOT NULL here would force whoever creates it to invent an answer — the
   * mistake P16 undid on `student_profiles.course_type`. An unresolved pointer SHORTENS the
   * approval chain (see `resolveLeaveApprovalChain`) rather than stranding the request, and
   * shows up in the UI as a named gap rather than a fabricated one.
   */
  manager: TeamPersonSchema.nullable(),
  lead: TeamPersonSchema.nullable(),
  /** Informational only — which office this team mostly sits in. Nothing scopes on it. */
  branchId: UuidSchema.nullable(),
  branchName: z.string().nullable(),
  active: z.boolean(),
  memberCount: z.number().int().min(0),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type Team = z.infer<typeof TeamSchema>;

/** One team plus its roster, for the team detail screen. */
export const TeamDetailSchema = TeamSchema.extend({
  members: z.array(TeamPersonSchema),
});
export type TeamDetail = z.infer<typeof TeamDetailSchema>;

export const ListTeamsQuerySchema = PageQuerySchema.extend({
  q: z.string().trim().max(120).optional(),
  active: z.coerce.boolean().optional(),
});
export type ListTeamsQuery = z.infer<typeof ListTeamsQuerySchema>;

export const CreateTeamRequestSchema = z
  .object({
    name: TeamNameSchema,
    managerUserId: UuidSchema.nullable().optional(),
    leadUserId: UuidSchema.nullable().optional(),
    branchId: UuidSchema.nullable().optional(),
    active: z.boolean().default(true),
  })
  .strict();
export type CreateTeamRequest = z.infer<typeof CreateTeamRequestSchema>;

export const UpdateTeamRequestSchema = CreateTeamRequestSchema.partial().strict();
export type UpdateTeamRequest = z.infer<typeof UpdateTeamRequestSchema>;

/** PUT /crm/org/teams/:id/members — the whole roster in one call. */
export const SetTeamMembersRequestSchema = z
  .object({
    userIds: z.array(UuidSchema).max(500),
  })
  .strict();
export type SetTeamMembersRequest = z.infer<typeof SetTeamMembersRequestSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Team assignment rules — one definition, run on both sides
// ─────────────────────────────────────────────────────────────────────────

/**
 * What can be wrong with a proposed manager/lead pairing. Codes rather than sentences so the
 * API can map them to a 422 body and the CRM can render its own copy against the same set —
 * the `LeaveDurationIssueCode` precedent.
 */
export const TeamAssignmentIssueCodeSchema = z.enum([
  "manager_is_lead",
  "manager_is_member",
  "lead_is_member",
]);
export type TeamAssignmentIssueCode = z.infer<typeof TeamAssignmentIssueCodeSchema>;

export interface TeamAssignmentInput {
  managerUserId: string | null;
  leadUserId: string | null;
  /** The roster as it will be after this save. */
  memberUserIds: string[];
}

/**
 * The rules a team's people must satisfy, checked identically by the CRM form (to show the
 * problem before submit) and by the API (which is the actual refuser) — the same
 * one-definition rule as `computeLeaveDuration` and `buildOnboardingAnswerIssues`.
 *
 * All three rules exist to keep the approval chain a FUNCTION. If the manager were also the
 * lead, a member's two approval steps would be the same signature twice, which is a one-step
 * approval wearing a disguise. If the manager or lead were also a rank-and-file member, they
 * would end up approving their own leave — resolvable, but only by rules nobody can predict
 * from the org chart they are looking at.
 */
export function validateTeamAssignment(input: TeamAssignmentInput): TeamAssignmentIssueCode[] {
  const issues: TeamAssignmentIssueCode[] = [];
  const members = new Set(input.memberUserIds);

  if (input.managerUserId && input.leadUserId && input.managerUserId === input.leadUserId) {
    issues.push("manager_is_lead");
  }
  if (input.managerUserId && members.has(input.managerUserId)) {
    issues.push("manager_is_member");
  }
  if (input.leadUserId && members.has(input.leadUserId)) {
    issues.push("lead_is_member");
  }

  return issues;
}

// ─────────────────────────────────────────────────────────────────────────
// Leave approval chain — the whole point of the hierarchy
// ─────────────────────────────────────────────────────────────────────────

/**
 * Where an applicant sits, as far as approving their leave is concerned. Deliberately a
 * flat, already-resolved snapshot rather than the Team row: this keeps the function pure and
 * lets the CRM call it with what `/me` already returns.
 */
export interface LeaveApprovalPosition {
  applicantId: string;
  /** Holds the `hr` role. HR's authority is company-wide, so it is not a place in the tree. */
  isHr: boolean;
  /** The applicant's own team, or null when they are not on the org chart yet. */
  team: {
    id: string;
    leadUserId: string | null;
    managerUserId: string | null;
  } | null;
  /** True when the applicant manages ANY team — a manager answers to the owner, not a lead. */
  managesAnyTeam: boolean;
}

export type LeaveApprovalStep = "lead" | "manager" | "owner";

export interface LeaveApprovalChain {
  /**
   * The steps this request must pass, in order. Length 1 means a single decision; length 2
   * means lead-then-manager. Never empty — `owner` is the terminal fallback, so a request
   * can never land in a queue nobody watches.
   */
  steps: LeaveApprovalStep[];
  /** Who signs the first step, or null when that step is answered by a role rather than a person. */
  firstApproverId: string | null;
  /** Who signs the final step, or null when it falls to HR / the owner. */
  finalApproverId: string | null;
  /**
   * True when no named person could be resolved for a step and it falls to whoever holds
   * company-wide leave authority (HR, and super_admin as the terminal backstop). The UI shows
   * this as a named gap — "no team lead assigned, routed to HR" — rather than hiding it.
   */
  fallbackToOwner: boolean;
}

/**
 * Who approves this person's leave, and in how many steps.
 *
 * Run identically by the API (to decide who may act, and what the request's opening status
 * is) and by the CRM (to tell the applicant where it is going BEFORE they submit, and to
 * label the reviewer's button "Approve" vs "Confirm"). Two implementations of this would
 * disagree the first time somebody changed a team's lead.
 *
 * The rules, in the owner's words:
 *
 *   | applicant            | step 1      | step 2            |
 *   |----------------------|-------------|-------------------|
 *   | a member of team T   | T's lead    | T's manager       |
 *   | T's own lead         | (skipped)   | T's manager       |
 *   | a manager            | (skipped)   | super admin       |
 *   | HR                   | (skipped)   | super admin       |
 *   | on no team yet       | (skipped)   | HR / super admin  |
 *
 * NOBODY EVER APPROVES THEIR OWN REQUEST. Wherever resolution would land on the applicant,
 * that step is dropped and the chain shortens — which is why a lead's own leave is a
 * single manager decision rather than a lead step they would sign themselves.
 *
 * The chain is DERIVED on every read, never snapshotted onto the request row. Same call as
 * derived leave balances (P13) and derived target progress (P15), and for the same reason: a
 * stored approver drifts the moment somebody changes teams. The accepted consequence is that
 * moving a person re-routes their in-flight requests to the new lead — which is correct, the
 * new lead is the one who now knows.
 */
export function resolveLeaveApprovalChain(position: LeaveApprovalPosition): LeaveApprovalChain {
  const { applicantId, isHr, team, managesAnyTeam } = position;

  // HR and managers answer to the owner directly. Neither sits under a team lead: HR's
  // authority is company-wide by definition, and a manager's approver is above them, not
  // inside a team they run.
  if (isHr || managesAnyTeam) {
    return { steps: ["owner"], firstApproverId: null, finalApproverId: null, fallbackToOwner: true };
  }

  // Not on the org chart yet. This is every existing member of staff on the day teams ship,
  // and it deliberately fails OPEN to today's behaviour rather than closed: refusing the
  // application would lock working people out of a working feature over a gap in admin data.
  if (!team) {
    return { steps: ["owner"], firstApproverId: null, finalApproverId: null, fallbackToOwner: true };
  }

  // A lead cannot recommend their own leave, so their chain starts at their manager.
  const leadId = team.leadUserId === applicantId ? null : team.leadUserId;
  const managerId = team.managerUserId === applicantId ? null : team.managerUserId;

  if (leadId && managerId) {
    return {
      steps: ["lead", "manager"],
      firstApproverId: leadId,
      finalApproverId: managerId,
      fallbackToOwner: false,
    };
  }

  // Exactly one of the two is resolvable: a single decision by whoever that is. A team with
  // no manager yet is a lead-only approval, not a request stuck waiting for a hire.
  if (managerId) {
    return { steps: ["manager"], firstApproverId: null, finalApproverId: managerId, fallbackToOwner: false };
  }
  if (leadId) {
    return { steps: ["lead"], firstApproverId: null, finalApproverId: leadId, fallbackToOwner: false };
  }

  // A team with neither, or whose only named person is the applicant.
  return { steps: ["owner"], firstApproverId: null, finalApproverId: null, fallbackToOwner: true };
}

/** Human-readable summary of where a request is going. Shared by the apply form and the queue. */
export function describeLeaveApprovalChain(chain: LeaveApprovalChain, names: {
  firstApproverName?: string | null;
  finalApproverName?: string | null;
}): string {
  if (chain.fallbackToOwner) return "HR / the super admin";
  if (chain.steps.length === 2) {
    return `${names.firstApproverName ?? "your team lead"}, then ${names.finalApproverName ?? "your manager"}`;
  }
  return names.finalApproverName ?? "your manager";
}

// ─────────────────────────────────────────────────────────────────────────
// The signed-in person's own position — served on /me
// ─────────────────────────────────────────────────────────────────────────

/**
 * Enough for the CRM to hide nav it cannot use and to preview the approval chain, without a
 * second round trip. `leadsTeamIds`/`managesTeamIds` are ids rather than a boolean because
 * the approvals queue filters by them.
 */
export const MyOrgPositionSchema = z.object({
  teamId: UuidSchema.nullable(),
  teamName: z.string().nullable(),
  leadUserId: UuidSchema.nullable(),
  leadName: z.string().nullable(),
  managerUserId: UuidSchema.nullable(),
  managerName: z.string().nullable(),
  leadsTeamIds: z.array(UuidSchema),
  managesTeamIds: z.array(UuidSchema),
  isHr: z.boolean(),
  /**
   * Holds the owner role. Together with `isHr` this is COMPANY-WIDE LEAVE AUTHORITY: the
   * two roles that may decide any request, including one whose chain has a gap.
   *
   * Carried on the position rather than inferred from the request's permission scope,
   * because authority here is a property of the person, not of the route they came in
   * through — and a scope-derived answer breaks the moment a call happens outside an HTTP
   * request (a scheduler, a script), which is precisely when it would fail open.
   */
  isOwner: z.boolean(),
});
export type MyOrgPosition = z.infer<typeof MyOrgPositionSchema>;
