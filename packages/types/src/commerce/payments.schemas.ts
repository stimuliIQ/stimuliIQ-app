// Payments contract — Phase 2, Wave 2 (docs/plans/phase-2.md task #2).
//
// The payments table is the LEDGER source of truth for reconciliation
// (docs/03 §20, phase-2.md §"Success criteria 10"). Each row = one payment
// attempt/event for an order.
//
// Razorpay integration shapes (docs/04 §2.10):
//   - CreateRazorpayOrderResponse: what the server returns from
//     POST /commerce/orders/:id/pay — the client opens the Razorpay checkout
//     with these fields. `keyId` is the PUBLIC Razorpay key (safe to send to
//     the client; NEVER send `keySecret`).
//   - VerifyPaymentRequest: the three fields Razorpay's checkout passes to the
//     `handler` callback (handler(response) in the Razorpay JS SDK). The client
//     POSTs these verbatim to POST /commerce/payments/verify; the server
//     recomputes the HMAC-SHA256 signature and marks the payment captured
//     (idempotent by `provider_payment_id` unique — replaying verify does NOT
//     double-enroll or double-pay, per phase-2.md §"Risks #1").
//   - RazorpayWebhookPayload: a passthrough/unknown shape because Razorpay can
//     send many event types with varying payload shapes. The backend verifies
//     the `X-Razorpay-Signature` header (HMAC with RAZORPAY_WEBHOOK_SECRET)
//     before processing. See `RazorpayWebhookSchema` — typed as
//     `z.record(z.string(), z.unknown())` to avoid coupling to a specific event
//     shape; the backend pattern-matches on `event` field for known types.
//     Replay safety is guaranteed by idempotency on `provider_payment_id`.
//   - ManualPaymentRequest: offline/cash/NEFT payment entry by staff. Creates a
//     payment row with `is_manual = true`; skips Razorpay signature checks.
//
// Security note: `keyId` (public Razorpay key) flows through the API response.
// `keySecret` and `RAZORPAY_WEBHOOK_SECRET` MUST NEVER appear in any response
// DTO — they stay in env vars and are used only by the backend provider adapter
// (integrations task #4).

import { z } from "zod";
import { UuidSchema, IsoDateTimeSchema } from "../common/primitives.js";
import { PageQuerySchema } from "../common/pagination.js";

// ─────────────────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────────────────

export const PaymentStatusSchema = z.enum([
  "created",
  "authorized",
  "captured",
  "failed",
  "refunded",
]);
export type PaymentStatus = z.infer<typeof PaymentStatusSchema>;

export const PaymentProviderSchema = z.enum(["razorpay", "manual"]);
export type PaymentProvider = z.infer<typeof PaymentProviderSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Razorpay checkout flow
// ─────────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/commerce/orders/:id/pay
 *
 * Server creates a Razorpay order via the PaymentProvider and returns the
 * fields needed to open Razorpay's checkout JS SDK. The client uses:
 *   - `razorpayOrderId` → `options.order_id`
 *   - `keyId` → `options.key` (PUBLIC key only — never the secret)
 *   - `amountPaise` → `options.amount`
 *   - `currency` → `options.currency`
 *
 * `Idempotency-Key` header required on this endpoint (docs/04 §2.6) to prevent
 * creating duplicate Razorpay orders on network retry.
 */
export const CreateRazorpayOrderResponseSchema = z.object({
  razorpayOrderId: z.string().min(1).describe("Razorpay order_id to pass to checkout options."),
  keyId: z
    .string()
    .min(1)
    .describe("PUBLIC Razorpay key id (rzp_test_... or rzp_live_...). NEVER the secret."),
  amountPaise: z.number().int().min(0).describe("Exact amount to charge in integer paise."),
  currency: z.string().length(3).describe("ISO-4217 currency code, e.g. INR."),
  orderId: UuidSchema.describe("Internal stimuliiq order id (for correlation after payment)."),
});
export type CreateRazorpayOrderResponse = z.infer<typeof CreateRazorpayOrderResponseSchema>;

/**
 * POST /api/v1/commerce/payments/verify
 *
 * These are the EXACT three fields Razorpay's checkout `handler(response)`
 * callback provides. The client must forward them verbatim without modification.
 * The server:
 *   1. Recomputes HMAC-SHA256(razorpay_order_id + "|" + razorpay_payment_id,
 *      RAZORPAY_KEY_SECRET) and compares to `razorpay_signature`.
 *   2. On match: marks payment `captured`, order `paid`, creates enrollment
 *      (atomic $transaction, idempotent by `provider_payment_id` unique).
 *   3. On mismatch: 422 with `payments.signature_invalid` error code.
 *
 * Idempotency: replaying with the same `razorpay_payment_id` is a no-op
 * (the existing captured payment is returned). This prevents double-enroll.
 *
 * `Idempotency-Key` header is required (docs/04 §2.6).
 */
