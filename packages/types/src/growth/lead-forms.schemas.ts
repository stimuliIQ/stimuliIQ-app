// Lead-form config contract — Phase 9 Completion, T12/T14/T32. Backs `model LeadForm` —
// a configurable lead-capture form definition embedded on web pages. `fields` is a JSON
// array of field descriptors `[{key, label, type, required}]`. Admin CRUD under
// /api/v1/crm/lead-forms; public config read (active only, by key) under
// /api/v1/public/lead-forms/:key — the web app fetches the field config to render the
// form, then submits captured data via the existing `POST /public/leads`
// (public/leads.schemas.ts `PublicLeadCaptureDtoSchema`) with `source` set to the
// form's `key`. This DTO does NOT duplicate lead capture — it is config-only.

import { z } from "zod";
import { UuidSchema, IsoDateTimeSchema } from "../common/primitives.js";
import { PageQuerySchema } from "../common/pagination.js";

export const LeadFormFieldTypeSchema = z.enum(["text", "email", "phone", "select", "textarea", "checkbox"]);
export type LeadFormFieldType = z.infer<typeof LeadFormFieldTypeSchema>;

export const LeadFormFieldSchema = z
  .object({
    key: z.string().min(1).max(60),
    label: z.string().min(1).max(200),
    type: LeadFormFieldTypeSchema,
    required: z.boolean().default(false),
    options: z.array(z.string().min(1).max(200)).optional().describe("Choices, when type='select'."),
  })
  .strict();
export type LeadFormField = z.infer<typeof LeadFormFieldSchema>;

export const CreateLeadFormRequestSchema = z
  .object({
    key: z.string().min(1).max(120).regex(/^[a-z0-9-]+$/, "lowercase kebab-case key"),
    name: z.string().min(1).max(200),
    fields: z.array(LeadFormFieldSchema).min(1),
    targetProgramId: UuidSchema.nullable().optional(),
    active: z.boolean().default(true),
  })
  .strict();
export type CreateLeadFormRequest = z.infer<typeof CreateLeadFormRequestSchema>;

export const UpdateLeadFormRequestSchema = CreateLeadFormRequestSchema.partial().strict();
export type UpdateLeadFormRequest = z.infer<typeof UpdateLeadFormRequestSchema>;

export const ListLeadFormsQuerySchema = z
  .object({
    active: z.coerce.boolean().optional(),
  })
  .merge(PageQuerySchema)
  .strict();
export type ListLeadFormsQuery = z.infer<typeof ListLeadFormsQuerySchema>;

export const LeadFormSchema = z.object({
  id: UuidSchema,
  key: z.string(),
  name: z.string(),
  fields: z.array(LeadFormFieldSchema),
  targetProgramId: UuidSchema.nullable(),
  active: z.boolean(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type LeadForm = z.infer<typeof LeadFormSchema>;

// ── Public config read ──────────────────────────────────────────────────

/** GET /api/v1/public/lead-forms/:key — 404 if inactive/not found (no existence leakage). */
export const PublicLeadFormSchema = z.object({
  key: z.string(),
  name: z.string(),
  fields: z.array(LeadFormFieldSchema),
  targetProgramId: UuidSchema.nullable(),
});
export type PublicLeadForm = z.infer<typeof PublicLeadFormSchema>;
