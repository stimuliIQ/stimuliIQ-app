// apps/api/src/modules/search/search.repository.ts
//
// Prisma data access for GET /me/search (docs/plans/phase-9-completion.md T29,
// packages/types/src/lms/search.schemas.ts). Uses raw SQL against the `search_vector`
// GENERATED ALWAYS AS ... STORED tsvector columns added in the
// `20260709090000_search_tsvector_index` migration (NOT represented in schema.prisma —
// see that migration's header comment) — Prisma's query builder has no tsvector/
// `@@` operator support, so this is the one repository in the codebase that legitimately
// uses `$queryRaw` for its primary read path.
//
// SECURITY (own-enrolled scope, never re-derivable by the caller):
//   - Every query is tenant-scoped (`programs.tenant_id` / `forum_threads.tenant_id`).
//   - Lessons/resources are restricted to `module.program_id IN (caller's enrolled
//     program ids)` — resolved server-side from the JWT subject, never trusted from
//     the query string.
//   - Forum threads are restricted to `(batch_id IN enrolled batch ids) OR
//     (program_id IN enrolled program ids)` — the same "owned OR program-level" shape
//     ForumService's own enrollment gate uses.
//   - Raw SQL bypasses the soft-delete Prisma extension — every query below explicitly
//     filters `deleted_at IS NULL` on every joined table.
//   - `plainto_tsquery` is parameterized (never string-concatenated) — no SQL injection
//     surface from the free-text query.

import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";

export interface SearchHitRow {
  type: "lesson" | "resource" | "forum_thread";
  id: string;
  title: string;
  snippet: string | null;
  programId: string | null;
  programTitle: string | null;
}

interface RawHit {
  id: string;
  title: string;
  snippet: string | null;
  programId: string | null;
  programTitle: string | null;
}

@Injectable()
export class SearchRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Enrolled (active) program ids for a student — the search scope boundary. */
  async findEnrolledProgramIds(tenantId: string, studentId: string): Promise<string[]> {
    const rows = await this.prisma.client.enrollment.findMany({
      where: { tenantId, studentId, status: "active" },
      select: { programId: true },
      distinct: ["programId"],
    });
    return rows.map((r) => r.programId);
  }

  /** Enrolled (active) batch ids for a student — used for batch-scoped forum threads. */
  async findEnrolledBatchIds(tenantId: string, studentId: string): Promise<string[]> {
    const rows = await this.prisma.client.enrollment.findMany({
      where: { tenantId, studentId, status: "active" },
      select: { batchId: true },
      distinct: ["batchId"],
    });
    return rows.map((r) => r.batchId);
  }

  async searchLessons(tenantId: string, programIds: string[], q: string, limit: number): Promise<SearchHitRow[]> {
    if (programIds.length === 0) return [];
    const rows = await this.prisma.client.$queryRaw<RawHit[]>(Prisma.sql`
      SELECT l.id AS "id", l.title AS "title",
        ts_headline('english', coalesce(l.content, l.title), plainto_tsquery('english', ${q}),
          'MaxWords=25,MinWords=8,ShortWord=3,MaxFragments=1') AS "snippet",
        m.program_id AS "programId", p.title AS "programTitle"
      FROM lessons l
      JOIN modules m ON m.id = l.module_id AND m.deleted_at IS NULL
      JOIN programs p ON p.id = m.program_id AND p.deleted_at IS NULL
      WHERE p.tenant_id = ${tenantId}::uuid
        AND l.deleted_at IS NULL
        AND m.program_id = ANY(${programIds}::uuid[])
        AND l.search_vector @@ plainto_tsquery('english', ${q})
      ORDER BY ts_rank(l.search_vector, plainto_tsquery('english', ${q})) DESC
      LIMIT ${limit}
    `);
    return rows.map((r) => ({ type: "lesson" as const, ...r }));
  }

  async searchResources(tenantId: string, programIds: string[], q: string, limit: number): Promise<SearchHitRow[]> {
    if (programIds.length === 0) return [];
    const rows = await this.prisma.client.$queryRaw<RawHit[]>(Prisma.sql`
      SELECT r.id AS "id", r.title AS "title",
        NULL::text AS "snippet",
        m.program_id AS "programId", p.title AS "programTitle"
      FROM resources r
      JOIN lessons l ON l.id = r.lesson_id AND l.deleted_at IS NULL
      JOIN modules m ON m.id = l.module_id AND m.deleted_at IS NULL
      JOIN programs p ON p.id = m.program_id AND p.deleted_at IS NULL
      WHERE r.tenant_id = ${tenantId}::uuid
        AND r.deleted_at IS NULL
        AND m.program_id = ANY(${programIds}::uuid[])
        AND r.search_vector @@ plainto_tsquery('english', ${q})
      ORDER BY ts_rank(r.search_vector, plainto_tsquery('english', ${q})) DESC
      LIMIT ${limit}
    `);
    return rows.map((r) => ({ type: "resource" as const, ...r }));
  }

  async searchForumThreads(
    tenantId: string,
    programIds: string[],
    batchIds: string[],
    q: string,
    limit: number,
  ): Promise<SearchHitRow[]> {
    if (programIds.length === 0 && batchIds.length === 0) return [];
    const rows = await this.prisma.client.$queryRaw<RawHit[]>(Prisma.sql`
      SELECT t.id AS "id", t.title AS "title",
        ts_headline('english', t.title, plainto_tsquery('english', ${q}),
          'MaxWords=25,MinWords=8,ShortWord=3,MaxFragments=1') AS "snippet",
        t.program_id AS "programId", p.title AS "programTitle"
      FROM forum_threads t
      LEFT JOIN programs p ON p.id = t.program_id AND p.deleted_at IS NULL
      WHERE t.tenant_id = ${tenantId}::uuid
        AND t.deleted_at IS NULL
        AND (t.batch_id = ANY(${batchIds}::uuid[]) OR t.program_id = ANY(${programIds}::uuid[]))
        AND t.search_vector @@ plainto_tsquery('english', ${q})
      ORDER BY ts_rank(t.search_vector, plainto_tsquery('english', ${q})) DESC
      LIMIT ${limit}
    `);
    return rows.map((r) => ({ type: "forum_thread" as const, ...r }));
  }
}
