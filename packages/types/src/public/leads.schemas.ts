// Public lead capture DTO — Phase 5, Wave 2 (docs/plans/phase-5.md task #2).
//
// POST /api/v1/public/leads
//
// This is the intake endpoint for ALL lead forms on the marketing site:
//   - Inline lead forms
//   - Sticky bar lead forms
//   - Exit-intent modal
//   - Footer newsletter capture
//   - Career apply forms
//
// Security properties (enforced at the endpoint, documented here as contract):
//   - captchaToken: REQUIRED on all public write endpoints. Backend verifies via
//     CaptchaProvider before any DB write. Fail-closed in prod (AC-3, AC-44).
//   - honeypot: the backend checks for a honeypot field (bot trap). Bots that
//     populate it → 422 before any DB write (AC-42). The field is NOT in this
//     DTO (it's in the HTML form only, rejected by .strict() parsing if present).
//   - Rate-limited per IP (AC-4). Rate-limit fail-closed on Redis error (AC-43).
//   - CSRF-excluded (no session for anon writes; separate public controller, ADR-0019).
//   - .strict() over-post stripping: any extra field → 422 before DB write.
//   - Input sanitized server-side (resolves P2 M-4).
//
// Consent (DPDP — docs/specs/phase-5-website.md §Consent):
//   consent.tos_version must match the current TOS_VERSION env var.
//   consent.timestamp is server-recorded (AC-37) — clients send it as a hint
//   but the server overwrites it to prevent clock manipulation.
//   consent.ip_hash is computed server-side (SHA-256 of client IP — NEVER the raw IP).
//   The client sends marketing_opt_in (the form checkbox value) and tos_version.
//
// UTM / attribution (docs/plans/phase-5.md §2 leads columns):
//   utm: captured from URL search params on the landing page.
//   landingUrl: the full URL of the form submission page.
//   referrer: HTTP Referer header.
//   gclid / fbclid: Google/Facebook click IDs from URL params.

import { z } from "zod";
import { UuidSchema, PhoneSchema } from "../common/primitives.js";
import { LeadUtmSchema } from "../crm/leads.schemas.js";

// ─────────────────────────────────────────────────────────────────────────
// DPDP Consent sub-schema
// ─────────────────────────────────────────────────────────────────────────

/**
 * Consent object sent by the client on any public form submission.
 * The backend:
 *   1. Overwrites `timestamp` with the server-recorded UTC ISO-8601 time.
 *   2. Computes `ip_hash` = SHA-256(client_ip) — the client does NOT send ip_hash.
 *   3. Validates that `tos_version` matches the current TOS_VERSION env var.
 * Stored as `leads.consent` / `bookings.consent` Json? column.
 */
export const PublicConsentSchema = z
  .object({
    /** Whether the user opted in to marketing communications (WhatsApp/email/SMS). */
    marketingOptIn: z.boolean().describe("Marketing communications opt-in from the form checkbox."),
    /**
     * The TOS version the user agreed to, e.g. "v1.0".
     * Must match the server-side TOS_VERSION env var (AC-37).
     */
    tosVersion: z.string().min(1).max(20).describe("TOS version string, e.g. 'v1.0'."),
  })
  .strict();
export type PublicConsent = z.infer<typeof PublicConsentSchema>;

// ─────────────────────────────────────────────────────────────────────────
// PublicLeadCaptureDto — POST /api/v1/public/leads
// ─────────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/public/leads (UNAUTHENTICATED)
 *
 * Captures a lead from any public form on the marketing site and creates a
 * CRM `leads` row with stage = `new`.
 *
 * Captcha-gated + rate-limited + CSRF-excluded + .strict() over-post stripping.
 * Audit trail: enqueues a confirmation domain event (NOT sent — P6 handles fanout).
 *
 * Permissions: None (anonymous public endpoint).
 * Rate limit: PublicBookingRateLimiter pattern (Redis fixed-window per IP).
 */
