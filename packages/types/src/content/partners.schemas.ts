// Headless CMS: Partners contract — Phase 9 Completion, T14/T22/T32. Backs `model
// Partner` (hiring/tech partner logos). Admin CRUD under /api/v1/crm/partners; public
// read (published only) under /api/v1/public/partners.

import { z } from "zod";
import { UuidSchema, IsoDateTimeSchema } from "../common/primitives.js";
import { PageQuerySchema } from "../common/pagination.js";
import { ContentStatusSchema } from "./common.schemas.js";

/**
 * focus/established/city — ADDITIVE, optional (Phase-11 locked-templates P1,
 * docs/plans/phase-11-locked-templates.md): these three Partner-model columns already
 * exist (added Phase-10 for `ResolvedPartnerItemSchema`/the homepage "partner colleges"
 * live-collection block, page-builder-blocks.schemas.ts) but were never exposed on the
 * ADMIN create/update/detail DTOs — Colleges CRUD (crm/colleges.schemas.ts) needs to set
 * them. Deliberately NOT added to `PublicPartnerSchema` (that stays exactly as Phase-10
 * left it — an intentional, documented scope boundary, see `ResolvedPartnerItemSchema`'s
 * comment in page-builder-blocks.schemas.ts).
 */
const PartnerCollegeFieldsSchema = z.object({
  focus: z.string().min(1).max(200).optional(),
  established: z.number().int().min(1800).max(2100).optional(),
  city: z.string().min(1).max(120).optional(),
});

export const CreatePartnerRequestSchema = z
  .object({
    name: z.string().min(1).max(200),
    logoKey: z.string().min(1).optional(),
    url: z.string().url().max(2048).optional(),
    category: z.string().min(1).max(80).optional(),
    status: ContentStatusSchema.default("draft"),
    order: z.number().int().min(0).default(0),
  })
  .merge(PartnerCollegeFieldsSchema)
  .strict();
export type CreatePartnerRequest = z.infer<typeof CreatePartnerRequestSchema>;

export const UpdatePartnerRequestSchema = CreatePartnerRequestSchema.partial().strict();
export type UpdatePartnerRequest = z.infer<typeof UpdatePartnerRequestSchema>;

export const ListPartnersQuerySchema = z
  .object({
    category: z.string().min(1).max(80).optional(),
    status: ContentStatusSchema.optional(),
  })
  .merge(PageQuerySchema)
  .strict();
export type ListPartnersQuery = z.infer<typeof ListPartnersQuerySchema>;

export const PartnerSchema = z.object({
  id: UuidSchema,
  name: z.string(),
  logoUrl: z.string().url().nullable(),
  url: z.string().url().nullable(),
  category: z.string().nullable(),
  focus: z.string().nullable(),
  established: z.number().int().nullable(),
  city: z.string().nullable(),
  status: ContentStatusSchema,
  order: z.number().int().min(0),
  createdAt: IsoDateTimeSchema,
});
export type Partner = z.infer<typeof PartnerSchema>;

export const PublicPartnerSchema = z.object({
  id: UuidSchema,
  name: z.string(),
  logoUrl: z.string().url().nullable(),
  url: z.string().url().nullable(),
  category: z.string().nullable(),
  // focus/established/city — additive to the public projection so college_partner rows
  // render rich cards on the code-owned homepage (which reads /public/partners directly,
  // not the page-builder resolution path). No new exposure: these three are ALREADY public
  // via `ResolvedPartnerItemSchema` (the live_collection_ref partners block).
  focus: z.string().nullable(),
  established: z.number().int().nullable(),
  city: z.string().nullable(),
});
export type PublicPartner = z.infer<typeof PublicPartnerSchema>;
