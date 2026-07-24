// Public lead capture SDK — Phase 5, Wave 2 (docs/plans/phase-5.md task #2).
//
// Namespace: client.public.leads.*
//
// Endpoint covered:
//   P-3: POST /public/leads → capture()
//
// Security contract:
//   - Unauthenticated (no cookieAuth, CSRF-excluded for anon writes).
//   - captchaToken in body, verified server-side before any DB write.
//   - Rate-limited per IP (429 + Retry-After).
//   - Honeypot honored at the endpoint layer.
//   - .strict() over-post stripping.
//   - Enqueues BullMQ confirmation event (NOT sent — P6 handles fanout).
//   - DPDP consent stored on leads.consent JSON column.
//   - Input sanitized server-side (resolves P2 M-4).

import type {
  PublicLeadCaptureDto,
  PublicLeadCaptureResponse,
} from "@repo/types";
import type { ApiClient } from "../http/client.js";

export class PublicLeadsApi {
  constructor(private readonly client: ApiClient) {}

  /**
   * POST /api/v1/public/leads (P-3) — UNAUTHENTICATED
   *
   * Captures a lead from any site form (inline, sticky, exit-intent, newsletter,
   * career-apply). Creates a CRM lead with stage=new.
   *
   * Captcha-gated (fail-closed in prod). Rate-limited per IP (AC-3/AC-4/AC-44).
   * DPDP consent recorded (consent.marketing_opt_in, consent.tos_version — AC-37).
   * UTM + landing_url + referrer + gclid/fbclid stored on the leads row (AC-1/AC-2).
   * Confirmation event enqueued in BullMQ — NOT sent (P6 owns fanout — AC-1).
   *
   * @param body - Lead form data including name/phone/email/consent/captchaToken.
   * @returns leadId + confirmation message.
   *
   * Errors:
   *   - 422: captcha failure, honeypot triggered, or validation error (AC-3).
   *   - 429: rate limit exceeded (AC-4).
   *
   * Authentication: None (anonymous public write).
   */
  async capture(body: PublicLeadCaptureDto): Promise<PublicLeadCaptureResponse> {
    // No idempotencyKey (not a money mutation). No CSRF header (CSRF-excluded for anon writes).
    return this.client.request<PublicLeadCaptureResponse>(
      "POST",
      "/api/v1/public/leads",
      { body },
    );
  }
}
