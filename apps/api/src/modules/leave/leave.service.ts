// apps/api/src/modules/leave/leave.service.ts
//
// Business logic for staff leave: applying, withdrawing, approving, rejecting, balances and
// the team calendar. Configuration (types, allowances, holidays, the working week) lives in
// leave-setup.service.ts — it is a different audience with a different permission.
//
// Three properties of this module are load-bearing, and each is a place a shortcut breaks
// something quietly rather than loudly:
//
//   1. THE DURATION IS COMPUTED SERVER-SIDE, ALWAYS. `computeLeaveDuration` (@repo/types) is
//      the same function the apply form runs for its live "3.5 days" preview, but the number
//      the client shows is never persisted — this service recomputes from its own holiday
//      list and working week. A client that lies about the duration lies to itself.
//
//   2. THE APPLICANT IS ALWAYS THE ACTOR. `create` takes no user id. Anyone holding
//      `leave.request` could otherwise file leave in a colleague's name, and there is no use
//      case for applying on someone else's behalf that is worth that.
//
//   3. THE ALLOWANCE IS CHECKED TWICE — once at apply time (so the form can refuse early and
//      helpfully) and once inside the approval transaction (because two requests that are
//      each individually within budget can both be approved). Only the second check is
//      authoritative; the first is a courtesy.
//
// SCOPE. `leave.view` is genuinely two-sided: `own` is "my requests" and `all` is the
// approver's queue, and both are shipped surfaces. So this maps the scope rather than
// refusing narrow scopes the way onboarding.service.ts does. The team calendar does NOT ride
// on `leave.view` — it has its own key (`leave.calendar.view`) behind a projection that never
// fetches the reason, so team visibility can never become "everyone reads everyone's reason".

import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import type {
  ApproveLeaveRequestRequest,
  CreateLeaveRequestRequest,
  GetLeaveApplyContextQuery,
  GetLeaveBalancesQuery,
  GetLeaveCalendarQuery,
  LeaveApplyContext,
  LeaveBalance,
  LeaveBalancesResponse,
  LeaveCalendarResponse,
  LeaveRequestDetail,
  LeaveRequestSummary,
  ListLeaveRequestsQuery,
  RejectLeaveRequestRequest,
} from "@repo/types";
// The status sets live in @repo/types (ADR-0070). Ten separate string literals used to
// answer "which requests are still live?", and missing one when the two-step chain landed
// would silently stop counting somebody's days rather than fail a test.
import { LEAVE_LIVE_STATUSES, LEAVE_UNCOMMITTED_STATUSES } from "@repo/types";
import { computeLeaveDuration } from "@repo/types";

import { PaginatedResult } from "../../common/dto/paginated-result";
import { requireScopeContext, type ScopeContext } from "../auth/lib/scope-context";
import { LeaveNotificationService } from "./leave-notification.service";
import { OrgService } from "../org/org.service";
import { LeaveSetupService } from "./leave-setup.service";
import { LeaveRepository, type LeaveRequestRow } from "./leave.repository";
import {
  fromIsoDate,
  halfDaysToDays,
  toIsoDate,
  toLeaveCalendarEntryDto,
  toLeaveRequestDetailDto,
  toLeaveRequestSummaryDto,
  toLeaveTypeDto,
} from "./leave.util";

/** `{}` means tenant-wide (scope=all); `{ userId }` narrows to the actor's own rows. */
type LeaveScopeFilter = Record<string, never> | { userId: string };

/** How to describe a clashing request to the person who just tried to book over it. */
function describeConflictStatus(status: string): string {
  if (status === "approved") return "approved";
  if (status === "lead_approved") return "part-approved";
  return "pending";
}

@Injectable()
export class LeaveService {
  private readonly logger = new Logger(LeaveService.name);

  constructor(
    private readonly repo: LeaveRepository,
    private readonly setup: LeaveSetupService,
    private readonly notifications: LeaveNotificationService,
    // The org chart is what decides who may approve whose leave. Leave depends on Org,
    // never the reverse — nothing in the org module knows what a leave request is.
    private readonly org: OrgService,
  ) {}

