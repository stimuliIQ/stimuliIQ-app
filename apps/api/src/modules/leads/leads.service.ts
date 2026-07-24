// apps/api/src/modules/leads/leads.service.ts
//
// Business logic for the lead pipeline (docs/04-trd-architecture.md §2.1). Owns the
// data-scope DECISION (which Prisma where-fragment each scope value maps to for the
// `Lead` model) and the stage/owner-assignment/conversion state machines. Never touches
// Prisma directly — delegates to LeadsRepository.
//
// DATA-SCOPE (docs/plans/phase-2.md "Risks #5" — the headline P2 deliverable):
//   - "all"      -> tenant-wide, no extra filter (Marketing/Owner/Admin).
//   - "branch"   -> `branchId IN (caller's user_roles.branchId values)` (BranchMgr). An
//                    empty branch-id set resolves to a where-fragment matching ZERO rows
//                    (`{ id: { in: [] } }`), never "no filter".
//   - "assigned" -> `ownerId = me OR branchId IN (caller's territory)` (owned OR same
//                    territory — phase-2.md Q4 default for "assigned").
//   - "own"      -> `ownerId = me` ONLY (Counsellor).
// IDOR: `getById`/`update`/`moveStage`/`assignOwner`/`softDelete`/`restore`/`convert` all
// pass the resolved `scopeWhere` into `LeadsRepository.findById`, so an out-of-scope id
// returns `null` -> 404 (never 403 — no existence disclosure, same posture as students
// module).

import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type { LeadDetail, LeadSummary, ConvertLeadResponse } from "@repo/types";
import { resolveLifecycleStage } from "@repo/types";
import { LeadsRepository, type LeadRow, type LeadScopeWhere } from "./leads.repository";
import { ActivitiesRepository } from "./activities.repository";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { requireScopeContext, type ScopeContext } from "../auth/lib/scope-context";
import { StudentsRepository } from "../students/students.repository";
import { CommerceService } from "../commerce/commerce.service";
import type {
  CreateLeadRequest,
  UpdateLeadRequest,
  ListLeadsQuery,
  MoveLeadStageRequest,
  AssignLeadOwnerRequest,
  ConvertLeadRequest,
} from "./dto";

/**
 * Stage transition table for the SIMPLIFIED 4-stage pipeline (2026-07 UX redesign):
 * new → follow_up → won | lost. Deliberately permissive (no forced linear stepping —
 * that was the friction the redesign removed): you can move a lead forward, mark it
 * won/lost from anywhere, or reopen a lost/won lead back into the funnel. A `follow_up`
 * lead may re-enter `follow_up` to reschedule its callback (see moveStage). Converting
 * a lead sets `won` directly regardless of this table (leads.service.convert()).
 */
const STAGE_TRANSITIONS: Record<string, readonly string[]> = {
  new: ["follow_up", "won", "lost"],
  follow_up: ["won", "lost", "new"],
  won: ["follow_up", "lost"],
  lost: ["new", "follow_up"],
};

/**
 * Default SLA follow-up window (hours) applied when a lead enters `follow_up` WITHOUT an
 * explicit `followUpAt` — so a scheduled callback always exists and surfaces on the
 * `slaOverdue` filter / tasks queue. When the caller supplies `followUpAt`, that exact
 * datetime is used instead (see moveStage).
 */
const DEFAULT_FOLLOW_UP_SLA_HOURS = 24;

@Injectable()
export class LeadsService {
  constructor(
    private readonly repository: LeadsRepository,
    private readonly studentsRepository: StudentsRepository,
    private readonly commerceService: CommerceService,
    private readonly activitiesRepository: ActivitiesRepository,
  ) {}

