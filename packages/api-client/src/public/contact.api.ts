// Typed contact-form SDK (public) — Phase 9 Completion, T14/T32. Admin list lives on
// `client.crm.content.contact`.

import type { SubmitContactRequest, SubmitContactResponse } from "@repo/types";
import type { ApiClient } from "../http/client.js";

export class PublicContactApi {
  constructor(private readonly client: ApiClient) {}

  /** POST /api/v1/public/contact — captcha-gated, rate-limited. */
  async submit(body: SubmitContactRequest): Promise<SubmitContactResponse> {
    return this.client.request<SubmitContactResponse>("POST", "/api/v1/public/contact", { body });
  }
}