  /**
   * Data-scope → Prisma filter. The opposite of onboarding's `assertAllScope()`: leave has a
   * real "own" reading and a real "all" reading, and both ship.
   *
   * `branch` and `assigned` fail CLOSED with a 403 rather than widening. The allowance is a
   * single company-wide policy set by one super admin, so there is no coherent branch
   * partition of leave, and "assigned" has no column to point at. Returning `{}` for either
   * would hand a branch manager every colleague's leave history, reasons included.
   */
  private resolveScopeFilter(scope: ScopeContext): LeaveScopeFilter {
    switch (scope.scope) {
      case "all":
        return {};
      case "own":
        return { userId: scope.actorId };
      default:
        throw new ForbiddenException({
          code: "leave.scope_unresolvable",
          title: "Scope not supported",
          detail: `The "${scope.scope}" data-scope cannot be resolved for leave requests.`,
        });
    }
  }

  // ── Reads ───────────────────────────────────────────────────────────────

  async listRequests(
    tenantId: string,
    query: ListLeaveRequestsQuery,
  ): Promise<PaginatedResult<LeaveRequestSummary>> {
    const scope = requireScopeContext();
    const filter = this.resolveScopeFilter(scope);

    // At own-scope a client-supplied `userId` is IGNORED rather than rejected — the same
    // posture as `leads` resolving "mine" from the session. A 403 here would be a puzzle for
    // a UI that sends its filters uniformly; silently scoping to yourself is what the
    // permission already means.
    const userId = "userId" in filter ? filter.userId : query.userId;

    // A TEAM LEAD OR MANAGER SEES THEIR PEOPLE, not just themselves.
    //
    // Every staff role holds `leave.view` at scope=own, which is right for somebody with
    // nobody reporting to them. But a lead who cannot SEE their team's requests cannot
    // approve them, and widening the grant to `all` would hand them the whole company —
    // reasons included, which is exactly what `leave.calendar.view` was split out to avoid.
    // So the widening comes from the ORG CHART rather than from the permission: the actor
    // sees their own requests, plus the requests of the people they actually approve for.
    let userIdIn: string[] | undefined;
    if ("userId" in filter && !query.userId) {
      const subordinates = await this.org.listSubordinateUserIds(tenantId, scope.actorId);
      if (subordinates.length > 0) userIdIn = [scope.actorId, ...subordinates];
    }

    const { rows, total } = await this.repo.listRequests({
      tenantId,
      page: query.page,
      pageSize: query.pageSize,
      status: query.status,
      leaveTypeId: query.leaveTypeId,
      year: query.year,
      // `userIdIn` supersedes the single id when the actor approves for other people.
      userId: userIdIn ? undefined : userId,
      userIdIn,
    });

    return new PaginatedResult(rows.map(toLeaveRequestSummaryDto), {
      page: query.page,
      pageSize: query.pageSize,
      total,
      hasMore: query.page * query.pageSize < total,
    });
  }

  async getRequest(tenantId: string, id: string): Promise<LeaveRequestDetail> {
    const scope = requireScopeContext();
    const filter = this.resolveScopeFilter(scope);
    const row = await this.repo.findRequestById(tenantId, id);
    if (!row) throw this.notFound();

    // Scoped AFTER the read rather than inside the WHERE, because "may I see this?" now has
    // two answers — it is mine, or I approve for whoever filed it — and a single id in the
    // WHERE cannot express the second. Still 404, never 403: an out-of-scope row must not
    // be confirmed to exist. Same outcome as before, reached differently.
    if ("userId" in filter && row.userId !== filter.userId) {
      const subordinates = await this.org.listSubordinateUserIds(tenantId, scope.actorId);
      if (!subordinates.includes(row.userId)) throw this.notFound();
    }
    return toLeaveRequestDetailDto(row);
  }

  // ── Applying ────────────────────────────────────────────────────────────