  /**
   * Resolves the caller's scope into a Prisma where-fragment for the `Lead` model.
   * FAIL-CLOSED via `requireScopeContext()` — never falls back to "all" on a missing
   * scope context.
   */
  private async resolveScopeWhere(scope: ScopeContext): Promise<LeadScopeWhere> {
    switch (scope.scope) {
      case "all":
        return {};
      case "branch": {
        const branchIds = await this.repository.listCallerBranchIds(scope.actorId);
        return { branchId: { in: branchIds } }; // empty array -> matches zero rows, never "no filter".
      }
      case "assigned": {
        const branchIds = await this.repository.listCallerBranchIds(scope.actorId);
        return { OR: [{ ownerId: scope.actorId }, { branchId: { in: branchIds } }] };
      }
      case "own":
        return { ownerId: scope.actorId };
      default:
        throw new ForbiddenException({
          code: "leads.scope_unresolvable",
          title: "Scope not supported",
          detail: `The "${scope.scope}" data-scope is not resolvable for the leads module.`,
        });
    }
  }

  /**
   * Validates a client-supplied `ownerId` is an active user IN THIS TENANT before it is
   * ever written to a lead row (P2 M-5 fix, Phase-7 Wave 2 security hardening batch B,
   * item 4). Rejects (400) rather than silently orphaning the lead to an out-of-tenant
   * or non-existent user id.
   */
  private async assertOwnerInTenant(tenantId: string, ownerId: string): Promise<void> {
    const isValid = await this.repository.isActiveUserInTenant(tenantId, ownerId);
    if (!isValid) {
      throw new BadRequestException({
        code: "leads.invalid_owner",
        title: "Invalid lead owner",
        detail: "The specified ownerId is not an active user in this tenant.",
      });
    }
  }

  async list(tenantId: string, query: ListLeadsQuery): Promise<PaginatedResult<LeadSummary>> {
    const scope = requireScopeContext();
    const scopeWhere = await this.resolveScopeWhere(scope);

    const { rows, total } = await this.repository.list({
      tenantId,
      stage: query.stage,
      ownerId: query.ownerId,
      source: query.source,
      branchId: query.branchId,
      programInterestId: query.programInterestId,
      slaOverdue: query.slaOverdue,
      search: query.search,
      page: query.page,
      pageSize: query.pageSize,
      scopeWhere,
    });

    return new PaginatedResult(rows.map(toSummary), {
      page: query.page,
      pageSize: query.pageSize,
      total,
      hasMore: query.page * query.pageSize < total,
    });
  }

  async getById(tenantId: string, id: string): Promise<LeadDetail> {
    const scope = requireScopeContext();
    const scopeWhere = await this.resolveScopeWhere(scope);
    const row = await this.repository.findById(tenantId, id, scopeWhere);
    if (!row) {
      throw new NotFoundException({ code: "leads.not_found", title: "Lead not found" });
    }
    return toDetail(row);
  }

  /**
   * Default-assignment rule (docs/plans/phase-2.md task #6: "default-assignment rule must
   * be documented"): if the caller omits `ownerId`, the lead is assigned via simple
   * round-robin among active `counsellor`-role users in the tenant (least currently-open
   * leads first — see `LeadsRepository.pickRoundRobinOwner`). If the tenant has no
   * counsellor users (e.g. a fresh tenant before staff onboarding), the lead is created
   * UNASSIGNED (`ownerId: null`) rather than failing the request — Marketing/Admin can
   * assign manually via PATCH /:id/owner.
   *
   * P2 M-5 fix (Phase-7 Wave 2 security hardening batch B, item 4): a CLIENT-SUPPLIED
   * `ownerId` is validated against this tenant's active users before being written — an
   * out-of-tenant or non-existent UUID would otherwise orphan the lead to an owner who
   * can never see it (round-robin-picked owners are already validated by construction,
   * so this check only applies to the caller-supplied path).
   */
  async create(tenantId: string, body: CreateLeadRequest): Promise<LeadDetail> {
    if (body.ownerId) {
      await this.assertOwnerInTenant(tenantId, body.ownerId);
    }
    const ownerId = body.ownerId ?? (await this.repository.pickRoundRobinOwner(tenantId));

    const created = await this.repository.create({
      tenantId,
      name: body.name,
      phone: body.phone,
      email: body.email,
      programInterestId: body.programInterestId,
      source: body.source,
      branchId: body.branchId,
      ownerId,
      utm: body.utm,
      score: body.score,
      slaDueAt: body.slaDueAt ? new Date(body.slaDueAt) : undefined,
    });

    const row = await this.repository.findById(tenantId, created.id);
    if (!row) throw new NotFoundException({ code: "leads.not_found", title: "Lead not found after creation" });
    return toDetail(row);
  }

