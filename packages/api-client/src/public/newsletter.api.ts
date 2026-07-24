// Typed newsletter SDK (public) — Phase 9 Completion, T14/T32. Admin subscriber
// list lives on `client.crm.content.newsletter`.

import type { SubscribeNewsletterRequest, SubscribeNewsletterResponse } from "@repo/types";
import type { ApiClient } from "../http/client.js";

export class PublicNewsletterApi {
  constructor(private readonly client: ApiClient) {}

  /** POST /api/v1/public/newsletter/subscribe — captcha-gated; re-subscribe reactivates. */
  async subscribe(body: SubscribeNewsletterRequest): Promise<SubscribeNewsletterResponse> {
    return this.client.request<SubscribeNewsletterResponse>("POST", "/api/v1/public/newsletter/subscribe", { body });
  }

  /** GET /api/v1/public/newsletter/unsubscribe?token=... — signed email-link token, no auth. */
  async unsubscribe(token: string): Promise<SubscribeNewsletterResponse> {
    return this.client.request<SubscribeNewsletterResponse>(
      "GET",
      `/api/v1/public/newsletter/unsubscribe?token=${encodeURIComponent(token)}`,
    );
  }
}