  async createRequest(
    tenantId: string,
    actorId: string,
    body: CreateLeaveRequestRequest,
  ): Promise<LeaveRequestDetail> {
    const leaveType = await this.repo.findLeaveTypeById(tenantId, body.leaveTypeId);
    if (!leaveType || !leaveType.active) {
      throw new UnprocessableEntityException({
        code: "leave.type_unavailable",
        title: "Leave type unavailable",
        detail: "That kind of leave isn't available. Pick another one.",
      });
    }

    const year = Number(body.startDate.slice(0, 4));
    const context = await this.loadCalculationContext(tenantId, year);

    const duration = computeLeaveDuration({
      startDate: body.startDate,
      endDate: body.endDate,
      startDayPart: body.startDayPart,
      endDayPart: body.endDayPart,
      weeklyOffDays: context.weeklyOffDays,
      holidayDates: context.holidayDates,
      allowHalfDay: leaveType.allowHalfDay,
    });

    if (duration.issues.length > 0) {
      const [first] = duration.issues;
      throw new UnprocessableEntityException({
        code: `leave.${first?.code ?? "invalid_request"}`,
        title: "Those dates don't work",
        detail: first?.message ?? "Check the dates and try again.",
      });
    }

    // Advisory check only — the authoritative one runs inside the approval transaction. It
    // lives here so the applicant finds out now rather than after waiting on an approver.
    await this.assertWithinAllowance(tenantId, actorId, year, {
      leaveTypeId: leaveType.id,
      leaveTypeName: leaveType.name,
      paid: leaveType.paid,
      halfDays: duration.halfDays,
    });

    const created = await this.repo.runInTransaction(async (tx) => {
      const { created: row, conflict } = await this.repo.createRequestGuardingOverlap(tx, {
        tenantId,
        userId: actorId,
        leaveTypeId: leaveType.id,
        startDate: fromIsoDate(body.startDate),
        endDate: fromIsoDate(body.endDate),
        startDayPart: body.startDayPart,
        endDayPart: body.endDayPart,
        halfDays: duration.halfDays,
        reason: body.reason,
      });

      if (conflict) {
        throw new ConflictException({
          code: "leave.overlapping_request",
          title: "You've already applied for those days",
          detail:
            `You have ${describeConflictStatus(conflict.status)} leave from ` +
            `${toIsoDate(conflict.startDate)} to ${toIsoDate(conflict.endDate)}. ` +
            "Cancel it first, or pick dates that don't overlap.",
        });
      }
      return row;
    });

    if (!created) {
      // Unreachable: createRequestGuardingOverlap returns a row or a conflict, and a conflict
      // throws above. Kept so a future edit to that contract fails loudly rather than
      // returning a broken DTO.
      throw new ConflictException({
        code: "leave.not_created",
        title: "Couldn't save the request",
        detail: "Try again.",
      });
    }

    await this.notifications.notifyRequested(tenantId, created);
    return toLeaveRequestDetailDto(created);
  }

  /**
   * Withdraw a request. The applicant's own action, and the only transition somebody can make
   * on their own row.
   *
   * A `pending` request can always be withdrawn. An `approved` one can be withdrawn only if
   * it has not started yet — cancelling leave you have already taken would credit back days
   * you were actually absent for, which is a balance the timesheet would disagree with. Once
   * it has started, the super admin has to unpick it.
   */
  async cancelRequest(tenantId: string, actorId: string, id: string): Promise<LeaveRequestDetail> {
    const row = await this.repo.findRequestById(tenantId, id, actorId);
    if (!row) throw this.notFound();

    if (row.status === "cancelled") {
      throw new ConflictException({
        code: "leave.already_cancelled",
        title: "Already withdrawn",
        detail: "You've already withdrawn this request.",
      });
    }
    if (row.status === "rejected") {
      throw new ConflictException({
        code: "leave.already_reviewed",
        title: "Already decided",
        detail: "This request was turned down, so there's nothing to withdraw.",
      });
    }

    const today = toIsoDate(new Date());
    if (row.status === "approved" && toIsoDate(row.startDate) <= today) {
      throw new UnprocessableEntityException({
        code: "leave.already_started",
        title: "This leave has already started",
        detail: "Approved leave can only be withdrawn before it starts. Ask an admin to sort it out.",
      });
    }

    const updated = await this.repo.transitionRequestStatus({
      tenantId,
      id,
      from: [...LEAVE_LIVE_STATUSES],
      to: "cancelled",
      actorId,
      note: null,
    });
    if (updated === 0) {
      throw new ConflictException({
        code: "leave.already_reviewed",
        title: "Someone got there first",
        detail: "This request was decided while you were withdrawing it. Reload to see where it stands.",
      });
    }

    const fresh = await this.repo.findRequestById(tenantId, id, actorId);
    if (!fresh) throw this.notFound();
    return toLeaveRequestDetailDto(fresh);
  }