  async update(tenantId: string, id: string, body: UpdateLeadRequest): Promise<LeadDetail> {
    const scope = requireScopeContext();
    const scopeWhere = await this.resolveScopeWhere(scope);
    const existing = await this.repository.findById(tenantId, id, scopeWhere);
    if (!existing) {
      throw new NotFoundException({ code: "leads.not_found", title: "Lead not found" });
    }

    await this.repository.update(id, {
      name: body.name,
      phone: body.phone,
      email: body.email,
      programInterestId: body.programInterestId,
      source: body.source,
      branchId: body.branchId,
      utm: body.utm,
      score: body.score,
      slaDueAt: body.slaDueAt === undefined ? undefined : body.slaDueAt ? new Date(body.slaDueAt) : null,
    });

    const updated = await this.repository.findById(tenantId, id, scopeWhere);
    if (!updated) throw new NotFoundException({ code: "leads.not_found", title: "Lead not found after update" });
    return toDetail(updated);
  }

  /** PATCH /crm/leads/:id/stage — validates the transition then (optionally) sets a fresh SLA timer. Audited automatically by the Prisma extension. */
  async moveStage(tenantId: string, id: string, body: MoveLeadStageRequest): Promise<LeadDetail> {
    const scope = requireScopeContext();
    const scopeWhere = await this.resolveScopeWhere(scope);
    const existing = await this.repository.findById(tenantId, id, scopeWhere);
    if (!existing) {
      throw new NotFoundException({ code: "leads.not_found", title: "Lead not found" });
    }
    if (existing.convertedStudentId) {
      throw new UnprocessableEntityException({
        code: "leads.already_converted",
        title: "Lead is already converted",
        detail: "A converted lead's stage cannot be changed.",
      });
    }

    const allowed = STAGE_TRANSITIONS[existing.stage] ?? [];
    if (!allowed.includes(body.stage)) {
      throw new UnprocessableEntityException({
        code: "leads.invalid_stage_transition",
        title: "Invalid stage transition",
        detail: `Cannot move a lead from "${existing.stage}" to "${body.stage}".`,
      });
    }

    // Follow-up scheduling: a `follow_up` lead always carries a callback datetime in
    // slaDueAt (surfaces on the SLA/tasks queue). Use the caller-supplied followUpAt when
    // present, else default to +24h. Terminal/other stages clear the timer.
    let slaDueAt: Date | null = null;
    if (body.stage === "follow_up") {
      slaDueAt = body.followUpAt
        ? new Date(body.followUpAt)
        : new Date(Date.now() + DEFAULT_FOLLOW_UP_SLA_HOURS * 60 * 60 * 1000);
    }

    await this.repository.moveStage(id, body.stage, slaDueAt);

    // Also create a follow-up TASK (Activity type=task) so the callback appears in the
    // "My Work → Follow-ups" queue, not just the lead's SLA field. Owned by the lead's
    // owner (falls back to the actor) so it lands in the right person's task list.
    if (body.stage === "follow_up" && slaDueAt) {
      await this.activitiesRepository.create({
        tenantId,
        leadId: id,
        userId: existing.ownerId ?? scope.actorId,
        type: "task",
        dueAt: slaDueAt,
        payload: { note: body.reason?.trim() || "Follow-up call", followUp: true },
      });
    }

    const updated = await this.repository.findById(tenantId, id, scopeWhere);
    if (!updated) throw new NotFoundException({ code: "leads.not_found", title: "Lead not found after stage move" });
    return toDetail(updated);
  }

