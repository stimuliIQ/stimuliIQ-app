// apps/api/src/modules/leads/leads.repository.ts
//
// Prisma data access ONLY for `leads` (docs/04-trd-architecture.md §2.1: "repository never
// contains business logic"). LeadsService is the only caller. Every query is ALWAYS
// tenant-scoped from the caller's `req.user.tenantId` (CLAUDE.md §3: "never trust a
// tenantId from the client body").
//
// DATA-SCOPE (the headline P2 deliverable — docs/plans/phase-2.md "Risks #5" + task #6):
// `leads.owner_id` is now a real column, so the scope dimensions resolve as:
//   - "all"      -> tenant-wide, no extra filter (Marketing/Owner/Admin).
//   - "branch"   -> `leads.branchId IN (caller's user_roles.branchId values)` (BranchMgr).
//   - "assigned" -> `ownerId = me OR branchId IN (caller's territory)` — owned OR
//                    same-territory leads (docs/plans/phase-2.md "Risks #5", Q4 default).
//   - "own"      -> `ownerId = me` ONLY (Counsellor).
// LeadsService resolves the caller's scope into a concrete Prisma `where` fragment
// BEFORE calling this repository (mirrors the students/commerce module convention) and
// passes it down as `scopeWhere`. This repository merges `scopeWhere` into every list AND
// every by-id query — by-id lookups outside scope return `null` (caller maps that to 404,
// never leaking existence — same IDOR posture as students.repository.ts).

import { Injectable } from "@nestjs/common";
import { Prisma, type LeadStage } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";

/**
 * A scope-resolved Prisma where-fragment for the `Lead` model. `{}` means "no extra
 * restriction" (scope "all"). Built by LeadsService.resolveScopeWhere() — this repository
 * never resolves a scope itself, it only ever applies an already-resolved fragment.
 */
export type LeadScopeWhere = Prisma.LeadWhereInput;

export interface ListLeadsFilters {
  tenantId: string;
  stage?: LeadStage;
  /**
   * Already RESOLVED by LeadsService — `mine=true` arrives here as the caller's own id.
   * This repository never reads the session.
   */
  ownerId?: string;
  /** Owner IS NULL. Distinct from `ownerId: undefined`, which means "don't filter on owner". */
  unassigned?: boolean;
  createdById?: string;
  source?: string;
  branchId?: string;
  programInterestId?: string;
  slaOverdue?: boolean;
  search?: string;
  includeDeleted?: boolean;
  page: number;
  pageSize: number;
  scopeWhere: LeadScopeWhere;
}

/** A staff user a lead can be handed to — see AssignableUserSchema in @repo/types. */
export interface AssignableUserRow {
  id: string;
  name: string;
  email: string | null;
  roleKeys: string[];
  openLeadCount: number;
}

/**
 * Role keys whose holders take ownership of leads.
 *
 * `counsellor` was the original round-robin pool. `marketing` joined it because marketing
 * staff work leads directly here, not just generate them — they hold the same
 * leads.create/edit/convert grants as a counsellor, differing only in data scope (`all`
 * vs `own`). Anything broader would start auto-dropping leads into admin/owner queues,
 * where they die quietly.
 */
export const LEAD_OWNER_ROLE_KEYS = ["counsellor", "marketing"] as const;

