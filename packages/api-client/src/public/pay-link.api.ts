// Public pay-link API (lifecycle-redesign) — token-authorized Razorpay checkout
// for an order whose payment link a staff member sent the student. No session:
// the HMAC-signed token in the URL is the authorization (see the API's
// pay-link.util.ts for the contract). Mirrors enroll.api.ts's checkout/verify.
//
// Usage (web /pay/[token] page):
//   const order = await client.public.payLink.getOrder(token);
//   const checkout = await client.public.payLink.checkout(token);
//   // open Razorpay checkout.js → handler(response) →
//   await client.public.payLink.verify(token, response);

import type {
  PublicPayLinkOrder,
  PublicCheckoutResponse,
  PublicVerifyPaymentDto,
  PublicVerifyPaymentResponse,
} from "@repo/types";
import type { ApiClient } from "../http/client.js";

export class PublicPayLinkApi {
  constructor(private readonly client: ApiClient) {}

  /** GET /api/v1/public/pay/:token — order summary for the pay page. */
  async getOrder(token: string): Promise<PublicPayLinkOrder> {
    return this.client.request<PublicPayLinkOrder>("GET", `/api/v1/public/pay/${encodeURIComponent(token)}`);
  }

  /** POST /api/v1/public/pay/:token/checkout — Razorpay bootstrap (PUBLIC keyId only). */
  async checkout(token: string): Promise<PublicCheckoutResponse> {
    return this.client.request<PublicCheckoutResponse>(
      "POST",
      `/api/v1/public/pay/${encodeURIComponent(token)}/checkout`,
    );
  }

  /** POST /api/v1/public/pay/:token/verify — signature verify + atomic enrollment. */
  async verify(token: string, body: PublicVerifyPaymentDto): Promise<PublicVerifyPaymentResponse> {
    return this.client.request<PublicVerifyPaymentResponse>(
      "POST",
      `/api/v1/public/pay/${encodeURIComponent(token)}/verify`,
      { body },
    );
  }
}