  /**
   * PATCH /crm/leads/:id/owner — manual (re-)assignment. Permission-gated via `leads.edit`
   * at the controller; audited automatically.
   * P2 M-5 fix: `body.ownerId` (when non-null — null explicitly unassigns) is validated
   * against this tenant's active users before being written (see `assertOwnerInTenant`).
   */
  async assignOwner(tenantId: string, id: string, body: AssignLeadOwnerRequest): Promise<LeadDetail> {
    const scope = requireScopeContext();
    const scopeWhere = await this.resolveScopeWhere(scope);
    const existing = await this.repository.findById(tenantId, id, scopeWhere);
    if (!existing) {
      throw new NotFoundException({ code: "leads.not_found", title: "Lead not found" });
    }

    if (body.ownerId) {
      await this.assertOwnerInTenant(tenantId, body.ownerId);
    }

    await this.repository.assignOwner(id, body.ownerId);

    // DEFECT FIX (QA leads.service.ts assignOwner): the post-write re-fetch must NOT
    // re-apply `scopeWhere`. For an own-scope actor scopeWhere is `ownerId = me`; when the
    // actor reassigns their OWN lead to someone else the row no longer satisfies that
    // filter, so the re-fetch returned null and this method threw a false `leads.not_found`
    // 404 even though the write committed (and BulkActionsService then mis-reported the row
    // as failed). Authorization was already established by the pre-write `existing` check —
    // re-fetch by tenant + id only.
    const updated = await this.repository.findById(tenantId, id, {});
    if (!updated) throw new NotFoundException({ code: "leads.not_found", title: "Lead not found after owner assignment" });
    return toDetail(updated);
  }

  async softDelete(tenantId: string, id: string): Promise<LeadDetail> {
    const scope = requireScopeContext();
    const scopeWhere = await this.resolveScopeWhere(scope);
    const existing = await this.repository.findById(tenantId, id, scopeWhere);
    if (!existing) {
      throw new NotFoundException({ code: "leads.not_found", title: "Lead not found" });
    }
    await this.repository.softDelete(id);
    const after = await this.repository.findById(tenantId, id, scopeWhere, true);
    return toDetail(after!);
  }

  async restore(tenantId: string, id: string): Promise<LeadDetail> {
    const scope = requireScopeContext();
    const scopeWhere = await this.resolveScopeWhere(scope);
    const existing = await this.repository.findById(tenantId, id, scopeWhere, true);
    if (!existing) {
      throw new NotFoundException({ code: "leads.not_found", title: "Lead not found" });
    }
    await this.repository.restore(id);
    const after = await this.repository.findById(tenantId, id, scopeWhere);
    return toDetail(after!);
  }

