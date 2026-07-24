// Typed bookings SDK — Phase 2, Wave 2 (docs/plans/phase-2.md task #2).
// CRM-authenticated management + unauthenticated public intake stub.

import type {
  BookingSummary,
  BookingDetail,
  ListBookingsQuery,
  CreateBookingRequest,
  UpdateBookingRequest,
  MoveBookingStatusRequest,
  CreatePublicBookingRequest,
  PublicBookingResponse,
} from "@repo/types";
import type { ApiClient } from "../http/client.js";
import { toQueryString } from "../http/query.js";

export class BookingsApi {
  constructor(private readonly client: ApiClient) {}

  /** GET /api/v1/crm/bookings — filter/paginate booking list. */
  async list(query: ListBookingsQuery) {
    return this.client.requestPaginated<BookingSummary>(
      "GET",
      `/api/v1/crm/bookings${toQueryString(query)}`,
    );
  }

  /** GET /api/v1/crm/bookings/:id */
  async get(id: string): Promise<BookingDetail> {
    return this.client.request<BookingDetail>("GET", `/api/v1/crm/bookings/${id}`);
  }

  /**
   * POST /api/v1/crm/bookings
   *
   * Create a booking via the CRM (authenticated staff). Creates in `requested` status.
   * `idempotencyKey` prevents duplicate booking creation on retry.
   */
  async create(
    body: CreateBookingRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<BookingDetail> {
    return this.client.request<BookingDetail>("POST", "/api/v1/crm/bookings", { body, idempotencyKey });
  }

  /** PATCH /api/v1/crm/bookings/:id — update slot, program, or notes. */
  async update(
    id: string,
    body: UpdateBookingRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<BookingDetail> {
    return this.client.request<BookingDetail>(
      "PATCH",
      `/api/v1/crm/bookings/${id}`,
      { body, idempotencyKey },
    );
  }

  /**
   * PATCH /api/v1/crm/bookings/:id/status
   *
   * Move through the booking state machine: requested→confirmed|cancelled;
   * confirmed→completed|cancelled|no_show. Invalid transitions return 422.
   */
  async moveStatus(
    id: string,
    body: MoveBookingStatusRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<BookingDetail> {
    return this.client.request<BookingDetail>(
      "PATCH",
      `/api/v1/crm/bookings/${id}/status`,
      { body, idempotencyKey },
    );
  }

  /**
   * POST /api/v1/public/bookings (UNAUTHENTICATED)
   *
   * Public book-a-slot intake stub (P2 minimal — full funnel is P5).
   * This call does NOT set credentials or CSRF headers — it uses the base
   * `fetch` semantics with `credentials: "include"` still (for potential
   * session enhancement), but no authentication is required or checked by the server.
   * Rate-limited per IP by the backend.
   *
   * Atomically upserts a lead (by phone) and creates a booking in `requested` status.
   * Returns a minimal confirmation response (no PII beyond what was sent).
   */
  async createPublic(body: CreatePublicBookingRequest): Promise<PublicBookingResponse> {
    // No idempotencyKey — not a money mutation. Backend deduplicates by phone+slotAt.
    return this.client.request<PublicBookingResponse>(
      "POST",
      "/api/v1/public/bookings",
      { body },
    );
  }
}
