// Referrals / affiliate contract — Phase 9 Completion, T11/T14/T25
// (docs/plans/phase-9-completion.md). Backs `model Referral`. `reward` is a JSON
// descriptor, e.g. `{"type":"cash","amountPaise":50000,"currency":"INR"}` or
// `{"type":"discount_coupon","couponId":"..."}` — any `amountPaise` key inside it is
// integer paise (CLAUDE.md §3.6).
//
// Surfaces:
//   - Own (any authenticated user, typically a student/alumnus): create own referral
//     code, list own referrals — /api/v1/me/referrals.
//   - Public: redeem a referral code against a new lead at capture time (attribution
//     write, anti-self-referral guard is a service-layer 422 business rule, not a zod
//     shape check) — /api/v1/public/referrals/redeem.
//   - CRM (staff): oversight list + manual reward-status transition —
//     /api/v1/crm/referrals. Permission: referrals.view (all), referrals.manage.

import { z } from "zod";
import { UuidSchema, IsoDateTimeSchema } from "../common/primitives.js";
import { PageQuerySchema } from "../common/pagination.js";

export const ReferralStatusSchema = z.enum(["pending", "converted", "rewarded", "expired", "rejected"]);
export type ReferralStatus = z.infer<typeof ReferralStatusSchema>;

/** Reward descriptor JSON — open discriminated shape, money always paise+currency when type='cash'. */
export const ReferralRewardSchema = z.union([
  z
    .object({
      type: z.literal("cash"),
      amountPaise: z.number().int().min(0),
      currency: z.string().length(3),
    })
    .strict(),
  z
    .object({
      type: z.literal("discount_coupon"),
      couponId: UuidSchema,
    })
    .strict(),
]);
export type ReferralReward = z.infer<typeof ReferralRewardSchema>;

/** POST /api/v1/me/referrals — creates a new referral code for the caller. */
export const CreateReferralRequestSchema = z.object({}).strict();
export type CreateReferralRequest = z.infer<typeof CreateReferralRequestSchema>;

/** GET /api/v1/me/referrals | GET /api/v1/crm/referrals */
export const ListReferralsQuerySchema = z
  .object({
    status: ReferralStatusSchema.optional(),
    referrerUserId: UuidSchema.optional().describe("CRM-only filter; ignored (forced to caller) on /me/referrals."),
  })
  .merge(PageQuerySchema)
  .strict();
export type ListReferralsQuery = z.infer<typeof ListReferralsQuerySchema>;

export const ReferralSchema = z.object({
  id: UuidSchema,
  referrerUserId: UuidSchema,
  referrerName: z.string(),
  referredLeadId: UuidSchema.nullable(),
  code: z.string(),
  reward: ReferralRewardSchema.nullable(),
  status: ReferralStatusSchema,
  rewardedAt: IsoDateTimeSchema.nullable(),
  createdAt: IsoDateTimeSchema,
});
export type Referral = z.infer<typeof ReferralSchema>;

/**
 * POST /api/v1/public/referrals/redeem (UNAUTHENTICATED) — attaches a referral code to
 * a freshly captured lead. 422 `REFERRAL_CODE_INVALID` / `SELF_REFERRAL_NOT_ALLOWED`
 * are service-layer business rules, not zod shape checks.
 */
export const RedeemReferralRequestSchema = z
  .object({
    code: z.string().min(1).max(40),
    leadId: UuidSchema,
    // Captcha token from the browser widget (Wave 6 M2). Verified server-side before
    // any DB work — fail-closed in production (an absent/invalid token → 422). Rate
    // limiting per-IP is the primary anti-enumeration control; captcha is defence-in-depth.
    captchaToken: z.string().min(1).max(2048),
  })
  .strict();
export type RedeemReferralRequest = z.infer<typeof RedeemReferralRequestSchema>;

export const RedeemReferralResponseSchema = z.object({
  referralId: UuidSchema,
  status: ReferralStatusSchema,
});
export type RedeemReferralResponse = z.infer<typeof RedeemReferralResponseSchema>;

/** PATCH /api/v1/crm/referrals/:id — staff manually transitions status (e.g. mark rewarded). */
export const UpdateReferralStatusRequestSchema = z
  .object({
    status: ReferralStatusSchema,
  })
  .strict();
export type UpdateReferralStatusRequest = z.infer<typeof UpdateReferralStatusRequestSchema>;