  // ── Deciding ────────────────────────────────────────────────────────────

  /**
   * Which step of the chain this actor is entitled to perform on this request — and a 404
   * if they are entitled to none.
   *
   * THE PERMISSION IS UNIFORM; THE ORG CHART DECIDES. Every approving role holds the same
   * `leave.approve` key. What separates a team lead from a manager from HR is not a
   * grant — it is where they sit, which is data. That is what lets a lead be appointed in
   * the Teams screen without also remembering to grant them something.
   *
   * Returns "lead" when the actor is the applicant's team lead and the request is still at
   * step one; "final" when they are the manager, or hold company-wide leave authority.
   *
   * 404, NOT 403, for somebody with no standing over this request — the IDOR posture the
   * rest of this module already uses (`notFound()`). A 403 would confirm the request exists,
   * and its dates and applicant are exactly what it must not confirm.
   */
  private async resolveApprovalStep(
    tenantId: string,
    actorId: string,
    row: LeaveRequestRow,
  ): Promise<"lead" | "final"> {
    const chain = await this.org.resolveApprovalChain(tenantId, row.userId);

    // Company-wide authority (HR, the owner) can act at either step. This is also the escape
    // hatch that keeps the company running when a lead is themselves on leave, and it is the
    // ONLY way a request whose chain has a gap ever gets decided.
    //
    // Read from the actor's ROLES, not from the request's permission scope: authority here
    // is a property of the person, and a scope-derived answer would break the moment this
    // ran outside an HTTP request — which is exactly when it would fail open.
    const actorPosition = await this.org.getPosition(tenantId, actorId);
    const hasCompanyWideAuthority = actorPosition.isHr || actorPosition.isOwner;

    if (row.status === "pending" && chain.steps[0] === "lead" && chain.firstApproverId === actorId) {
      return "lead";
    }

    // The manager acts only once the request has REACHED their step: `lead_approved` on a
    // two-step chain, or `pending` on a single-step one where there is no lead step to wait
    // for. Matching on `finalApproverId` alone let a manager approve straight from `pending`
    // and silently skip the team lead — which is a one-step approval wearing a two-step
    // label, and it is invisible on screen because the row simply comes back approved.
    const managerStepReached = row.status === "lead_approved" || chain.steps.length === 1;
    if (managerStepReached && chain.finalApproverId === actorId) {
      return "final";
    }
    if (hasCompanyWideAuthority) {
      // Approving directly from `pending` skips the lead step. It is visible rather than
      // silent: the CRM labels the button "Approve directly", and the row records this
      // actor as both the lead approver and the final one, so the trail says one person
      // did both rather than implying a step that never happened.
      return "final";
    }

    throw this.notFound();
  }

