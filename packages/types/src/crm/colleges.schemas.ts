// Colleges — Phase-11 locked templates, api-designer P1
// (docs/plans/phase-11-locked-templates.md: "Colleges become a dedicated CRM-managed
// list ... identical model to mentors (Mentor) and courses (programs)").
//
// A "College" is NOT a new table — it is a `model Partner` row (prisma/schema.prisma),
// the SAME model the existing generic hiring/tech-partner CRUD already uses
// (content/partners.schemas.ts, `/api/v1/crm/partners`). This file gives colleges their
// OWN dedicated, purpose-built CRM contract (mirroring the mentors/courses precedent — a
// college is authored through a focused "Colleges" screen with focus/established/city
// front-and-center, not the generic partner-logo screen built for hiring/tech logos) while
// reusing every field definition from `content/partners.schemas.ts` verbatim — nothing here
// re-derives a field shape that already exists (CLAUDE.md §3.2).
//
// Endpoint surface (backend-builder, P3): `/api/v1/crm/colleges` — list/create/update/
// delete, mounted alongside (not replacing) `/api/v1/crm/partners`. Both surfaces read/write
// the same `partners` table; backend-builder's service layer is expected to default
// `category` to `"college"` on create and filter list-by `category: "college"` so this
// screen never mixes in hiring/tech partner rows — see `CreateCollegeRequestSchema`'s
// `category` field comment below for the exact default-and-filter contract.
//
// Public read: colleges surface on the site via the EXISTING `live_collection_ref`
// (`collection: "partners"`) mechanism (page-builder-blocks.schemas.ts /
// page-templates.schemas.ts's `colleges_live` sections) — there is no separate
// `/public/colleges` endpoint; `GET /public/partners` (content/partners.schemas.ts)
// already serves this, filtered by `category` the same way.
//
// PERMISSIONS (open decision for backend-builder, flagged here rather than silently
// assumed): the existing `/crm/partners` surface gates on `content.view/create/edit/delete`
// (see apps/api/src/modules/content/partners.controller.ts). This contract assumes
// `/crm/colleges` reuses the SAME `content.*` permissions (colleges are still `Partner`
// rows, and `content.builder` already super-admin-gates the page-builder side that
// consumes them) — introducing a dedicated `colleges.*` permission set is a viable
// alternative backend-builder/security-reviewer may choose instead; if so, update this
// comment and the CRM nav/RBAC seed together.

import { z } from "zod";
import { UuidSchema, IsoDateTimeSchema } from "../common/primitives.js";
import { PageQuerySchema } from "../common/pagination.js";
import { ContentStatusSchema } from "../content/common.schemas.js";

/** `focus`/`established`/`city` reuse the exact bounds added to `content/partners.schemas.ts`
 *  this same phase (`PartnerSchema`/`CreatePartnerRequestSchema`) — not re-declared here. */
const CollegeFocusSchema = z.string().min(1).max(200);
const CollegeEstablishedYearSchema = z.number().int().min(1800).max(2100);
const CollegeCitySchema = z.string().min(1).max(120);

/**
 * `POST /crm/colleges`. `category` defaults to `"college_partner"` — matching the ACTUAL
 * seeded convention (prisma/seed.ts's Phase-10 sample colleges, prisma/fixtures/
 * builder-pages/{home,for-colleges}.json's `live_collection_ref` selections) that
 * distinguishes a college row from the generic hiring/tech partners `/crm/partners`
 * manages (backend-builder P3 correction: an earlier draft of this default read plain
 * `"college"`, which never matched any seeded/resolved row). `category` is still a plain
 * editable string, not a fixed literal: some tenants may want finer-grained categories
 * (e.g. "engineering_college", "medical_college") while still living on the dedicated
 * Colleges screen, matching `Partner.category`'s existing "open-ended string, no enum"
 * convention (content/partners.schemas.ts) — note the `/crm/colleges` LIST endpoint's
 * implicit filter only matches the exact `"college_partner"` value (CollegesRepository);
 * recategorising a row away from it will hide it from the Colleges list (it remains
 * addressable by id via `/crm/colleges/:id` update/delete).
 */
export const CreateCollegeRequestSchema = z
  .object({
    name: z.string().min(1).max(200),
    logoKey: z.string().min(1).optional(),
    url: z.string().url().max(2048).optional(),
    category: z.string().min(1).max(80).default("college_partner"),
    focus: CollegeFocusSchema.optional(),
    established: CollegeEstablishedYearSchema.optional(),
    city: CollegeCitySchema.optional(),
    status: ContentStatusSchema.default("draft"),
    order: z.number().int().min(0).default(0),
  })
  .strict();
export type CreateCollegeRequest = z.infer<typeof CreateCollegeRequestSchema>;

/** `PATCH /crm/colleges/:id` — partial update. `category` stays editable (a college row
 *  could be recategorised) but is never required. */
export const UpdateCollegeRequestSchema = CreateCollegeRequestSchema.partial().strict();
export type UpdateCollegeRequest = z.infer<typeof UpdateCollegeRequestSchema>;

/** `GET /crm/colleges` — list/search/paginate. No `category` filter param: the server
 *  scopes this endpoint to college-category rows implicitly (see file header); a caller
 *  wanting the full unfiltered `Partner` table (hiring/tech partners included) uses the
 *  existing `/crm/partners` endpoint instead. */
export const ListCollegesQuerySchema = z
  .object({
    status: ContentStatusSchema.optional(),
    search: z.string().min(1).max(200).optional().describe("Matches college name, case-insensitive."),
    city: CollegeCitySchema.optional(),
  })
  .merge(PageQuerySchema)
  .strict();
export type ListCollegesQuery = z.infer<typeof ListCollegesQuerySchema>;

/** Response row/detail — a college-scoped projection of `Partner`. Minimal, no entity
 *  leakage (no `tenantId`, no soft-delete internals beyond what the generic Partner
 *  CRUD already exposes). */
export const CollegeSchema = z.object({
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
export type College = z.infer<typeof CollegeSchema>;

/** `DELETE /crm/colleges/:id` response — soft-delete, mirrors
 *  `PartnersController.remove`'s existing `{ deleted: true }` shape verbatim. */
export const DeleteCollegeResponseSchema = z.object({ deleted: z.literal(true) });
export type DeleteCollegeResponse = z.infer<typeof DeleteCollegeResponseSchema>;

/**
 * `POST /crm/colleges/logo-upload-url` — mint a short-lived signed PUT URL for a college
 * logo. Mirrors `MentorPhotoUploadUrlRequestSchema` (crm/mentors.schemas.ts) /
 * `ContentPageMediaUploadUrlRequestSchema` (content/pages.schemas.ts): raster-only (no
 * SVG — stored-XSS vector on the public site), 5 MB cap.
 */
export const CollegeLogoUploadUrlRequestSchema = z
  .object({
    contentType: z.enum(["image/jpeg", "image/png", "image/webp"]).describe("College logos are raster images only — no SVG."),
    fileName: z.string().min(1).max(255),
    sizeBytes: z.number().int().min(1).max(5_242_880).describe("Max 5 MB per college logo."),
  })
  .strict();
export type CollegeLogoUploadUrlRequest = z.infer<typeof CollegeLogoUploadUrlRequestSchema>;
