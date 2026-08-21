// Public self-service enrollment funnel DTOs — Phase 5, Wave 2
// (docs/plans/phase-5.md task #2, endpoints P-7, P-8, P-9).
//
// The self-service enroll flow (after POST /public/register issues a session):
//   P-7: POST /public/enroll/orders     → create order (idempotent)
//   P-8: POST /public/enroll/checkout   → initiate Razorpay checkout
//   P-9: POST /public/enroll/verify     → verify payment + create enrollment
//
// Design principle (Risk #1 from phase-5.md §6):
//   These DTOs wrap the SAME CommerceService engine as the staff-facing
//   /commerce/orders / /commerce/orders/:id/pay / /commerce/payments/verify.
//   The ONLY differences from the staff flow:
//     1. Auth: `own`-scoped fail-closed (student acts on THEIR OWN order only).
//        Cross-student access → 404 (IDOR protection, AC-22).
//     2. Simplification: no `studentId` in the request (derived from session).
//        No `batchId` (backend auto-assigns the next available batch for the program).
//        No `notes` (staff annotation field stripped from public surface).
//     3. Funnel shaping: register → order → checkout → verify as one guided path.
//   All money math, idempotency, coupon paise computation, signature verification,
//   and order→enrollment atomicity are INHERITED from CommerceService (ADR-0014).
//
// Security (AC-16..AC-23):
//   - Amount ALWAYS server-derived: program.pricePaise − coupon_discount.
//     The client CANNOT supply an amount. .strict() rejects any extra fields.
//   - IdempotencyKey: client-generated (crypto.randomUUID()), passed as
//     Idempotency-Key HTTP header on P-7 + P-8. Stored in orders.idempotency_key.
//     Same key → replayed request → cached response (no double-order, AC-17).
//   - Verify idempotency: provider_payment_id UNIQUE constraint makes a replayed
//     verify a no-op (no double-enrollment, AC-18).
//   - Forged signature → 400, no enrollment (AC-20).
//   - No secret in response: PublicCheckoutResponse carries keyId (PUBLIC) ONLY.
//     RAZORPAY_KEY_SECRET / RAZORPAY_WEBHOOK_SECRET / captcha secrets are NEVER
//     in any response (AC-41, compile-time asserted below).
//   - IDOR: a student can only checkout/verify their OWN order → 404 otherwise (AC-22).
//   - LMS handoff: verify response includes lmsRedirectUrl (AC-23).
//
// Reuse note: PublicVerifyPaymentDto is intentionally identical to
// VerifyPaymentRequestSchema (payments.schemas.ts). To avoid duplication we
// re-export it as a type alias here (CLAUDE.md §3.2: "one schema per shape, no dupes").
// The api-client public namespace calls the public endpoint path; the schema is
// shared with the existing schema import from commerce/payments.schemas.ts.

import { z } from "zod";
import { UuidSchema } from "../common/primitives.js";
// Re-use the existing verify DTO — same fields, same validation, just a different endpoint path.
import { VerifyPaymentRequestSchema } from "../commerce/payments.schemas.js";
import { OrderEmiPlanSchema } from "../commerce/orders.schemas.js";

// ─────────────────────────────────────────────────────────────────────────
// P-7: PublicCreateOrderDto — POST /api/v1/public/enroll/orders
// ─────────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/public/enroll/orders (AUTHENTICATED — fresh student session)
 *
 * Creates a new self-service order for the authenticated student.
 * Auth: own-scoped (session must belong to the student; studentId is derived
 *   from session, never accepted from client).
 * Idempotency: Idempotency-Key header required. Same key → returns existing order.
 * Amount: server-derived from program.pricePaise − coupon_discount (AC-21).
 *   .strict() ensures no client-supplied amount field can slip through.
 *
 * FORBIDDEN client fields (rejected by .strict()):
 *   studentId, tenantId, amountPaise, status, currency, id.
 *   No notes (staff annotation stripped from public funnel — not an oversight).
 *
 * Auto-batch: the backend auto-selects the next available batch for the program
 *   (no batchId in the public funnel — simplification vs staff create-order).
 *
 * On duplicate idempotency key: returns the existing order (200), no new row.
 *
 * Permissions: Self (authenticated student, own order only).
 */
