// Typed marketing-targets SDK (CRM). Spec: docs/specs/marketing-targets.md, ADR-0067.
// Exposed on the SDK as `client.crm.marketingTargets.*`.
//
// TWO AUDIENCES, ONE CLASS, AND THE SPLIT MATTERS:
//   `mine()` is what a marketing person calls. It takes NO user id — the subject is always
//   the session user — so there is no parameter to tamper with. Gated on
//   `marketing_targets.view`.
//
//   `list()` / `upsert()` / `remove()` are the super-admin surface, gated on
//   `marketing_targets.manage`. Callers must hide these behind that permission; the API is
//   the real enforcement (CLAUDE.md §3.5).
//
// There is no `client.crm.marketingTargets.progress(userId)`. Progress is never fetched for
// somebody else in isolation — reading another person's number is the report's job, which
// returns the whole team at once so a row can never be quoted out of context.

import type {
  MarketingTargetProgress,
  MarketingTargetsListDto,
  MarketingTargetsQuery,
  MyMarketingTargetDto,
  UpsertMarketingTargetRequest,
} from "@repo/types";
import type { ApiClient } from "../http/client.js";
import { toQueryString } from "../http/query.js";

export class MarketingTargetsApi {
  constructor(private readonly client: ApiClient) {}

  /**
   * GET /api/v1/crm/marketing-targets/me — the signed-in person's own card.
   * Omit `month` for the current one. Never 404s when no target is set; the response
   * carries `hasTarget: false` and real `completed` figures.
   */
  async mine(query: MarketingTargetsQuery = {}): Promise<MyMarketingTargetDto> {
    return this.client.request<MyMarketingTargetDto>(
      "GET",
      `/api/v1/crm/marketing-targets/me${toQueryString(query)}`,
    );
  }

  /** GET /api/v1/crm/marketing-targets — the whole team for one month, plus the roll-up. */
  async list(query: MarketingTargetsQuery = {}): Promise<MarketingTargetsListDto> {
    return this.client.request<MarketingTargetsListDto>(
      "GET",
      `/api/v1/crm/marketing-targets${toQueryString(query)}`,
    );
  }

  /**
   * PUT /api/v1/crm/marketing-targets — set or replace one person's number for one month.
   * Idempotent by design: "the target for Rahul in March" is one fact, so there is no
   * create/edit split to get wrong.
   */
  async upsert(body: UpsertMarketingTargetRequest): Promise<MarketingTargetProgress> {
    return this.client.request<MarketingTargetProgress>("PUT", "/api/v1/crm/marketing-targets", {
      body,
    });
  }

  /** DELETE /api/v1/crm/marketing-targets/:id — "no target this month" (soft delete). */
  async remove(id: string): Promise<void> {
    await this.client.request<void>("DELETE", `/api/v1/crm/marketing-targets/${id}`);
  }
}
