// apps/api/src/modules/tickets/tickets.service.ts
//
// Business logic for the support-desk Ticket module (docs/plans/phase-9-completion.md
// T21). No Prisma here (CLAUDE.md §3.3) — all persistence goes through `TicketsRepository`.
//
// SLA (T7/T21 "sla_due_at computed on create by priority"): a fixed lead-time table per
// priority (no schema/DTO field carries a configurable duration, so this is a documented
// business constant, not a per-tenant setting):
//   urgent -> 4h   high -> 8h   medium -> 24h   low -> 48h
//
// ISOLATION (T21 headline): `isInternal=true` TicketMessage rows are NEVER returned to the
// raising student — every student-facing read (getMine/listMyMessages) filters them out at
// the REPOSITORY level (`includeInternal=false`), not just in the DTO mapper, so a bug in
// the mapper can never leak an internal note. A student can also never SET `isInternal=true`
// — the service forces it to `false` for any `/me/tickets/*` message write, regardless of
// what the (zod-validated, but client-controlled) request body contains.
//
// SCOPE ACTIONS (mirrors the three independently-gated mutation routes in
// tickets.controller.ts, since @repo/types ships one shared UpdateTicketRequestSchema
// for all three underlying fields — CLAUDE.md §3.7 "do not touch packages/*"): each
// service method below applies ONLY the field(s) its own permission key authorizes,
// ignoring any other field present in the (shared-shape) request body.

import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type {
  AddTicketMessageRequest,
  CreateTicketRequest,
  ListMyTicketsQuery,
  ListTicketsQuery,
  RateTicketRequest,
  TicketDetail,
  TicketMessage as TicketMessageDto,
  TicketPriority,
  TicketSummary,
  UpdateTicketRequest,
} from "@repo/types";
import { TicketsRepository, type TicketRow, type TicketMessageRow } from "./tickets.repository";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { requireScopeContext } from "../auth/lib/scope-context";

const UNRESOLVABLE_ID = "00000000-0000-0000-0000-000000000000";

/** SLA lead-time in milliseconds per priority (T7/T21 documented business constant). */
const SLA_LEAD_TIME_MS: Record<TicketPriority, number> = {
  urgent: 4 * 60 * 60_000,
  high: 8 * 60 * 60_000,
  medium: 24 * 60 * 60_000,
  low: 48 * 60 * 60_000,
};

interface Restriction {
  restrictToUserId?: string;
  restrictToAssigneeId?: string;
  restrictToUserIds?: string[];
}

@Injectable()
export class TicketsService {
  constructor(private readonly repository: TicketsRepository) {}

  // ─── Scope resolution ───────────────────────────────────────────────────────

  private async resolveRestriction(actorId: string): Promise<Restriction> {
    const scope = requireScopeContext();
    switch (scope.scope) {
      case "all":
        return {};
      case "assigned":
        return { restrictToAssigneeId: actorId };
      case "own":
        return { restrictToUserId: actorId };
      case "branch": {
        const branchIds = await this.repository.listCallerBranchIds(actorId);
        const userIds = await this.repository.listUserIdsForBranches(requireScopeContext().tenantId, branchIds);
        return { restrictToUserIds: userIds.length > 0 ? userIds : [UNRESOLVABLE_ID] };
      }
      default:
        throw new ForbiddenException({
          code: "tickets.scope_unresolvable",
          title: "Scope not supported",
          detail: `The "${scope.scope}" data-scope is not resolvable for the tickets module.`,
        });
    }
  }

  private assertRowInScope(row: TicketRow, restriction: Restriction): void {
    if (restriction.restrictToUserId && row.userId !== restriction.restrictToUserId) {
      throw new NotFoundException({ code: "tickets.not_found", title: "Ticket not found" });
    }
    if (restriction.restrictToAssigneeId && row.assigneeId !== restriction.restrictToAssigneeId) {
      throw new NotFoundException({ code: "tickets.not_found", title: "Ticket not found" });
    }
    if (restriction.restrictToUserIds && !restriction.restrictToUserIds.includes(row.userId)) {
      throw new NotFoundException({ code: "tickets.not_found", title: "Ticket not found" });
    }
  }

  // ─── CRM: list / get / update / assign / close / message ───────────────────

