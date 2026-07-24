// Refunds contract — Phase 2, Wave 2 (docs/plans/phase-2.md task #2).
//
// Refund approval workflow (docs/03 §7.6):
//   requested → approved → processed (via PaymentProvider)
//              → rejected  (terminal, no refund issued)
//              → failed    (provider call failed; may be retried by finance)
//
// Authorization (docs/03 §9 + phase-2.md §"Risks #2"):
//   - `payments.create` (or `refunds.request`) → Counsellor / Finance / Admin
//   - `refunds.approve` → Finance + Owner/Admin ONLY. The backend MUST enforce
//     this and MUST prevent self-approval escalation.
//   - `refunds.reject`  → Finance + Owner/Admin ONLY.
//
// Money: all amounts in integer paise (CLAUDE.md §3.6). `amountPaise` must
// be > 0 and <= the original payment's captured amount (validated server-side).

import { z } from "zod";
import { UuidSchema, IsoDateTimeSchema } from "../common/primitives.js";
import { PageQuerySchema } from "../common/pagination.js";

// ─────────────────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────────────────

export const RefundStatusSchema = z.enum([
  "requested",
  "approved",
  "rejected",
  "processed",
  "failed",
]);
export type RefundStatus = z.infer<typeof RefundStatusSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Requests
// ─────────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/commerce/refunds
 *
 * Request a refund for a captured payment. `amountPaise` must be ≤ the
 * original captured payment amount (validated server-side; partial refunds
 * are supported). Creates a refund row in `requested` status.
 *
 * `Idempotency-Key` header required (docs/04 §2.6).
 */
export const RequestRefundRequestSchema = z
  .object({
    paymentId: UuidSchema.describe("The captured payment to refund (payments.id)."),
    amountPaise: z
      .number()
      .int()
      .min(1)
      .describe("Refund amount in integer paise. Must be > 0 and ≤ original captured amount."),
    reason: z
      .string()
      .min(1)
      .max(1000)
      .describe("Reason for the refund request. Required for audit trail."),
  })
  .strict();
export type RequestRefundRequest = z.infer<typeof RequestRefundRequestSchema>;

/**
 * POST /api/v1/commerce/refunds/:id/approve
 *
 * Finance / Owner / Admin only (`refunds.approve`). Moves the refund to
 * `approved` status and triggers the provider refund call (via PaymentProvider
 * in the backend service). Records `approved_by` from the authenticated user.
 *
 * SECURITY: The backend MUST check that the actor's permission includes
 * `refunds.approve` — no self-approval escalation (security-reviewer task #10).
 *
 * `Idempotency-Key` header required.
 */
export const ApproveRefundRequestSchema = z
  .object({
    notes: z
      .string()
      .max(500)
      .optional()
      .describe("Optional approval notes (for the audit log)."),
  })
  .strict();
export type ApproveRefundRequest = z.infer<typeof ApproveRefundRequestSchema>;

/**
 * POST /api/v1/commerce/refunds/:id/reject
 *
 * Finance / Owner / Admin only (`refunds.approve`). Moves the refund to
 * `rejected` status (terminal — no provider call). Records `approved_by`
 * (used as `rejected_by` context) from the authenticated user.
 *
 * `Idempotency-Key` header required.
 */
export const RejectRefundRequestSchema = z
  .object({
    reason: z
      .string()
      .min(1)
      .max(500)
      .describe("Reason for rejection — required for audit trail."),
  })
  .strict();
export type RejectRefundRequest = z.infer<typeof RejectRefundRequestSchema>;

/** GET /api/v1/commerce/refunds — filter/paginate the refund list. */
export const ListRefundsQuerySchema = z
  .object({
    paymentId: UuidSchema.optional(),
    orderId: UuidSchema.optional(),
    studentId: UuidSchema.optional(),
    status: RefundStatusSchema.optional(),
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
  })
  .merge(PageQuerySchema)
  .strict();
export type ListRefundsQuery = z.infer<typeof ListRefundsQuerySchema>;

// ─────────────────────────────────────────────────────────────────────────
// Response DTOs
// ─────────────────────────────────────────────────────────────────────────

/** Row shape for the refunds list. */
export const RefundSummarySchema = z.object({
  id: UuidSchema,
  paymentId: UuidSchema,
  orderId: UuidSchema,
  amountPaise: z.number().int().min(0).describe("Refund amount in integer paise."),
  reason: z.string(),
  status: RefundStatusSchema,
  requestedById: UuidSchema.nullable(),
  requestedByName: z.string().nullable(),
  approvedById: UuidSchema.nullable(),
  approvedByName: z.string().nullable(),
  createdAt: IsoDateTimeSchema,
});
export type RefundSummary = z.infer<typeof RefundSummarySchema>;

/** Full refund detail including provider + student context. */
export const RefundDetailSchema = RefundSummarySchema.extend({
  providerRefundId: z.string().nullable().describe("Provider-assigned refund id, set after processing."),
  processedAt: IsoDateTimeSchema.nullable(),
  studentId: UuidSchema,
  studentName: z.string(),
  programTitle: z.string(),
  updatedAt: IsoDateTimeSchema,
});
export type RefundDetail = z.infer<typeof RefundDetailSchema>;