  /**
   * Approve, deducting the days from the applicant's allowance.
   *
   * The whole thing runs in one transaction holding the APPLICANT's advisory lock — the same
   * lock `createRequestGuardingOverlap` takes — so a concurrent application and a concurrent
   * approval cannot interleave between the allowance check and the write.
   *
   * Order matters: lock, re-read, re-check the allowance excluding this request's own pending
   * days, then a status-guarded update. A zero-row update means another approver got there
   * first, which is a 409 rather than a second deduction.
   */
  async approveRequest(
    tenantId: string,
    actorId: string,
    id: string,
    body: ApproveLeaveRequestRequest,
  ): Promise<LeaveRequestDetail> {
    const existing = await this.repo.findRequestById(tenantId, id);
    if (!existing) throw this.notFound();
    this.assertNotSelfReview(existing, actorId);
    this.assertInState(existing, ["pending", "lead_approved"]);

    // Which step is this actor performing? Resolved from the org chart, not from a
    // permission: everyone who may approve holds the SAME key, and the hierarchy decides
    // whose requests they see and at which stage they act.
    const step = await this.resolveApprovalStep(tenantId, actorId, existing);

    // STEP ONE — the team lead approves. Deducts nothing, so it takes no lock and does no
    // allowance arithmetic: there is nothing yet to double-charge. The days keep counting
    // as uncommitted (LEAVE_UNCOMMITTED_STATUSES) until the manager confirms.
    if (step === "lead") {
      const moved = await this.repo.transitionRequestStatus({
        tenantId,
        id,
        from: ["pending"],
        to: "lead_approved",
        actorId,
        note: body.note?.trim() || null,
        leadStep: true,
      });
      if (moved === 0) {
        throw new ConflictException({
          code: "leave.already_reviewed",
          title: "Someone got there first",
          detail: "Another approver moved this request a moment ago. Reload to see where it stands.",
        });
      }
      const afterLead = await this.repo.findRequestById(tenantId, id);
      if (!afterLead) throw this.notFound();
      await this.notifications.notifyLeadApproved(tenantId, afterLead);
      return toLeaveRequestDetailDto(afterLead);
    }

    const leaveType = await this.repo.findLeaveTypeById(tenantId, existing.leaveTypeId);
    const year = existing.startDate.getUTCFullYear();

    await this.repo.runInTransaction(async (tx) => {
      await this.repo.lockUser(tx, existing.userId);

      // Authoritative allowance check. `excludeRequestId` keeps this request's own pending
      // half-days out of the running total — they are what is about to be approved, and
      // counting them alongside would double-charge it.
      if (leaveType?.paid !== false) {
        const [quotas, sums] = await Promise.all([
          this.repo.findQuotasForYear(tenantId, year, tx),
          this.repo.sumHalfDaysByTypeAndStatus(tenantId, existing.userId, year, {
            tx,
            excludeRequestId: existing.id,
          }),
        ]);

        const quota = quotas.find((q) => q.leaveTypeId === existing.leaveTypeId);
        if (!quota) {
          throw new UnprocessableEntityException({
            code: "leave.quota_not_set",
            title: `No ${year} allowance set`,
            detail:
              `The ${year} allowance for ${existing.leaveType.name} hasn't been set yet. ` +
              "Set it in Leave Management ▸ Setup, then approve this.",
          });
        }

        const committed = sums
          .filter((s) => s.leaveTypeId === existing.leaveTypeId && s.status === "approved")
          .reduce((total, s) => total + s.halfDays, 0);

        if (committed + existing.halfDays > quota.halfDays) {
          const remaining = halfDaysToDays(Math.max(0, quota.halfDays - committed));
          throw new UnprocessableEntityException({
            code: "leave.quota_exceeded",
            title: "Not enough allowance left",
            detail:
              `${existing.user.name} has ${remaining} day(s) of ${existing.leaveType.name} left for ` +
              `${year}, and this request is ${halfDaysToDays(existing.halfDays)}. ` +
              "Turn it down, or raise the allowance first.",
          });
        }
      }

      const updated = await this.repo.transitionRequestStatus({
        tenantId,
        id,
        // Narrowed to the state we actually READ, not to both openings. If a lead approves
        // between that read and this write, the guard misses and the service answers 409 —
        // which is right. Accepting both here would let the manager's id overwrite the
        // lead trio and erase who performed step one.
        from: [existing.status === "pending" ? "pending" : "lead_approved"],
        to: "approved",
        alsoRecordAsLead: existing.status === "pending",
        actorId,
        note: body.note?.trim() || null,
        tx,
      });
      if (updated === 0) {
        throw new ConflictException({
          code: "leave.already_reviewed",
          title: "Someone got there first",
          detail: "Another admin decided this request a moment ago. Reload to see where it stands.",
        });
      }
    });

    const fresh = await this.repo.findRequestById(tenantId, id);
    if (!fresh) throw this.notFound();

    await this.notifications.notifyDecision(tenantId, fresh, "approved");
    return toLeaveRequestDetailDto(fresh);
  }

