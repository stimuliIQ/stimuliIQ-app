// Public coupon validation DTO — Phase 5, Wave 2 (docs/plans/phase-5.md task #2).
//
// POST /api/v1/public/coupons/validate
//
// The public coupon validate endpoint is a SAFE, non-mutating preview:
//   - Returns discounted paise amounts for display in the pricing/checkout UI.
//   - NEVER leaks coupon internals (id, max_uses, used count, program_scope,
//     valid_from, valid_to, status, tenant_id).
//   - NEVER increments the `used` counter (that happens at order-create time).
//   - Rate-limited per IP to prevent coupon enumeration (AC-11).
//
// Contrast with ValidateCouponRequestSchema / ValidateCouponResponseSchema from
// commerce/coupons.schemas.ts (staff endpoint, POST /commerce/coupons/validate):
//   - Staff endpoint returns `valid`, `couponId`, `code`, `type`, `discountPaise`,
//     `invalidReason` — some of which are internal (couponId).
//   - Public endpoint returns ONLY display-safe amounts + display_code + type.
//     No `valid` bool, no couponId, no invalidReason leaking existence.
//     An invalid coupon gets a 422 with generic message (AC-10).
//
// Note: `PublicValidateCouponDto` is the REQUEST DTO (input).
// `PublicCouponDiscountResponse` is the SUCCESS RESPONSE (200).
// Error path: 422 with generic "invalid or expired coupon" (no existence leak).

import { z } from "zod";
import { UuidSchema } from "../common/primitives.js";
import { CouponTypeSchema } from "../commerce/coupons.schemas.js";

// ─────────────────────────────────────────────────────────────────────────
// PublicValidateCouponDto — POST /api/v1/public/coupons/validate
// ─────────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/public/coupons/validate (UNAUTHENTICATED)
 *
 * Public coupon validation — safe non-mutating preview for the pricing/checkout
 * coupon field. Requires captcha token to prevent enumeration abuse (AC-11).
 *
 * Rate-limited per IP. CSRF-excluded. .strict() over-post stripping.
 * Error: 422 with generic message (never reveals whether code exists vs inactive).
 *
 * Permissions: None (anonymous public endpoint).
 */
export const PublicValidateCouponDtoSchema = z
  .object({
    /** The coupon code to validate (as entered by the visitor in the coupon field). */
    code: z.string().min(1).max(50).describe("Coupon code as entered by the visitor."),
    /**
     * The program to validate the coupon against.
     * Required: coupon may be program-scoped (programScope column).
     * Server validates that the coupon is applicable to this program.
     */
    programId: UuidSchema.describe(
      "The program UUID this coupon would be applied to. Required for program-scope validation.",
    ),
    /**
     * Captcha verification token (same requirement as lead capture).
     * Fail-closed in prod; prevents automated coupon enumeration.
     */
    captchaToken: z
      .string()
      .min(1)
      .describe(
        "Captcha verification token. Required for rate-limit + enumeration protection.",
      ),
  })
  .strict();
export type PublicValidateCouponDto = z.infer<typeof PublicValidateCouponDtoSchema>;

/**
 * Response for POST /api/v1/public/coupons/validate (200 OK)
 *
 * ALLOWED fields (from the PM spec allowlist):
 *   original_paise, discount_paise, final_paise, type, display_code
 *
 * FORBIDDEN (never in this response):
 *   id, max_uses, used, valid_from, valid_to, program_scope, status, tenant_id,
 *   any internal identifier.
 */
export const PublicCouponDiscountResponseSchema = z.object({
  /**
   * Original program price in integer paise (before discount).
   * Redundant to the program's pricePaise but included so the client can show
   * strikethrough price without re-fetching the program detail.
   */
  originalPaise: z
    .number()
    .int()
    .min(0)
    .describe("Original program price in integer paise."),
  /** Discount amount applied in integer paise. */
  discountPaise: z.number().int().min(0).describe("Discount amount in integer paise."),
  /** Final price (originalPaise - discountPaise) in integer paise. */
  finalPaise: z
    .number()
    .int()
    .min(0)
    .describe("Final price after discount in integer paise."),
  /**
   * Coupon discount type — pct (percentage) or flat (fixed paise).
   * Safe to display in UI ("10% off" vs "₹500 off").
   */
  type: CouponTypeSchema.describe("Coupon discount type: 'pct' or 'flat'."),
  /**
   * The coupon code as it should be displayed in the UI confirmation
   * (uppercase, sanitized). Safe for display; never an internal id.
   */
  displayCode: z.string().min(1).describe("Coupon code for display confirmation."),
});
export type PublicCouponDiscountResponse = z.infer<typeof PublicCouponDiscountResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Compile-time assertion: PublicCouponDiscountResponse must NOT carry internals
// ─────────────────────────────────────────────────────────────────────────

type ForbiddenCouponField =
  | "id"
  | "maxUses"
  | "used"
  | "validFrom"
  | "validTo"
  | "programScope"
  | "status"
  | "tenantId";

type AssertNoCouponInternals<T, ForbiddenKeys extends string> = [
  ForbiddenKeys extends keyof T ? "FORBIDDEN COUPON INTERNAL DETECTED" : "ok",
] extends ["ok"]
  ? true
  : never;

type _AssertCouponResponse = AssertNoCouponInternals<
  PublicCouponDiscountResponse,
  ForbiddenCouponField
>;
const _assertCoupon: _AssertCouponResponse = true;
export type { _AssertCouponResponse };
void _assertCoupon;
