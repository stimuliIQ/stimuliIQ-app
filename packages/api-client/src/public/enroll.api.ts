// Public self-service enrollment funnel SDK — Phase 5, Wave 2
// (docs/plans/phase-5.md task #2).
//
// Namespace: client.public.enroll.*
//
// Endpoints covered:
//   P-7: POST /public/enroll/orders   → createOrder()
//   P-8: POST /public/enroll/checkout → checkout()
//   P-9: POST /public/enroll/verify   → verify()
//
// All three endpoints require the session issued by POST /public/register (P-6).
// They are own-scoped fail-closed: the backend validates that the order belongs to
// the authenticated student (IDOR → 404, AC-22).
//
// Security contract:
//   - Requires cookieAuth (session from client.public.auth.register()).
//   - CSRF token required on all POST requests (X-CSRF-Token header, auto-managed by ApiClient).
//   - Idempotency-Key required on all mutations (docs/04 §2.6).
//     Default: crypto.randomUUID(). For retries: caller MUST pass the SAME key.
//   - Amount: server-derived exclusively. Client cannot supply amount_paise (AC-21).
//   - Own-scoped: every endpoint verifies the resource belongs to the authenticated student.
//   - No secret in responses: checkout() returns PUBLIC keyId only (AC-41).
//     Compile-time asserted in @repo/types/public/enroll.schemas.ts.
//   - Idempotent: same idempotency key → cached response (AC-17).
//   - Verify idempotent: provider_payment_id UNIQUE → replay → no double-enroll (AC-18).
//   - Forged signature: 400, no enrollment (AC-20).
//   - LMS handoff: verify() response includes lmsRedirectUrl (AC-23).
//
// Funnel usage example:
//   const key = crypto.randomUUID();        // generate once, persist in state for retries
//   const order = await client.public.enroll.createOrder({ programId }, key);
//   const checkout = await client.public.enroll.checkout({ orderId: order.orderId }, key);
//   // Open Razorpay checkout.js with checkout.razorpayOrderId, checkout.keyId, etc.
//   // After Razorpay handler callback:
//   const result = await client.public.enroll.verify({ ...razorpayFields }, key);
//   router.push(result.lmsRedirectUrl);    // LMS handoff

import type {
  PublicCreateOrderDto,
  PublicOrderResponse,
  PublicCheckoutDto,
  PublicCheckoutResponse,
  PublicVerifyPaymentDto,
  PublicVerifyPaymentResponse,
} from "@repo/types";
import type { ApiClient } from "../http/client.js";

export class PublicEnrollApi {
  constructor(private readonly client: ApiClient) {}

  /**
   * POST /api/v1/public/enroll/orders (P-7)
   *
   * Creates a self-service order for the authenticated student.
   * Own-scoped: studentId derived from session (never from client).
   * Amount server-derived: program.pricePaise − coupon_discount (AC-21).
   * Idempotent: same idempotencyKey → returns existing order (AC-17).
   *
   * @param body - { programId, couponCode?, emiPlan? }
   * @param idempotencyKey - Caller-generated UUID. MUST be the same on retries.
   * @returns PublicOrderResponse with orderId + amountPaise (server-derived).
   *
   * Errors:
   *   - 401: session expired (refresh + retry via onUnauthorized hook).
   *   - 422: coupon invalid/expired/not-applicable (AC edge case).
   *   - 404: program not found or not public.
   *
   * Authentication: Required (student session from register()).
   */
  async createOrder(
    body: PublicCreateOrderDto,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<PublicOrderResponse> {
    return this.client.request<PublicOrderResponse>(
      "POST",
      "/api/v1/public/enroll/orders",
      { body, idempotencyKey },
    );
  }

  /**
   * POST /api/v1/public/enroll/checkout (P-8)
   *
   * Initiates Razorpay checkout for the student's own order.
   * Own-scoped: orderId must belong to the authenticated student → 404 otherwise (AC-22).
   * Returns the fields needed to open Razorpay's checkout.js SDK.
   *
   * SECURITY: response.keyId is the PUBLIC RAZORPAY_KEY_ID only.
   * RAZORPAY_KEY_SECRET is NEVER in this response (compile-time asserted in @repo/types).
   *
   * @param body - { orderId }
   * @param idempotencyKey - Caller-generated UUID. MUST be the same on retries.
   * @returns { razorpayOrderId, keyId (PUBLIC), amountPaise, currency, orderId }
   *
   * Errors:
   *   - 401: session expired.
   *   - 404: order not found or belongs to another student (IDOR — AC-22).
   *
   * Authentication: Required (student session).
   */
  async checkout(
    body: PublicCheckoutDto,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<PublicCheckoutResponse> {
    return this.client.request<PublicCheckoutResponse>(
      "POST",
      "/api/v1/public/enroll/checkout",
      { body, idempotencyKey },
    );
  }

  /**
   * POST /api/v1/public/enroll/verify (P-9)
   *
   * Verifies the Razorpay payment signature and creates the enrollment atomically.
   * Own-scoped: razorpay_order_id must map to the authenticated student's order (AC-22).
   * Idempotent: provider_payment_id UNIQUE → replay → no double-enrollment (AC-18).
   * Forged/invalid signature → 400, no enrollment (AC-20).
   * Returns lmsRedirectUrl for immediate LMS handoff (AC-23).
   *
   * IMPORTANT: pass the SAME idempotencyKey used for createOrder() and checkout()
   * to ensure correct idempotency tracking across the funnel.
   *
   * @param body - { razorpay_order_id, razorpay_payment_id, razorpay_signature }
   *               (exact fields from Razorpay's checkout handler callback)
   * @param idempotencyKey - Caller-generated UUID (same as used for createOrder/checkout).
   * @returns { enrollmentId, orderId, lmsRedirectUrl, message }
   *
   * Errors:
   *   - 400: invalid Razorpay signature (AC-20). No enrollment.
   *   - 401: session expired.
   *   - 404: order not found or belongs to another student (IDOR — AC-22).
   *
   * Authentication: Required (student session).
   */
  async verify(
    body: PublicVerifyPaymentDto,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<PublicVerifyPaymentResponse> {
    return this.client.request<PublicVerifyPaymentResponse>(
      "POST",
      "/api/v1/public/enroll/verify",
      { body, idempotencyKey },
    );
  }
}
