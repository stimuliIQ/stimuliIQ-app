// apps/api/src/modules/referrals/dto/index.ts
//
// Re-exports the Phase-9 Completion referrals/affiliate zod schemas from @repo/types
// (docs/04-trd-architecture.md §2.2 module template, T11/T14/T25). Never redeclare a
// shape here — single source of truth stays in packages/types/src/commerce/referrals.schemas.ts.

export {
  ReferralStatusSchema,
  type ReferralStatus,
  ReferralRewardSchema,
  type ReferralReward,
  CreateReferralRequestSchema,
  type CreateReferralRequest,
  ListReferralsQuerySchema,
  type ListReferralsQuery,
  ReferralSchema,
  type Referral,
  RedeemReferralRequestSchema,
  type RedeemReferralRequest,
  RedeemReferralResponseSchema,
  type RedeemReferralResponse,
  UpdateReferralStatusRequestSchema,
  type UpdateReferralStatusRequest,
} from "@repo/types";
