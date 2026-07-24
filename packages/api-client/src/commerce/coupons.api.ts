// Typed coupons SDK — Phase 2, Wave 2 (docs/plans/phase-2.md task #2).
// CRUD + validate over /api/v1/commerce/coupons.

import type {
  CouponSummary,
  CouponDetail,
  ListCouponsQuery,
  CreateCouponRequest,
  UpdateCouponRequest,
  ValidateCouponRequest,
  ValidateCouponResponse,
} from "@repo/types";
import type { ApiClient } from "../http/client.js";
import { toQueryString } from "../http/query.js";

export class CouponsApi {
  constructor(private readonly client: ApiClient) {}

  /** GET /api/v1/commerce/coupons — filter/paginate coupon list. */
  async list(query: ListCouponsQuery) {
    return this.client.requestPaginated<CouponSummary>(
      "GET",
      `/api/v1/commerce/coupons${toQueryString(query)}`,
    );
  }

  /** GET /api/v1/commerce/coupons/:id */
  async get(id: string): Promise<CouponDetail> {
    return this.client.request<CouponDetail>("GET", `/api/v1/commerce/coupons/${id}`);
  }

  /**
   * POST /api/v1/commerce/coupons
   *
   * Marketing creates coupons (phase-2.md §Risks #8). `code` unique per tenant.
   * `used` counter starts at 0, incremented atomically at order time.
   */
  async create(
    body: CreateCouponRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<CouponDetail> {
    return this.client.request<CouponDetail>("POST", "/api/v1/commerce/coupons", { body, idempotencyKey });
  }

  /**
   * PATCH /api/v1/commerce/coupons/:id
   *
   * Partial update. `code` and `type` cannot be changed after creation.
   */
  async update(
    id: string,
    body: UpdateCouponRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<CouponDetail> {
    return this.client.request<CouponDetail>(
      "PATCH",
      `/api/v1/commerce/coupons/${id}`,
      { body, idempotencyKey },
    );
  }

  /**
   * POST /api/v1/commerce/coupons/validate
   *
   * Non-mutating preview: returns the discount that would apply for the given
   * code + programId pair. Does NOT change the `used` counter. Use this for
   * real-time discount display in the order creation UI.
   */
  async validate(body: ValidateCouponRequest): Promise<ValidateCouponResponse> {
    return this.client.request<ValidateCouponResponse>(
      "POST",
      "/api/v1/commerce/coupons/validate",
      { body },
    );
  }

  /** DELETE /api/v1/commerce/coupons/:id — soft-delete a coupon (marketing/admin). */
  async remove(
    id: string,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<CouponDetail> {
    return this.client.request<CouponDetail>(
      "DELETE",
      `/api/v1/commerce/coupons/${id}`,
      { idempotencyKey },
    );
  }
}
