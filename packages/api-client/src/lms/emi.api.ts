// Typed EMI plans SDK (own-scope, read-only) — Phase 9 Completion, T11/T14/T24.
// Finance/Admin create + mark-paid + dunning lives on `client.crm.emiPlans`.

import type { ListEmiPlansQuery, EmiPlanSummary } from "@repo/types";
import type { ApiClient } from "../http/client.js";
import { toQueryString } from "../http/query.js";

export class LmsEmiPlansApi {
  constructor(private readonly client: ApiClient) {}

  /** GET /api/v1/me/emi-plans — own plans, via own orders. */
  async list(query: ListEmiPlansQuery) {
    return this.client.requestPaginated<EmiPlanSummary>("GET", `/api/v1/me/emi-plans${toQueryString(query)}`);
  }
}
