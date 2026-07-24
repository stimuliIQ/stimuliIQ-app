// Typed referrals SDK (own-scope) — Phase 9 Completion, T11/T14/T25. Staff
// oversight lives on `client.crm.referrals`; public redeem lives on
// `client.public.referrals.redeem()`.

import type { CreateReferralRequest, ListReferralsQuery, Referral } from "@repo/types";
import type { ApiClient } from "../http/client.js";
import { toQueryString } from "../http/query.js";

export class LmsReferralsApi {
  constructor(private readonly client: ApiClient) {}

  /** GET /api/v1/me/referrals */
  async list(query: ListReferralsQuery) {
    return this.client.requestPaginated<Referral>("GET", `/api/v1/me/referrals${toQueryString(query)}`);
  }

  /** POST /api/v1/me/referrals — creates a new referral code for the caller. */
  async create(idempotencyKey: string = crypto.randomUUID()): Promise<Referral> {
    const body: CreateReferralRequest = {};
    return this.client.request<Referral>("POST", "/api/v1/me/referrals", { body, idempotencyKey });
  }
}
