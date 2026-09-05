// Editable transactional email templates.
//
// WHY THESE ARE OVERRIDES AND NOT ROWS. Every automatic email the system sends is written
// in TypeScript. That is the right default: an email that fails to render is worse than one
// nobody can reword, and a missing template at send time would break enrolment for a
// student who has already paid. So the DEFAULT text stays in code, and a row in
// `email_templates` is an OVERRIDE of the prose. Deleting the row restores the code
// version, which is why "Reset to default" is a delete and not a copy of anything.
//
// WHAT IS EDITABLE, AND WHAT DELIBERATELY IS NOT. Staff can change the subject, the
// heading, the body prose and the footnote. They CANNOT change the details table, the
// button, or the layout — those carry the LMS username, the temporary password and the
// sign-in link, and a template editor that can delete somebody's credentials out of the one
// email that contains them is not a feature. The UI says so rather than leaving it to be
// discovered.
//
// Only the enrolment/payment emails are covered. The payment-LINK email is deliberately
// absent: its body is generated per order (a pay button per pending programme, single and
// multi-order branches), so there is no prose to edit without inventing a templating
// language for buttons, and a half-editable template is the `stats.headline` trap again.
import { z } from "zod";

import { IsoDateTimeSchema } from "../common/primitives.js";

/**
 * The emails this screen governs. A key here MUST have a default in the API's
 * EMAIL_TEMPLATE_DEFAULTS and a send site that renders through EmailTemplateService —
 * a key with no send site is a control that edits nothing.
 */
export const EMAIL_TEMPLATE_KEYS = ["enrollment_welcome", "payment_receipt"] as const;
export const EmailTemplateKeySchema = z.enum(EMAIL_TEMPLATE_KEYS);
export type EmailTemplateKey = z.infer<typeof EmailTemplateKeySchema>;

/** One `{{placeholder}}` a template may use, with the description shown beside the editor. */
export const EmailTemplateVariableSchema = z.object({
  key: z.string(),
  description: z.string(),
  /** What it renders as in the preview, so a reader sees a sentence rather than braces. */
  sample: z.string(),
});
export type EmailTemplateVariable = z.infer<typeof EmailTemplateVariableSchema>;

export const EmailTemplateSchema = z.object({
  key: EmailTemplateKeySchema,
  /** Human name for the list, e.g. "Enrolment welcome". */
  name: z.string(),
  /** When this email fires, in a sentence. Staff cannot edit what they cannot place. */
  description: z.string(),
  subject: z.string(),
  heading: z.string(),
  body: z.string().describe("Prose. Blank lines separate paragraphs."),
  footnote: z.string().nullable(),
  variables: z.array(EmailTemplateVariableSchema),
  /**
   * What the send site adds and this editor cannot touch, in words a non-engineer reads.
   * Served from the API rather than restated in the CRM: the send site owns which parts are
   * fixed, and a second copy of this sentence would drift the first time one of them moved.
   */
  fixedPartsNote: z.string(),
  /**
   * True when a row overrides the code default. Drives whether "Reset to default" is
   * offered, and tells a reader whether what they are looking at was written by the
   * company or shipped with the product.
   */
  isCustomised: z.boolean(),
  /** Null while the template is still the code default. */
  updatedAt: IsoDateTimeSchema.nullable(),
});
export type EmailTemplate = z.infer<typeof EmailTemplateSchema>;

export const UpdateEmailTemplateRequestSchema = z
  .object({
    subject: z.string().trim().min(1).max(200),
    heading: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(5000),
    // Empty string clears the footnote; null and absent both mean "no footnote".
    footnote: z.string().trim().max(1000).nullable().optional(),
  })
  .strict();
export type UpdateEmailTemplateRequest = z.infer<typeof UpdateEmailTemplateRequestSchema>;

/** `{ deleted: true }` — the row is removed and the code default takes over again. */
export const ResetEmailTemplateResponseSchema = z.object({ reset: z.literal(true) });
export type ResetEmailTemplateResponse = z.infer<typeof ResetEmailTemplateResponseSchema>;

export const EmailTemplatePreviewResponseSchema = z.object({
  subject: z.string(),
  html: z.string().describe("The full rendered email, exactly as the send site would build it."),
});
export type EmailTemplatePreviewResponse = z.infer<typeof EmailTemplatePreviewResponseSchema>;

/**
 * Placeholders used in `text` that the template does not supply.
 *
 * Run identically by the API (which rejects the save) and the CRM editor (which warns
 * before you submit), the same shape `computeLeaveDuration` and
 * `buildOnboardingAnswerIssues` use. An unknown placeholder is not cosmetic: the renderer
 * leaves it alone, so `{{studnetName}}` ships to a real student as literal braces.
 */
export function findUnknownEmailTemplateVariables(
  text: string,
  allowed: readonly string[],
): string[] {
  const used = [...text.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)].map((m) => m[1]!);
  const permitted = new Set(allowed);
  return [...new Set(used.filter((key) => !permitted.has(key)))];
}