  /**
   * POST /crm/leads/:id/convert — lead -> student conversion (docs/plans/phase-2.md task
   * #6 + leads.schemas.ts's embedded contract comment). Transaction boundary:
   *   1. Scope-check + validate the lead is in `negotiation`/`won` and not already
   *      converted (re-running convert on an already-converted lead is rejected, not
   *      idempotently replayed — the lead<->student link is 1:1 via the unique
   *      `converted_student_id` column, so a second attempt is a client bug to surface,
   *      not silently absorbed).
   *   2 & 3. `StudentsRepository.createStudentWithUser` (REUSED — mirrors P1's
   *      students-create transaction, see file header of students.repository.ts) creates
   *      the `users` + `student_profiles` rows in its own `$transaction`.
   *   4. `LeadsRepository.setConverted` sets `converted_student_id` + `stage = won` in a
   *      second, immediately-following write.
   *   NOTE ON ATOMICITY: steps 2-4 are NOT wrapped in one outer `$transaction` spanning
   *   both repositories (StudentsRepository's transaction is self-contained and Prisma
   *   does not support composing two independently-opened `$transaction` calls into one
   *   ACID unit without passing a shared `tx` client across repository boundaries, which
   *   would break the controller/service/repository layering this module deliberately
   *   preserves). The practical failure window is a created-but-unlinked student if the
   *   process crashes between step 3 and step 4 — recoverable by re-running convert
   *   manually once the orphan student is noticed (P2 acceptable risk; a P7 hardening
   *   pass can move to a shared-tx helper if this proves to bite in practice).
   *   5. If `programId` + `batchId` are provided, `CommerceService.createOrder` (REUSED,
   *      NOT rebuilt — Wave 4a) creates an order with `source` left as the order's
   *      default and an idempotency key derived from the lead id
   *      (`lead:${leadId}:order`) so a retried convert request never double-charges.
   *      The order is created in `created` state; enrollment completes later through the
   *      existing pay/verify or manual-payment flow (CommerceService.verifyPayment /
   *      recordManualPayment) — convert does NOT create the enrollment itself, so
   *      `enrollmentId` in the response is always `null` at convert time.
   *   6. Audit log row is written automatically by the Prisma audit extension for both
   *      the `lead` update and the `student_profile`/`order` creates (already-registered
   *      AUDITED_MODELS — see apps/api/src/prisma/audit.extension.ts).
   */
  async convert(tenantId: string, actorId: string, id: string, body: ConvertLeadRequest): Promise<ConvertLeadResponse> {
    const scope = requireScopeContext();
    const scopeWhere = await this.resolveScopeWhere(scope);
    const lead = await this.repository.findById(tenantId, id, scopeWhere);
    if (!lead) {
      throw new NotFoundException({ code: "leads.not_found", title: "Lead not found" });
    }
    if (lead.convertedStudentId) {
      throw new UnprocessableEntityException({
        code: "leads.already_converted",
        title: "Lead is already converted",
        detail: "This lead has already been converted to a student.",
      });
    }
    // Convert-from-any-stage (2026-07 UX redesign): staff can convert a New / Follow-up /
    // Won lead in one click — no linear stepping. Only a `lost` lead is blocked (reopen it
    // first). Conversion itself sets stage = won atomically (setConverted below).
    if (lead.stage === "lost") {
      throw new UnprocessableEntityException({
        code: "leads.not_ready_to_convert",
        title: "Lead is not ready for conversion",
        detail: `A lost lead can't be converted — reopen it first (current stage: "${lead.stage}").`,
      });
    }

    const fields = body.studentFields;
    const existingUser = await this.studentsRepository.findUserByEmail(tenantId, fields.email);
    if (existingUser) {
      throw new UnprocessableEntityException({
        code: "leads.email_in_use",
        title: "Email already in use",
        detail: "A user with this email already exists in this tenant.",
      });
    }

    const student = await this.studentsRepository.createStudentWithUser({
      tenantId,
      name: fields.name,
      email: fields.email,
      phone: fields.phone ?? lead.phone,
      college: fields.college,
      courseType: fields.courseType,
      year: fields.year,
      city: fields.city,
      source: fields.source ?? lead.source,
      status: fields.status,
    });

    await this.repository.setConverted(id, student.id);

    let orderId: string | null = null;
    if (body.programId && body.batchId) {
      const order = await this.commerceService.createOrder(tenantId, actorId, `lead:${id}:order`, {
        studentId: student.id,
        programId: body.programId,
        batchId: body.batchId,
        couponCode: body.couponCode,
        notes: body.notes,
      });
      orderId = order.id;
    }

    return { leadId: id, studentId: student.id, orderId, enrollmentId: null };
  }
}

function toSummary(row: LeadRow): LeadSummary {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    stage: row.stage,
    source: row.source,
    programInterestId: row.programInterestId,
    programInterestTitle: row.programInterestTitle,
    branchId: row.branchId,
    branchName: row.branchName,
    ownerId: row.ownerId,
    ownerName: row.ownerName,
    score: row.score,
    slaDueAt: row.slaDueAt ? row.slaDueAt.toISOString() : null,
    convertedStudentId: row.convertedStudentId,
    // Derived lifecycle stage (lifecycle-redesign P1). Computed purely from the lead's
    // own fields — no extra query. A converted lead reports `registered` (the student
    // record's own DTO carries the richer downstream stage from there on).
    lifecycleStage: resolveLifecycleStage({
      lead: {
        stage: row.stage,
        hasOwner: row.ownerId !== null,
        converted: row.convertedStudentId !== null,
      },
      student: row.convertedStudentId !== null ? { status: "active" } : null,
    }),
    courseInterest: row.courseInterest,
    college: row.college,
    language: row.language,
    createdAt: row.createdAt.toISOString(),
  };
}

function toDetail(row: LeadRow): LeadDetail {
  return {
    ...toSummary(row),
    utm: (row.utm as LeadDetail["utm"]) ?? null,
    message: row.message,
    activityCount: row.activityCount,
    bookingCount: row.bookingCount,
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}
