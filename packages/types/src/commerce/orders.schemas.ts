// Orders contract — Phase 2, Wave 2 (docs/plans/phase-2.md task #2).
//
// Modeling decisions (phase-2.md §"Risks"):
//   - `amount_paise` on the order row is the **net charged** (after coupon
//     discount). The server computes this from `programs.pricePaise` minus
//     the coupon's discount; the client MUST NOT compute or send the final
//     amount. An optional `expectedAmountPaise` field is accepted for
//     reconciliation display (the frontend can show "you'll pay ₹X") but the
//     server is the authoritative source of truth — if the server-computed
//     amount differs, the server's value wins and no error is raised (the
//     client should re-read the returned order to display the real amount).
//   - `batchId` is required at order creation: it identifies which batch the
//     paid order will enroll the student into (validated: batch belongs to the
//     program and has capacity). This prevents the "which batch?" ambiguity.
//   - The `idempotency_key` field on the DB row maps 1:1 from the
//     `Idempotency-Key` HTTP header (docs/04 §2.6/§2.14). The backend stores
//     it and returns a cached response on replay, preventing double-orders.
//   - `emi_plan` is a JSON field (order-level, P2 only). Full EMI plan /
//     dunning is deferred (P2 plans §"Risks #5").
//   - Clients must NOT send `status`, `tenantId`, `id`, `discountPaise`, or
//     `amountPaise` on creates — the server is the source of truth for money.
//     Strict objects enforce this (zod .strict()).

import { z } from "zod";
import { UuidSchema, IsoDateTimeSchema } from "../common/primitives.js";
import { PageQuerySchema } from "../common/pagination.js";

// ─────────────────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────────────────

export const OrderStatusSchema = z.enum(["created", "paid", "failed", "refunded"]);
export type OrderStatus = z.infer<typeof OrderStatusSchema>;

export const EnrollmentSourceSchema = z.enum(["manual", "order", "conversion"]);
export type EnrollmentSource = z.infer<typeof EnrollmentSourceSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Shared sub-schemas
// ─────────────────────────────────────────────────────────────────────────

/**
 * Per-installment EMI plan option attached to the order row (`orders.emi_plan`
 * JSON column). Full EMI/dunning depth is deferred to post-P2.
 */
export const OrderEmiPlanSchema = z.object({
  months: z.number().int().min(1).max(60),
  perInstallmentPaise: z.number().int().min(0).describe("Per-installment amount, integer paise."),
  totalAmountPaise: z.number().int().min(0).describe("Total EMI amount in integer paise."),
});
export type OrderEmiPlan = z.infer<typeof OrderEmiPlanSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Requests
// ─────────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/commerce/orders
 *
 * Creates a new order for a program. The server:
 *   1. Validates `programId` + `batchId` (batch must belong to program, have
 *      capacity, and be active).
 *   2. Validates + applies the `couponCode` (expiry, max_uses, program scope)
 *      and computes `discountPaise`.
 *   3. Computes `amount_paise = program.pricePaise - discountPaise` server-side.
 *   4. Stores the `Idempotency-Key` header value into `orders.idempotency_key`
 *      (unique) — a replayed request with the same key returns the cached order.
 *
 * `expectedAmountPaise` is optional and informational only — the server does
 * NOT reject mismatches; callers should read the returned `amountPaise` to
 * display the final charge to the user.
 *
 * Clients must NOT send `status`, `tenantId`, `id`, `discountPaise`,
 * `amountPaise`, or `currency` — these are server-computed.
 */
export const CreateOrderRequestSchema = z
  .object({
    studentId: UuidSchema.describe("student_profiles.id of the student being enrolled."),
    programId: UuidSchema.describe("The program this order is for."),
    batchId: UuidSchema.describe(
      "The batch the student will be enrolled into on payment success. " +
        "Must belong to the program and have available capacity.",
    ),
    couponCode: z
      .string()
      .min(1)
      .max(50)
      .optional()
      .describe("Optional coupon code. Server validates and applies discount."),
    expectedAmountPaise: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        "Client's expected net amount in paise (after coupon). INFORMATIONAL ONLY, " +
          "server is the authoritative source. No error is raised on mismatch; read " +
          "the returned order for the actual charge.",
      ),
    emiPlan: OrderEmiPlanSchema.optional().describe(
      "Optional EMI breakdown. Stored on the order row. Full EMI/dunning is P2+ deferred.",
    ),
    notes: z
      .string()
      .max(500)
      .optional()
      .describe("Free-text notes (staff annotation). Not shown to the student."),
  })
  .strict();
export type CreateOrderRequest = z.infer<typeof CreateOrderRequestSchema>;

