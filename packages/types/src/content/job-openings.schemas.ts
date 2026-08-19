// Job-opening contract — CRM ▸ Careers ▸ Openings, and the live roles rendered on
// /careers. Backs `model JobOpening`. Spec: docs/specs/careers-hiring.md, ADR-0066.
//
// TWO PROJECTIONS, ON PURPOSE:
//   `JobOpening`       — the CRM row. Everything, including draft/closed rows and the
//                        applicant count, behind `careers.openings.manage`.
//   `PublicJobOpening` — what an anonymous visitor may see. NO status, NO counts, NO
//                        internal ids beyond the ones the apply form must echo back.
// They are separate schemas rather than one with optional fields so that adding a CRM-only
// column can never leak onto the marketing site by forgetting to strip it.
//
// WHY A `slug` AND AN `id`: the slug is the durable public handle (/careers#senior-counsellor,
// shareable, survives a re-publish), while the id is what the apply form submits. The
// public projection carries both because the form needs the id and the anchor needs the slug.

import { z } from "zod";
import { UuidSchema, IsoDateTimeSchema, IsoDateSchema } from "../common/primitives.js";
import { PageQuerySchema } from "../common/pagination.js";

/**
 * draft     — authored, invisible to the public, cannot be applied to.
 * published — live on /careers and accepting applications.
 * closed    — deliberately taken down. Kept (not deleted) so its applications keep their
 *             opening, and so it can be re-published next hiring round.
 *
 * A published opening whose `closesOn` has passed behaves publicly EXACTLY like a closed
 * one without its status changing — see `isJobOpeningLive` below and the model comment in
 * schema.prisma. Staff still see it as published-but-lapsed, which is the honest state.
 */
export const JobOpeningStatusSchema = z.enum(["draft", "published", "closed"]);
export type JobOpeningStatus = z.infer<typeof JobOpeningStatusSchema>;

export const JobOpeningWorkModeSchema = z.enum(["onsite", "hybrid", "remote"]);
export type JobOpeningWorkMode = z.infer<typeof JobOpeningWorkModeSchema>;

/** Free text rather than an enum: "Full-time", "Internship", "Contract — 6 months" are all
 *  legitimate and a fixed list would be wrong within a month. */
const EmploymentTypeSchema = z.string().min(1).max(40);

/**
 * Slug rules match the rest of the site's public slugs: lowercase, digits, single hyphens,
 * no leading/trailing hyphen. Server-generated from the title when omitted on create.
 */
export const JobOpeningSlugSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug must be lowercase words separated by single hyphens");

const BulletListSchema = z.array(z.string().min(1).max(300)).max(20);

// ── Public projection ────────────────────────────────────────────────────────

export const PublicJobOpeningSchema = z.object({
  id: UuidSchema.describe("Submit this as `jobOpeningId` on the apply form."),
  slug: JobOpeningSlugSchema,
  title: z.string(),
  department: z.string().nullable(),
  employmentType: z.string(),
  location: z.string(),
  workMode: JobOpeningWorkModeSchema.nullable(),
  experienceLevel: z.string().nullable(),
  summary: z.string(),
  description: z.string().nullable(),
  responsibilities: z.array(z.string()),
  requirements: z.array(z.string()),
  compensationNote: z.string().nullable(),
  openingsCount: z.number().int().min(1),
  closesOn: IsoDateSchema.nullable().describe("Inclusive last day to apply."),
  postedAt: IsoDateTimeSchema.describe("publishedAt, falling back to createdAt."),
});
export type PublicJobOpening = z.infer<typeof PublicJobOpeningSchema>;

export const ListPublicJobOpeningsQuerySchema = z
  .object({
    department: z.string().min(1).max(80).optional(),
    location: z.string().min(1).max(100).optional(),
    workMode: JobOpeningWorkModeSchema.optional(),
    limit: z.coerce.number().int().min(1).max(60).default(30),
  })
  .strict();
export type ListPublicJobOpeningsQuery = z.infer<typeof ListPublicJobOpeningsQuerySchema>;

