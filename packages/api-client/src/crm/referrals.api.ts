// Typed referrals SDK (CRM/staff oversight) — Phase 9 Completion, T11/T14/T25.
// Own-scope create/list lives on `client.lms.referrals`; public redeem lives on
// `client.public.referrals.redeem()`.

import type { ListReferralsQuery, Referral, UpdateReferralStatusRequest } from "@repo/types";
import type { ApiClient } from "../http/client.js";
import { toQueryString } from "../http/query.js";

export class ReferralsApi {
  constructor(private readonly client: ApiClient) {}

  /** GET /api/v1/crm/referrals */
  async list(query: ListReferralsQuery) {
    return this.client.requestPaginated<Referral>("GET", `/api/v1/crm/referrals${toQueryString(query)}`);
  }

  /** PATCH /api/v1/crm/referrals/:id — manually transition reward status. */
  async updateStatus(
    id: string,
    body: UpdateReferralStatusRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<Referral> {
    return this.client.request<Referral>("PATCH", `/api/v1/crm/referrals/${id}`, { body, idempotencyKey });
  }
}