export const PublicCreateOrderDtoSchema = z
  .object({
    programId: UuidSchema.describe("The program to enroll in."),
    couponCode: z
      .string()
      .min(1)
      .max(50)
      .optional()
      .describe(
        "Optional coupon code. Server validates and applies discount. " +
          "The discount is computed server-side, never client-supplied.",
      ),
    /**
     * Optional EMI plan selection. Display-only in P5; stored on the order row.
     * Full EMI/dunning is a later phase. The plan must be one of the EMI options
     * returned by the program detail (emiDisplay field).
     */
    emiPlan: OrderEmiPlanSchema.optional().describe("Optional EMI plan choice (display only in P5)."),
  })
  .strict();
export type PublicCreateOrderDto = z.infer<typeof PublicCreateOrderDtoSchema>;

/**
 * Response for POST /api/v1/public/enroll/orders.
 * Minimal: just enough for the checkout step to proceed.
 */
export const PublicOrderResponseSchema = z.object({
  orderId: UuidSchema.describe("Internal order id. Pass to POST /public/enroll/checkout."),
  amountPaise: z
    .number()
    .int()
    .min(0)
    .describe("Net charge amount in integer paise (server-derived). Use for checkout display."),
  currency: z.string().length(3).describe("ISO-4217 currency code, e.g. INR."),
  discountPaise: z
    .number()
    .int()
    .min(0)
    .describe("Discount applied in integer paise (from coupon, if any)."),
  status: z
    .enum(["created", "paid", "failed", "refunded"])
    .describe("Order status. 'created' on fresh order; 'paid' if already paid (idempotent)."),
});
export type PublicOrderResponse = z.infer<typeof PublicOrderResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────
// P-8: PublicCheckoutDto + PublicCheckoutResponse
// POST /api/v1/public/enroll/checkout
// ─────────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/public/enroll/checkout (AUTHENTICATED — fresh student session)
 *
 * Initiates a Razorpay checkout for the student's order.
 * Calls CommerceService.initiateRazorpayCheckout() (same as /commerce/orders/:id/pay).
 * Own-scoped: the orderId must belong to the authenticated student → 404 otherwise.
 * Idempotency-Key header required.
 *
 * Permissions: Self (authenticated student, own order only).
 */
export const PublicCheckoutDtoSchema = z
  .object({
    orderId: UuidSchema.describe(
      "The internal order id from POST /public/enroll/orders. " +
        "Must belong to the authenticated student (own-scoped).",
    ),
  })
  .strict();
export type PublicCheckoutDto = z.infer<typeof PublicCheckoutDtoSchema>;

/**
 * Response for POST /api/v1/public/enroll/checkout.
 *
 * Contains ONLY the fields needed to open Razorpay checkout.js in the browser:
 *   - razorpayOrderId → options.order_id
 *   - keyId          → options.key (PUBLIC key — NEVER the secret)
 *   - amountPaise    → options.amount
 *   - currency       → options.currency
 *
 * SECURITY ASSERTION (compile-time, below):
 *   This type MUST NOT contain `keySecret`, `secret`, or any private key field.
 *   Only the PUBLIC RAZORPAY_KEY_ID is returned — prefixed NEXT_PUBLIC_ on the
 *   client (AC-41).
 */
