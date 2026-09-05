// Typed orders SDK — Phase 2, Wave 2 (docs/plans/phase-2.md task #2).
// POST /commerce/orders (create + initiate Razorpay checkout).
// Frontends must never hand-write fetches (CLAUDE.md §3.2).

import type {
  CreateOrderRequest,
  OrderSummary,
  OrderDetail,
  ListOrdersQuery,
  CreateRazorpayOrderResponse,
  CreatePaymentLinkResponse,
  SendPaymentLinksRequest,
  SendPaymentLinksResponse,
  UpdateOrderPriceRequest,
} from "@repo/types";
import type { ApiClient } from "../http/client.js";
import { toQueryString } from "../http/query.js";

export class OrdersApi {
  constructor(private readonly client: ApiClient) {}

  /** GET /api/v1/commerce/orders — filter/paginate the order ledger. */
  async list(query: ListOrdersQuery) {
    return this.client.requestPaginated<OrderSummary>(
      "GET",
      `/api/v1/commerce/orders${toQueryString(query)}`,
    );
  }

  /** GET /api/v1/commerce/orders/:id */
  async get(id: string): Promise<OrderDetail> {
    return this.client.request<OrderDetail>("GET", `/api/v1/commerce/orders/${id}`);
  }

  /**
   * POST /api/v1/commerce/orders
   *
   * Creates an order. Server computes amount_paise from program price minus coupon.
   * `idempotencyKey` maps to the `Idempotency-Key` header → `orders.idempotency_key`
   * (unique). Replayed requests with the same key return the cached order.
   */
  async create(
    body: CreateOrderRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<OrderDetail> {
    return this.client.request<OrderDetail>("POST", "/api/v1/commerce/orders", { body, idempotencyKey });
  }

  /**
   * DELETE /api/v1/commerce/orders/:id
   *
   * Cancels an UNPAID (status=created) order — un-assigns a program opened by
   * mistake. Soft-deletes the order + never-captured payment rows and releases
   * the coupon redemption. 422 for a paid order (use the refund flow instead).
   */
  /**
   * PATCH /api/v1/commerce/orders/:id/price — sell a programme below its list price.
   * Permission: orders.edit.
   *
   * Stored as a DISCOUNT: the order keeps what is charged AND how far below list that is, so
   * revenue reads as gross / discount / net. `reason` is mandatory (min 5 chars) — the audit
   * log records the numbers moving and cannot record why.
   *
   * Rejects 422 once the order is paid or carries any live payment: changing a price under a
   * recorded payment breaks the ledger, the invoice and reconciliation at once. That case is
   * a refund. Also rejects a price above list, and a no-op.
   *
   * Every successful change notifies the other active super admins.
   */
  async updatePrice(
    id: string,
    body: UpdateOrderPriceRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<OrderDetail> {
    return this.client.request<OrderDetail>("PATCH", `/api/v1/commerce/orders/${id}/price`, {
      body,
      idempotencyKey,
    });
  }

  async cancel(id: string, idempotencyKey: string = crypto.randomUUID()): Promise<void> {
    await this.client.request<void>("DELETE", `/api/v1/commerce/orders/${id}`, { idempotencyKey });
  }

  /**
   * POST /api/v1/commerce/orders/:id/payment-link
   *
   * Mints a signed public payment URL for an OPEN order to send to the student
   * (lifecycle-redesign). The token in the URL is the authorization — HMAC over
   * tenant+order+expiry. payments.create-gated.
   */
  async createPaymentLink(id: string): Promise<CreatePaymentLinkResponse> {
    return this.client.request<CreatePaymentLinkResponse>("POST", `/api/v1/commerce/orders/${id}/payment-link`);
  }

  /**
   * POST /api/v1/commerce/orders/payment-links/send
   *
   * Emails payment link(s) straight to the student — pass one open order id, or
   * several (same student) to send ONE email with a Pay button per program plus
   * the total, so the student can pay each individually from the same message.
   */
  async sendPaymentLinks(body: SendPaymentLinksRequest): Promise<SendPaymentLinksResponse> {
    return this.client.request<SendPaymentLinksResponse>("POST", "/api/v1/commerce/orders/payment-links/send", {
      body,
    });
  }

  /**
   * POST /api/v1/commerce/orders/:id/pay
   *
   * Initiates Razorpay checkout for an existing order. Returns the fields needed
   * to open Razorpay's checkout JS SDK (razorpayOrderId, keyId [PUBLIC only],
   * amountPaise, currency). After the user completes checkout, call
   * `payments.verify()` with the callback fields.
   */
  async initiateRazorpayCheckout(
    id: string,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<CreateRazorpayOrderResponse> {
    return this.client.request<CreateRazorpayOrderResponse>(
      "POST",
      `/api/v1/commerce/orders/${id}/pay`,
      { idempotencyKey },
    );
  }
}