export const VerifyPaymentRequestSchema = z
  .object({
    razorpay_order_id: z
      .string()
      .min(1)
      .describe("From Razorpay checkout handler response.razorpay_order_id."),
    razorpay_payment_id: z
      .string()
      .min(1)
      .describe("From Razorpay checkout handler response.razorpay_payment_id."),
    razorpay_signature: z
      .string()
      .min(1)
      .describe("From Razorpay checkout handler response.razorpay_signature. HMAC-SHA256."),
  })
  .strict();
export type VerifyPaymentRequest = z.infer<typeof VerifyPaymentRequestSchema>;

/**
 * POST /api/v1/commerce/payments/webhook (UNAUTHENTICATED — Razorpay signature verified)
 *
 * Razorpay sends many event types (`payment.captured`, `payment.failed`,
 * `order.paid`, `refund.processed`, etc.) with varying payload shapes. This
 * schema is intentionally loose (passthrough) because:
 *   1. We cannot enumerate every Razorpay event shape here.
 *   2. The backend verifies the `X-Razorpay-Signature` header FIRST before
 *      touching the body — a forged/unsigned payload is rejected at the guard
 *      layer and never reaches business logic.
 *   3. The backend then pattern-matches on `event` for known event types and
 *      ignores unknown ones (safe-by-default).
 *
 * SECURITY: This endpoint is UNAUTHENTICATED (no cookie/CSRF required) because
 * Razorpay calls it from their servers. Authentication IS the HMAC signature
 * verification (RAZORPAY_WEBHOOK_SECRET). The endpoint MUST consume the raw
 * request body as bytes for signature verification — do NOT parse JSON before
 * verification.
 *
 * Type annotation: `Record<string, unknown>` — intentional passthrough.
 * The `any`-equivalent is justified here because Razorpay controls the payload
 * shape and extends it without notice; runtime processing is guarded by
 * signature verification + `event` field narrowing in the backend handler.
 */
export const RazorpayWebhookSchema = z.record(z.string(), z.unknown()).describe(
  "Razorpay webhook payload, intentional passthrough shape. " +
    "Signature MUST be verified via X-Razorpay-Signature header before processing. " +
    "Backend pattern-matches on `event` field for known event types.",
);
export type RazorpayWebhook = z.infer<typeof RazorpayWebhookSchema>;

/**
 * Tolerance for the "not in the future" rule on a recorded payment instant.
 *
 * The timestamp is produced by the STAFF MEMBER'S browser clock and judged against the
 * server's, and those disagree in the wild — an unsynced laptop drifting a minute or two is
 * ordinary. Without slack, "leave it blank to use now" is safe but explicitly picking the
 * current minute would 422 for a subset of users, which reads as a bug rather than a rule.
 *
 * Five minutes is far below any interval a human would think of as "the future" for a cash
 * receipt, so it forgives skew without weakening what the rule is actually for.
 */
const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000;

/**
 * Rejects a future instant, ignoring absent values (the field is optional) and unparseable
 * ones (already rejected by `.datetime()`, and reporting them twice helps nobody).
 */
function isNotInTheFuture(value: string | undefined): boolean {
  if (value === undefined) return true;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return true;
  return parsed <= Date.now() + CLOCK_SKEW_TOLERANCE_MS;
}

/**
 * `POST /api/v1/commerce/payments/manual`
 *
 * Offline / cash / NEFT / cheque payment entry by staff. Creates a payment row with
 * `is_manual = true` and `signature_verified = false`. The order must be in `created`
 * status. Finance / Admin only (requires `payments.create` + scope).
 *
 * `Idempotency-Key` header required (docs/04 §2.6).
 *
 * WHY `paidAt` CANNOT BE IN THE FUTURE. This request asserts that money has ALREADY been
 * received — it captures the payment, marks the order paid, creates the enrollment and
 * raises an invoice, all immediately. A future `paidAt` would therefore enroll a student and
 * invoice them for a payment nobody has taken yet, and leave the ledger claiming income on a
 * date that has not happened. The rule lives HERE, in the shared schema, so the CRM's date
 * picker and the API enforce the same thing rather than the UI being the only guard.
 */