export const PublicCheckoutResponseSchema = z.object({
  razorpayOrderId: z
    .string()
    .min(1)
    .describe("Razorpay order_id to pass to checkout options.order_id."),
  /**
   * PUBLIC Razorpay key id (rzp_test_... or rzp_live_...).
   * Safe to send to the client. NEVER the secret key.
   * This is read from RAZORPAY_KEY_ID env var (NOT RAZORPAY_KEY_SECRET).
   */
  keyId: z
    .string()
    .min(1)
    .describe(
      "PUBLIC Razorpay key id (rzp_test_... or rzp_live_...). " +
        "NEVER the secret. Pass to checkout options.key.",
    ),
  amountPaise: z
    .number()
    .int()
    .min(0)
    .describe("Exact amount to charge in integer paise. Pass to checkout options.amount."),
  currency: z.string().length(3).describe("ISO-4217 currency code. Pass to checkout options.currency."),
  /** Internal stimuliiq order id — for correlation in the verify step. */
  orderId: UuidSchema.describe("Internal order id. Use to correlate with POST /public/enroll/verify."),
});
export type PublicCheckoutResponse = z.infer<typeof PublicCheckoutResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────
// P-9: PublicVerifyPaymentDto — POST /api/v1/public/enroll/verify
// ─────────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/public/enroll/verify (AUTHENTICATED — fresh student session)
 *
 * Verifies the Razorpay payment signature and creates the enrollment atomically.
 * Calls CommerceService.verifyPayment() — the SAME engine as /commerce/payments/verify.
 *
 * These are the exact three fields Razorpay's checkout `handler(response)` callback
 * provides. The client forwards them verbatim without modification.
 *
 * The backend:
 *   1. Validates own-scope: the razorpay_order_id must belong to the authenticated
 *      student's order → 404 otherwise (IDOR protection, AC-22).
 *   2. Recomputes HMAC-SHA256(razorpay_order_id + "|" + razorpay_payment_id,
 *      RAZORPAY_KEY_SECRET) and compares to razorpay_signature.
 *   3. On match: marks payment captured, order paid, creates enrollment (atomic
 *      $transaction, idempotent by provider_payment_id UNIQUE).
 *   4. On mismatch: 400 with payments.signature_invalid (no enrollment, AC-20).
 *
 * Idempotent: replaying with same razorpay_payment_id is a no-op (AC-18).
 * Idempotency-Key header required.
 *
 * Response includes lmsRedirectUrl for LMS handoff (AC-23).
 *
 * Permissions: Self (authenticated student, own order only).
 *
 * REUSE: This schema is intentionally identical to VerifyPaymentRequestSchema
 * (commerce/payments.schemas.ts). We use a type alias, not a new schema, to
 * avoid drift (CLAUDE.md §3.2: one schema per shape, no dupes).
 */
export const PublicVerifyPaymentDtoSchema = VerifyPaymentRequestSchema;
export type PublicVerifyPaymentDto = z.infer<typeof PublicVerifyPaymentDtoSchema>;

/**
 * Response for POST /api/v1/public/enroll/verify (200 OK)
 *
 * Returns the enrollment id + an LMS redirect URL for the handoff (AC-23).
 * The LMS redirect URL allows the web frontend to redirect the newly enrolled
 * student to the LMS without a separate login step (the session cookie issued
 * at registration is still valid).
 */
export const PublicVerifyPaymentResponseSchema = z.object({
  enrollmentId: UuidSchema.describe("The enrollment created for this student + program."),
  orderId: UuidSchema.describe("The order that was paid."),
  /**
   * URL to redirect the student to the LMS after successful enrollment.
   * This is a server-derived URL (not a client-constructed one). The session
   * issued at registration is valid here — no separate login required.
   * AC-23: must be non-null on success.
   */
  lmsRedirectUrl: z
    .string()
    .url()
    .describe(
      "LMS redirect URL for immediate post-enrollment handoff. " +
        "Redirect the student here after displaying the success screen.",
    ),
  message: z
    .string()
    .describe("User-facing success message, e.g. 'Payment successful! Welcome to the program.'"),
});
export type PublicVerifyPaymentResponse = z.infer<typeof PublicVerifyPaymentResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Compile-time type assertions — no secret in checkout response
//
// AC-41 + Risk #1 (phase-5.md §5): RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET,
// and captcha secrets must NEVER appear in any response DTO.
//
// The assertions below fail at compile time if `keySecret`, `secret`,
// `webhookSecret`, or `keySecretField` are ever added to PublicCheckoutResponse.
// ─────────────────────────────────────────────────────────────────────────

type ForbiddenCheckoutField =
  | "keySecret"
  | "secret"
  | "webhookSecret"
  | "razorpayKeySecret"
  | "apiSecret";

type AssertNoSecretInCheckout<T, ForbiddenKeys extends string> = [
  ForbiddenKeys extends keyof T ? "SECRET FIELD DETECTED IN CHECKOUT RESPONSE" : "ok",
] extends ["ok"]
  ? true
  : never;

type _AssertCheckoutResponse = AssertNoSecretInCheckout<
  PublicCheckoutResponse,
  ForbiddenCheckoutField
>;
const _assertCheckout: _AssertCheckoutResponse = true;
export type { _AssertCheckoutResponse };
void _assertCheckout;
