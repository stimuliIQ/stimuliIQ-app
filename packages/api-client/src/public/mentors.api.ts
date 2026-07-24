// Public mentors directory SDK — GET /public/mentors (web /mentors page).
//
// Namespace: client.public.mentors.*
//
// Security contract:
//   - UNAUTHENTICATED public read (no cookieAuth, no CSRF).
//   - Backend lists ONLY engagementStatus=active, non-deleted CRM mentors and
//     projects the PublicMentorCard allowlist (fullName + externalInstitute +
//     expertise) — no email/phone/status/internal fields on the wire.
//
// Pagination: cursor-based (PaginationMeta: nextCursor + hasMore) per docs/04 §2.14.

import type { PublicMentorCard, ListPublicMentorsQuery } from "@repo/types";
import type { ApiClient } from "../http/client.js";
import { toQueryString } from "../http/query.js";

/** Cursor-paginated list result returned by list(). */
export interface PublicMentorListResult {
  items: PublicMentorCard[];
  meta: { nextCursor: string | null; hasMore: boolean };
}

export class PublicMentorsApi {
  constructor(private readonly client: ApiClient) {}

  /**
   * GET /api/v1/public/mentors
   *
   * Cursor-paginated public mentors directory (active CRM mentors only).
   *
   * @param query - cursor + limit.
   * @returns items (PublicMentorCard[]) + meta (nextCursor + hasMore).
   *
   * Authentication: None (anonymous public read).
   */
  async list(query?: Partial<ListPublicMentorsQuery>): Promise<PublicMentorListResult> {
    return this.client.requestCursorPaginated<PublicMentorCard>(
      "GET",
      `/api/v1/public/mentors${toQueryString(query ?? {})}`,
    );
  }

  /**
   * GET /api/v1/public/mentors/:id
   *
   * Single active mentor's public profile (the /mentors/:id detail page). 404 for
   * a prospective/inactive/deleted/unknown id.
   *
   * Authentication: None (anonymous public read).
   */
  async get(id: string): Promise<PublicMentorCard> {
    return this.client.request<PublicMentorCard>(
      "GET",
      `/api/v1/public/mentors/${encodeURIComponent(id)}`,
    );
  }
}
