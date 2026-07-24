// Contact form contract — Phase 9 Completion, T14/T32. Backs `model ContactSubmission`.
// Public submit at POST /api/v1/public/contact (captcha-gated + rate-limited, same
// posture as public/leads.schemas.ts); admin list/get/update-status under
// /api/v1/crm/contact-submissions.

import { z } from "zod";
import { UuidSchema, PhoneSchema, IsoDateTimeSchema } from "../common/primitives.js";
import { PageQuerySchema } from "../common/pagination.js";
import { PublicConsentSchema } from "../public/leads.schemas.js";

export const ContactSubmissionStatusSchema = z.enum(["new", "in_progress", "resolved", "spam"]);
export type ContactSubmissionStatus = z.infer<typeof ContactSubmissionStatusSchema>;

/** POST /api/v1/public/contact (UNAUTHENTICATED) */
export const SubmitContactRequestSchema = z
  .object({
    name: z.string().min(1).max(200),
    email: z.string().email().max(254),
    phone: PhoneSchema.optional(),
    subject: z.string().max(200).optional(),
    message: z.string().min(1).max(5000),
    consent: PublicConsentSchema,
    captchaToken: z.string().min(1),
  })
  .strict();
export type SubmitContactRequest = z.infer<typeof SubmitContactRequestSchema>;

export const SubmitContactResponseSchema = z.object({
  id: UuidSchema,
  message: z.string(),
});
export type SubmitContactResponse = z.infer<typeof SubmitContactResponseSchema>;

// ── Admin (CRM) ─────────────────────────────────────────────────────────

export const UpdateContactSubmissionStatusRequestSchema = z
  .object({
    status: ContactSubmissionStatusSchema,
  })
  .strict();
export type UpdateContactSubmissionStatusRequest = z.infer<typeof UpdateContactSubmissionStatusRequestSchema>;

export const ListContactSubmissionsQuerySchema = z
  .object({
    status: ContactSubmissionStatusSchema.optional(),
    search: z.string().min(1).max(200).optional(),
  })
  .merge(PageQuerySchema)
  .strict();
export type ListContactSubmissionsQuery = z.infer<typeof ListContactSubmissionsQuerySchema>;

export const ContactSubmissionSchema = z.object({
  id: UuidSchema,
  name: z.string(),
  email: z.string().email(),
  phone: z.string().nullable(),
  subject: z.string().nullable(),
  message: z.string(),
  status: ContactSubmissionStatusSchema,
  createdAt: IsoDateTimeSchema,
});
export type ContactSubmission = z.infer<typeof ContactSubmissionSchema>;
