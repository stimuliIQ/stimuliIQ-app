// apps/api/src/modules/marketing-targets/marketing-targets.repository.ts
//
// Prisma data access ONLY (CLAUDE.md §3.3). Spec: docs/specs/marketing-targets.md.
//
// Soft-delete and audit are transparent: `MarketingTarget` is registered in both
// SOFT_DELETE_MODELS and AUDITED_MODELS, so `.delete()` writes `deleted_at`, reads
// auto-filter, and every change to a target lands in `audit_logs` with no explicit call.
//
// THE TWO PROGRESS QUERIES ARE THE POINT OF THIS FILE.
//
// `countConversionsByOwner` and `sumRevenuePaiseByOwner` are the ONLY definition of
// "completed" in the product, and both are deliberately aligned with definitions that
// already exist elsewhere rather than inventing new ones:
//
//   Conversions — a lead whose `converted_at` falls inside the month, owned by the person.
//     `converted_at` (not the student's created_at) because converting LINKS a lead to a
//     StudentProfile that may already have existed.
//
//   Revenue — payments `status='captured' AND paid_at IS NOT NULL`, summed by `paid_at`,
//     attributed through order → student → the lead that converted to that student. That
//     `captured`/`paid_at` pair is copied verbatim from `mv_revenue_daily` (migration
//     20260704060200) so the sum of every person's revenue reconciles with the revenue
//     dashboard instead of quietly disagreeing with it.
//
// Both are GROSS of refunds, again matching `mv_revenue_daily`. A refund does not currently
// reduce anybody's number; that is the existing house definition of revenue and this feature
// is not the place to change it silently. Documented in the spec's "Known limits".

import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { PrismaService } from "../../prisma/prisma.service";

export interface MarketingTargetRow {
  id: string;
  userId: string;
  periodMonth: Date;
  conversionsTarget: number;
  revenueTargetPaise: number;
  note: string | null;
  createdById: string | null;
  createdByName: string | null;
  updatedAt: Date;
}

export interface TargetableUserRow {
  id: string;
  name: string;
  email: string;
  roleKeys: string[];
}

const TARGET_SELECT = {
  id: true,
  userId: true,
  periodMonth: true,
  conversionsTarget: true,
  revenueTargetPaise: true,
  note: true,
  createdById: true,
  updatedAt: true,
  createdBy: { select: { name: true } },
} satisfies Prisma.MarketingTargetSelect;

type RawTarget = Prisma.MarketingTargetGetPayload<{ select: typeof TARGET_SELECT }>;

function toRow(raw: RawTarget): MarketingTargetRow {
  return {
    id: raw.id,
    userId: raw.userId,
    periodMonth: raw.periodMonth,
    conversionsTarget: raw.conversionsTarget,
    revenueTargetPaise: raw.revenueTargetPaise,
    note: raw.note,
    createdById: raw.createdById,
    createdByName: raw.createdBy?.name ?? null,
    updatedAt: raw.updatedAt,
  };
}

