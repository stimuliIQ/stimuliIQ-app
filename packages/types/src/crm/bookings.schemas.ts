// Bookings contract — Phase 2, Wave 2 (docs/plans/phase-2.md task #2).
//
// Bookings are demo/slot appointments (docs/03 §7.12):
//   - Created via the CRM (authenticated staff) or via the PUBLIC intake stub.
//   - The public intake stub (`POST /api/v1/public/bookings`) is UNAUTHENTICATED
//     — open to anyone. It creates a `lead` (if phone doesn't already exist for
//     the tenant) and a `booking` in one atomic operation. This is the minimal
//     stub public entry per phase-2.md scope boundary (the full marketing-site
//     book-slot funnel is P5). Rate-limited per IP.
//   - CRM management: confirm, complete, cancel, mark no-show.
//
// `source` is a free-form string (e.g. 'crm', 'web', 'referral', 'walk-in').
// `leadId` and `programId` are both optional (booking may be created before a
// lead is qualified or a program is chosen).
//
// Status state machine (docs/05 §3 BookingStatus):
//   requested → confirmed → completed
//            → cancelled  (terminal)
//            → no_show    (terminal)

import { z } from "zod";
import { UuidSchema, PhoneSchema, IsoDateTimeSchema } from "../common/primitives.js";
import { PageQuerySchema } from "../common/pagination.js";
import { LeadUtmSchema } from "./leads.schemas.js";

// ─────────────────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────────────────

export const BookingStatusSchema = z.enum([
  "requested",
  "confirmed",
  "completed",
  "cancelled",
  "no_show",
]);
export type BookingStatus = z.infer<typeof BookingStatusSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Requests — CRM-side (authenticated)
// ─────────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/crm/bookings
 *
 * Create a booking via the CRM (authenticated staff). `leadId` or `programId`
 * are optional — a booking can be created before the lead is qualified.
 *
 * `Idempotency-Key` header required (docs/04 §2.6).
 */
export const CreateBookingRequestSchema = z
  .object({
    leadId: UuidSchema.optional().describe("Lead this booking is for. Optional."),
    programId: UuidSchema.optional().describe("Program this demo booking is for. Optional."),
    slotAt: z
      .string()
      .datetime({ offset: true })
      .describe("ISO-8601 datetime of the booked slot."),
    source: z
      .string()
      .min(1)
      .max(120)
      .describe("Booking source, e.g. 'crm', 'walk-in', 'referral'."),
    notes: z.string().max(500).optional(),
  })
  .strict();
export type CreateBookingRequest = z.infer<typeof CreateBookingRequestSchema>;

/**
 * PATCH /api/v1/crm/bookings/:id
 *
 * Update mutable booking fields (slot time, program, notes). Status transitions
 * use the dedicated PATCH /crm/bookings/:id/status endpoint.
 *
 * `Idempotency-Key` header required.
 */
export const UpdateBookingRequestSchema = z
  .object({
    slotAt: z.string().datetime({ offset: true }),
    programId: UuidSchema,
    notes: z.string().max(500),
  })
  .partial()
  .strict();
export type UpdateBookingRequest = z.infer<typeof UpdateBookingRequestSchema>;

/**
 * PATCH /api/v1/crm/bookings/:id/status
 *
 * Move the booking through its status state machine. Valid transitions:
 *   requested → confirmed | cancelled
 *   confirmed → completed | cancelled | no_show
 * Backend enforces valid transitions; invalid transitions return 422.
 *
 * `Idempotency-Key` header required.
 */
export const MoveBookingStatusRequestSchema = z
  .object({
    status: BookingStatusSchema,
    notes: z.string().max(500).optional().describe("Notes for the status change (audit log)."),
  })
  .strict();
export type MoveBookingStatusRequest = z.infer<typeof MoveBookingStatusRequestSchema>;

/** GET /api/v1/crm/bookings — filter/paginate booking list. */
export const ListBookingsQuerySchema = z
  .object({
    leadId: UuidSchema.optional(),
    programId: UuidSchema.optional(),
    status: BookingStatusSchema.optional(),
    from: z.string().datetime({ offset: true }).optional().describe("Filter by slot_at >= from."),
    to: z.string().datetime({ offset: true }).optional().describe("Filter by slot_at <= to."),
    source: z.string().min(1).max(120).optional(),
  })
  .merge(PageQuerySchema)
  .strict();
export type ListBookingsQuery = z.infer<typeof ListBookingsQuerySchema>;

