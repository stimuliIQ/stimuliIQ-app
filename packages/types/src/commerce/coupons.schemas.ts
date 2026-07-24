// Coupons contract — Phase 2, Wave 2 (docs/plans/phase-2.md task #2).
//
// Coupon ownership (phase-2.md §"Risks #8" + docs/03 §9):
//   Marketing role creates/edits coupons (`coupons.create` / `coupons.edit`).
//   Finance + Owner/Admin see all order/discount impact.
//
// Coupon math is ALWAYS server-side (CLAUDE.md §3.6):
//   - `type: "pct"` → discount = floor(programPricePaise * value / 100), paise
//   - `type: "flat"` → discount = value (already in paise)
//   - Coupon validation: active status + valid date window + max_uses not
//     exceeded + program in programScope (null = all programs).
//   - `used` counter is incremented ATOMICALLY at order-creation time (DB-level
//     increment with a conditional check for max_uses).
//
// `value` semantics:
//   - `type: "pct"` → integer percent points 1–100 (e.g. 10 = 10% off)
//   - `type: "flat"` → integer paise (e.g. 50000 = ₹500 off)
//   Clients MUST NOT compute discounts — always call /validate first for display.
//
// ValidateCouponRequest / Response:
//   The validate endpoint is a safe non-mutating preview: given a code + programId
//   it returns the discount that would apply. No `used` counter is changed.
//   The actual application happens at order-create time server-side.

import { z } from "zod";
import { UuidSchema, IsoDateTimeSchema } from "../common/primitives.js";
import { PageQuerySchema } from "../common/pagination.js";

// ─────────────────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────────────────

export const CouponTypeSchema = z.enum(["pct", "flat"]);
export type CouponType = z.infer<typeof CouponTypeSchema>;

export const CouponStatusSchema = z.enum(["active", "inactive", "expired"]);
export type CouponStatus = z.infer<typeof CouponStatusSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Requests
// ─────────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/commerce/coupons
 *
 * Creates a new coupon. `code` must be unique per tenant (enforced server-side;
 * 409 on duplicate). `status` defaults to `active` if omitted.
 *
 * `value` semantics depend on `type` (see file header).
 * Validation enforces: pct value 1–100; flat value ≥ 1 paise.
 *
 * Clients must NOT send `id`, `tenantId`, `used`, or computed fields.
 *
 * `Idempotency-Key` header required (docs/04 §2.6).
 */
export const CreateCouponRequestSchema = z
  .object({
    code: z
      .string()
      .min(1)
      .max(50)
      .regex(/^[A-Z0-9_-]+$/, "must be uppercase alphanumeric + underscore/hyphen only")
      .describe("Unique coupon code per tenant, e.g. 'SUMMER20'."),
    type: CouponTypeSchema,
    value: z
      .number()
      .int()
      .min(1)
      .describe(
        "For pct: integer percent 1–100. For flat: integer paise (e.g. 50000 = ₹500). " +
          "Server validates range per type.",
      ),
    maxUses: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("Maximum total redemptions allowed. Null = unlimited."),
    validFrom: z
      .string()
      .datetime({ offset: true })
      .optional()
      .describe("Coupon is not valid before this datetime. Null = valid immediately."),
    validTo: z
      .string()
      .datetime({ offset: true })
      .optional()
      .describe("Coupon expires after this datetime. Null = no expiry."),
    programScope: z
      .array(UuidSchema)
      .min(1)
      .optional()
      .describe(
        "Array of programIds this coupon is restricted to. Null/omitted = valid for all programs.",
      ),
    status: CouponStatusSchema.default("active").describe("Coupon status. Defaults to active."),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.type === "pct" && data.value > 100) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["value"],
        message: "Percentage coupons must have a value between 1 and 100.",
      });
    }
  });
export type CreateCouponRequest = z.infer<typeof CreateCouponRequestSchema>;

/**
 * PATCH /api/v1/commerce/coupons/:id
 *
 * Partial update. `code` and `type` cannot be changed after creation (the
 * `code` is tenant-unique and referenced in orders; `type` changes math
 * meaning). To change these, deactivate and create a new coupon.
 *
 * `Idempotency-Key` header required.
 */
export const UpdateCouponRequestSchema = z
  .object({
    maxUses: z.number().int().min(1).optional(),
    validFrom: z.string().datetime({ offset: true }).optional(),
    validTo: z.string().datetime({ offset: true }).optional(),
    programScope: z.array(UuidSchema).min(1).optional(),
    status: CouponStatusSchema.optional(),
  })
  .strict();
export type UpdateCouponRequest = z.infer<typeof UpdateCouponRequestSchema>;

/** GET /api/v1/commerce/coupons — filter/paginate coupon list. */
export const ListCouponsQuerySchema = z
  .object({
    status: CouponStatusSchema.optional(),
    type: CouponTypeSchema.optional(),
    search: z.string().min(1).max(100).optional().describe("Match by code prefix."),
  })
  .merge(PageQuerySchema)
  .strict();
export type ListCouponsQuery = z.infer<typeof ListCouponsQuerySchema>;

/**
 * POST /api/v1/commerce/coupons/validate
 *
 * Safe, non-mutating preview: returns the discount that would apply for a given
 * code + programId pair, without modifying the `used` counter. Use this to
 * display discount previews in the order creation UI before the user submits.
 * The actual application is server-side at order-create time.
 */
export const ValidateCouponRequestSchema = z
  .object({
    code: z.string().min(1).max(50),
    programId: UuidSchema.describe("The program this coupon would be applied to."),
  })
  .strict();
export type ValidateCouponRequest = z.infer<typeof ValidateCouponRequestSchema>;

/** Response for POST /api/v1/commerce/coupons/validate */
export const ValidateCouponResponseSchema = z.object({
  valid: z.boolean().describe("True if the coupon is usable for this program right now."),
  couponId: UuidSchema.nullable(),
  code: z.string(),
  type: CouponTypeSchema.nullable(),
  discountPaise: z
    .number()
    .int()
    .min(0)
    .nullable()
    .describe("Computed discount in paise. Null if coupon is invalid or programId was not found."),
  invalidReason: z
    .string()
    .nullable()
    .describe(
      "Human-readable reason why the coupon is invalid (expired, max_uses_reached, wrong_program, not_active). " +
        "Null if valid.",
    ),
});
export type ValidateCouponResponse = z.infer<typeof ValidateCouponResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Response DTOs
// ─────────────────────────────────────────────────────────────────────────

/** Row shape for the coupons list. */
export const CouponSummarySchema = z.object({
  id: UuidSchema,
  code: z.string(),
  type: CouponTypeSchema,
  value: z.number().int().min(1),
  maxUses: z.number().int().nullable(),
  used: z.number().int().min(0).describe("Redemption count to date."),
  validFrom: IsoDateTimeSchema.nullable(),
  validTo: IsoDateTimeSchema.nullable(),
  status: CouponStatusSchema,
  createdAt: IsoDateTimeSchema,
});
export type CouponSummary = z.infer<typeof CouponSummarySchema>;

/** Full coupon detail. */
export const CouponDetailSchema = CouponSummarySchema.extend({
  programScope: z
    .array(UuidSchema)
    .nullable()
    .describe("Program ids this coupon is restricted to. Null = all programs."),
  updatedAt: IsoDateTimeSchema,
});
export type CouponDetail = z.infer<typeof CouponDetailSchema>;
