// apps/api/src/modules/content/content-page-versions.repository.ts
//
// Prisma data access ONLY (CLAUDE.md §3.3) for `ContentPageVersion` — the immutable
// snapshot history backing the page-builder save/revert flow (docs/specs/
// phase-10-page-builder.md AC 6/7). `ContentPagesBuilderService` is the only caller.
//
// `applyWithVersionSnapshot` is the single write path used by BOTH save and revert —
// the spec's "save-before-apply" semantics (write the row's PRE-mutation state as
// version `expectedVersion+1`, THEN apply the new content live) are identical for
// both operations; only the CONTENT being applied differs (client-submitted for save,
// a prior version's snapshot for revert — see ContentPagesBuilderService). The whole
// operation runs inside one `$transaction` with a `SELECT ... FOR UPDATE` row lock —
// same race-safe compare-and-set pattern as
// `mentors/batch-completion.repository.ts#markComplete` — so two concurrent saves can
// never both "win": the loser's `expectedVersion` no longer matches the
// (now-incremented) version count once it acquires the lock, and it is told to
// reload (409, Edge case #5).

import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import type { ContentPageRow } from "./content-pages.repository";

export interface ContentPageVersionRow {
  version: number;
  title: string;
  body: Prisma.JsonValue;
  seoTitle: string | null;
  seoDescription: string | null;
  seoImagePath: string | null;
  createdBy: { id: string; name: string };
  createdAt: Date;
}

interface VersionInclude {
  version: number;
  title: string;
  body: Prisma.JsonValue;
  seoTitle: string | null;
  seoDescription: string | null;
  seoImagePath: string | null;
  createdAt: Date;
  createdBy: { id: string; name: string };
}

function toVersionRow(row: VersionInclude): ContentPageVersionRow {
  return {
    version: row.version,
    title: row.title,
    body: row.body,
    seoTitle: row.seoTitle,
    seoDescription: row.seoDescription,
    seoImagePath: row.seoImagePath,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
}

/** Raw-SQL row shape from the `FOR UPDATE` lock query below (snake_case DB columns). */
interface LockedPageRow {
  id: string;
  title: string;
  body: unknown;
  seo_title: string | null;
  seo_description: string | null;
  seo_image_path: string | null;
  is_builder_managed: boolean;
}

export type ApplyVersionSnapshotResult =
  | { ok: true; newVersion: number; row: ContentPageRow }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "version_conflict"; currentVersion: number };

@Injectable()
export class ContentPageVersionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(filters: { tenantId: string; contentPageId: string; page: number; pageSize: number }): Promise<{ rows: ContentPageVersionRow[]; total: number }> {
    const where: Prisma.ContentPageVersionWhereInput = {
      tenantId: filters.tenantId,
      contentPageId: filters.contentPageId,
      deletedAt: null,
    };
    const [rows, total] = await Promise.all([
      this.prisma.client.contentPageVersion.findMany({
        where,
        orderBy: { version: "desc" },
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
        include: { createdBy: { select: { id: true, name: true } } },
      }),
      this.prisma.client.contentPageVersion.count({ where }),
    ]);
    return { rows: rows.map(toVersionRow), total };
  }

  async findVersionByNumber(tenantId: string, contentPageId: string, version: number): Promise<ContentPageVersionRow | null> {
    const row = await this.prisma.client.contentPageVersion.findFirst({
      where: { tenantId, contentPageId, version, deletedAt: null },
      include: { createdBy: { select: { id: true, name: true } } },
    });
    return row ? toVersionRow(row) : null;
  }

  async countVersions(tenantId: string, contentPageId: string): Promise<number> {
    return this.prisma.client.contentPageVersion.count({ where: { tenantId, contentPageId, deletedAt: null } });
  }

  /**
   * Atomically: (1) locks the page row, (2) compares `expectedVersion` against the
   * live version count, (3) on match, snapshots the row's CURRENT (pre-mutation) state
   * as a new version, then (4) applies `next` to the live row and forces
   * `status='published'` (save-is-live, AC 5). Returns a discriminated result — the
   * SERVICE layer maps `not_found`/`version_conflict` to 404/409 respectively (mirrors
   * `BatchCompletionRepository.markComplete`'s "repository executes the compare-and-set,
   * service decides the HTTP-level meaning" split).
   */
  async applyWithVersionSnapshot(
    tenantId: string,
    pageId: string,
    expectedVersion: number,
    next: { title: string; body: Prisma.InputJsonValue; seoTitle: string | null; seoDescription: string | null; seoImagePath: string | null },
    actorId: string,
  ): Promise<ApplyVersionSnapshotResult> {
    return this.prisma.client.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<LockedPageRow[]>`
        SELECT id, title, body, seo_title, seo_description, seo_image_path, is_builder_managed
        FROM content_pages
        WHERE id = ${pageId}::uuid AND tenant_id = ${tenantId}::uuid AND deleted_at IS NULL
        FOR UPDATE`;
      const lockedRow = locked[0];
      if (!lockedRow || !lockedRow.is_builder_managed) {
        return { ok: false, reason: "not_found" } as const;
      }

      const currentVersion = await tx.contentPageVersion.count({
        where: { tenantId, contentPageId: pageId, deletedAt: null },
      });

      if (currentVersion !== expectedVersion) {
        return { ok: false, reason: "version_conflict", currentVersion } as const;
      }

      // SAVE-BEFORE-APPLY (docs/specs/phase-10-page-builder.md, pages.schemas.ts header):
      // snapshot the row's PRE-mutation state (as locked above) as version N+1 — BEFORE
      // the new content is applied.
      await tx.contentPageVersion.create({
        data: {
          tenantId,
          contentPageId: pageId,
          version: currentVersion + 1,
          title: lockedRow.title,
          body: lockedRow.body as Prisma.InputJsonValue,
          seoTitle: lockedRow.seo_title,
          seoDescription: lockedRow.seo_description,
          seoImagePath: lockedRow.seo_image_path,
          createdById: actorId,
        },
      });

      const updated = await tx.contentPage.update({
        where: { id: pageId },
        data: {
          title: next.title,
          body: next.body,
          seoTitle: next.seoTitle,
          seoDescription: next.seoDescription,
          seoImagePath: next.seoImagePath,
          status: "published",
          publishedAt: new Date(),
        },
      });

      return { ok: true, newVersion: currentVersion + 1, row: updated } as const;
    });
  }
}
