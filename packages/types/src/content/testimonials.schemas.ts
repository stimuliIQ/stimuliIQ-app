// Headless CMS: Testimonials contract — Phase 9 Completion, T14/T22/T32.
// Backs `model Testimonial`. `studentName` is intentionally unmasked (public-consented
// marketing content — see the Prisma model comment). Admin CRUD under
// /api/v1/crm/testimonials; public read (published only) under /api/v1/public/testimonials.

import { z } from "zod";
import { UuidSchema, IsoDateTimeSchema } from "../common/primitives.js";
import { PageQuerySchema } from "../common/pagination.js";
import { ContentStatusSchema } from "./common.schemas.js";

export const CreateTestimonialRequestSchema = z
  .object({
    programId: UuidSchema.nullable().optional(),
    studentName: z.string().min(1).max(200),
    studentPhotoKey: z.string().min(1).optional(),
    quote: z.string().min(1).max(2000),
    rating: z.number().int().min(0).max(50).nullable().optional().describe("0-50 = 0.0-5.0 stars, x10 scale."),
    status: ContentStatusSchema.default("draft"),
    order: z.number().int().min(0).default(0),
  })
  .strict();
export type CreateTestimonialRequest = z.infer<typeof CreateTestimonialRequestSchema>;

export const UpdateTestimonialRequestSchema = CreateTestimonialRequestSchema.partial().strict();
export type UpdateTestimonialRequest = z.infer<typeof UpdateTestimonialRequestSchema>;

export const ListTestimonialsQuerySchema = z
  .object({
    programId: UuidSchema.optional(),
    status: ContentStatusSchema.optional(),
  })
  .merge(PageQuerySchema)
  .strict();
export type ListTestimonialsQuery = z.infer<typeof ListTestimonialsQuerySchema>;

export const TestimonialSchema = z.object({
  id: UuidSchema,
  programId: UuidSchema.nullable(),
  studentName: z.string(),
  studentPhotoUrl: z.string().url().nullable().describe("CDN URL minted server-side from studentPhotoKey."),
  quote: z.string(),
  rating: z.number().int().min(0).max(50).nullable(),
  status: ContentStatusSchema,
  order: z.number().int().min(0),
  createdAt: IsoDateTimeSchema,
});
export type Testimonial = z.infer<typeof TestimonialSchema>;

// ── Public read ──────────────────────────────────────────────────────────

export const ListPublicTestimonialsQuerySchema = z
  .object({
    programId: UuidSchema.optional(),
  })
  .strict();
export type ListPublicTestimonialsQuery = z.infer<typeof ListPublicTestimonialsQuerySchema>;

export const PublicTestimonialSchema = z.object({
  id: UuidSchema,
  studentName: z.string(),
  studentPhotoUrl: z.string().url().nullable(),
  quote: z.string(),
  rating: z.number().int().min(0).max(50).nullable(),
  /**
   * Title of the linked `Program`, joined server-side — the "which track did they train
   * on" line under the student's name on a testimonial card. Null when the testimonial
   * isn't linked to a program (`programId` is optional in the CRM form), in which case
   * the card simply omits that line.
   *
   * The public DTO exposes the TITLE, not the `programId` the CRM DTO carries: the id is
   * an internal handle of no use to a marketing page, and shipping it would invite the
   * web app to fetch the program separately just to render one string.
   */
  programTitle: z.string().nullable(),
});
export type PublicTestimonial = z.infer<typeof PublicTestimonialSchema>;