  /**
   * Turn a request down. The reason is mandatory and is emailed to the applicant verbatim —
   * a rejection with no explanation is what makes people re-apply for the same dates, and the
   * reviewer is the only person who knows why.
   *
   * Nothing is deducted, so there is no allowance arithmetic and no lock: the request simply
   * stops counting against the balance once it leaves `pending`.
   */
  async rejectRequest(
    tenantId: string,
    actorId: string,
    id: string,
    body: RejectLeaveRequestRequest,
  ): Promise<LeaveRequestDetail> {
    const existing = await this.repo.findRequestById(tenantId, id);
    if (!existing) throw this.notFound();
    this.assertNotSelfReview(existing, actorId);
    this.assertInState(existing, ["pending", "lead_approved"]);
    // Authorisation is the same as for approving — the chain decides who may act. A lead
    // may turn a request down OUTRIGHT rather than passing a "no" up to the manager: the
    // applicant needs to re-plan, and making them wait for a second signature on a refusal
    // helps nobody. Deliberately asymmetric with approval, same call P4 makes on grading.
    await this.resolveApprovalStep(tenantId, actorId, existing);

    const updated = await this.repo.transitionRequestStatus({
      tenantId,
      id,
      from: ["pending", "lead_approved"],
      to: "rejected",
      actorId,
      note: body.reason.trim(),
    });
    if (updated === 0) {
      throw new ConflictException({
        code: "leave.already_reviewed",
        title: "Someone got there first",
        detail: "Another admin decided this request a moment ago. Reload to see where it stands.",
      });
    }

    const fresh = await this.repo.findRequestById(tenantId, id);
    if (!fresh) throw this.notFound();

    await this.notifications.notifyDecision(tenantId, fresh, "rejected");
    return toLeaveRequestDetailDto(fresh);
  }

  // ── Balances ────────────────────────────────────────────────────────────

  async getBalances(
    tenantId: string,
    actorId: string,
    query: GetLeaveBalancesQuery,
  ): Promise<LeaveBalancesResponse> {
    const scope = requireScopeContext();
    const filter = this.resolveScopeFilter(scope);
    // At own-scope a client-supplied userId is ignored, not rejected (see listRequests).
    const userId = "userId" in filter ? filter.userId : (query.userId ?? actorId);
    const year = query.year ?? new Date().getUTCFullYear();

    const user = await this.repo.findUserName(tenantId, userId);
    if (!user) throw new NotFoundException({ code: "leave.user_not_found", title: "Not found", detail: "No such staff member." });

    return {
      year,
      userId,
      userName: user.name,
      balances: await this.buildBalances(tenantId, userId, year),
    };
  }

  /**
   * Everything the apply form needs in one call: the working week, the holiday list, the
   * available leave types and the applicant's current balances.
   *
   * Bundled rather than left to four separate fetches because the four have to be consistent
   * with each other. A form holding last week's holiday list would preview a day count the
   * API then disagrees with, at exactly the moment the applicant commits to the dates.
   */
  async getApplyContext(
    tenantId: string,
    actorId: string,
    query: GetLeaveApplyContextQuery,
  ): Promise<LeaveApplyContext> {
    const year = query.year ?? new Date().getUTCFullYear();
    const [context, types, balances] = await Promise.all([
      this.loadCalculationContext(tenantId, year),
      this.repo.listLeaveTypes(tenantId, true),
      this.buildBalances(tenantId, actorId, year),
    ]);

    return {
      year,
      weeklyOffDays: context.weeklyOffDays,
      holidayDates: context.holidayDates,
      types: types.map(toLeaveTypeDto),
      balances,
    };
  }

  // ── Calendar ────────────────────────────────────────────────────────────

