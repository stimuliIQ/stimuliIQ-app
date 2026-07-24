// apps/api/src/modules/bookmarks/bookmarks.service.ts
//
// Business logic for own-scope LMS bookmarks (docs/plans/phase-9-completion.md T29).
// No Prisma here — delegates to BookmarksRepository. Own-scope is NOT resolved via
// ScopeInterceptor/requireScopeContext (there is no branch/assigned/all dimension for a
// personal bookmark — it is always exactly the authenticated user's own row); userId is
// taken from the session (CurrentUser), never trusted from the client body.

import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { Bookmark } from "@repo/types";
import { BookmarksRepository, type BookmarkRow } from "./bookmarks.repository";
import { PaginatedResult } from "../../common/dto/paginated-result";
import type { CreateBookmarkRequest, ListBookmarksQuery } from "./dto";

@Injectable()
export class BookmarksService {
  constructor(private readonly repository: BookmarksRepository) {}

  async create(tenantId: string, userId: string, body: CreateBookmarkRequest): Promise<Bookmark> {
    // Idempotent-create: re-bookmarking the same (refType, refId) is a conflict, not a
    // silent duplicate — the client should PATCH/DELETE the existing bookmark instead.
    const existing = await this.repository.findExisting(tenantId, userId, body.refType, body.refId);
    if (existing) {
      throw new ConflictException({
        code: "bookmarks.already_exists",
        title: "Already bookmarked",
        detail: "This item is already bookmarked.",
      });
    }

    const row = await this.repository.create({
      tenantId,
      userId,
      refType: body.refType,
      refId: body.refId,
      note: body.note,
      timestampS: body.timestampS,
    });
    return toDto(row);
  }

  async list(tenantId: string, userId: string, query: ListBookmarksQuery): Promise<PaginatedResult<Bookmark>> {
    const { rows, total } = await this.repository.list({
      tenantId,
      userId,
      refType: query.refType,
      page: query.page,
      pageSize: query.pageSize,
    });

    return new PaginatedResult(rows.map(toDto), {
      page: query.page,
      pageSize: query.pageSize,
      total,
      hasMore: query.page * query.pageSize < total,
    });
  }

  async remove(tenantId: string, userId: string, id: string): Promise<void> {
    // IDOR -> 404: an out-of-scope (not-this-user's) bookmark id is indistinguishable
    // from a nonexistent one.
    const existing = await this.repository.findById(tenantId, userId, id);
    if (!existing) {
      throw new NotFoundException({ code: "bookmarks.not_found", title: "Bookmark not found" });
    }
    await this.repository.softDelete(id);
  }
}

function toDto(row: BookmarkRow): Bookmark {
  return {
    id: row.id,
    refType: row.refType,
    refId: row.refId,
    refTitle: row.refTitle,
    note: row.note,
    timestampS: row.timestampS,
    createdAt: row.createdAt.toISOString(),
  };
}
