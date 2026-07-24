// Newsletter subscription contract — Phase 9 Completion, T14/T32. Backs `model
// NewsletterSubscription`. Public subscribe endpoint (footer newsletter opt-in,
// captcha-gated + rate-limited, same posture as public/leads.schemas.ts) at
// POST /api/v1/public/newsletter/subscribe; admin list under
// /api/v1/crm/newsletter-subscriptions for CRM export/segmentation.

import { z } from "zod";
import { UuidSchema, IsoDateTimeSchema } from "../common/primitives.js";
import { PageQuerySchema } from "../common/pagination.js";
import { PublicConsentSchema } from "../public/leads.schemas.js";

/**
 * POST /api/v1/public/newsletter/subscribe (UNAUTHENTICATED)
 * Re-subscribing after a soft-deleted (unsubscribed) row is allowed — the backend
 * reactivates the existing row rather than erroring.
 */
export const SubscribeNewsletterRequestSchema = z
  .object({
    email: z.string().email().max(254),
    consent: PublicConsentSchema,
    captchaToken: z.string().min(1),
  })
  .strict();
export type SubscribeNewsletterRequest = z.infer<typeof SubscribeNewsletterRequestSchema>;

export const SubscribeNewsletterResponseSchema = z.object({
  subscribed: z.literal(true),
});
export type SubscribeNewsletterResponse = z.infer<typeof SubscribeNewsletterResponseSchema>;

/**
 * GET /api/v1/public/newsletter/unsubscribe?token=... — signed-token unsubscribe link
 * carried in newsletter emails. No auth/CSRF (matches engagement/notifications.schemas.ts
 * unsubscribe precedent, LOCK-D3-style HMAC token, not a session).
 */
export const UnsubscribeNewsletterQuerySchema = z
  .object({
    token: z.string().min(1),
  })
  .strict();
export type UnsubscribeNewsletterQuery = z.infer<typeof UnsubscribeNewsletterQuerySchema>;

// ── Admin (CRM) list ────────────────────────────────────────────────────

export const ListNewsletterSubscriptionsQuerySchema = z
  .object({
    status: z.enum(["active", "unsubscribed"]).optional(),
    search: z.string().min(1).max(200).optional().describe("Match by email."),
  })
  .merge(PageQuerySchema)
  .strict();
export type ListNewsletterSubscriptionsQuery = z.infer<typeof ListNewsletterSubscriptionsQuerySchema>;

export const NewsletterSubscriptionSchema = z.object({
  id: UuidSchema,
  email: z.string().email(),
  status: z.string(),
  unsubscribedAt: IsoDateTimeSchema.nullable(),
  createdAt: IsoDateTimeSchema,
});
export type NewsletterSubscription = z.infer<typeof NewsletterSubscriptionSchema>;
