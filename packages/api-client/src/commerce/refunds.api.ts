// Typed refunds SDK — Phase 2, Wave 2 (docs/plans/phase-2.md task #2).
// Request / Approve / Reject / List / Detail over /api/v1/commerce/refunds.

import type {
  RefundSummary,
  RefundDetail,
  ListRefundsQuery,
  RequestRefundRequest,
  ApproveRefundRequest,
  RejectRefundRequest,
} from "@repo/types";
import type { ApiClient } from "../http/client.js";
import { toQueryString } from "../http/query.js";

export class RefundsApi {
  constructor(private readonly client: ApiClient) {}

  /** GET /api/v1/commerce/refunds — filter/paginate refund list. */
  async list(query: ListRefundsQuery) {
    return this.client.requestPaginated<RefundSummary>(
      "GET",
      `/api/v1/commerce/refunds${toQueryString(query)}`,
    );
  }

  /** GET /api/v1/commerce/refunds/:id */
  async get(id: string): Promise<RefundDetail> {
    return this.client.request<RefundDetail>("GET", `/api/v1/commerce/refunds/${id}`);
  }

  /**
   * POST /api/v1/commerce/refunds
   *
   * Request a refund for a captured payment. Creates a refund row in `requested`
   * status — not immediately processed. Triggers an approval workflow.
   * `idempotencyKey` prevents duplicate refund requests on retry.
   */
  async request(
    body: RequestRefundRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<RefundDetail> {
    return this.client.request<RefundDetail>("POST", "/api/v1/commerce/refunds", { body, idempotencyKey });
  }

  /**
   * POST /api/v1/commerce/refunds/:id/approve
   *
   * Finance / Owner / Admin only (`refunds.approve`). Triggers the provider
   * refund call after approval. Idempotent on replay.
   */
  async approve(
    id: string,
    body: ApproveRefundRequest = {},
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<RefundDetail> {
    return this.client.request<RefundDetail>(
      "POST",
      `/api/v1/commerce/refunds/${id}/approve`,
      { body, idempotencyKey },
    );
  }

  /**
   * POST /api/v1/commerce/refunds/:id/reject
   *
   * Finance / Owner / Admin only. Terminal — no provider call issued.
   */
  async reject(
    id: string,
    body: RejectRefundRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<RefundDetail> {
    return this.client.request<RefundDetail>(
      "POST",
      `/api/v1/commerce/refunds/${id}/reject`,
      { body, idempotencyKey },
    );
  }
}
