// Commerce resource aggregator — Phase 2, Wave 2 (docs/plans/phase-2.md task #2).
// Exposed on the SDK as `client.commerce.*`. Each resource API is a thin typed
// wrapper over the shared ApiClient http core (cookie + CSRF + envelope
// unwrap + onUnauthorized refresh) — never hand-write fetches (CLAUDE.md §3.2).
//
// NOTE on the webhook path: POST /commerce/payments/webhook is an unauthenticated
// Razorpay server-to-server endpoint. It is NOT represented as a client SDK method
// because frontends never call it — Razorpay calls it directly. It is documented
// in the OpenAPI spec (registry.ts) for backend-builder and integrations reference.

import type { ApiClient } from "../http/client.js";
import { OrdersApi } from "./orders.api.js";
import { PaymentsApi } from "./payments.api.js";
import { InvoicesApi } from "./invoices.api.js";
import { RefundsApi } from "./refunds.api.js";
import { CouponsApi } from "./coupons.api.js";

export class CommerceApi {
  readonly orders: OrdersApi;
  readonly payments: PaymentsApi;
  readonly invoices: InvoicesApi;
  readonly refunds: RefundsApi;
  readonly coupons: CouponsApi;

  constructor(client: ApiClient) {
    this.orders = new OrdersApi(client);
    this.payments = new PaymentsApi(client);
    this.invoices = new InvoicesApi(client);
    this.refunds = new RefundsApi(client);
    this.coupons = new CouponsApi(client);
  }
}

export * from "./orders.api.js";
export * from "./payments.api.js";
export * from "./invoices.api.js";
export * from "./refunds.api.js";
export * from "./coupons.api.js";
