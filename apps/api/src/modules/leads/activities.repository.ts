// apps/api/src/modules/leads/activities.repository.ts
//
// Prisma data access ONLY for `activities` (logged call/note/whatsapp/email/task records —
// docs/plans/phase-2.md task #6: "LOGGED records only, NOT sent"; no Mail/WhatsApp provider
// involved here). ActivitiesService is the only caller.
//
// SCOPE INHERITANCE: an activity has no owner/branch column of its own — visibility is
// inherited from its parent `lead` (via the lead's scope-resolved `where` fragment) OR,
// for activities attached to a `student` (not a lead) OR for "my tasks", via
// `userId = actorId` (the activity's actor). ActivitiesService resolves which predicate
// applies and passes it down as `scopeWhere`; this repository never decides scope itself.

import { Injectable } from "@nestjs/common";
import { Prisma, type ActivityType } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";

export type ActivityScopeWhere = Prisma.ActivityWhereInput;

export interface ListActivitiesFilters {
  tenantId: string;
  leadId?: string;
  studentId?: string;
  userId?: string;
  type?: ActivityType;
  dueBefore?: Date;
  doneOnly?: boolean;
  pendingTasks?: boolean;
  page: number;
  pageSize: number;
  scopeWhere: ActivityScopeWhere;
}

export interface ActivityRow {
  id: string;
  tenantId: string;
  leadId: string | null;
  studentId: string | null;
  userId: string;
  userName: string;
  type: ActivityType;
  payload: unknown;
  dueAt: Date | null;
  doneAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

const ACTIVITY_INCLUDE = {
  user: { select: { name: true } },
} satisfies Prisma.ActivityInclude;

type ActivityWithRelations = Prisma.ActivityGetPayload<{ include: typeof ACTIVITY_INCLUDE }>;

function toActivityRow(row: ActivityWithRelations): ActivityRow {
  return {
    id: row.id,
    tenantId: row.tenantId,
    leadId: row.leadId,
    studentId: row.studentId,
    userId: row.userId,
    userName: row.user.name,
    type: row.type,
    payload: row.payload,
    dueAt: row.dueAt,
    doneAt: row.doneAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

@Injectable()
export class ActivitiesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(filters: ListActivitiesFilters): Promise<{ rows: ActivityRow[]; total: number }> {
    const where: Prisma.ActivityWhereInput = {
      tenantId: filters.tenantId,
      deletedAt: null,
      ...filters.scopeWhere,
      ...(filters.leadId ? { leadId: filters.leadId } : {}),
      ...(filters.studentId ? { studentId: filters.studentId } : {}),
      ...(filters.userId ? { userId: filters.userId } : {}),
      ...(filters.type ? { type: filters.type } : {}),
      ...(filters.dueBefore ? { dueAt: { lte: filters.dueBefore } } : {}),
      ...(filters.doneOnly ? { doneAt: { not: null } } : {}),
      ...(filters.pendingTasks ? { type: "task", doneAt: null, dueAt: { not: null } } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.client.activity.findMany({
        where,
        include: ACTIVITY_INCLUDE,
        orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
      this.prisma.client.activity.count({ where }),
    ]);

    return { rows: rows.map(toActivityRow), total };
  }

  async findById(tenantId: string, id: string, scopeWhere: ActivityScopeWhere = {}): Promise<ActivityRow | null> {
    const row = await this.prisma.client.activity.findFirst({
      where: { id, tenantId, deletedAt: null, ...scopeWhere },
      include: ACTIVITY_INCLUDE,
    });
    return row ? toActivityRow(row) : null;
  }

  /** Used by the scope resolver to find the parent lead's `branchId`/`ownerId` for an activity attached to a student-only record (no lead). Not used when leadId is present (lead scope is resolved directly). */
  async findParentLeadScopeFields(leadId: string): Promise<{ ownerId: string | null; branchId: string | null } | null> {
    return this.prisma.client.lead.findUnique({
      where: { id: leadId },
      select: { ownerId: true, branchId: true },
    });
  }

  async create(data: {
    tenantId: string;
    leadId?: string;
    studentId?: string;
    userId: string;
    type: ActivityType;
    payload?: unknown;
    dueAt?: Date;
  }): Promise<{ id: string }> {
    const row = await this.prisma.client.activity.create({
      data: {
        tenantId: data.tenantId,
        leadId: data.leadId,
        studentId: data.studentId,
        userId: data.userId,
        type: data.type,
        payload: data.payload as Prisma.InputJsonValue | undefined,
        dueAt: data.dueAt,
      },
    });
    return { id: row.id };
  }

  /**
   * Sets `doneAt` (and optionally a merged payload — the merge itself happens in
   * ActivitiesService.completeTask, which reads the current payload first to avoid
   * clobbering existing keys). This repository only ever persists the final object.
   */
  async updatePayload(id: string, payload: unknown, doneAt?: Date): Promise<void> {
    await this.prisma.client.activity.update({
      where: { id },
      data: {
        payload: payload as Prisma.InputJsonValue,
        ...(doneAt !== undefined ? { doneAt } : {}),
      },
    });
  }
}