/** GET /api/v1/commerce/orders — filter/paginate the order ledger. */
export const ListOrdersQuerySchema = z
  .object({
    status: OrderStatusSchema.optional(),
    studentId: UuidSchema.optional(),
    programId: UuidSchema.optional(),
    batchId: UuidSchema.optional(),
    from: z.string().datetime({ offset: true }).optional().describe("Filter orders created on or after this ISO-8601 datetime."),
    to: z.string().datetime({ offset: true }).optional().describe("Filter orders created on or before this ISO-8601 datetime."),
    search: z.string().min(1).max(200).optional().describe("Match by student name / email / order id prefix."),
  })
  .merge(PageQuerySchema)
  .strict();
export type ListOrdersQuery = z.infer<typeof ListOrdersQuerySchema>;

// ─────────────────────────────────────────────────────────────────────────
// Response DTOs
// ─────────────────────────────────────────────────────────────────────────

/** Row shape for the order ledger table — minimal, no entity leakage. */
export const OrderSummarySchema = z.object({
  id: UuidSchema,
  studentId: UuidSchema,
  studentName: z.string(),
  programId: UuidSchema,
  programTitle: z.string(),
  batchId: UuidSchema,
  batchName: z.string(),
  amountPaise: z.number().int().min(0).describe("Net charged amount in integer paise."),
  currency: z.string().length(3).describe("ISO-4217 currency code, e.g. INR."),
  discountPaise: z.number().int().min(0).describe("Discount applied in integer paise."),
  /**
   * The programme's list price at read time, so a caller can show "₹10,000, discounted from
   * ₹14,999" without a second fetch. Derived (`amountPaise + discountPaise`) rather than
   * stored: the order records what was charged and what was taken off, and re-deriving keeps
   * those two the only source of truth.
   */
  listPricePaise: z.number().int().min(0).describe("amountPaise + discountPaise, in integer paise."),
  /** Why a human priced this below list. Null for no discount and for a coupon discount. */
  discountReason: z.string().nullable(),
  status: OrderStatusSchema,
  couponCode: z.string().nullable().describe("Coupon code applied, or null."),
  // Invoice linkage (lifecycle-redesign): a paid order carries its generated invoice
  // so list surfaces (Student 360 Payments tab) can offer a view/download action
  // without an extra detail fetch. Null until payment captures.
  invoiceId: UuidSchema.nullable(),
  invoiceNumber: z.string().nullable(),
  createdAt: IsoDateTimeSchema,
});
export type OrderSummary = z.infer<typeof OrderSummarySchema>;

/** Full order detail including payment + invoice + enrollment linkage. */
export const OrderDetailSchema = OrderSummarySchema.extend({
  couponId: UuidSchema.nullable(),
  emiPlan: OrderEmiPlanSchema.nullable(),
  notes: z.string().nullable(),
  enrollmentId: UuidSchema.nullable().describe("The enrollment created for this order, or null if not yet enrolled."),
  enrollmentSource: EnrollmentSourceSchema.nullable(),
  invoiceId: UuidSchema.nullable().describe("The invoice row id, or null if not yet generated."),
  invoiceNumber: z.string().nullable(),
  paymentCount: z.number().int().min(0).describe("Number of payment records in the ledger for this order."),
  updatedAt: IsoDateTimeSchema,
});
export type OrderDetail = z.infer<typeof OrderDetailSchema>;

/**
 * `PATCH /crm/orders/:id/price` — reprice an order a human agreed to sell cheaper.
 *
 * STORED AS A DISCOUNT, NOT AS AN OVERWRITTEN AMOUNT. The order keeps `amountPaise` as what
 * is actually charged and `discountPaise` as the difference from the programme's list price,
 * so revenue can be read as gross / discount / net. Overwriting the amount alone would make
 * a discounted sale indistinguishable from a cheap programme, which is the opposite of the
 * clarity this exists for.
 *
 * ONLY BEFORE MONEY LANDS. The API refuses once the order has any non-failed payment, because
 * changing the price under a recorded payment breaks reconciliation, the ledger and the
 * invoice at once. Reducing what somebody has already paid is a REFUND, which exists.
 */
export const UpdateOrderPriceRequestSchema = z
  .object({
    /**
     * The new net amount in integer paise. May be 0 (a free seat) but never above the
     * programme's list price — a "discount" that raises the price is an upsell, and hiding
     * one in a discount field would silently corrupt every gross-vs-net report.
     */
    amountPaise: z.number().int().min(0),
    /**
     * Why. Mandatory and non-trivial: the audit log already records the numbers moving, and
     * this is the only place the intent behind them can live. A 5-character floor stops
     * "ok" from passing for a reason.
     */
    reason: z.string().trim().min(5).max(500),
  })
  .strict();
export type UpdateOrderPriceRequest = z.infer<typeof UpdateOrderPriceRequestSchema>;