  /**
   * Holidays, weekly offs and who is out, for one date window.
   *
   * Team-wide by design and NOT scope-filtered: this endpoint sits behind
   * `leave.calendar.view`, which every staff role holds at scope=all, and the projection it
   * reads through never fetches a reason. Seeing that a colleague is off on Thursday is the
   * point; seeing why is not on offer here at any permission level.
   */
  async getCalendar(
    tenantId: string,
    actorId: string,
    query: GetLeaveCalendarQuery,
  ): Promise<LeaveCalendarResponse> {
    const from = fromIsoDate(query.from);
    const to = fromIsoDate(query.to);

    // WHO THIS PERSON MAY SEE. Server-enforced from their permission scope and their place
    // on the org chart — NOT chosen by the caller.
    //
    // This used to be a free toggle over a company-wide calendar: every staff role held
    // `leave.calendar.view` at scope=all, so anyone could switch back to "Everyone" and read
    // the whole company's absences. The filter was a convenience sitting on top of a view
    // that showed everything, which is not the same thing as a boundary.
    //
    //   scope=all (super_admin / admin / HR) — the whole company, and `scope=team` narrows
    //     it to their own circle as a convenience, exactly as before.
    //   scope=own (everybody else) — their own leave, PLUS the people they approve for.
     //     A rank-and-file member approves for nobody, so they see strictly themselves. A
    //     team lead or manager sees their team. There is no request they can send that
    //     widens this.
    //
    // `listSubordinateUserIds` rather than `listTeamCircleUserIds` on purpose: the circle
    // looks sideways and up (your team-mates AND your lead), which would let an ordinary
    // member read their colleagues' dates. Subordinates look strictly DOWN, which is what
    // "a member sees only their own" requires.
    const scope = requireScopeContext();
    let userIds: string[] | null = null;
    if (scope.scope === "all") {
      if (query.scope === "team") {
        const circle = await this.org.listTeamCircleUserIds(tenantId, actorId);
        userIds = [actorId, ...circle];
      }
    } else {
      const approvesFor = await this.org.listSubordinateUserIds(tenantId, actorId);
      userIds = [actorId, ...approvesFor];
    }

    const [setting, holidays, rows] = await Promise.all([
      this.setup.getWeeklyOffDays(tenantId),
      this.repo.listHolidaysBetween(tenantId, from, to),
      this.repo.listCalendarWindow(tenantId, from, to, actorId, userIds),
    ]);

    return {
      from: query.from,
      to: query.to,
      weeklyOffDays: setting,
      holidays: holidays.map((h) => ({
        id: h.id,
        date: toIsoDate(h.date),
        name: h.name,
        description: h.description,
        optional: h.optional,
      })),
      entries: rows.map((row) => toLeaveCalendarEntryDto(row, actorId)),
    };
  }

  // ── Internals ───────────────────────────────────────────────────────────

  /**
   * The working week plus the year's MANDATORY holiday dates.
   *
   * Optional (restricted) holidays are deliberately excluded: taking one is a choice the
   * person makes by applying for leave on it, so it has to cost a day like any other. Passing
   * them here would make that leave free.
   */
  private async loadCalculationContext(
    tenantId: string,
    year: number,
  ): Promise<{ weeklyOffDays: number[]; holidayDates: string[] }> {
    const [weeklyOffDays, holidays] = await Promise.all([
      this.setup.getWeeklyOffDays(tenantId),
      this.repo.listHolidays(tenantId, year),
    ]);
    return {
      weeklyOffDays,
      holidayDates: holidays.filter((h) => !h.optional).map((h) => toIsoDate(h.date)),
    };
  }

  /**
   * Balances for one person for one year.
   *
   * Types come from the active list UNION the types this person's own requests reference, so
   * an approved request against a since-deleted type keeps showing up. Without that union the
   * days would still be deducted while the row explaining them disappeared, and the allowance
   * would look like it had leaked.
   */
  private async buildBalances(tenantId: string, userId: string, year: number): Promise<LeaveBalance[]> {
    const [activeTypes, referencedTypes, quotas, sums] = await Promise.all([
      this.repo.listLeaveTypes(tenantId, true),
      this.repo.listLeaveTypesForUserYear(tenantId, userId, year),
      this.repo.findQuotasForYear(tenantId, year),
      this.repo.sumHalfDaysByTypeAndStatus(tenantId, userId, year),
    ]);

    const typesById = new Map(activeTypes.map((t) => [t.id, t]));
    for (const type of referencedTypes) {
      if (!typesById.has(type.id)) typesById.set(type.id, type);
    }

    const quotaByType = new Map(quotas.map((q) => [q.leaveTypeId, q.halfDays]));

    return [...typesById.values()].map((type) => {
      const used = sums
        .filter((s) => s.leaveTypeId === type.id && s.status === "approved")
        .reduce((total, s) => total + s.halfDays, 0);
      const pending = sums
        // Every uncommitted status, not just `pending` — a request sitting with the manager
        // is still an absence this person has asked for, and must keep counting against
        // their balance until it is decided (ADR-0070).
        .filter((s) => s.leaveTypeId === type.id && (LEAVE_UNCOMMITTED_STATUSES as readonly string[]).includes(s.status))
        .reduce((total, s) => total + s.halfDays, 0);

      // Unpaid leave has nothing to run out of, so it reports no entitlement rather than a
      // zero — "0 days left" would read as a refusal for something that is never refused on
      // balance grounds.
      const quota = type.paid ? quotaByType.get(type.id) : undefined;

      return {
        leaveTypeId: type.id,
        leaveTypeName: type.name,
        paid: type.paid,
        allowHalfDay: type.allowHalfDay,
        entitledDays: quota === undefined ? null : halfDaysToDays(quota),
        usedDays: halfDaysToDays(used),
        pendingDays: halfDaysToDays(pending),
        remainingDays: quota === undefined ? null : halfDaysToDays(quota - used - pending),
      };
    });
  }

