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
  ownerId?: string;
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

  async assignOwner(id: string, ownerId: string | null): Promise<void> {
    await this.prisma.client.lead.update({ where: { id }, data: { ownerId } });
  }

  async setConverted(id: string, studentId: string): Promise<void> {
    await this.prisma.client.lead.update({
      where: { id },
      data: { convertedStudentId: studentId, stage: "won" },
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
   * picks the counsellor with the fewest currently-open (non-won/lost) owned leads in
   * this tenant, among users holding the `counsellor` role. Returns `null` if there are
   * no counsellor users to assign to (lead is created unassigned).
   */
  async pickRoundRobinOwner(tenantId: string): Promise<string | null> {
    const counsellors = await this.prisma.client.userRole.findMany({
      where: { role: { tenantId, key: "counsellor", deletedAt: null }, user: { deletedAt: null, status: "active" } },
      select: { userId: true },
      distinct: ["userId"],
    });
    const counsellorIds = counsellors.map((c) => c.userId);
    if (counsellorIds.length === 0) {
      return null;
    }

    const loadCounts = await this.prisma.client.lead.groupBy({
      by: ["ownerId"],
      where: {
        tenantId,
        deletedAt: null,
        ownerId: { in: counsellorIds },
        stage: { notIn: ["won", "lost"] },
      },
      _count: { _all: true },
    });

    const loadMap = new Map<string, number>(counsellorIds.map((id) => [id, 0]));
    for (const row of loadCounts) {
      if (row.ownerId) {
        loadMap.set(row.ownerId, row._count._all);
      }
    }

    let pick = counsellorIds[0]!;
    let minLoad = loadMap.get(pick) ?? 0;
    for (const id of counsellorIds) {
      const load = loadMap.get(id) ?? 0;
      if (load < minLoad) {
        minLoad = load;
        pick = id;
      }
    }
    return pick;
  }
}
