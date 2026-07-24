// Typed bookmarks SDK (own-scope) — Phase 9 Completion, T10/T14/T29.

import type { CreateBookmarkRequest, ListBookmarksQuery, Bookmark } from "@repo/types";
import type { ApiClient } from "../http/client.js";
import { toQueryString } from "../http/query.js";

export class BookmarksApi {
  constructor(private readonly client: ApiClient) {}

  /** GET /api/v1/me/bookmarks */
  async list(query: ListBookmarksQuery) {
    return this.client.requestPaginated<Bookmark>("GET", `/api/v1/me/bookmarks${toQueryString(query)}`);
  }

  /** POST /api/v1/me/bookmarks */
  async create(body: CreateBookmarkRequest, idempotencyKey: string = crypto.randomUUID()): Promise<Bookmark> {
    return this.client.request<Bookmark>("POST", "/api/v1/me/bookmarks", { body, idempotencyKey });
  }

  /** DELETE /api/v1/me/bookmarks/:id — IDOR->404 on another user's bookmark. */
  // 204 No Content — nothing is returned.
  async remove(id: string, idempotencyKey: string = crypto.randomUUID()): Promise<void> {
    await this.client.request<void>("DELETE", `/api/v1/me/bookmarks/${id}`, { idempotencyKey });
  }
}
