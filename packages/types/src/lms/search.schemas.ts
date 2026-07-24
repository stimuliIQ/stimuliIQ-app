// LMS global search contract — Phase 9 Completion, T14/T29 (docs/plans/
// phase-9-completion.md). GET /api/v1/me/search — searches across the student's
// OWN-scoped surface only (lessons in enrolled programs, resources attached to those
// lessons, forum threads in enrolled batches/programs) via a `tsvector` full-text index
// (backend-builder, T29). Never cross-tenant/cross-enrollment (RBAC+scope guarded).

import { z } from "zod";
import { UuidSchema } from "../common/primitives.js";

export const SearchResultTypeSchema = z.enum(["lesson", "resource", "forum_thread"]);
export type SearchResultType = z.infer<typeof SearchResultTypeSchema>;

/** GET /api/v1/me/search */
export const GlobalSearchQuerySchema = z
  .object({
    q: z.string().min(1).max(200),
    types: z
      .string()
      .optional()
      .describe("Comma-separated subset of SearchResultType to filter to (e.g. 'lesson,forum_thread'). Omit for all types."),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();
export type GlobalSearchQuery = z.infer<typeof GlobalSearchQuerySchema>;

/** One search hit — minimal, deep-link-only shape (no lesson content/video asset ref leaked). */
export const SearchResultItemSchema = z.object({
  type: SearchResultTypeSchema,
  id: UuidSchema,
  title: z.string(),
  snippet: z.string().nullable().describe("Short highlighted excerpt around the match, or null."),
  programId: UuidSchema.nullable().describe("The owning program, for building the deep link. Null for forum_thread not scoped to a program."),
  programTitle: z.string().nullable(),
});
export type SearchResultItem = z.infer<typeof SearchResultItemSchema>;

export const GlobalSearchResponseSchema = z.object({
  results: z.array(SearchResultItemSchema),
});
export type GlobalSearchResponse = z.infer<typeof GlobalSearchResponseSchema>;