export const ManualPaymentRequestSchema = z
  .object({
    orderId: UuidSchema.describe("The internal order this payment settles."),
    amountPaise: z.number().int().min(1).describe("Amount received, integer paise."),
    method: z
      .string()
      .min(1)
      .max(80)
      .describe("Payment method description, e.g. 'cash', 'NEFT', 'cheque'."),
    reference: z
      .string()
      .min(1)
      .max(200)
      .describe("Transaction reference number, receipt number, or cheque number."),
    paidAt: z
      .string()
      .datetime({ offset: true })
      .optional()
      .refine(isNotInTheFuture, {
        message: "A payment can't be recorded as received in the future.",
      })
      .describe(
        "When the payment was physically RECEIVED. A past instant. Defaults to now if omitted. " +
          "Never a future date: this row asserts money has already arrived.",
      ),
    notes: z.string().max(500).optional().describe("Staff notes on this payment entry."),
  })
  .strict();
export type ManualPaymentRequest = z.infer<typeof ManualPaymentRequestSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Requests
// ─────────────────────────────────────────────────────────────────────────

/** GET /api/v1/commerce/payments — the payment ledger (filter/paginate). */
export const ListPaymentsQuerySchema = z
  .object({
    orderId: UuidSchema.optional(),
    studentId: UuidSchema.optional(),
    status: PaymentStatusSchema.optional(),
    provider: PaymentProviderSchema.optional(),
    isManual: z.coerce.boolean().optional(),
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
  })
  .merge(PageQuerySchema)
  .strict();
export type ListPaymentsQuery = z.infer<typeof ListPaymentsQuerySchema>;

// ─────────────────────────────────────────────────────────────────────────
// Response DTOs
// ─────────────────────────────────────────────────────────────────────────

/** Ledger row for the payments list — minimal, no entity leakage. */
export const PaymentSummarySchema = z.object({
  id: UuidSchema,
  orderId: UuidSchema,
  provider: z.string(),
  providerPaymentId: z.string().nullable(),
  amountPaise: z.number().int().min(0).describe("Amount in integer paise."),
  status: PaymentStatusSchema,
  method: z.string().nullable(),
  isManual: z.boolean(),
  paidAt: IsoDateTimeSchema.nullable(),
  createdAt: IsoDateTimeSchema,
});
export type PaymentSummary = z.infer<typeof PaymentSummarySchema>;

/** Full payment detail including signature/order/student context. */
export const PaymentDetailSchema = PaymentSummarySchema.extend({
  providerOrderId: z.string().nullable().describe("Razorpay order_id, if applicable."),
  signatureVerified: z.boolean(),
  studentId: UuidSchema,
  studentName: z.string(),
  programId: UuidSchema,
  programTitle: z.string(),
  updatedAt: IsoDateTimeSchema,
  // M-6: offline payment audit artifact. Present only on manual payments (cheque/NEFT/receipt no.).
  reference: z.string().nullable().optional().describe("Cheque/NEFT/receipt reference number. Present for manual payments only."),
  // Optional staff notes on the payment entry (manual payments only).
  notes: z.string().nullable().optional().describe("Staff notes on this manual payment entry."),
});
export type PaymentDetail = z.infer<typeof PaymentDetailSchema>;

/**
 * Ledger reconciliation summary — returned by
 * GET /api/v1/commerce/payments/reconciliation?from=...&to=...
 *
 * Contract for docs/03 §20: sum(captured payments) − sum(processed refunds) =
 * order ledger paid total for any date range. Proven by integration tests
 * (qa-engineer task #9, phase-2.md §"Success criteria 10").
 */
export const LedgerReconciliationSchema = z.object({
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
  capturedAmountPaise: z.number().int().min(0).describe("Sum of all captured payment amounts in paise."),
  processedRefundAmountPaise: z.number().int().min(0).describe("Sum of all processed refund amounts in paise."),
  netAmountPaise: z.number().int().describe("capturedAmountPaise − processedRefundAmountPaise. May be negative if refunds exceed captures (edge case)."),
  orderPaidTotalPaise: z.number().int().min(0).describe("Sum of order amounts where status=paid. Must equal netAmountPaise for reconciliation to pass."),
  reconcilesOk: z.boolean().describe("True when netAmountPaise === orderPaidTotalPaise."),
  captureCount: z.number().int().min(0),
  refundCount: z.number().int().min(0),
});
export type LedgerReconciliation = z.infer<typeof LedgerReconciliationSchema>;
