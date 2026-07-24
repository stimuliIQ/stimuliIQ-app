// Typed PUBLIC global-search SDK — Phase 9 Completion T30 follow-up. Namespace:
// client.public.search.*
//
// NO dedicated backend search route exists for the public surface (see @repo/types
// public/search.schemas.ts file header). This is a CLIENT-SIDE COMPOSITION over two
// existing public reads, issued in parallel:
//   - GET /api/v1/public/blog/posts  — supports a real server-side `search` param.
//   - GET /api/v1/public/programs    — does NOT expose a free-text search/`q` param
//     server-side today (ListPublicProgramsQuerySchema has only domain/level/mode/
//     duration/price-band/sort/cursor filters). Program matches are therefore found by
//     fetching a page of the (sorted, unfiltered-by-text) public catalog and filtering
//     client-side on a case-insensitive substring match against `title`/`cardSummary`.
//     This is a DOCUMENTED LIMITATION, not a bug: if/when the backend grows a real
//     full-text program search endpoint, swap this leg for a direct server-side call
//     without changing the `PublicSearchResponse` shape callers consume.

import type { PublicSearchQuery, PublicSearchResponse, PublicSearchResultItem } from "@repo/types";
import type { ApiClient } from "../http/client.js";
import { PublicProgramsApi } from "./programs.api.js";
import { PublicContentApi } from "./content.api.js";

export class PublicSearchApi {
  private readonly programsApi: PublicProgramsApi;
  private readonly contentApi: PublicContentApi;

  constructor(client: ApiClient) {
    this.programsApi = new PublicProgramsApi(client);
    this.contentApi = new PublicContentApi(client);
  }

  /**
   * Composes GET /api/v1/public/programs + GET /api/v1/public/blog/posts into a
   * single normalized result set. `query.types` (comma-separated `program`/
   * `blog_post`) controls which source(s) are queried; omit for both. NOT a single
   * backend round-trip.
   */
  async search(query: PublicSearchQuery): Promise<PublicSearchResponse> {
    const types = query.types
      ? query.types.split(",").map((t) => t.trim())
      : (["program", "blog_post"] as const);
    const limit = query.limit ?? 20;
    const needle = query.q.trim().toLowerCase();

    const [programItems, blogItems] = await Promise.all([
      types.includes("program")
        ? this.programsApi.list({ sort: "popularity", limit }).then((r) => r.items)
        : Promise.resolve([]),
      types.includes("blog_post")
        ? this.contentApi.blog.list({ search: query.q, limit }).then((r) => r.items)
        : Promise.resolve([]),
    ]);

    const programResults: PublicSearchResultItem[] = programItems
      .filter(
        (p) =>
          p.title.toLowerCase().includes(needle) ||
          (p.cardSummary?.toLowerCase().includes(needle) ?? false),
      )
      .map((p) => ({
        type: "program" as const,
        id: p.id,
        slug: p.slug,
        title: p.title,
        snippet: p.cardSummary,
        imageUrl: p.ogImageUrl,
      }));

    const blogResults: PublicSearchResultItem[] = blogItems.map((b) => ({
      type: "blog_post" as const,
      id: b.id,
      slug: b.slug,
      title: b.title,
      snippet: b.excerpt,
      imageUrl: b.coverImageUrl,
    }));

    return { results: [...programResults, ...blogResults] };
  }
}
