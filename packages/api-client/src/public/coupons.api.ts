// Public coupon validation SDK — Phase 5, Wave 2 (docs/plans/phase-5.md task #2).
//
// Namespace: client.public.coupons.*
//
// Endpoint covered:
//   P-5: POST /public/coupons/validate → validate()
//
// Security contract:
//   - Unauthenticated (no cookieAuth, CSRF-excluded for anon writes).
//   - captchaToken required to prevent automated coupon enumeration (AC-11).
//   - Rate-limited per IP (429 + Retry-After — AC-11).
//   - Response is strictly display-safe: original/discount/final paise + type + displayCode.
//   - NEVER leaks coupon internals: id, max_uses, used count, program_scope,
//     valid_from/valid_to, status, tenantId (AC-9). Asserted compile-time in @repo/types.
//   - Invalid coupon: 422 with generic message (no existence-vs-inactive leak — AC-10).
//   - Does NOT change the `used` counter (non-mutating preview — AC-9).
//
// Note: This is distinct from the staff CommerceApi.coupons.validate() which returns
// `couponId` and `invalidReason` (internal fields not safe for public exposure).
// The public validate returns ONLY the PM-spec allowlist fields.

import type {
  PublicValidateCouponDto,
  PublicCouponDiscountResponse,
} from "@repo/types";
import type { ApiClient } from "../http/client.js";

export class PublicCouponsApi {
  constructor(private readonly client: ApiClient) {}

  /**
   * POST /api/v1/public/coupons/validate (P-5) — UNAUTHENTICATED
   *
   * Non-mutating coupon preview for the pricing/checkout coupon field.
   * Returns discounted paise amounts for display. Does NOT change the `used` counter.
   * The actual coupon application happens server-side at POST /public/enroll/orders.
   *
   * Captcha-gated to prevent enumeration (AC-11). Rate-limited per IP.
   *
   * @param body - { code, programId, captchaToken }
   * @returns { originalPaise, discountPaise, finalPaise, type, displayCode }
   *
   * Errors:
   *   - 422: coupon invalid, expired, not applicable, or captcha failed (AC-10).
   *         Generic message — does NOT reveal whether code exists but is inactive.
   *   - 429: rate limit exceeded (AC-11).
   *
   * Authentication: None (anonymous public write).
   */
  async validate(body: PublicValidateCouponDto): Promise<PublicCouponDiscountResponse> {
    return this.client.request<PublicCouponDiscountResponse>(
      "POST",
      "/api/v1/public/coupons/validate",
      { body },
    );
  }
}
