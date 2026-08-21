// apps/api/src/modules/marketing-targets/marketing-targets.service.ts
//
// Business logic (CLAUDE.md §3.3). Spec: docs/specs/marketing-targets.md. ADR-0067.
//
// The whole service is one idea: a target row is the GOAL, and progress against it is
// ALWAYS recomputed, never stored. Every read path below fetches the goal, runs the two
// aggregate queries for the month, and hands both to `summariseTargetMetric` — the same
// function the CRM card calls, so the two can never disagree.

import { Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type {
  MarketingTargetProgress,
  MarketingTargetsListDto,
  MyMarketingTargetDto,
  TargetMonth,
  UpsertMarketingTargetRequest,
} from "@repo/types";
import {
  summariseTargetMetric,
  targetMonthEnd,
  targetMonthToDate,
  toTargetMonth,
} from "@repo/types";

import {
  MarketingTargetsRepository,
  type MarketingTargetRow,
  type TargetableUserRow,
} from "./marketing-targets.repository";

/**
 * Which roles are offered a target on the admin screen.
 *
 * A constant rather than a settings row: this is "who is this feature for", and the answer
 * changing is a product decision, not a knob. The FK is to `users`, so giving a counsellor a
 * target later needs one entry here and no migration.
 */
export const TARGETABLE_ROLE_KEYS = ["marketing"] as const;

@Injectable()
export class MarketingTargetsService {
  constructor(private readonly repo: MarketingTargetsRepository) {}

  /**
   * GET /crm/marketing-targets/me — the signed-in person's own card.
   *
   * Never 404s on "no target set". A marketing person opening the dashboard before anyone
   * has set their number must get a clear, empty-but-real answer, and their `completed`
   * figures are computed either way: closing deals against no target is still worth showing.
   */
  async getMine(tenantId: string, userId: string, month?: TargetMonth): Promise<MyMarketingTargetDto> {
    const targetMonth = month ?? toTargetMonth();
    const user = await this.repo.findUserById(tenantId, userId);
    if (!user) throw new NotFoundException("User not found.");

    const target = await this.repo.findForUserMonth(tenantId, userId, targetMonthToDate(targetMonth));
    const [conversions, revenue] = await this.progressFor(tenantId, [userId], targetMonth);

    return {
      month: targetMonth,
      hasTarget: target !== null,
      progress: this.toProgress(user, target, targetMonth, conversions, revenue),
    };
  }

  /**
   * GET /crm/marketing-targets — every targetable person for the month, plus the roll-up.
   *
   * People with NO target are included, with zeroed targets and real completed figures.
   * Dropping them would make "nobody set Anil a number" look identical to "Anil is not on
   * the team", and the first is the thing this screen exists to catch.
   */
  async list(tenantId: string, month?: TargetMonth): Promise<MarketingTargetsListDto> {
    const targetMonth = month ?? toTargetMonth();
    const users = await this.repo.findTargetableUsers(tenantId, [...TARGETABLE_ROLE_KEYS]);
    const targets = await this.repo.findForMonth(tenantId, targetMonthToDate(targetMonth));

    // A target may exist for somebody who has since lost the marketing role. They still
    // appear, because the number was set and their progress is still being measured — a row
    // vanishing from the report the day a role changes would erase the month's history.
    const extraUserIds = targets.map((t) => t.userId).filter((id) => !users.some((u) => u.id === id));
    const extraUsers = (
      await Promise.all(extraUserIds.map((id) => this.repo.findUserById(tenantId, id)))
    ).filter((u): u is TargetableUserRow => u !== null);

    const allUsers = [...users, ...extraUsers].sort((a, b) => a.name.localeCompare(b.name));
    const userIds = allUsers.map((u) => u.id);
    const [conversions, revenue] = await this.progressFor(tenantId, userIds, targetMonth);

    const byUser = new Map(targets.map((t) => [t.userId, t]));
    const rows = allUsers.map((user) =>
      this.toProgress(user, byUser.get(user.id) ?? null, targetMonth, conversions, revenue),
    );

    // Totals sum the individual rows rather than being their own settable number: a team
    // total that could be edited on its own would be a second source of truth, free to
    // disagree with the sum of its parts.
    const totalConversionTarget = rows.reduce((sum, r) => sum + r.conversions.target, 0);
    const totalConversionDone = rows.reduce((sum, r) => sum + r.conversions.completed, 0);
    const totalRevenueTarget = rows.reduce((sum, r) => sum + r.revenuePaise.target, 0);
    const totalRevenueDone = rows.reduce((sum, r) => sum + r.revenuePaise.completed, 0);

    const withTarget = rows.filter((r) => r.targetId !== null);

    return {
      month: targetMonth,
      rows,
      totals: {
        conversions: summariseTargetMetric(totalConversionTarget, totalConversionDone),
        revenuePaise: summariseTargetMetric(totalRevenueTarget, totalRevenueDone),
        peopleWithTarget: withTarget.length,
        // "Met" means every metric they were actually measured on. Someone given only a
        // revenue number is judged on revenue alone — counting the conversions card they
        // were never set would make hitting the target impossible.
        peopleMeetingTarget: withTarget.filter((r) => {
          const measured = [
            r.conversions.target > 0 ? r.conversions.met : null,
            r.revenuePaise.target > 0 ? r.revenuePaise.met : null,
          ].filter((v): v is boolean => v !== null);
          return measured.length > 0 && measured.every(Boolean);
        }).length,
      },
    };
  }

  /** PUT /crm/marketing-targets — set or replace one person's number for one month. */
  async upsert(
    tenantId: string,
    actorId: string,
    body: UpsertMarketingTargetRequest,
  ): Promise<MarketingTargetProgress> {
    const user = await this.repo.findUserById(tenantId, body.userId);
    // 404, not 403: a user id from another tenant must be indistinguishable from one that
    // does not exist, or this endpoint becomes a cross-tenant existence oracle.
    if (!user) throw new NotFoundException("User not found.");

    const row = await this.repo.upsert({
      tenantId,
      userId: body.userId,
      periodMonth: targetMonthToDate(body.month),
      conversionsTarget: body.conversionsTarget,
      revenueTargetPaise: body.revenueTargetPaise,
      note: body.note?.trim() ? body.note.trim() : null,
      actorId,
    });

    const [conversions, revenue] = await this.progressFor(tenantId, [body.userId], body.month);
    return this.toProgress(user, row, body.month, conversions, revenue);
  }

  /** DELETE /crm/marketing-targets/:id — "this person has no target this month". */
  async remove(tenantId: string, id: string): Promise<void> {
    const existing = await this.repo.findById(tenantId, id);
    if (!existing) throw new NotFoundException("Target not found.");
    await this.repo.softDelete(id);
  }

  // ── internals ─────────────────────────────────────────────────────────────

  /** The two aggregates for a month, run once for the whole set of users. */
  private async progressFor(
    tenantId: string,
    userIds: string[],
    month: TargetMonth,
  ): Promise<[Map<string, number>, Map<string, number>]> {
    const from = targetMonthToDate(month);
    const to = targetMonthEnd(month);
    if (from >= to) {
      // Unreachable via the schema, but a malformed month would otherwise produce an empty
      // window that reads as "nobody did anything" rather than as an error.
      throw new UnprocessableEntityException("Invalid target month.");
    }
    return Promise.all([
      this.repo.countConversionsByOwner(tenantId, userIds, from, to),
      this.repo.sumRevenuePaiseByOwner(tenantId, userIds, from, to),
    ]);
  }

  private toProgress(
    user: TargetableUserRow,
    target: MarketingTargetRow | null,
    month: TargetMonth,
    conversions: Map<string, number>,
    revenue: Map<string, number>,
  ): MarketingTargetProgress {
    return {
      targetId: target?.id ?? null,
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      roleKeys: user.roleKeys,
      month,
      conversions: summariseTargetMetric(target?.conversionsTarget ?? 0, conversions.get(user.id) ?? 0),
      revenuePaise: summariseTargetMetric(target?.revenueTargetPaise ?? 0, revenue.get(user.id) ?? 0),
      note: target?.note ?? null,
      setByName: target?.createdByName ?? null,
      updatedAt: target?.updatedAt.toISOString() ?? null,
    };
  }
}