  async list(tenantId: string, actorId: string, query: ListTicketsQuery): Promise<PaginatedResult<TicketSummary>> {
    const restriction = await this.resolveRestriction(actorId);
    const { rows, total } = await this.repository.list({
      tenantId,
      status: query.status,
      priority: query.priority,
      assigneeId: query.assigneeId,
      search: query.search,
      overdue: query.overdue,
      page: query.page,
      pageSize: query.pageSize,
      ...restriction,
    });
    return new PaginatedResult(rows.map(toSummary), {
      page: query.page,
      pageSize: query.pageSize,
      total,
      hasMore: query.page * query.pageSize < total,
    });
  }

  async getById(tenantId: string, actorId: string, id: string, includeInternal: boolean): Promise<TicketDetail> {
    const row = await this.repository.findById(tenantId, id);
    if (!row) throw new NotFoundException({ code: "tickets.not_found", title: "Ticket not found" });
    const restriction = await this.resolveRestriction(actorId);
    this.assertRowInScope(row, restriction);
    const messages = await this.repository.listMessages(id, includeInternal);
    return toDetail(row, messages);
  }

  /** PATCH /crm/tickets/:id — tickets.edit: status + priority only (never assigneeId). */
  async update(tenantId: string, actorId: string, id: string, body: UpdateTicketRequest): Promise<TicketDetail> {
    const row = await this.repository.findById(tenantId, id);
    if (!row) throw new NotFoundException({ code: "tickets.not_found", title: "Ticket not found" });
    const restriction = await this.resolveRestriction(actorId);
    this.assertRowInScope(row, restriction);

    await this.repository.update(id, {
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.priority !== undefined ? { priority: body.priority } : {}),
    });

