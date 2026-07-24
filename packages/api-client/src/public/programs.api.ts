// Public programs SDK — Phase 5, Wave 2 (docs/plans/phase-5.md task #2).
//
// Namespace: client.public.programs.*
//
// Endpoints covered:
//   P-1: GET /public/programs       → list()  (cursor-paginated, filters + sort)
//   P-2: GET /public/programs/:slug → getBySlug()
//
// Security contract:
//   - Both endpoints are UNAUTHENTICATED (no cookieAuth, no CSRF required).
//   - The client passes no auth headers; the backend resolves tenant server-side.
//   - Response projection is strictly the public allowlist (compile-time asserted in
//     @repo/types/public/programs.schemas.ts): no status, no isPublic, no ogImageKey,
//     no tenantId, no draft/internal fields. ogImageUrl is a CDN URL minted server-side.
//   - GET /public/programs/:slug returns 404 for draft or non-is_public programs (AC-25).
//
// Pagination: cursor-based (PaginationMeta: nextCursor + hasMore) per docs/04 §2.14.
//   Use the `cursor` param from the previous response's meta.nextCursor to fetch next page.

import type {
  PublicProgramSummary,
  PublicProgramDetail,
  PublicLessonPreviewUrlResponse,
  ListPublicProgramsQuery,
} from "@repo/types";
import type { ApiClient } from "../http/client.js";
import { toQueryString } from "../http/query.js";

/** Cursor-paginated list result returned by list(). */
export interface PublicProgramListResult {
  items: PublicProgramSummary[];
  meta: { nextCursor: string | null; hasMore: boolean };
}

export class PublicProgramsApi {
  constructor(private readonly client: ApiClient) {}

  /**
   * GET /api/v1/public/programs (P-1)
   *
   * Cursor-paginated, filterable, sortable public program catalog.
   * Only programs with status=published AND is_public=true are returned (AC-24).
   *
   * @param query - Filter (domain/level/mode/duration/price band), sort, cursor, limit.
   * @returns items (PublicProgramSummary[]) + meta (nextCursor + hasMore).
   *
   * Authentication: None (anonymous public read).
   */
  async list(
    query?: Partial<ListPublicProgramsQuery>,
  ): Promise<PublicProgramListResult> {
    return this.client.requestCursorPaginated<PublicProgramSummary>(
      "GET",
      `/api/v1/public/programs${toQueryString(query ?? {})}`,
    );
  }

  /**
   * GET /api/v1/public/programs/:slug (P-2)
   *
   * Full public projection for a single program detail/conversion page.
   * Returns 404 for draft programs (status≠published) or non-public programs (AC-25).
   *
   * @param slug - The program's SEO slug (e.g. "full-stack-web-development").
   * @returns PublicProgramDetail with curriculum outline, mentor bios, reviews summary.
   *
   * Authentication: None (anonymous public read).
   */
  async getBySlug(slug: string): Promise<PublicProgramDetail> {
    return this.client.request<PublicProgramDetail>(
      "GET",
      `/api/v1/public/programs/${encodeURIComponent(slug)}`,
    );
  }

  /**
   * GET /public/programs/:slug/lessons/:lessonId/preview-url — anonymous
   * "watch before you enrol" playback for a FREE-PREVIEW lesson.
   *
   * The server 404s unless the program is public+published, the lesson is flagged
   * `isPreview`, and its video is ready — so a paid lesson can never be fetched here.
   * The returned URL is short-TTL and signed: never cache it, re-request on expiry.
   *
   * Authentication: None (anonymous public read).
   */
  async getLessonPreviewUrl(
    slug: string,
    lessonId: string,
  ): Promise<PublicLessonPreviewUrlResponse> {
    return this.client.request<PublicLessonPreviewUrlResponse>(
      "GET",
      `/api/v1/public/programs/${encodeURIComponent(slug)}/lessons/${encodeURIComponent(lessonId)}/preview-url`,
    );
  }
}
