// apps/api/src/modules/bookmarks/bookmarks.repository.ts
//
// Prisma data access ONLY for `bookmarks` (docs/04-trd-architecture.md §2.1). Every
// query is tenant-scoped AND user-scoped (own-scope only — CLAUDE.md §3.5: RBAC is
// server-side; a student can only ever see/mutate their OWN bookmarks, enforced here
// via `userId` in every WHERE clause, never trusted from a client-supplied field).
//
// `refType` is open-ended (see Bookmark model doc comment in schema.prisma). This
// repository resolves a best-effort denormalized `refTitle` for the known ref types
// (`lesson`, `video_timestamp` — both point at a lesson id; `forum_thread`) so the
// LMS UI can render a human title without a second round-trip. Unknown ref types
// resolve to `refTitle: null` rather than failing the request — the bookmark itself
// still round-trips correctly by id.

import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

export interface BookmarkRow {
  id: string;
  refType: string;
  refId: string;
  refTitle: string | null;
  note: string | null;
  timestampS: number | null;
  createdAt: Date;
}

const LESSON_REF_TYPES = new Set(["lesson", "video_timestamp"]);

@Injectable()
export class BookmarksRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Best-effort denormalized title lookup for known ref types. Tenant-scoped. */
  private async resolveRefTitle(tenantId: string, refType: string, refId: string): Promise<string | null> {
    if (LESSON_REF_TYPES.has(refType)) {
      const lesson = await this.prisma.client.lesson.findFirst({
        where: { id: refId, module: { program: { tenantId } } },
        select: { title: true },
      });
      return lesson?.title ?? null;
    }
    if (refType === "forum_thread") {
      const thread = await this.prisma.client.forumThread.findFirst({
        where: { id: refId, tenantId },
        select: { title: true },
      });
      return thread?.title ?? null;
    }
    return null;
  }

  async create(args: {
    tenantId: string;
    userId: string;
    refType: string;
    refId: string;
    note?: string;
    timestampS?: number;
  }): Promise<BookmarkRow> {
    const row = await this.prisma.client.bookmark.create({
      data: {
        tenantId: args.tenantId,
        userId: args.userId,
        refType: args.refType,
        refId: args.refId,
        note: args.note,
        timestampS: args.timestampS,
      },
    });
    const refTitle = await this.resolveRefTitle(args.tenantId, row.refType, row.refId);
    return toRow(row, refTitle);
  }

  /** Existing (non-deleted) bookmark for the same (user, refType, refId) — idempotent-create check. */
  async findExisting(tenantId: string, userId: string, refType: string, refId: string): Promise<{ id: string } | null> {
    return this.prisma.client.bookmark.findFirst({
      where: { tenantId, userId, refType, refId },
      select: { id: true },
    });
  }

  async list(args: {
    tenantId: string;
    userId: string;
    refType?: string;
    page: number;
    pageSize: number;
  }): Promise<{ rows: BookmarkRow[]; total: number }> {
    const where = {
      tenantId: args.tenantId,
      userId: args.userId,
      ...(args.refType ? { refType: args.refType } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.client.bookmark.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (args.page - 1) * args.pageSize,
        take: args.pageSize,
      }),
      this.prisma.client.bookmark.count({ where }),
    ]);

    const withTitles = await Promise.all(
      rows.map(async (row) => toRow(row, await this.resolveRefTitle(args.tenantId, row.refType, row.refId))),
    );

    return { rows: withTitles, total };
  }

  /** IDOR-safe by-id lookup: scoped to (tenantId, userId) — an out-of-scope id returns null. */
  async findById(tenantId: string, userId: string, id: string): Promise<BookmarkRow | null> {
    const row = await this.prisma.client.bookmark.findFirst({ where: { id, tenantId, userId } });
    if (!row) return null;
    return toRow(row, await this.resolveRefTitle(tenantId, row.refType, row.refId));
  }

  async softDelete(id: string): Promise<void> {
    await this.prisma.client.bookmark.delete({ where: { id } }); // rewritten to soft-delete by the extension.
  }
}

function toRow(
  row: { id: string; refType: string; refId: string; note: string | null; timestampS: number | null; createdAt: Date },
  refTitle: string | null,
): BookmarkRow {
  return {
    id: row.id,
    refType: row.refType,
    refId: row.refId,
    refTitle,
    note: row.note,
    timestampS: row.timestampS,
    createdAt: row.createdAt,
  };
}
