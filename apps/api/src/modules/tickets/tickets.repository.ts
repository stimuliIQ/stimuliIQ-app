// apps/api/src/modules/tickets/tickets.repository.ts
//
// Prisma data access ONLY (CLAUDE.md §3.3). TicketsService is the only caller. Every
// query is tenant-scoped. Soft-delete + audit are handled transparently by the Prisma
// client extensions (`Ticket`/`TicketMessage` are already registered in
// soft-delete.extension.ts / audit.extension.ts).
//
// SCOPE (docs/plans/phase-9-completion.md T21, prisma/seed.ts P9 grants):
//   - "all"      -> tenant-wide. support/admin/super_admin.
//   - "assigned" -> `tickets.assigneeId = actorId` (staff's own queue). Supported
//                    defensively even though the current seed only grants "all" to
//                    support — the task brief's RBAC discipline calls for both.
//   - "own"      -> `tickets.userId = actorId` (student raiser). student is seeded here
//                    for tickets.create/view.
//   - "branch"   -> raiser's branch, resolved via the raiser's MOST RECENT active
//                    enrollment's `batch.branchId` (students have no direct branchId
//                    column) OR the raiser's own `user_roles.branchId` (for staff-raised
//                    tickets). branch_manager is seeded at this scope for tickets.view.

import { Injectable } from "@nestjs/common";
import type { Prisma, TicketStatus as PrismaTicketStatus, TicketPriority as PrismaTicketPriority } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";