export interface LeadRow {
  id: string;
  tenantId: string;
  name: string;
  phone: string;
  email: string | null;
  stage: LeadStage;
  source: string;
  programInterestId: string | null;
  programInterestTitle: string | null;
  branchId: string | null;
  branchName: string | null;
  ownerId: string | null;
  ownerName: string | null;
  createdById: string | null;
  createdByName: string | null;
  assignedById: string | null;
  assignedByName: string | null;
  assignedAt: Date | null;
  firstContactedAt: Date | null;
  lastActivityAt: Date | null;
  score: number | null;
  slaDueAt: Date | null;
  convertedStudentId: string | null;
  utm: unknown;
  courseInterest: string | null;
  college: string | null;
  language: string | null;
  message: string | null;
  activityCount: number;
  bookingCount: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

const LEAD_INCLUDE = {
  programInterest: { select: { title: true } },
  branch: { select: { name: true } },
  owner: { select: { name: true } },
  // Names only — the pipeline shows "assigned by Priya", never her contact details.
  createdBy: { select: { name: true } },
  assignedBy: { select: { name: true } },
  _count: { select: { activities: true, bookings: true } },
} satisfies Prisma.LeadInclude;

type LeadWithRelations = Prisma.LeadGetPayload<{ include: typeof LEAD_INCLUDE }>;

function toLeadRow(row: LeadWithRelations): LeadRow {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    phone: row.phone,
    email: row.email,
    stage: row.stage,
    source: row.source,
    programInterestId: row.programInterestId,
    programInterestTitle: row.programInterest?.title ?? null,
    branchId: row.branchId,
    branchName: row.branch?.name ?? null,
    ownerId: row.ownerId,
    ownerName: row.owner?.name ?? null,
    createdById: row.createdById,
    createdByName: row.createdBy?.name ?? null,
    assignedById: row.assignedById,
    assignedByName: row.assignedBy?.name ?? null,
    assignedAt: row.assignedAt,
    firstContactedAt: row.firstContactedAt,
    lastActivityAt: row.lastActivityAt,
    score: row.score,
    slaDueAt: row.slaDueAt,
    convertedStudentId: row.convertedStudentId,
    utm: row.utm,
    courseInterest: row.courseInterest,
    college: row.college,
    language: row.language,
    message: row.message,
    activityCount: row._count.activities,
    bookingCount: row._count.bookings,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

@Injectable()
export class LeadsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(filters: ListLeadsFilters): Promise<{ rows: LeadRow[]; total: number }> {
    const where: Prisma.LeadWhereInput = {
      tenantId: filters.tenantId,
      deletedAt: filters.includeDeleted ? undefined : null,
      ...filters.scopeWhere,
      ...(filters.stage ? { stage: filters.stage } : {}),
      ...(filters.ownerId ? { ownerId: filters.ownerId } : {}),
      // `unassigned` and `ownerId` are mutually exclusive at the DTO boundary, so these
      // two spreads can never both apply and clobber each other.
      ...(filters.unassigned ? { ownerId: null } : {}),
      ...(filters.createdById ? { createdById: filters.createdById } : {}),
      ...(filters.source ? { source: filters.source } : {}),
      ...(filters.branchId ? { branchId: filters.branchId } : {}),
      ...(filters.programInterestId ? { programInterestId: filters.programInterestId } : {}),
      ...(filters.slaOverdue
        ? {
            slaDueAt: { lt: new Date() },
            stage: filters.stage ?? { notIn: ["won", "lost"] },
          }
        : {}),
      ...(filters.search
        ? {
            OR: [
              { name: { contains: filters.search, mode: "insensitive" } },
              { phone: { contains: filters.search, mode: "insensitive" } },
              { email: { contains: filters.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.client.lead.findMany({
        where,
        include: LEAD_INCLUDE,
        orderBy: { createdAt: "desc" },
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
      this.prisma.client.lead.count({ where }),
    ]);

    return { rows: rows.map(toLeadRow), total };
  }

  /**
   * By-id lookup that ALSO applies the scope fragment — an out-of-scope id returns
   * `null` exactly like an out-of-tenant id (IDOR prevention: existence is never leaked
   * to a caller outside scope). `scopeWhere` defaults to `{}` for trusted internal
   * call sites (e.g. conversion, where the lead was already scope-checked by the
   * caller a moment earlier within the same request).
   */
  async findById(
    tenantId: string,
    id: string,
    scopeWhere: LeadScopeWhere = {},
    includeDeleted = false,
  ): Promise<LeadRow | null> {
    const row = await this.prisma.client.lead.findFirst({
      where: { id, tenantId, deletedAt: includeDeleted ? undefined : null, ...scopeWhere },
      include: LEAD_INCLUDE,
    });
    return row ? toLeadRow(row) : null;
  }

  async findByPhone(tenantId: string, phone: string): Promise<{ id: string } | null> {
    return this.prisma.client.lead.findFirst({
      where: { tenantId, phone, deletedAt: null },
      select: { id: true },
    });
  }

  /** Resolves the caller's branch ids (user_roles.branchId) — shared shape with faculty/students modules. */
  async listCallerBranchIds(userId: string): Promise<string[]> {
    const rows = await this.prisma.client.userRole.findMany({
      where: { userId, branchId: { not: null } },
      select: { branchId: true },
    });
    return rows.map((row) => row.branchId).filter((id): id is string => id !== null);
  }

  /**
   * Whether `userId` is an ACTIVE user in THIS tenant (P2 M-5 fix, Phase-7 Wave 2 security
   * hardening batch B, item 4: `assignOwner`/`create` did not validate the target
   * `ownerId` was an in-tenant user — an out-of-scope/foreign UUID could orphan a lead
   * to an owner who can never see it). Used to validate a client-supplied `ownerId`
   * before it is ever written to a lead row.
   */
  async isActiveUserInTenant(tenantId: string, userId: string): Promise<boolean> {
    const row = await this.prisma.client.user.findFirst({
      where: { id: userId, tenantId, status: "active" },
      select: { id: true },
    });
    return row !== null;
  }

  async create(data: {
    tenantId: string;
    name: string;
    phone: string;
    email?: string;
    programInterestId?: string;
    source: string;
    branchId?: string;
    ownerId?: string | null;
    /** Staff user who keyed this in. Omitted for public/web lead capture — see below. */
    createdById?: string | null;
    /** Staff user who chose the owner. Omitted when round-robin picked it. */
    assignedById?: string | null;
    utm?: unknown;
    score?: number;
    slaDueAt?: Date;
  }): Promise<{ id: string }> {
    const row = await this.prisma.client.lead.create({
      data: {
        tenantId: data.tenantId,
        name: data.name,
        phone: data.phone,
        email: data.email,
        programInterestId: data.programInterestId,
        source: data.source,
        branchId: data.branchId,
        ownerId: data.ownerId ?? null,
        createdById: data.createdById ?? null,
        assignedById: data.assignedById ?? null,
        // A lead born with an owner was assigned at birth. Leaving assignedAt null here
        // would make every round-robin lead look permanently "never assigned" in the
        // report, which is exactly the number the report exists to measure.
        assignedAt: data.ownerId ? new Date() : null,
        utm: data.utm as Prisma.InputJsonValue | undefined,
        score: data.score,
        slaDueAt: data.slaDueAt,
        stage: "new",
      },
    });
    return { id: row.id };
  }

  async update(
    id: string,
    patch: Partial<{
      name: string;
      phone: string;
      email: string | null;
      programInterestId: string | null;
      source: string;
      branchId: string | null;
      utm: unknown;
      score: number | null;
      slaDueAt: Date | null;
    }>,
  ): Promise<void> {
    await this.prisma.client.lead.update({
      where: { id },
      data: {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
        ...(patch.email !== undefined ? { email: patch.email } : {}),
        ...(patch.programInterestId !== undefined ? { programInterestId: patch.programInterestId } : {}),
        ...(patch.source !== undefined ? { source: patch.source } : {}),
        ...(patch.branchId !== undefined ? { branchId: patch.branchId } : {}),
        ...(patch.utm !== undefined ? { utm: patch.utm as Prisma.InputJsonValue | undefined } : {}),
        ...(patch.score !== undefined ? { score: patch.score } : {}),
        ...(patch.slaDueAt !== undefined ? { slaDueAt: patch.slaDueAt } : {}),
      },
    });
  }

  async moveStage(id: string, stage: LeadStage, slaDueAt?: Date | null): Promise<void> {
    await this.prisma.client.lead.update({
      where: { id },
      data: { stage, ...(slaDueAt !== undefined ? { slaDueAt } : {}) },
    });
  }

  /**
   * Sets the owner AND the provenance of that decision in one write.
   *
   * `assignedAt` is cleared on unassign (ownerId=null) rather than left pointing at the
   * previous handover — a lead sitting in the unassigned queue has not "been assigned
   * since <date>", it has no assignment at all, and leaving a stale timestamp would make
   * time-to-assignment silently under-report.
   */
  async assignOwner(id: string, ownerId: string | null, assignedById: string | null): Promise<void> {
    await this.prisma.client.lead.update({
      where: { id },
      data: {
        ownerId,
        assignedById: ownerId ? assignedById : null,
        assignedAt: ownerId ? new Date() : null,
      },
    });
  }

  /**
   * Stamps contact timestamps after an activity is logged against a lead.
   *
   * `firstContactedAt` is WRITE-ONCE — the `firstContactedAt: null` predicate in the
   * where clause means a second call is a no-op rather than an overwrite. Doing this as a
   * conditional UPDATE instead of read-then-write keeps it atomic: two reps logging a
   * call on the same lead concurrently cannot both pass a JS-side null check and race to
   * write two different "first" contacts.
   *
   * `lastActivityAt` is updated unconditionally in a second statement, since it must move
   * on every activity, including ones that don't qualify as first contact.
   */
  async touchLeadContact(id: string, contactedAt: Date, countsAsContact: boolean): Promise<void> {
    if (countsAsContact) {
      await this.prisma.client.lead.updateMany({
        where: { id, firstContactedAt: null },
        data: { firstContactedAt: contactedAt },
      });
    }
    await this.prisma.client.lead.update({ where: { id }, data: { lastActivityAt: contactedAt } });
  }

  /**
   * The staff users a lead can be handed to: active, non-deleted users in this tenant
   * holding a lead-owning role (see LEAD_OWNER_ROLE_KEYS), each with their current open
   * lead count so the assigner can see who is already buried.
   *
   * Two queries, not a correlated subquery per user: one to resolve the pool, one
   * `groupBy` for the counts. The pool is bounded by headcount (tens, not thousands), so
   * this is materially cheaper than a per-row count and needs no pagination.
   */
  async listAssignableUsers(tenantId: string, search?: string): Promise<AssignableUserRow[]> {
    const userRoles = await this.prisma.client.userRole.findMany({
      where: {
        role: { tenantId, key: { in: [...LEAD_OWNER_ROLE_KEYS] }, deletedAt: null },
        user: {
          tenantId,
          deletedAt: null,
          status: "active",
          ...(search
            ? {
                OR: [
                  { name: { contains: search, mode: "insensitive" as const } },
                  { email: { contains: search, mode: "insensitive" as const } },
                ],
              }
            : {}),
        },
      },
      select: { userId: true, user: { select: { name: true, email: true } }, role: { select: { key: true } } },
    });

    if (userRoles.length === 0) return [];

    // A user holding BOTH counsellor and marketing appears once, with both role keys.
    const byUser = new Map<string, { name: string; email: string | null; roleKeys: Set<string> }>();
    for (const row of userRoles) {
      const existing = byUser.get(row.userId);
      if (existing) {
        existing.roleKeys.add(row.role.key);
        continue;
      }
      byUser.set(row.userId, {
        name: row.user.name,
        email: row.user.email,
        roleKeys: new Set([row.role.key]),
      });
    }

    const openCounts = await this.countOpenLeadsByOwner(tenantId, [...byUser.keys()]);

    return [...byUser.entries()]
      .map(([id, user]) => ({
        id,
        name: user.name,
        email: user.email,
        roleKeys: [...user.roleKeys].sort(),
        openLeadCount: openCounts.get(id) ?? 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Open (not won/lost, not deleted) owned-lead counts, keyed by owner id. Shared by the picker and the round-robin. */
  async countOpenLeadsByOwner(tenantId: string, ownerIds: string[]): Promise<Map<string, number>> {
    if (ownerIds.length === 0) return new Map();
    const rows = await this.prisma.client.lead.groupBy({
      by: ["ownerId"],
      where: {
        tenantId,
        deletedAt: null,
        ownerId: { in: ownerIds },
        stage: { notIn: ["won", "lost"] },
      },
      _count: { _all: true },
    });
    const counts = new Map<string, number>(ownerIds.map((id) => [id, 0]));
    for (const row of rows) {
      if (row.ownerId) counts.set(row.ownerId, row._count._all);
    }
    return counts;
  }

  /**
   * Close the lead: link the student, mark it won, and STAMP THE CLOSE DATE.
   *
   * `converted_at` is written here and nowhere else. It is what makes a monthly marketing
   * target move on its own (docs/specs/marketing-targets.md) — without it the only clue to
   * WHEN a deal closed is the student row, which may predate the conversion because
   * converting can link a lead to a StudentProfile that already existed.
   */
  async setConverted(id: string, studentId: string): Promise<void> {
    await this.prisma.client.lead.update({
      where: { id },
      data: { convertedStudentId: studentId, stage: "won", convertedAt: new Date() },
    });
  }

  async softDelete(id: string): Promise<void> {
    await this.prisma.client.lead.delete({ where: { id } }); // rewritten to soft-delete by the extension.
  }

  async restore(id: string): Promise<void> {
    await this.prisma.client.lead.update({ where: { id }, data: { deletedAt: null } });
  }

  /**
   * Simple round-robin assignment (docs/plans/phase-2.md "Risks #4" — "keep it simple"):
   * picks the lead-owning staff member with the fewest currently-open (non-won/lost)
   * owned leads in this tenant. Returns `null` when the tenant has nobody who can own a
   * lead, in which case the lead is created unassigned and lands in the Unassigned queue.
   *
   * The pool is LEAD_OWNER_ROLE_KEYS (counsellor + marketing) — widened from
   * counsellor-only in the lead-ownership pass, because marketing staff work leads here
   * rather than only sourcing them.
   *
   * Ties are broken by user id (`sort()` below), NOT by insertion order, so the pick is
   * deterministic: on a fresh tenant where everyone has zero leads, an arbitrary-order
   * result would make the assignment untestable and hard to reason about in support.
   */
  async pickRoundRobinOwner(tenantId: string): Promise<string | null> {
    const owners = await this.prisma.client.userRole.findMany({
      where: {
        role: { tenantId, key: { in: [...LEAD_OWNER_ROLE_KEYS] }, deletedAt: null },
        user: { tenantId, deletedAt: null, status: "active" },
      },
      select: { userId: true },
      distinct: ["userId"],
    });
    const ownerIds = owners.map((o) => o.userId).sort();
    if (ownerIds.length === 0) {
      return null;
    }

    const loadMap = await this.countOpenLeadsByOwner(tenantId, ownerIds);

    let pick = ownerIds[0]!;
    let minLoad = loadMap.get(pick) ?? 0;
    for (const id of ownerIds) {
      const load = loadMap.get(id) ?? 0;
      if (load < minLoad) {
        minLoad = load;
        pick = id;
      }
    }
    return pick;
  }
}
