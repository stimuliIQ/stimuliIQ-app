// Support-desk tickets contract — Phase 9 Completion, T14/T21
// (docs/plans/phase-9-completion.md). Backs `model Ticket` + `model TicketMessage`.
//
// Surfaces:
//   - Student (LMS): raise/list/get own tickets, add messages, rate on resolution —
//     /api/v1/me/tickets. Own-scope (IDOR -> 404 on another user's ticket).
//   - Staff (CRM): list/get/update/assign all-or-assigned tickets, add messages
//     (incl. internal-only notes), close/reopen — /api/v1/crm/tickets. Permission:
//     tickets.view (scope: all|assigned), tickets.manage.
// `isInternal` messages are NEVER returned to the raising student — the
// student-facing GET always filters `isInternal=false` server-side.

import { z } from "zod";
import { UuidSchema, IsoDateTimeSchema } from "../common/primitives.js";
import { PageQuerySchema } from "../common/pagination.js";

// ─────────────────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────────────────

export const TicketStatusSchema = z.enum(["open", "in_progress", "resolved", "closed"]);
export type TicketStatus = z.infer<typeof TicketStatusSchema>;

export const TicketPrioritySchema = z.enum(["low", "medium", "high", "urgent"]);
export type TicketPriority = z.infer<typeof TicketPrioritySchema>;

// ─────────────────────────────────────────────────────────────────────────
// Requests
// ─────────────────────────────────────────────────────────────────────────

/** POST /api/v1/me/tickets — student raises a ticket. `priority` defaults to medium; SLA is server-computed. */
export const CreateTicketRequestSchema = z
  .object({
    subject: z.string().min(1).max(200),
    body: z.string().min(1).max(10_000),
    priority: TicketPrioritySchema.default("medium"),
  })
  .strict();
export type CreateTicketRequest = z.infer<typeof CreateTicketRequestSchema>;

/** PATCH /api/v1/crm/tickets/:id — staff-only transitions (status/priority/assignee). */
export const UpdateTicketRequestSchema = z
  .object({
    status: TicketStatusSchema,
    priority: TicketPrioritySchema,
    assigneeId: UuidSchema.nullable(),
  })
  .partial()
  .strict();
export type UpdateTicketRequest = z.infer<typeof UpdateTicketRequestSchema>;

/** GET /api/v1/crm/tickets — staff list (all|assigned scope). */
export const ListTicketsQuerySchema = z
  .object({
    status: TicketStatusSchema.optional(),
    priority: TicketPrioritySchema.optional(),
    assigneeId: UuidSchema.optional(),
    search: z.string().min(1).max(200).optional().describe("Matches subject or raiser name."),
    overdue: z.coerce.boolean().optional().describe("Filter to sla_due_at < now and status not in (resolved,closed)."),
  })
  .merge(PageQuerySchema)
  .strict();
export type ListTicketsQuery = z.infer<typeof ListTicketsQuerySchema>;

/** GET /api/v1/me/tickets — student's own tickets only. */
export const ListMyTicketsQuerySchema = z
  .object({
    status: TicketStatusSchema.optional(),
  })
  .merge(PageQuerySchema)
  .strict();
export type ListMyTicketsQuery = z.infer<typeof ListMyTicketsQuerySchema>;

/** POST /api/v1/me/tickets/:id/messages or /api/v1/crm/tickets/:id/messages */
export const AddTicketMessageRequestSchema = z
  .object({
    body: z.string().min(1).max(10_000),
    isInternal: z
      .boolean()
      .default(false)
      .describe("Staff-only note, never visible to the raiser. Students cannot set this true (server enforces false)."),
  })
  .strict();
export type AddTicketMessageRequest = z.infer<typeof AddTicketMessageRequestSchema>;

/** POST /api/v1/me/tickets/:id/rate — CSAT, only after status=resolved|closed. */
export const RateTicketRequestSchema = z
  .object({
    rating: z.number().int().min(1).max(5),
  })
  .strict();
export type RateTicketRequest = z.infer<typeof RateTicketRequestSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Response DTOs
// ─────────────────────────────────────────────────────────────────────────

export const TicketMessageSchema = z.object({
  id: UuidSchema,
  ticketId: UuidSchema,
  authorId: UuidSchema,
  authorName: z.string(),
  body: z.string(),
  isInternal: z.boolean(),
  createdAt: IsoDateTimeSchema,
});
export type TicketMessage = z.infer<typeof TicketMessageSchema>;

export const TicketSummarySchema = z.object({
  id: UuidSchema,
  userId: UuidSchema,
  userName: z.string(),
  subject: z.string(),
  status: TicketStatusSchema,
  priority: TicketPrioritySchema,
  assigneeId: UuidSchema.nullable(),
  assigneeName: z.string().nullable(),
  slaDueAt: IsoDateTimeSchema.nullable(),
  rating: z.number().int().min(1).max(5).nullable(),
  createdAt: IsoDateTimeSchema,
});
export type TicketSummary = z.infer<typeof TicketSummarySchema>;

export const TicketDetailSchema = TicketSummarySchema.extend({
  body: z.string(),
  messages: z.array(TicketMessageSchema).describe(
    "For the student-facing GET, isInternal=true rows are filtered server-side before this array is built.",
  ),
  updatedAt: IsoDateTimeSchema,
});
export type TicketDetail = z.infer<typeof TicketDetailSchema>;