    const updated = await this.repository.findById(tenantId, id);
    if (!updated) throw new NotFoundException({ code: "tickets.not_found", title: "Ticket not found after update" });
    const messages = await this.repository.listMessages(id, true);
    return toDetail(updated, messages);
  }

  /** POST /crm/tickets/:id/assign — tickets.assign: assigneeId only. */
  async assign(tenantId: string, actorId: string, id: string, assigneeId: string | null): Promise<TicketDetail> {
    const row = await this.repository.findById(tenantId, id);
    if (!row) throw new NotFoundException({ code: "tickets.not_found", title: "Ticket not found" });
    const restriction = await this.resolveRestriction(actorId);
    this.assertRowInScope(row, restriction);

    await this.repository.update(id, { assigneeId });

    const updated = await this.repository.findById(tenantId, id);
    if (!updated) throw new NotFoundException({ code: "tickets.not_found", title: "Ticket not found after assign" });
    const messages = await this.repository.listMessages(id, true);
    return toDetail(updated, messages);
  }

  /** POST /crm/tickets/:id/close — tickets.close: unconditionally sets status=closed. */
  async close(tenantId: string, actorId: string, id: string): Promise<TicketDetail> {
    const row = await this.repository.findById(tenantId, id);
    if (!row) throw new NotFoundException({ code: "tickets.not_found", title: "Ticket not found" });
    const restriction = await this.resolveRestriction(actorId);
    this.assertRowInScope(row, restriction);

    if (row.status === "closed") {
      throw new ConflictException({ code: "tickets.already_closed", title: "Ticket already closed" });
    }

    await this.repository.update(id, { status: "closed" });
    const updated = await this.repository.findById(tenantId, id);
    if (!updated) throw new NotFoundException({ code: "tickets.not_found", title: "Ticket not found after close" });
    const messages = await this.repository.listMessages(id, true);
    return toDetail(updated, messages);
  }

  /** POST /crm/tickets/:id/messages — staff reply, may set isInternal (tickets.edit). */
  async addStaffMessage(tenantId: string, actorId: string, id: string, body: AddTicketMessageRequest): Promise<TicketMessageDto> {
    const row = await this.repository.findById(tenantId, id);
    if (!row) throw new NotFoundException({ code: "tickets.not_found", title: "Ticket not found" });
    const restriction = await this.resolveRestriction(actorId);
    this.assertRowInScope(row, restriction);

    const created = await this.repository.addMessage(tenantId, {
      ticketId: id,
      authorId: actorId,
      body: body.body,
      isInternal: body.isInternal,
    });
    const messages = await this.repository.listMessages(id, true);
    const message = messages.find((m) => m.id === created.id);
    if (!message) throw new NotFoundException({ code: "tickets.message_not_found", title: "Message not found after creation" });
    return toMessageDto(message);
  }

  // ─── LMS: student's own tickets ─────────────────────────────────────────────

  async create(tenantId: string, actorId: string, body: CreateTicketRequest): Promise<TicketDetail> {
    const slaDueAt = new Date(Date.now() + SLA_LEAD_TIME_MS[body.priority]);
    const created = await this.repository.create(tenantId, {
      userId: actorId,
      subject: body.subject,
      body: body.body,
      priority: body.priority,
      slaDueAt,
    });
    const row = await this.repository.findById(tenantId, created.id);
    if (!row) throw new NotFoundException({ code: "tickets.not_found", title: "Ticket not found after creation" });
    return toDetail(row, []);
  }

  async listMine(tenantId: string, actorId: string, query: ListMyTicketsQuery): Promise<PaginatedResult<TicketSummary>> {
    const { rows, total } = await this.repository.list({
      tenantId,
      status: query.status,
      page: query.page,
      pageSize: query.pageSize,
      restrictToUserId: actorId,
    });
    return new PaginatedResult(rows.map(toSummary), {
      page: query.page,
      pageSize: query.pageSize,
      total,
      hasMore: query.page * query.pageSize < total,
    });
  }

  async getMine(tenantId: string, actorId: string, id: string): Promise<TicketDetail> {
    const row = await this.repository.findById(tenantId, id);
    if (!row || row.userId !== actorId) {
      throw new NotFoundException({ code: "tickets.not_found", title: "Ticket not found" });
    }
    // Student view — isInternal=true rows filtered server-side (headline isolation rule).
    const messages = await this.repository.listMessages(id, false);
    return toDetail(row, messages);
  }

  /**
   * POST /me/tickets/:id/messages — student reply. isInternal is FORCED false server-side.
   *
   * Returns the full TicketDetail, not the created message, matching `create`,
   * `getMine` and `rate` on this controller. The LMS caches this response as the
   * ticket detail; returning a bare message put a message-shaped object under the
   * detail cache key and crashed the thread on the next render
   * (`ticket.messages.map` of undefined) — on a write that had already succeeded.
   */
  async addMyMessage(tenantId: string, actorId: string, id: string, body: AddTicketMessageRequest): Promise<TicketDetail> {
    const row = await this.repository.findById(tenantId, id);
    if (!row || row.userId !== actorId) {
      throw new NotFoundException({ code: "tickets.not_found", title: "Ticket not found" });
    }
    const created = await this.repository.addMessage(tenantId, {
      ticketId: id,
      authorId: actorId,
      body: body.body,
      isInternal: false, // students can NEVER set this true, regardless of the request body.
    });
    // Student view — isInternal=true rows stay filtered out (headline isolation rule).
    const messages = await this.repository.listMessages(id, false);
    if (!messages.some((m) => m.id === created.id)) {
      throw new NotFoundException({ code: "tickets.message_not_found", title: "Message not found after creation" });
    }
    return toDetail(row, messages);
  }

  /** POST /me/tickets/:id/rate — CSAT, only after status=resolved|closed. */
  async rate(tenantId: string, actorId: string, id: string, body: RateTicketRequest): Promise<TicketDetail> {
    const row = await this.repository.findById(tenantId, id);
    if (!row || row.userId !== actorId) {
      throw new NotFoundException({ code: "tickets.not_found", title: "Ticket not found" });
    }
    if (row.status !== "resolved" && row.status !== "closed") {
      throw new ConflictException({
        code: "tickets.not_ratable",
        title: "Ticket is not yet resolved",
        detail: "A ticket can only be rated once it is resolved or closed.",
      });
    }
    await this.repository.update(id, { rating: body.rating });
    const updated = await this.repository.findById(tenantId, id);
    if (!updated) throw new NotFoundException({ code: "tickets.not_found", title: "Ticket not found after rate" });
    const messages = await this.repository.listMessages(id, false);
    return toDetail(updated, messages);
  }
}

// ─── DTO mapping ────────────────────────────────────────────────────────────

function toSummary(row: TicketRow): TicketSummary {
  return {
    id: row.id,
    userId: row.userId,
    userName: row.userName,
    subject: row.subject,
    status: row.status,
    priority: row.priority,
    assigneeId: row.assigneeId,
    assigneeName: row.assigneeName,
    slaDueAt: row.slaDueAt ? row.slaDueAt.toISOString() : null,
    rating: row.rating,
    createdAt: row.createdAt.toISOString(),
  };
}

function toDetail(row: TicketRow, messages: TicketMessageRow[]): TicketDetail {
  return {
    ...toSummary(row),
    body: row.body,
    messages: messages.map(toMessageDto),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toMessageDto(row: TicketMessageRow): TicketMessageDto {
  return {
    id: row.id,
    ticketId: row.ticketId,
    authorId: row.authorId,
    authorName: row.authorName,
    body: row.body,
    isInternal: row.isInternal,
    createdAt: row.createdAt.toISOString(),
  };
}