@Injectable()
export class MarketingTargetsRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ── Targets ───────────────────────────────────────────────────────────────

  async findForMonth(tenantId: string, periodMonth: Date): Promise<MarketingTargetRow[]> {
    const rows = await this.prisma.client.marketingTarget.findMany({
      where: { tenantId, periodMonth, deletedAt: null },
      select: TARGET_SELECT,
    });
    return rows.map(toRow);
  }

  async findForUserMonth(
    tenantId: string,
    userId: string,
    periodMonth: Date,
  ): Promise<MarketingTargetRow | null> {
    const row = await this.prisma.client.marketingTarget.findFirst({
      where: { tenantId, userId, periodMonth, deletedAt: null },
      select: TARGET_SELECT,
    });
    return row ? toRow(row) : null;
  }

  async findById(tenantId: string, id: string): Promise<MarketingTargetRow | null> {
    const row = await this.prisma.client.marketingTarget.findFirst({
      where: { tenantId, id, deletedAt: null },
      select: TARGET_SELECT,
    });
    return row ? toRow(row) : null;
  }

  /**
   * Set or replace one person's target for one month.
   *
   * Not `prisma.upsert`: the uniqueness that matters is PARTIAL (`WHERE deleted_at IS NULL`)
   * and lives in migration SQL, so Prisma has no unique input to upsert against. Find-then-
   * write is therefore the only option, and the partial index is what makes the race safe —
   * two concurrent creates for the same person/month collide at the database rather than
   * both landing.
   */
  async upsert(input: {
    tenantId: string;
    userId: string;
    periodMonth: Date;
    conversionsTarget: number;
    revenueTargetPaise: number;
    note: string | null;
    actorId: string;
  }): Promise<MarketingTargetRow> {
    const existing = await this.prisma.client.marketingTarget.findFirst({
      where: {
        tenantId: input.tenantId,
        userId: input.userId,
        periodMonth: input.periodMonth,
        deletedAt: null,
      },
      select: { id: true },
    });

    if (existing) {
      const updated = await this.prisma.client.marketingTarget.update({
        where: { id: existing.id },
        data: {
          conversionsTarget: input.conversionsTarget,
          revenueTargetPaise: input.revenueTargetPaise,
          note: input.note,
          // `created_by_id` is re-stamped on every write: it means "who set the number that
          // is live now", which is the accountable fact. The full history of who changed it
          // to what is in audit_logs.
          createdById: input.actorId,
        },
        select: TARGET_SELECT,
      });
      return toRow(updated);
    }

    const created = await this.prisma.client.marketingTarget.create({
      data: {
        tenantId: input.tenantId,
        userId: input.userId,
        periodMonth: input.periodMonth,
        conversionsTarget: input.conversionsTarget,
        revenueTargetPaise: input.revenueTargetPaise,
        note: input.note,
        createdById: input.actorId,
      },
      select: TARGET_SELECT,
    });
    return toRow(created);
  }

  async softDelete(id: string): Promise<void> {
    await this.prisma.client.marketingTarget.delete({ where: { id } }); // rewritten to soft-delete.
  }

  // ── Who can hold a target ─────────────────────────────────────────────────

  /**
   * Active staff eligible for a target: anyone holding one of `roleKeys` (in practice
   * `marketing`).
   *
   * Returned even with no target set, so the admin screen can show "no target set for Anil"
   * instead of silently omitting him — an omission reads as "no marketing team" and hides
   * exactly the person who needs a number.
   */
  async findTargetableUsers(tenantId: string, roleKeys: string[]): Promise<TargetableUserRow[]> {
    if (roleKeys.length === 0) return [];
    const rows = await this.prisma.client.user.findMany({
      where: {
        tenantId,
        deletedAt: null,
        status: "active",
        userRoles: { some: { deletedAt: null, role: { key: { in: roleKeys } } } },
      },
      select: {
        id: true,
        name: true,
        email: true,
        userRoles: { where: { deletedAt: null }, select: { role: { select: { key: true } } } },
      },
      orderBy: { name: "asc" },
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      roleKeys: row.userRoles.map((link) => link.role.key),
    }));
  }

  async findUserById(tenantId: string, userId: string): Promise<TargetableUserRow | null> {
    const row = await this.prisma.client.user.findFirst({
      where: { tenantId, id: userId, deletedAt: null },
      select: {
        id: true,
        name: true,
        email: true,
        userRoles: { where: { deletedAt: null }, select: { role: { select: { key: true } } } },
      },
    });
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      roleKeys: row.userRoles.map((link) => link.role.key),
    };
  }

  // ── Derived progress ──────────────────────────────────────────────────────

  /**
   * Deals closed inside [from, to) per owner.
   *
   * `converted_at` is only written from this feature's migration forward, so leads converted
   * before it are counted in no month. That is deliberate (see the migration): inferring a
   * close date from students.created_at would mix real and guessed dates inside a number
   * people are reviewed against.
   */
  async countConversionsByOwner(
    tenantId: string,
    userIds: string[],
    from: Date,
    to: Date,
  ): Promise<Map<string, number>> {
    const counts = new Map<string, number>(userIds.map((id) => [id, 0]));
    if (userIds.length === 0) return counts;

    const rows = await this.prisma.client.lead.groupBy({
      by: ["ownerId"],
      where: {
        tenantId,
        deletedAt: null,
        ownerId: { in: userIds },
        convertedAt: { gte: from, lt: to },
      },
      _count: { _all: true },
    });
    for (const row of rows) {
      if (row.ownerId) counts.set(row.ownerId, row._count._all);
    }
    return counts;
  }

  /**
   * Paise captured inside [from, to) per lead owner.
   *
   * Raw SQL because the join walks payment → order → member, and Prisma cannot express
   * "group by a column two relations away" without fetching every payment row into memory
   * first.
   *
   * ATTRIBUTION MOVED to `student_profiles.owner_id`. It used to walk one hop further, on to
   * the LEAD that converted into that member (`leads.converted_student_id` → `leads.owner_id`),
   * which meant revenue could only ever be attributed to somebody who had once been a lead
   * owner. A member enrolled through the onboarding form has no lead row at all, so their
   * payments matched nothing and were counted for nobody — present in the company total,
   * absent from every individual and team figure. Nobody reports a number that is too SMALL,
   * so it stayed invisible.
   *
   * The owner column was backfilled from `leads.owner_id`, so every figure this produced
   * before still reconciles; what changes is that money which previously belonged to nobody
   * now belongs to whoever the member is tagged to.
   *
   * `status='captured' AND paid_at IS NOT NULL` is copied from `mv_revenue_daily` so this
   * reconciles with the revenue dashboard. Gross of refunds, same as that view.
   *
   * One member, one owner column, so the join cannot fan out and double-count a payment —
   * a stronger guarantee than the old one, which rested on `converted_student_id` being
   * UNIQUE.
   */
  async sumRevenuePaiseByOwner(
    tenantId: string,
    userIds: string[],
    from: Date,
    to: Date,
  ): Promise<Map<string, number>> {
    const sums = new Map<string, number>(userIds.map((id) => [id, 0]));
    if (userIds.length === 0) return sums;

    const rows = await this.prisma.client.$queryRaw<Array<{ owner_id: string; total: bigint }>>(
      Prisma.sql`
        SELECT sp.owner_id AS owner_id, COALESCE(SUM(p.amount_paise), 0)::bigint AS total
        FROM "payments" p
        JOIN "orders" o ON o.id = p.order_id
        JOIN "student_profiles" sp ON sp.id = o.student_id
        WHERE p.tenant_id = ${tenantId}::uuid
          AND p.deleted_at IS NULL
          AND p.status = 'captured'
          AND p.paid_at IS NOT NULL
          AND p.paid_at >= ${from}
          AND p.paid_at <  ${to}
          AND sp.deleted_at IS NULL
          AND sp.owner_id = ANY(ARRAY[${Prisma.join(
            userIds.map((id) => Prisma.sql`${id}::uuid`),
          )}]::uuid[])
        GROUP BY sp.owner_id
      `,
    );

    for (const row of rows) {
      // SUM() returns bigint. Paise fit an INTEGER column, so a monthly per-person total
      // cannot approach Number.MAX_SAFE_INTEGER, and Number() is safe here.
      sums.set(row.owner_id, Number(row.total));
    }
    return sums;
  }
}
