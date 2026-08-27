// apps/api/src/modules/courses/courses.repository.ts
//
// Prisma data access ONLY (docs/04-trd-architecture.md §2.1). CoursesService is the only
// caller. `programs` is tenant-scoped directly; `modules`/`lessons` are scoped transitively
// through their parent program (neither table carries a `tenant_id` column — see
// prisma/schema.prisma `Module`/`Lesson`), so every modules/lessons query joins back to
// `programs.tenant_id` to enforce tenant isolation.
//
// SCOPE RESOLUTION (docs/03 §9 + prisma/seed.ts):
//   - "all"      -> tenant-wide. super_admin/admin/content_editor/branch_manager(view-only).
//   - "assigned" -> faculty is seeded `courses.view/create/edit` at scope=assigned, intended
//                    to mean "programs this faculty member authors/is assigned to teach" —
//                    BUT `programs` has NO author/owner column in the P1 schema (confirmed:
//                    no `created_by`/`author_id` field). THIS SCOPE FAILS CLOSED in the
//                    service layer (Wave 3b follow-up: add `programs.created_by` or derive
//                    "assigned" from `batches.facultyId` linkage once batches exists).
//   - "branch"/"own" -> not seeded for the courses module in P1; not implemented here.

import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";

export interface ListProgramsFilters {
  tenantId: string;
  search?: string;
  domain?: string;
  level?: string;
  status?: string;
  includeDeleted: boolean;
  page: number;
  pageSize: number;
}

