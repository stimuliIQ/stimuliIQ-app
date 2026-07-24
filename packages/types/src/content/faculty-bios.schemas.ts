// Headless CMS: Faculty bios contract — Phase 9 Completion, T14/T22/T32. Backs `model
// FacultyBio` — the PUBLIC marketing bio, distinct from the internal `faculty_profiles`
// record (`facultyProfileId` optionally links the two). `name`/`bio` are intentionally
// unmasked (public-consented marketing content). Admin CRUD under
// /api/v1/crm/faculty-bios; public read (published only) under /api/v1/public/faculty-bios.

import { z } from "zod";
import { UuidSchema, IsoDateTimeSchema } from "../common/primitives.js";
import { PageQuerySchema } from "../common/pagination.js";
import { ContentStatusSchema } from "./common.schemas.js";

export const FacultyBioSocialLinksSchema = z
  .object({
    linkedin: z.string().url().optional(),
    twitter: z.string().url().optional(),
    website: z.string().url().optional(),
  })
  .strict();
export type FacultyBioSocialLinks = z.infer<typeof FacultyBioSocialLinksSchema>;

export const CreateFacultyBioRequestSchema = z
  .object({
    facultyProfileId: UuidSchema.nullable().optional(),
    name: z.string().min(1).max(200),
    photoKey: z.string().min(1).optional(),
    title: z.string().max(120).optional(),
    bio: z.string().min(1).max(4000),
    socialLinks: FacultyBioSocialLinksSchema.optional(),
    status: ContentStatusSchema.default("draft"),
    order: z.number().int().min(0).default(0),
  })
  .strict();
export type CreateFacultyBioRequest = z.infer<typeof CreateFacultyBioRequestSchema>;

export const UpdateFacultyBioRequestSchema = CreateFacultyBioRequestSchema.partial().strict();
export type UpdateFacultyBioRequest = z.infer<typeof UpdateFacultyBioRequestSchema>;

export const ListFacultyBiosQuerySchema = z
  .object({
    status: ContentStatusSchema.optional(),
  })
  .merge(PageQuerySchema)
  .strict();
export type ListFacultyBiosQuery = z.infer<typeof ListFacultyBiosQuerySchema>;

export const FacultyBioSchema = z.object({
  id: UuidSchema,
  facultyProfileId: UuidSchema.nullable(),
  name: z.string(),
  photoUrl: z.string().url().nullable(),
  title: z.string().nullable(),
  bio: z.string(),
  socialLinks: FacultyBioSocialLinksSchema.nullable(),
  status: ContentStatusSchema,
  order: z.number().int().min(0),
  createdAt: IsoDateTimeSchema,
});
export type FacultyBio = z.infer<typeof FacultyBioSchema>;

export const PublicFacultyBioSchema = z.object({
  id: UuidSchema,
  name: z.string(),
  photoUrl: z.string().url().nullable(),
  title: z.string().nullable(),
  bio: z.string(),
  socialLinks: FacultyBioSocialLinksSchema.nullable(),
});
export type PublicFacultyBio = z.infer<typeof PublicFacultyBioSchema>;