// ── CRM projection ───────────────────────────────────────────────────────────

export const JobOpeningSchema = PublicJobOpeningSchema.extend({
  status: JobOpeningStatusSchema,
  order: z.number().int(),
  publishedAt: IsoDateTimeSchema.nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  /** Live (non-soft-deleted) applications against this opening. Drives the CRM list's
   *  "12 applicants" column and the "you are about to close a role with 3 undecided
   *  candidates" confirmation. */
  applicationCount: z.number().int().min(0),
  /** Applications still sitting at `new` — the number that actually needs somebody's time. */
  pendingApplicationCount: z.number().int().min(0),
  /** True when the row is `published` AND not past `closesOn` — i.e. genuinely visible on
   *  the site right now. Computed server-side so the CRM badge and the public list can
   *  never disagree about what "live" means. */
  isLive: z.boolean(),
});
export type JobOpening = z.infer<typeof JobOpeningSchema>;

export const CreateJobOpeningRequestSchema = z
  .object({
    title: z.string().min(1).max(120),
    slug: JobOpeningSlugSchema.optional().describe("Derived from the title when omitted."),
    department: z.string().min(1).max(80).nullish(),
    employmentType: EmploymentTypeSchema,
    location: z.string().min(1).max(100),
    workMode: JobOpeningWorkModeSchema.nullish(),
    experienceLevel: z.string().min(1).max(80).nullish(),
    summary: z.string().min(1).max(500),
    description: z.string().max(8000).nullish(),
    responsibilities: BulletListSchema.default([]),
    requirements: BulletListSchema.default([]),
    compensationNote: z.string().min(1).max(200).nullish(),
    status: JobOpeningStatusSchema.default("draft"),
    order: z.number().int().min(0).max(9999).default(0),
    openingsCount: z.number().int().min(1).max(999).default(1),
    closesOn: IsoDateSchema.nullish(),
  })
  .strict();
export type CreateJobOpeningRequest = z.infer<typeof CreateJobOpeningRequestSchema>;

/** Every field optional — but `.strict()`, so a typo'd key is a 400 rather than a silent no-op. */
export const UpdateJobOpeningRequestSchema = CreateJobOpeningRequestSchema.partial().strict();
export type UpdateJobOpeningRequest = z.infer<typeof UpdateJobOpeningRequestSchema>;

export const ListJobOpeningsQuerySchema = z
  .object({
    status: JobOpeningStatusSchema.optional(),
    department: z.string().min(1).max(80).optional(),
    search: z.string().min(1).max(200).optional(),
  })
  .merge(PageQuerySchema)
  .strict();
export type ListJobOpeningsQuery = z.infer<typeof ListJobOpeningsQuerySchema>;

// ── Shared helpers (run identically in the browser and the API) ──────────────

/**
 * Turn a role title into a slug. Exported so the CRM form can show staff the slug it is
 * about to get, and the API can derive the same one when the field is left blank — the
 * `computeLeaveDuration` / `buildOnboardingAnswerIssues` discipline of one function run on
 * both sides rather than two implementations that drift.
 */
export function slugifyJobOpeningTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    // NFKD splits accents into combining marks, which the next replace folds away with every
    // other non-alphanumeric run — "José" becomes "jose", not "jos-".
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120)
    .replace(/-+$/g, "");
}

/**
 * Is this opening visible to the public right now?
 *
 * `closesOn` is an inclusive DATE, so an opening closing on the 30th accepts applications
 * for the whole of the 30th. Compared date-string to date-string (not as Date objects) so
 * the answer does not shift with the server's timezone: "closes on the 30th" must not
 * become the 29th for a server running behind UTC.
 */
export function isJobOpeningLive(
  opening: { status: JobOpeningStatus; closesOn: string | null },
  today: string = new Date().toISOString().slice(0, 10),
): boolean {
  if (opening.status !== "published") return false;
  if (opening.closesOn && opening.closesOn < today) return false;
  return true;
}
