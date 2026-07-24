// Typed referral-redeem SDK (public) — Phase 9 Completion, T11/T14/T25. Own-scope
// create/list lives on `client.lms.referrals`; staff oversight on `client.crm.referrals`.

import type { RedeemReferralRequest, RedeemReferralResponse } from "@repo/types";
import type { ApiClient } from "../http/client.js";

export class PublicReferralsApi {
  constructor(private readonly client: ApiClient) {}

  /** POST /api/v1/public/referrals/redeem — attaches a referral code to a freshly captured lead. */
  async redeem(body: RedeemReferralRequest): Promise<RedeemReferralResponse> {
    return this.client.request<RedeemReferralResponse>("POST", "/api/v1/public/referrals/redeem", { body });
  }
}