// ─────────────────────────────────────────────────────────────────────────
// Public intake stub (UNAUTHENTICATED)
// ─────────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/public/bookings (UNAUTHENTICATED — no cookie/CSRF required)
 *
 * Minimal public intake stub for the book-a-slot funnel (phase-2.md scope
 * boundary: heavy marketing-site funnel is P5; this is the API + CRM-side
 * management stub only). Rate-limited per IP.
 *
 * This endpoint atomically:
 *   1. Upserts a `lead` row (finds existing lead by phone for the default
 *      tenant, or creates a new one with stage = `new`).
 *   2. Creates a `booking` in `requested` status linked to that lead.
 *
 * `tenantId` is resolved by the backend from the request context (single-tenant
 * in P2 — hardcoded default; multi-tenant resolution is post-P2). Clients must
 * NOT send `tenantId`, `leadId`, or `status`.
 *
 * No Idempotency-Key required on this public endpoint (it's not a money
 * mutation), but the backend should be tolerant of near-duplicate submissions
 * (same phone + same slotAt within a short window → deduplicate).
 */
/**
 * DPDP consent supplied by the book-free-slot form. Only the two user choices are
 * client-supplied; the server ALWAYS derives `timestamp` + `ip_hash` (never trusted
 * from the client) before persisting to `bookings.consent` — mirrors the P-3 lead
 * capture consent contract (public-funnel.service.ts#buildConsent).
 */
export const PublicBookingConsentSchema = z
  .object({
    marketingOptIn: z.boolean().describe("Whether the user opted in to marketing communications."),
    tosVersion: z.string().min(1).max(50).describe("Version of the Terms of Service the user accepted."),
  })
  .strict();
export type PublicBookingConsent = z.infer<typeof PublicBookingConsentSchema>;

export const CreatePublicBookingRequestSchema = z
  .object({
    name: z.string().min(1).max(200),
    phone: PhoneSchema,
    email: z.string().email().max(254).optional(),
    programId: UuidSchema.optional().describe("Program the prospective student is interested in."),
    slotAt: z.string().datetime({ offset: true }).describe("Requested slot datetime."),
    source: z
      .string()
      .min(1)
      .max(120)
      .describe("Source of this booking, e.g. 'website', 'landing-page'."),
    utm: LeadUtmSchema.optional().describe("UTM tracking parameters from the landing page."),
    // Captcha token from the browser widget. Optional for backward compatibility with
    // CRM/API-created bookings; when present it is verified server-side (captcha-gated
    // public write — see captcha-provider.interface.ts). The public book-slot form
    // always sends it.
    captchaToken: z.string().min(1).max(4096).optional().describe("Captcha token from the browser widget; verified server-side."),
    // DPDP consent from the book-free-slot form (marketing opt-in + accepted TOS
    // version). Persisted to bookings.consent with a SERVER-derived timestamp + ip_hash.
    consent: PublicBookingConsentSchema.optional().describe("DPDP consent captured at form submission."),
  })
  .strict();
export type CreatePublicBookingRequest = z.infer<typeof CreatePublicBookingRequestSchema>;

/** Response for POST /public/bookings — minimal, no PII leak. */
export const PublicBookingResponseSchema = z.object({
  bookingId: UuidSchema.describe("Created booking id (for reference/confirmation)."),
  slotAt: IsoDateTimeSchema,
  status: BookingStatusSchema,
  message: z
    .string()
    .describe(
      "User-facing confirmation message. Backend localizes if needed. " +
        "E.g. 'Your slot has been booked. Our team will confirm shortly.'",
    ),
});
export type PublicBookingResponse = z.infer<typeof PublicBookingResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Response DTOs
// ─────────────────────────────────────────────────────────────────────────

/** Row shape for the bookings list. */
export const BookingSummarySchema = z.object({
  id: UuidSchema,
  leadId: UuidSchema.nullable(),
  leadName: z.string().nullable(),
  programId: UuidSchema.nullable(),
  programTitle: z.string().nullable(),
  slotAt: IsoDateTimeSchema,
  status: BookingStatusSchema,
  source: z.string(),
  createdAt: IsoDateTimeSchema,
});
export type BookingSummary = z.infer<typeof BookingSummarySchema>;

/** Full booking detail. */
export const BookingDetailSchema = BookingSummarySchema.extend({
  notes: z.string().nullable(),
  updatedAt: IsoDateTimeSchema,
});
export type BookingDetail = z.infer<typeof BookingDetailSchema>;
