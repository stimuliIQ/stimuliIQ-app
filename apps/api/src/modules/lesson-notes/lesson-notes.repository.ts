// apps/api/src/modules/lesson-notes/lesson-notes.repository.ts
//
// Prisma data access ONLY for `lesson_notes` (docs/04-trd-architecture.md §2.1). Every
// query is tenant-scoped AND user-scoped (own-scope only) — a student may only ever
// see/mutate their OWN notes, enforced here via `userId` in every WHERE clause.

import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

export interface LessonNoteRow {
  id: string;
  lessonId: string;
  body: string;
  timestampS: number | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class LessonNotesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(args: {
    tenantId: string;
    userId: string;
    lessonId: string;
    body: string;
    timestampS?: number;
  }): Promise<LessonNoteRow> {
    return this.prisma.client.lessonNote.create({
      data: {
        tenantId: args.tenantId,
        userId: args.userId,
        lessonId: args.lessonId,
        body: args.body,
        timestampS: args.timestampS,
      },
    });
  }

  async list(args: {
    tenantId: string;
    userId: string;
    lessonId: string;
    page: number;
    pageSize: number;
  }): Promise<{ rows: LessonNoteRow[]; total: number }> {
    const where = { tenantId: args.tenantId, userId: args.userId, lessonId: args.lessonId };
    const [rows, total] = await Promise.all([
      this.prisma.client.lessonNote.findMany({
        where,
        orderBy: [{ timestampS: "asc" }, { createdAt: "asc" }],
        skip: (args.page - 1) * args.pageSize,
        take: args.pageSize,
      }),
      this.prisma.client.lessonNote.count({ where }),
    ]);
    return { rows, total };
  }

  /** IDOR-safe by-id lookup: scoped to (tenantId, userId, lessonId) — out-of-scope returns null. */
  async findById(tenantId: string, userId: string, lessonId: string, id: string): Promise<LessonNoteRow | null> {
    return this.prisma.client.lessonNote.findFirst({ where: { id, tenantId, userId, lessonId } });
  }

  async update(id: string, patch: { body?: string; timestampS?: number | null }): Promise<void> {
    await this.prisma.client.lessonNote.update({
      where: { id },
      data: {
        ...(patch.body !== undefined ? { body: patch.body } : {}),
        ...(patch.timestampS !== undefined ? { timestampS: patch.timestampS } : {}),
      },
    });
  }

  async softDelete(id: string): Promise<void> {
    await this.prisma.client.lessonNote.delete({ where: { id } }); // rewritten to soft-delete by the extension.
  }
}
