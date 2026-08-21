// packages/types/src/public/search.schemas.ts
//
// PUBLIC global-search DTO for the `web` marketing site's site-wide search UI.
//
// NO DEDICATED PUBLIC SEARCH BACKEND ROUTE EXISTS (verified: apps/api/src/modules/
// search only implements `GET /api/v1/me/search` — the LMS OWN-scope AUTHENTICATED
// search over a student's enrolled lessons/resources/forum threads, see
// lms/search.schemas.ts; apps/api/src/modules/public has no search endpoint of its
// own). This file does NOT declare a new backend contract the API must implement.
//
// Instead it is the shape `client.public.search.search()` (@repo/api-client)
// COMPOSES, client-side, from TWO EXISTING public reads:
//   - GET /api/v1/public/programs      (ListPublicProgramsQuerySchema / PublicProgramSummary)
//   - GET /api/v1/public/blog/posts    (ListPublicBlogPostsQuerySchema, `search` param /
//                                        PublicBlogPostSummary)
// The SDK method issues both requests in parallel and normalizes the results into
// `PublicSearchResultItem[]` — it is never a single backend round-trip. See
// packages/api-client/src/public/search.api.ts for the composition + its documented
// limitation (the public programs catalog has no free-text `search`/`q` query param
// server-side today, so program matching is filtered client-side on the fetched page).

import { z } from "zod";
import { UuidSchema } from "../common/primitives.js";

export const PublicSearchResultTypeSchema = z.enum(["program", "blog_post"]);
export type PublicSearchResultType = z.infer<typeof PublicSearchResultTypeSchema>;

/** Query for the COMPOSED public search — never sent as-is to a single backend route. */
export const PublicSearchQuerySchema = z
  .object({
    q: z.string().min(1).max(200),
    types: z
      .string()
      .optional()
      .describe(
        "Comma-separated subset of PublicSearchResultType (e.g. 'program,blog_post'). Omit for both.",
      ),
    limit: z
      .coerce.number()
      .int()
      .min(1)
      .max(50)
      .default(20)
      .describe("Cap applied PER source (programs/blog posts), not to the combined total."),
  })
  .strict();
export type PublicSearchQuery = z.infer<typeof PublicSearchQuerySchema>;

/** One normalized search hit — minimal, deep-link-only shape (mirrors PublicProgramSummary/PublicBlogPostSummary's public-safe fields only). */
export const PublicSearchResultItemSchema = z.object({
  type: PublicSearchResultTypeSchema,
  id: UuidSchema,
  slug: z.string().describe("SEO slug. /programs/:slug or /blog/:slug depending on `type`."),
  title: z.string(),
  snippet: z.string().nullable().describe("Short excerpt (program cardSummary or blog excerpt)."),
  imageUrl: z.string().url().nullable().describe("CDN URL (program ogImageUrl or blog coverImageUrl)."),
});
export type PublicSearchResultItem = z.infer<typeof PublicSearchResultItemSchema>;

export const PublicSearchResponseSchema = z.object({
  results: z.array(PublicSearchResultItemSchema),
});
export type PublicSearchResponse = z.infer<typeof PublicSearchResponseSchema>;
