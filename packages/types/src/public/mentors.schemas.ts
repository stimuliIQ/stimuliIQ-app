// Public mentors directory schemas — GET /public/mentors (web /mentors page).
//
// Source of truth: the CRM `mentors` table (Phase-8 — REAL, HUMAN external-hire
// mentors managed in the CRM directory), NOT `faculty_profiles` (which backs the
// per-program `mentorBios` section on program detail pages).
//
// SECURITY (public projection allowlist):
//   Exposed:   id, fullName, externalInstitute (credibility display), expertise tags.
//   FORBIDDEN: email, phone, notes, engagementStatus, userId, tenantId, joinedAt,
//              assignedBatchCount, and every other CRM-internal field. Only mentors
//              with engagementStatus=active AND deletedAt IS NULL are listed — the
//              status itself is never exposed (being listed implies active).
//
// Pagination: cursor-based (PaginationMeta: nextCursor + hasMore) per docs/04 §2.14,
// same contract as /public/programs.

import { z } from "zod";
import { UuidSchema } from "../common/primitives.js";
import { MentorSocialLinksSchema } from "../crm/mentors.schemas.js";

/** One mentor card on the public /mentors page — safe public fields ONLY. */
export const PublicMentorCardSchema = z.object({
  id: UuidSchema,
  fullName: z.string().min(1).describe("Mentor's display name."),
  /** The institute/company the mentor is hired from — credibility display. */
  externalInstitute: z.string().describe("Company/institute for credibility display."),
  /** Subject/skill tags (e.g. ["React", "System Design"]). */
  expertise: z.array(z.string()).describe("Expertise tags shown on the mentor card."),
  // ── Public marketing-profile fields (CRM-managed; see crm/mentors.schemas.ts) ──
  photoUrl: z.string().url().nullable().describe("Public CDN photo URL; null → the card renders a monogram avatar."),
  title: z.string().nullable().describe("Professional headline shown under the name."),
  bio: z.string().nullable().describe("Short professional bio."),
  yearsExperience: z.number().int().min(0).nullable().describe("Years of professional experience."),
  socialLinks: MentorSocialLinksSchema.nullable().describe("LinkedIn / X / GitHub / website links."),
});
export type PublicMentorCard = z.infer<typeof PublicMentorCardSchema>;

/** Query parameters for GET /public/mentors (cursor pagination). */
export const ListPublicMentorsQuerySchema = z
  .object({
    /** Opaque cursor from the previous page's meta.nextCursor. */
    cursor: z.string().optional().describe("Cursor for the next page (from meta.nextCursor)."),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(50)
      .default(12)
      .describe("Items per page, max 50."),
  })
  .strict();
export type ListPublicMentorsQuery = z.infer<typeof ListPublicMentorsQuerySchema>;

// ─────────────────────────────────────────────────────────────────────────
// Compile-time no-forbidden-field assertion (same pattern as programs.schemas.ts)
// ─────────────────────────────────────────────────────────────────────────

type ForbiddenMentorField =
  | "email"
  | "phone"
  | "notes"
  | "engagementStatus"
  | "userId"
  | "tenantId"
  | "joinedAt"
  | "assignedBatchCount"
  | "createdAt"
  | "updatedAt"
  | "deletedAt";

type AssertNoForbiddenFields<T, ForbiddenKeys extends string> = [
  ForbiddenKeys extends keyof T ? "FORBIDDEN FIELD DETECTED" : "ok",
] extends ["ok"]
  ? true
  : never;

type _AssertMentorCardProjection = AssertNoForbiddenFields<
  PublicMentorCard,
  ForbiddenMentorField
>;
const _assertMentorCard: _AssertMentorCardProjection = true;
void _assertMentorCard;