export interface TicketRow {
  id: string;
  tenantId: string;
  userId: string;
  userName: string;
  subject: string;
  body: string;
  status: PrismaTicketStatus;
  priority: PrismaTicketPriority;
  assigneeId: string | null;
  assigneeName: string | null;
  slaDueAt: Date | null;
  rating: number | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface TicketMessageRow {
  id: string;
  ticketId: string;
  authorId: string;
  authorName: string;
  body: string;
  isInternal: boolean;
  createdAt: Date;
}

export interface ListTicketsFilters {
  tenantId: string;
  status?: PrismaTicketStatus;
  priority?: PrismaTicketPriority;
  assigneeId?: string;
  search?: string;
  overdue?: boolean;
  page: number;
  pageSize: number;
  /** "own" scope. */
  restrictToUserId?: string;
  /** "assigned" scope. */
  restrictToAssigneeId?: string;
  /** "branch" scope — raiser userId set resolved by the service. Empty array = zero rows. */
  restrictToUserIds?: string[];
}

const TICKET_INCLUDE = {
  user: { select: { name: true } },
  assignee: { select: { name: true } },
} satisfies Prisma.TicketInclude;

type TicketWithIncludes = Prisma.TicketGetPayload<{ include: typeof TICKET_INCLUDE }>;

function toTicketRow(row: TicketWithIncludes): TicketRow {
  return {
    id: row.id,
    tenantId: row.tenantId,
    userId: row.userId,
    userName: row.user.name,
    subject: row.subject,
    body: row.body,
    status: row.status,
    priority: row.priority,
    assigneeId: row.assigneeId,
    assigneeName: row.assignee?.name ?? null,
    slaDueAt: row.slaDueAt,
    rating: row.rating,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

@Injectable()
export class TicketsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(filters: ListTicketsFilters): Promise<{ rows: TicketRow[]; total: number }> {
    const now = new Date();
    const where: Prisma.TicketWhereInput = {
      tenantId: filters.tenantId,
      deletedAt: null,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.priority ? { priority: filters.priority } : {}),
      ...(filters.assigneeId ? { assigneeId: filters.assigneeId } : {}),
      ...(filters.restrictToUserId ? { userId: filters.restrictToUserId } : {}),
      ...(filters.restrictToAssigneeId ? { assigneeId: filters.restrictToAssigneeId } : {}),
      ...(filters.restrictToUserIds ? { userId: { in: filters.restrictToUserIds } } : {}),
      ...(filters.overdue ? { slaDueAt: { lt: now }, status: { notIn: ["resolved", "closed"] } } : {}),
      ...(filters.search
        ? {
            OR: [
              { subject: { contains: filters.search, mode: "insensitive" } },
              { user: { name: { contains: filters.search, mode: "insensitive" } } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.client.ticket.findMany({
        where,
        include: TICKET_INCLUDE,
        orderBy: { createdAt: "desc" },
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
      this.prisma.client.ticket.count({ where }),
    ]);

    return { rows: rows.map(toTicketRow), total };
  }

  async findById(tenantId: string, id: string): Promise<TicketRow | null> {
    const row = await this.prisma.client.ticket.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: TICKET_INCLUDE,
    });
    return row ? toTicketRow(row) : null;
  }

  async create(
    tenantId: string,
    data: { userId: string; subject: string; body: string; priority: PrismaTicketPriority; slaDueAt: Date },
  ): Promise<{ id: string }> {
    const row = await this.prisma.client.ticket.create({
      data: {
        tenantId,
        userId: data.userId,
        subject: data.subject,
        body: data.body,
        priority: data.priority,
        slaDueAt: data.slaDueAt,
      },
    });
    return { id: row.id };
  }

  async update(
    id: string,
    patch: Partial<{ status: PrismaTicketStatus; priority: PrismaTicketPriority; assigneeId: string | null; rating: number }>,
  ): Promise<void> {
    await this.prisma.client.ticket.update({ where: { id }, data: patch });
  }

  // ── Messages ─────────────────────────────────────────────────────────────

  async listMessages(ticketId: string, includeInternal: boolean): Promise<TicketMessageRow[]> {
    const rows = await this.prisma.client.ticketMessage.findMany({
      where: { ticketId, deletedAt: null, ...(includeInternal ? {} : { isInternal: false }) },
      include: { author: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((row) => ({
      id: row.id,
      ticketId: row.ticketId,
      authorId: row.authorId,
      authorName: row.author.name,
      body: row.body,
      isInternal: row.isInternal,
      createdAt: row.createdAt,
    }));
  }

  async addMessage(
    tenantId: string,
    data: { ticketId: string; authorId: string; body: string; isInternal: boolean },
  ): Promise<{ id: string }> {
    const row = await this.prisma.client.ticketMessage.create({
      data: {
        tenantId,
        ticketId: data.ticketId,
        authorId: data.authorId,
        body: data.body,
        isInternal: data.isInternal,
      },
    });
    return { id: row.id };
  }

  // ── Scope resolution helpers ─────────────────────────────────────────────

  /**
   * User ids visible to a "branch" scope caller: raisers whose most recent active
   * enrollment's `batch.branchId` is in `branchIds`, UNION staff users whose own
   * `user_roles.branchId` is in `branchIds` (covers staff-raised tickets). Empty
   * `branchIds` -> `[]` (fail-closed, never "all").
   */
  async listUserIdsForBranches(tenantId: string, branchIds: string[]): Promise<string[]> {
    if (branchIds.length === 0) return [];
    const [studentRows, staffRows] = await Promise.all([
      this.prisma.client.enrollment.findMany({
        where: { tenantId, deletedAt: null, batch: { branchId: { in: branchIds }, deletedAt: null } },
        select: { student: { select: { userId: true } } },
        distinct: ["studentId"],
      }),
      this.prisma.client.userRole.findMany({
        where: { branchId: { in: branchIds } },
        select: { userId: true },
        distinct: ["userId"],
      }),
    ]);
    return [...new Set([...studentRows.map((r) => r.student.userId), ...staffRows.map((r) => r.userId)])];
  }

  /** Branch ids the caller's `user_roles` rows are scoped to (mirrors batches.repository.ts). */
  async listCallerBranchIds(userId: string): Promise<string[]> {
    const rows = await this.prisma.client.userRole.findMany({
      where: { userId, branchId: { not: null } },
      select: { branchId: true },
    });
    return rows.map((row) => row.branchId).filter((id): id is string => id !== null);
  }
}