  /**
   * Apply-time allowance check. Advisory — the binding one runs inside the approval
   * transaction — but it counts PENDING requests as well as approved ones, so somebody cannot
   * queue five ten-day requests against a twelve-day allowance and leave the approver to
   * work out which two can survive.
   */
  private async assertWithinAllowance(
    tenantId: string,
    userId: string,
    year: number,
    request: { leaveTypeId: string; leaveTypeName: string; paid: boolean; halfDays: number },
  ): Promise<void> {
    if (!request.paid) return;

    const [quotas, sums] = await Promise.all([
      this.repo.findQuotasForYear(tenantId, year),
      this.repo.sumHalfDaysByTypeAndStatus(tenantId, userId, year),
    ]);

    const quota = quotas.find((q) => q.leaveTypeId === request.leaveTypeId);
    if (!quota) {
      throw new UnprocessableEntityException({
        code: "leave.quota_not_set",
        title: `No ${year} allowance yet`,
        detail:
          `The ${year} allowance for ${request.leaveTypeName} hasn't been set yet. ` +
          "Ask an admin to set it in Leave Management ▸ Setup.",
      });
    }

    const committed = sums
      .filter((s) => s.leaveTypeId === request.leaveTypeId)
      .reduce((total, s) => total + s.halfDays, 0);

    if (committed + request.halfDays > quota.halfDays) {
      const remaining = halfDaysToDays(Math.max(0, quota.halfDays - committed));
      throw new UnprocessableEntityException({
        code: "leave.quota_exceeded",
        title: "Not enough leave left",
        detail:
          `You have ${remaining} day(s) of ${request.leaveTypeName} left for ${year} ` +
          "(anything already awaiting approval counts), and this request is " +
          `${halfDaysToDays(request.halfDays)}.`,
      });
    }
  }

  /**
   * Refuses a request that is not in one of the states this action can move it from.
   *
   * Replaces the old `assertPending`, which could only express one state. With a two-step
   * chain the lead acts on `pending` and the manager on `lead_approved`, and a lead trying
   * to confirm what they themselves approved has to be told that specifically — not "already
   * decided", which is what the single-state version would have said.
   */
  private assertInState(row: LeaveRequestRow, allowed: readonly string[]): void {
    if (allowed.includes(row.status)) return;
    throw new ConflictException({
      code: "leave.already_reviewed",
      title: row.status === "lead_approved" ? "Already approved by the team lead" : "Already decided",
      detail:
        row.status === "cancelled"
          ? "The applicant withdrew this request."
          : row.status === "lead_approved"
            ? "The team lead has approved this. It is waiting on the manager to confirm."
            : `This request has already been ${row.status}.`,
    });
  }

  /**
   * NOBODY DECIDES THEIR OWN REQUEST.
   *
   * Enforced here rather than by permissions, because a permission cannot express it: the
   * super admin holds `leave.approve` at scope=all, which before this included their own row.
   * This is the one place the module answers 403 rather than 404 — the actor unambiguously
   * knows the request exists, because it is theirs, so there is nothing to conceal.
   */
  private assertNotSelfReview(row: LeaveRequestRow, actorId: string): void {
    if (row.userId !== actorId) return;
    throw new ForbiddenException({
      code: "leave.self_review",
      title: "You can't decide your own leave",
      detail: "Your own request goes to your manager, or to HR. Ask them to look at it.",
    });
  }

  /** IDOR posture: an out-of-scope row is NOT FOUND, never forbidden. A 403 confirms it exists. */
  private notFound(): NotFoundException {
    return new NotFoundException({
      code: "leave.request_not_found",
      title: "Not found",
      detail: "No such leave request.",
    });
  }
}