export interface ProgramRow {
  id: string;
  slug: string;
  title: string;
  domain: string;
  level: string | null;
  mode: string;
  durationWeeks: number | null;
  pricePaise: number;
  compareAtPricePaise: number | null;
  emi: unknown;
  summary: string | null;
  seo: unknown;
  status: string;
  isPublic: boolean;
  cardSummary: string | null;
  outcomes: unknown;
  ogImageKey: string | null;
  brochureKey: string | null;
  scholarshipAvailable: boolean;
  enrollmentEnabled: boolean;
  enrollmentPaymentUrl: string | null;
  order: number;
  badgeColor: string | null;
  badgeLabel: string | null;
  badgeEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface ModuleRow {
  id: string;
  programId: string;
  title: string;
  order: number;
}

export interface LessonRow {
  id: string;
  moduleId: string;
  title: string;
  type: string;
  order: number;
  isPreview: boolean;
  /** Rich body (HTML) for reading/quiz/assignment lessons; null for video. */
  content: string | null;
}

@Injectable()
export class CoursesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(filters: ListProgramsFilters): Promise<{ rows: ProgramRow[]; total: number }> {
    const where: Prisma.ProgramWhereInput = {
      tenantId: filters.tenantId,
      ...(filters.domain ? { domain: filters.domain } : {}),
      ...(filters.level ? { level: filters.level } : {}),
      ...(filters.status ? { status: filters.status as Prisma.ProgramWhereInput["status"] } : {}),
      // The soft-delete extension re-injects `deletedAt: null` for any `where` missing
      // the `deletedAt` KEY entirely — `deletedAt: undefined` (a present key) is required
      // to actually opt out when `includeDeleted` is true (see findById() below).
      deletedAt: filters.includeDeleted ? undefined : null,
      ...(filters.search
        ? {
            OR: [
              { title: { contains: filters.search, mode: "insensitive" } },
              { slug: { contains: filters.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.client.program.findMany({
        where,
        // Same sequence the public site renders, so the CRM table shows staff exactly what
        // they are curating. (It sorted newest-first before `order` existed, which meant
        // the list staff reordered against never matched the one visitors saw.)
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
      this.prisma.client.program.count({ where }),
    ]);

    return { rows, total };
  }

  async findById(tenantId: string, id: string, includeDeleted = false): Promise<ProgramRow | null> {
    // See the `list()` comment above: `deletedAt: undefined` (a present key) is required
    // to opt out of the soft-delete extension's auto-injected filter.
    return this.prisma.client.program.findFirst({
      where: { id, tenantId, deletedAt: includeDeleted ? undefined : null },
    });
  }

  async findBySlug(tenantId: string, slug: string): Promise<{ id: string } | null> {
    return this.prisma.client.program.findFirst({ where: { tenantId, slug }, select: { id: true } });
  }

  async create(
    tenantId: string,
    data: {
      slug: string;
      title: string;
      domain: string;
      level: string;
      mode: string;
      durationWeeks: number;
      pricePaise: number;
      compareAtPricePaise?: number | null;
      emi: unknown;
      summary?: string;
      seo?: unknown;
      status: string;
      cardSummary?: string;
      outcomes?: string[];
      ogImageKey?: string;
      brochureKey?: string;
      scholarshipAvailable?: boolean;
      enrollmentEnabled?: boolean;
      enrollmentPaymentUrl?: string | null;
      // Computed by the service (max(order)+1), never accepted from the client.
      order: number;
      badgeColor?: string | null;
      badgeLabel?: string | null;
      badgeEnabled?: boolean;
    },
  ): Promise<ProgramRow> {
    return this.prisma.client.program.create({
      data: {
        tenantId,
        slug: data.slug,
        title: data.title,
        domain: data.domain,
        level: data.level,
        mode: data.mode as Prisma.ProgramCreateInput["mode"],
        durationWeeks: data.durationWeeks,
        pricePaise: data.pricePaise,
        compareAtPricePaise: data.compareAtPricePaise ?? null,
        emi: data.emi as Prisma.InputJsonValue,
        summary: data.summary,
        seo: data.seo as Prisma.InputJsonValue,
        status: data.status as Prisma.ProgramCreateInput["status"],
        cardSummary: data.cardSummary,
        ...(data.outcomes !== undefined
          ? { outcomes: data.outcomes as Prisma.InputJsonValue }
          : {}),
        ogImageKey: data.ogImageKey,
        brochureKey: data.brochureKey,
        scholarshipAvailable: data.scholarshipAvailable ?? false,
        // Defaults TRUE — a new program is sellable unless enrollment is explicitly closed.
        enrollmentEnabled: data.enrollmentEnabled ?? true,
        enrollmentPaymentUrl: data.enrollmentPaymentUrl ?? null,
        order: data.order,
        badgeColor: data.badgeColor ?? null,
        badgeLabel: data.badgeLabel ?? null,
        badgeEnabled: data.badgeEnabled ?? false,
      },
    });
  }

  async update(
    id: string,
    patch: Partial<{
      slug: string;
      title: string;
      domain: string;
      level: string;
      mode: string;
      durationWeeks: number;
      pricePaise: number;
      compareAtPricePaise: number | null;
      emi: unknown;
      summary: string;
      seo: unknown;
      cardSummary: string;
      outcomes: string[];
      // null clears the image (UpdateProgramRequest's ogImageKey: string | null)
      ogImageKey: string | null;
      // null removes the brochure (UpdateProgramRequest's brochureKey: string | null)
      brochureKey: string | null;
      scholarshipAvailable: boolean;
      enrollmentEnabled: boolean;
      // null clears the payment link (back to the in-app checkout)
      enrollmentPaymentUrl: string | null;
      // null clears the badge colour (UpdateProgramRequest's badgeColor: hex | null)
      badgeColor: string | null;
      badgeLabel: string | null;
      badgeEnabled: boolean;
    }>,
  ): Promise<ProgramRow> {
    // `order` is intentionally absent from this patch type — it is rewritten only by
    // reorderPrograms(), so an edit can never silently move a program in the sequence.
    const { mode, emi, seo, outcomes, ...rest } = patch;
    return this.prisma.client.program.update({
      where: { id },
      data: {
        ...rest,
        ...(mode ? { mode: mode as Prisma.ProgramUpdateInput["mode"] } : {}),
        ...(emi !== undefined ? { emi: emi as Prisma.InputJsonValue } : {}),
        ...(seo !== undefined ? { seo: seo as Prisma.InputJsonValue } : {}),
        ...(outcomes !== undefined ? { outcomes: outcomes as Prisma.InputJsonValue } : {}),
      },
    });
  }

  /**
   * Highest `order` currently in use for the tenant, or -1 when the tenant has no programs
   * (so a caller's `+ 1` yields 0 for the very first program). Includes soft-deleted rows:
   * reusing a deleted program's slot would collide if it were ever restored.
   */
  async findMaxOrder(tenantId: string): Promise<number> {
    const result = await this.prisma.client.program.aggregate({
      where: { tenantId, deletedAt: undefined },
      _max: { order: true },
    });
    return result._max.order ?? -1;
  }

  /** Ids from `ids` that actually belong to this tenant — the caller compares counts. */
  async findManyByIds(tenantId: string, ids: string[]): Promise<{ id: string }[]> {
    return this.prisma.client.program.findMany({
      where: { id: { in: ids }, tenantId },
      select: { id: true },
    });
  }

  /**
   * Rewrite `order` from array position, transactionally. Same full-list-replace contract
   * as reorderModules: the caller sends every id, so the resulting sequence is always
   * gap-free and no partial-reorder race can interleave two clients' writes.
   */
  async reorderPrograms(programIds: string[]): Promise<void> {
    await this.prisma.client.$transaction(
      programIds.map((id, index) =>
        this.prisma.client.program.update({ where: { id }, data: { order: index } }),
      ),
    );
  }

  async setStatus(id: string, status: "draft" | "published" | "archived"): Promise<ProgramRow> {
    return this.prisma.client.program.update({ where: { id }, data: { status } });
  }

  /** Flip the marketing `is_public` flag (website visibility). */
  async setVisibility(id: string, isPublic: boolean): Promise<ProgramRow> {
    return this.prisma.client.program.update({ where: { id }, data: { isPublic } });
  }

  /** Full curriculum tree for a program — modules (ordered) with their lessons (ordered). */
  async getCurriculumTree(programId: string): Promise<{ modules: (ModuleRow & { lessons: LessonRow[] })[] }> {
    const modules = await this.prisma.client.module.findMany({
      where: { programId, deletedAt: null },
      orderBy: { order: "asc" },
      include: { lessons: { where: { deletedAt: null }, orderBy: { order: "asc" } } },
    });

    return {
      modules: modules.map((mod) => ({
        id: mod.id,
        programId: mod.programId,
        title: mod.title,
        order: mod.order,
        lessons: mod.lessons.map((lesson) => ({
          id: lesson.id,
          moduleId: lesson.moduleId,
          title: lesson.title,
          type: lesson.type,
          order: lesson.order,
          isPreview: lesson.isPreview,
          content: lesson.content,
        })),
      })),
    };
  }

  /** Verifies a module belongs to the given (tenant-scoped) program — the join used to enforce tenant isolation on modules. */
  async findModuleInProgram(tenantId: string, programId: string, moduleId: string): Promise<ModuleRow | null> {
    const mod = await this.prisma.client.module.findFirst({
      where: { id: moduleId, programId, deletedAt: null, program: { tenantId } },
    });
    return mod ? { id: mod.id, programId: mod.programId, title: mod.title, order: mod.order } : null;
  }

  async createModule(programId: string, data: { title: string; order: number }): Promise<ModuleRow> {
    const mod = await this.prisma.client.module.create({
      data: { programId, title: data.title, order: data.order },
    });
    return { id: mod.id, programId: mod.programId, title: mod.title, order: mod.order };
  }

  async updateModule(id: string, patch: Partial<{ title: string; order: number }>): Promise<ModuleRow> {
    const mod = await this.prisma.client.module.update({ where: { id }, data: patch });
    return { id: mod.id, programId: mod.programId, title: mod.title, order: mod.order };
  }

  /** Re-derives `order` from array position for every module id supplied (full-list reorder semantics). */
  async reorderModules(moduleIds: string[]): Promise<void> {
    await this.prisma.client.$transaction(
      moduleIds.map((id, index) => this.prisma.client.module.update({ where: { id }, data: { order: index } })),
    );
  }

  /** Verifies a lesson belongs to the given (tenant-scoped) program+module — the join used to enforce tenant isolation on lessons. */
  async findLessonInModule(
    tenantId: string,
    programId: string,
    moduleId: string,
    lessonId: string,
  ): Promise<LessonRow | null> {
    const lesson = await this.prisma.client.lesson.findFirst({
      where: {
        id: lessonId,
        moduleId,
        deletedAt: null,
        module: { programId, deletedAt: null, program: { tenantId } },
      },
    });
    return lesson
      ? {
          id: lesson.id,
          moduleId: lesson.moduleId,
          title: lesson.title,
          type: lesson.type,
          order: lesson.order,
          isPreview: lesson.isPreview,
          content: lesson.content,
        }
      : null;
  }

  // ─── Lesson resources (PDFs, slides, datasets) ────────────────────────────
  //
  // 1 lesson → MANY resources (unlike video, which is 1:1 via a UNIQUE lesson_id).
  // `storageKey` is written on create and read ONLY by the download-url minter —
  // it is never selected into a client-facing DTO.

  /** Tenant-scoped lesson lookup used to authorise resource writes (IDOR → 404). */
  async findLessonForResourceWrite(
    tenantId: string,
    lessonId: string,
  ): Promise<{ id: string; programId: string } | null> {
    const row = await this.prisma.client.lesson.findFirst({
      where: { id: lessonId, deletedAt: null, module: { program: { tenantId } } },
      select: { id: true, module: { select: { programId: true } } },
    });
    return row ? { id: row.id, programId: row.module.programId } : null;
  }

  async listLessonResources(
    lessonId: string,
  ): Promise<Array<{ id: string; lessonId: string; title: string; type: string; size: number | null; createdAt: Date }>> {
    return this.prisma.client.resource.findMany({
      where: { lessonId, deletedAt: null },
      // storageKey deliberately NOT selected — never leaves the server.
      select: { id: true, lessonId: true, title: true, type: true, size: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
  }

  async createLessonResource(
    tenantId: string,
    lessonId: string,
    data: { title: string; type: string; storageKey: string; sizeBytes: number | null },
  ): Promise<{ id: string; lessonId: string; title: string; type: string; size: number | null; createdAt: Date }> {
    return this.prisma.client.resource.create({
      data: {
        tenantId,
        lessonId,
        title: data.title,
        type: data.type as Prisma.ResourceCreateInput["type"],
        storageKey: data.storageKey,
        size: data.sizeBytes,
      },
      select: { id: true, lessonId: true, title: true, type: true, size: true, createdAt: true },
    });
  }

  /** Tenant-scoped resource lookup for delete (IDOR → 404). */
  async findResourceForWrite(
    tenantId: string,
    resourceId: string,
  ): Promise<{ id: string; lessonId: string; programId: string } | null> {
    const row = await this.prisma.client.resource.findFirst({
      where: { id: resourceId, deletedAt: null, lesson: { module: { program: { tenantId } } } },
      select: { id: true, lessonId: true, lesson: { select: { module: { select: { programId: true } } } } },
    });
    return row ? { id: row.id, lessonId: row.lessonId, programId: row.lesson.module.programId } : null;
  }

  /** Soft delete (CLAUDE.md §3.4) — the stored object is left in place. */
  /**
   * Soft-deletes one lesson. Its video / resources / progress rows are left in place: every
   * reader already filters on the lesson's own deleted_at through the module→lesson joins,
   * and keeping them means a mistaken delete is repairable from the database.
   */
  async softDeleteLesson(lessonId: string): Promise<void> {
    await this.prisma.client.lesson.update({ where: { id: lessonId }, data: { deletedAt: new Date() } });
  }

  /**
   * Soft-deletes a module AND every live lesson in it, atomically — a module with no
   * lessons is what the tree shows, so deleting only the parent would strand lessons that
   * still count in every student's progress denominator.
   */
  async softDeleteModule(moduleId: string): Promise<void> {
    const now = new Date();
    await this.prisma.client.$transaction([
      this.prisma.client.lesson.updateMany({ where: { moduleId, deletedAt: null }, data: { deletedAt: now } }),
      this.prisma.client.module.update({ where: { id: moduleId }, data: { deletedAt: now } }),
    ]);
  }

  async softDeleteResource(resourceId: string): Promise<void> {
    await this.prisma.client.resource.update({
      where: { id: resourceId },
      data: { deletedAt: new Date() },
    });
  }

  async createLesson(
    moduleId: string,
    data: { title: string; type: string; order: number; content?: string; isPreview: boolean },
  ): Promise<LessonRow> {
    const lesson = await this.prisma.client.lesson.create({
      data: {
        moduleId,
        title: data.title,
        type: data.type as Prisma.LessonCreateInput["type"],
        order: data.order,
        content: data.content,
        isPreview: data.isPreview,
      },
    });
    return {
      id: lesson.id,
      moduleId: lesson.moduleId,
      title: lesson.title,
      type: lesson.type,
      order: lesson.order,
      isPreview: lesson.isPreview,
      content: lesson.content,
    };
  }

  async updateLesson(
    id: string,
    patch: Partial<{ title: string; type: string; order: number; content: string; isPreview: boolean }>,
  ): Promise<LessonRow> {
    const { type, ...rest } = patch;
    const lesson = await this.prisma.client.lesson.update({
      where: { id },
      data: {
        ...rest,
        ...(type ? { type: type as Prisma.LessonUpdateInput["type"] } : {}),
      },
    });
    return {
      id: lesson.id,
      moduleId: lesson.moduleId,
      title: lesson.title,
      type: lesson.type,
      order: lesson.order,
      isPreview: lesson.isPreview,
      content: lesson.content,
    };
  }

  /** Re-derives `order` from array position for every lesson id supplied (full-list reorder semantics). */
  async reorderLessons(lessonIds: string[]): Promise<void> {
    await this.prisma.client.$transaction(
      lessonIds.map((id, index) => this.prisma.client.lesson.update({ where: { id }, data: { order: index } })),
    );
  }
}
