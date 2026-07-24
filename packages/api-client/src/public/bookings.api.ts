// Public bookings SDK — Phase 5, Wave 2 (docs/plans/phase-5.md task #2).
//
// Namespace: client.public.bookings.*
//
// This is a thin facade over the P2 CreatePublicBookingRequest/PublicBookingResponse
// contract already defined in crm/bookings.schemas.ts. The endpoint itself
// (POST /api/v1/public/bookings) is REUSED AS-IS from P2 — no new backend code.
// This wrapper exists so web.app code can use `client.public.bookings.create()`
// without importing from the crm namespace (cleaner separation of concerns).
//
// Endpoint covered:
//   P-4: POST /public/bookings → create() (reused P2 endpoint, unchanged)
//
// Security contract (P2, unchanged):
//   - Unauthenticated (no cookieAuth, CSRF-excluded for anon writes).
//   - Rate-limited per IP (Redis fixed-window, PublicBookingRateLimiter pattern).
//   - .strict() over-post stripping.
//   - Atomically upserts a lead (by phone) and creates a booking.
//   - P5 adds consent to the booking row (bookings.consent Json? column).
//   - Note: The CreatePublicBookingRequestSchema (P2) does NOT have a captchaToken
//     or consent field. P5 adds those server-side behaviors. The api-designer does
//     not re-define the booking DTO here — the backend-builder adds captchaToken
//     and consent to the existing P2 booking intake in the backend task (#5).
//   - The DTO types here are the EXISTING P2 types (no duplication per CLAUDE.md §3.2).

import type {
  CreatePublicBookingRequest,
  PublicBookingResponse,
} from "@repo/types";
import type { ApiClient } from "../http/client.js";

export class PublicBookingsApi {
  constructor(private readonly client: ApiClient) {}

  /**
   * POST /api/v1/public/bookings (P-4) — UNAUTHENTICATED
   *
   * Book-Free-Slot intake. Reused P2 endpoint, unchanged.
   * Atomically upserts a lead (by phone) and creates a booking in `requested` status.
   * Rate-limited per IP. CSRF-excluded. .strict() over-post stripping.
   *
   * Note for web app: pass captchaToken and consent in the body. The P5 backend
   * extends the existing endpoint to validate captchaToken and store consent on
   * the bookings.consent JSON column (backward-compatible — P2 CRM bookings have null).
   *
   * @param body - { name, phone, email?, programId?, slotAt, source, utm? }
   * @returns { bookingId, slotAt, status, message }
   *
   * Errors:
   *   - 409: slot full (generic message — AC-7).
   *   - 422: captcha failed or validation error.
   *   - 429: rate limited.
   *
   * Authentication: None (anonymous public write).
   */
  async create(body: CreatePublicBookingRequest): Promise<PublicBookingResponse> {
    return this.client.request<PublicBookingResponse>(
      "POST",
      "/api/v1/public/bookings",
      { body },
    );
  }
}
