// Canned-response contract (support-desk agent macros) — Phase 9 Completion, T14/T21.
// Backs `model CannedResponse`. CRM staff-only (/api/v1/crm/canned-responses);
// used to prefill ticket reply text client-side, never auto-sent server-side.

import { z } from "zod";
import { UuidSchema, IsoDateTimeSchema } from "../common/primitives.js";
import { PageQuerySchema } from "../common/pagination.js";

export const CreateCannedResponseRequestSchema = z
  .object({
    title: z.string().min(1).max(200),
    body: z.string().min(1).max(10_000),
    category: z.string().min(1).max(80).optional(),
  })
  .strict();
export type CreateCannedResponseRequest = z.infer<typeof CreateCannedResponseRequestSchema>;

export const UpdateCannedResponseRequestSchema = CreateCannedResponseRequestSchema.partial().strict();
export type UpdateCannedResponseRequest = z.infer<typeof UpdateCannedResponseRequestSchema>;

export const ListCannedResponsesQuerySchema = z
  .object({
    category: z.string().min(1).max(80).optional(),
    search: z.string().min(1).max(200).optional(),
  })
  .merge(PageQuerySchema)
  .strict();
export type ListCannedResponsesQuery = z.infer<typeof ListCannedResponsesQuerySchema>;

export const CannedResponseSchema = z.object({
  id: UuidSchema,
  title: z.string(),
  body: z.string(),
  category: z.string().nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type CannedResponse = z.infer<typeof CannedResponseSchema>;