export const PublicLeadCaptureDtoSchema = z
  .object({
    name: z.string().min(1).max(200).describe("Lead's full name."),
    phone: PhoneSchema.describe("Lead's phone number in E.164-like format."),
    email: z
      .string()
      .email()
      .max(254)
      .optional()
      .describe("Lead's email address. Optional but recommended."),
    /**
     * UUID of the program the lead expressed interest in.
     * Stored as `leads.program_interest` FK. Null for generic/newsletter leads.
     */
    programInterestId: UuidSchema.optional().describe(
      "Program UUID the visitor expressed interest in. Optional.",
    ),
    /**
     * Free-text course/program the visitor typed into the lead popup, e.g.
     * "Full Stack Web Development". Distinct from programInterestId (a catalog
     * FK) — the marketing popup captures free text, not a dropdown selection.
     */
    courseInterest: z
      .string()
      .max(200)
      .optional()
      .describe("Free-text course the visitor is interested in."),
    /** The visitor's college/university (free text, marketing popup). */
    college: z.string().max(200).optional().describe("Visitor's college or university."),
    /** The visitor's preferred contact language (free text, e.g. "Hindi"). */
    language: z.string().max(100).optional().describe("Visitor's preferred contact language."),
    /**
     * Free-text message/question the visitor typed into the lead popup's
     * message box. Stored on the lead and shown read-only in the CRM drawer.
     */
    message: z
      .string()
      .max(1000)
      .optional()
      .describe("Free-text message the visitor typed. Optional."),
    /**
     * Lead source string (e.g. 'web-inline', 'web-sticky', 'web-exit-intent',
     * 'web-timed-popup', 'web-footer-newsletter', 'web-career'). Free-form, not an enum.
     */
    source: z.string().min(1).max(120).describe("Form source identifier."),
    /** UTM tracking parameters from the landing page URL. */
    utm: LeadUtmSchema.optional().describe("UTM params captured from the landing URL."),
    /** Full URL of the page where the form was submitted. */
    landingUrl: z
      .string()
      .url()
      .max(2048)
      .optional()
      .describe("Full landing page URL (for attribution)."),
    /** HTTP Referer header value at submission. */
    referrer: z.string().max(2048).optional().describe("HTTP Referer at form submission."),
    /** Google Click ID (?gclid= query param — Google Ads attribution). */
    gclid: z.string().max(200).optional().describe("Google Click ID for Google Ads attribution."),
    /** Facebook Click ID (?fbclid= query param — Meta Ads attribution). */
    fbclid: z.string().max(200).optional().describe("Facebook Click ID for Meta Ads attribution."),
    /** DPDP consent from the form checkboxes. */
    consent: PublicConsentSchema.describe("DPDP consent captured from the form."),
    /**
     * Captcha verification token from the client-side captcha widget
     * (hCaptcha or Cloudflare Turnstile — provider is behind CaptchaProvider interface).
     * Backend verifies this server-side before any DB write. FAIL-CLOSED in prod.
     */
    captchaToken: z
      .string()
      .min(1)
      .describe(
        "Captcha verification token. Required. Verified server-side by CaptchaProvider. " +
          "Fail-closed in prod: if captcha provider is not noop and token is invalid/missing → 422.",
      ),
  })
  .strict();
export type PublicLeadCaptureDto = z.infer<typeof PublicLeadCaptureDtoSchema>;

/**
 * Response for POST /api/v1/public/leads — minimal, no PII or internal IDs.
 * The leadId is included for reference (can be used for booking linkage in
 * the book-slot funnel if needed, but is typically not shown to the visitor).
 */
export const PublicLeadCaptureResponseSchema = z.object({
  leadId: UuidSchema.describe("Created lead id (opaque reference)."),
  message: z
    .string()
    .describe("User-facing confirmation message. E.g. 'Thanks! A counsellor will reach out soon.'"),
});
export type PublicLeadCaptureResponse = z.infer<typeof PublicLeadCaptureResponseSchema>;
