// apps/api/src/modules/courses/courses.service.ts
//
// Business logic for the courses/curriculum module (docs/04-trd-architecture.md §2.1).
//
// SCOPE DECISION: "all" is fully resolvable (content_editor/admin/super_admin/branch_manager
// view-only). "assigned" (faculty's courses.view/create/edit grant, see prisma/seed.ts
// `facultyCourseAuthorGrants`) is intended to mean "programs this faculty authors", but
// `programs` has NO author/owner column in the P1 schema — there is no way to resolve this
// scope without either a schema change (out of bounds for this task) or guessing. Per the
// fail-closed mandate, this scope is REJECTED with 403 here rather than silently widened to
// "all". Wave 3b should add `programs.created_by` (or derive authorship from a
// `batches.facultyId` linkage) and replace this rejection with a real filter.
//
// IDOR / object-level authz: 404 (not 403) on out-of-tenant ids for the same reason as the
// students/faculty modules — avoids confirming a program/module/lesson id exists in another
// tenant. Module/lesson lookups are nested through their parent program: e.g.
// PATCH .../modules/:moduleId 404s if moduleId doesn't belong to :programId, even if the
// module exists under a different (or no) program the caller can't see.

import { mintCdnUrl } from "../content/content.util";
import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type {
  CreateLessonRequest,
  CreateLessonResourceRequest,
  CreateModuleRequest,
  CreateProgramRequest,
  CurriculumTree,
  LessonDetail,
  LessonNode,
  LessonResource,
  LessonResourceUploadUrlRequest,
  ListProgramsQuery,
  ModuleNode,
  ProgramDetail,
  ProgramBrochureUploadUrlRequest,
  ProgramImageUploadUrlRequest,
  ProgramSummary,
  ReorderLessonsRequest,
  ReorderModulesRequest,
  ReorderProgramsRequest,
  SignedUploadResponse,
  UpdateLessonRequest,
  UpdateModuleRequest,
  UpdateProgramRequest,
} from "@repo/types";
import { CoursesRepository, type LessonRow, type ModuleRow, type ProgramRow } from "./courses.repository";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { requireScopeContext } from "../auth/lib/scope-context";
import { STORAGE_PROVIDER, type StorageProvider } from "../storage/providers/storage/storage-provider.interface";
import { S3StorageProvider } from "../storage/providers/storage/s3-storage.provider";
import { LmsProgressService } from "../lms/lms-progress.service";

@Injectable()
export class CoursesService {
  private readonly logger = new Logger(CoursesService.name);

  constructor(
    private readonly repository: CoursesRepository,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    // Curriculum edits move every enrolled student's progress. See resyncEnrolledProgress.
    private readonly progress: LmsProgressService,
  ) {}

  /**
   * Mint a short-lived signed PUT URL for a course card/OG image. The client PUTs the
   * image directly to the returned URL, then submits `storageKey` as `ogImageKey` on
   * create/update. The raw bucket URL is never returned (only the presigned PUT URL +
   * the opaque key). Key: program_images/{tenantId}/{uuid}-{filename}.
   * Mirrors MentorsService.getPhotoUploadUrl.
   */
  async getImageUploadUrl(tenantId: string, body: ProgramImageUploadUrlRequest): Promise<SignedUploadResponse> {
    this.assertResolvableScope();
    const { randomUUID } = await import("node:crypto");
    const key = S3StorageProvider.buildKey({
      namespace: "program_images",
      tenantId,
      uniqueId: randomUUID(),
      filename: body.fileName,
    });
    const result = await this.storage.getSignedUploadUrl({
      key,
      contentType: body.contentType,
      maxBytes: body.sizeBytes,
      ttlSeconds: 900, // ≤15 min
    });
    return {
      storageKey: result.storageKey,
      uploadUrl: result.url,
      expiresAt: result.expiresAt.toISOString(),
      additionalHeaders: result.requiredHeaders,
      maxSizeBytes: body.sizeBytes,
    };
  }

  /**
   * Mint a short-lived signed PUT URL for the downloadable course brochure (PDF). Same
   * two-step ingest as the course image: the client PUTs the file directly to the returned
   * URL, then submits `storageKey` as `brochureKey` on create/update.
   * Key: program_brochures/{tenantId}/{uuid}-{filename}.
   *
   * A separate namespace from `program_images` on purpose: brochures are PDFs served as
   * downloads while images are inlined, so keeping them apart lets the bucket/CDN treat
   * the two differently (cache rules, content-disposition) without a per-object exception.
   */
  async getBrochureUploadUrl(
    tenantId: string,
    body: ProgramBrochureUploadUrlRequest,
  ): Promise<SignedUploadResponse> {
    this.assertResolvableScope();
    const { randomUUID } = await import("node:crypto");
    const key = S3StorageProvider.buildKey({
      namespace: "program_brochures",
      tenantId,
      uniqueId: randomUUID(),
      filename: body.fileName,
    });
    const result = await this.storage.getSignedUploadUrl({
      key,
      contentType: body.contentType,
      maxBytes: body.sizeBytes,
      ttlSeconds: 900, // ≤15 min
    });
    return {
      storageKey: result.storageKey,
      uploadUrl: result.url,
      expiresAt: result.expiresAt.toISOString(),
      additionalHeaders: result.requiredHeaders,
      maxSizeBytes: body.sizeBytes,
    };
  }

  // ─── Lesson resources (PDF / slides / datasets) ───────────────────────────
  //
  // Same two-step ingest as course images and lesson video: mint a short-TTL
  // signed PUT, let the browser upload DIRECTLY to storage, then register the
  // returned opaque key. The API never proxies file bytes, and the raw
  // `storageKey` never appears in a read DTO — students get short-lived signed
  // download URLs from GET /lessons/:id/resources/:rid/download-url instead.

  /**
   * Mint a signed PUT URL for a lesson attachment.
   * Key: lesson_resources/{tenantId}/{lessonId}/{uuid}-{filename}.
   */
  async getResourceUploadUrl(
    tenantId: string,
    lessonId: string,
    body: LessonResourceUploadUrlRequest,
  ): Promise<SignedUploadResponse> {
    this.assertResolvableScope();
    await this.assertLessonInTenant(tenantId, lessonId);

    const { randomUUID } = await import("node:crypto");
    // The "resources" namespace is purpose-built for this and bakes BOTH the tenant
    // and the lesson into the key: resources/{tenantId}/{lessonId}/{uuid}-{filename}.
    // That partitioning is what makes the ownership check on create meaningful.
    const key = S3StorageProvider.buildKey({
      namespace: "resources",
      tenantId,
      scopeId: lessonId,
      uniqueId: randomUUID(),
      filename: body.fileName,
    });
    const result = await this.storage.getSignedUploadUrl({
      key,
      contentType: body.contentType,
      maxBytes: body.sizeBytes,
      ttlSeconds: 900, // ≤15 min
    });
    return {
      storageKey: result.storageKey,
      uploadUrl: result.url,
      expiresAt: result.expiresAt.toISOString(),
      additionalHeaders: result.requiredHeaders,
      maxSizeBytes: body.sizeBytes,
    };
  }

  async listResources(tenantId: string, lessonId: string): Promise<LessonResource[]> {
    this.assertResolvableScope();
    await this.assertLessonInTenant(tenantId, lessonId);
    const rows = await this.repository.listLessonResources(lessonId);
    return rows.map(toLessonResource);
  }

  async createResource(
    tenantId: string,
    lessonId: string,
    body: CreateLessonResourceRequest,
  ): Promise<LessonResource> {
    this.assertResolvableScope();
    await this.assertLessonInTenant(tenantId, lessonId);

    // The client may only register a key the server just minted for THIS lesson in
    // THIS tenant — otherwise a caller could attach an arbitrary object (another
    // tenant's certificate PDF, say) by supplying its key. buildStorageKey's layout
    // is `resources/{tenantId}/{lessonId}/{uuid}-{filename}`, so pinning that exact
    // prefix binds the object to both the tenant and the lesson.
    const expectedPrefix = `resources/${tenantId}/${lessonId}/`;
    if (!body.storageKey.startsWith(expectedPrefix)) {
      throw new ForbiddenException({
        code: "courses.resource_key_mismatch",
        title: "Invalid storage key",
        detail: "The storage key does not belong to this lesson's upload namespace.",
      });
    }

    const row = await this.repository.createLessonResource(tenantId, lessonId, {
      title: body.title,
      type: body.type,
      storageKey: body.storageKey,
      sizeBytes: body.sizeBytes ?? null,
    });
    return toLessonResource(row);
  }

  async deleteResource(tenantId: string, resourceId: string): Promise<void> {
    this.assertResolvableScope();
    const row = await this.repository.findResourceForWrite(tenantId, resourceId);
    // IDOR → 404 (no existence disclosure), same as every other module.
    if (!row) throw new NotFoundException({ code: "courses.resource_not_found", title: "Resource not found" });
    await this.repository.softDeleteResource(resourceId);
  }

  /** Tenant-scopes a lessonId before any resource write. IDOR → 404. */
  private async assertLessonInTenant(tenantId: string, lessonId: string): Promise<void> {
    const lesson = await this.repository.findLessonForResourceWrite(tenantId, lessonId);
    if (!lesson) throw new NotFoundException({ code: "courses.lesson_not_found", title: "Lesson not found" });
  }

  /** Fails closed for any scope this module cannot yet resolve ("assigned" — see file header). */
  private assertResolvableScope(): void {
    const scope = requireScopeContext();
    if (scope.scope !== "all") {
      throw new ForbiddenException({
        code: "courses.scope_unresolvable",
        title: "Scope not yet supported",
        detail: `The "${scope.scope}" data-scope for courses requires program-authorship linkage that does not exist in the P1 schema. Access is denied rather than widened to all programs.`,
      });
    }
  }

  // ── Programs ────────────────────────────────────────────────────────────

  async list(tenantId: string, query: ListProgramsQuery): Promise<PaginatedResult<ProgramSummary>> {
    this.assertResolvableScope();

    const { rows, total } = await this.repository.list({
      tenantId,
      search: query.search,
      domain: query.domain,
      level: query.level,
      status: query.status,
      includeDeleted: query.includeDeleted,
      page: query.page,
      pageSize: query.pageSize,
    });

    return new PaginatedResult(rows.map(toSummary), {
      page: query.page,
      pageSize: query.pageSize,
      total,
      hasMore: query.page * query.pageSize < total,
    });
  }

  async getById(tenantId: string, id: string): Promise<ProgramDetail> {
    this.assertResolvableScope();
    const row = await this.repository.findById(tenantId, id);
    if (!row) {
      throw new NotFoundException({ code: "courses.not_found", title: "Program not found" });
    }
    return toDetail(row);
  }

  async create(tenantId: string, body: CreateProgramRequest): Promise<ProgramDetail> {
    this.assertResolvableScope();

    const existing = await this.repository.findBySlug(tenantId, body.slug);
    if (existing) {
      throw new ForbiddenException({
        code: "courses.slug_in_use",
        title: "Slug already in use",
        detail: "A program with this slug already exists in this tenant.",
      });
    }

    assertCompareAtAbovePrice(body.pricePaise, body.compareAtPricePaise);
    assertBadgeConfigured(body.badgeColor ?? null, body.badgeLabel ?? null, body.badgeEnabled);

    // New programs land at the END of the staff-curated sequence. `order` is deliberately
    // not part of the request contract — appending here keeps a single write path (this
    // and the reorder endpoint) so a create can never wedge itself into the middle.
    const order = (await this.repository.findMaxOrder(tenantId)) + 1;

    const row = await this.repository.create(tenantId, {
      slug: body.slug,
      title: body.title,
      domain: body.domain,
      level: body.level,
      mode: body.mode,
      durationWeeks: body.durationWeeks,
      pricePaise: body.pricePaise,
      compareAtPricePaise: body.compareAtPricePaise ?? null,
      emi: body.emi,
      summary: body.summary,
      seo: body.seo,
      status: body.status,
      cardSummary: body.cardSummary,
      outcomes: body.outcomes,
      ogImageKey: body.ogImageKey,
      brochureKey: body.brochureKey,
      scholarshipAvailable: body.scholarshipAvailable,
      enrollmentEnabled: body.enrollmentEnabled,
      enrollmentPaymentUrl: body.enrollmentPaymentUrl ?? null,
      order,
      badgeColor: body.badgeColor ?? null,
      badgeLabel: body.badgeLabel ?? null,
      badgeEnabled: body.badgeEnabled,
    });
    return toDetail(row);
  }

  async update(tenantId: string, id: string, body: UpdateProgramRequest): Promise<ProgramDetail> {
    this.assertResolvableScope();
    const existing = await this.repository.findById(tenantId, id);
    if (!existing) {
      throw new NotFoundException({ code: "courses.not_found", title: "Program not found" });
    }

    if (body.slug && body.slug !== existing.slug) {
      const slugOwner = await this.repository.findBySlug(tenantId, body.slug);
      if (slugOwner && slugOwner.id !== id) {
        throw new ForbiddenException({
          code: "courses.slug_in_use",
          title: "Slug already in use",
          detail: "A program with this slug already exists in this tenant.",
        });
      }
    }

    // Cross-field, so it can't live in the zod schema: a PATCH may carry either field
    // alone, and the missing half has to come from the stored row.
    assertCompareAtAbovePrice(
      body.pricePaise ?? existing.pricePaise,
      body.compareAtPricePaise === undefined ? existing.compareAtPricePaise : body.compareAtPricePaise,
    );

    // Same merge-then-check shape, for the same reason: a PATCH carrying only
    // `{badgeEnabled: true}` passes DTO validation on its own, but would switch on a badge
    // whose colour/label were never configured — an empty chip on a live course card.
    assertBadgeConfigured(
      body.badgeColor === undefined ? existing.badgeColor : body.badgeColor ?? null,
      body.badgeLabel === undefined ? existing.badgeLabel : body.badgeLabel ?? null,
      body.badgeEnabled ?? existing.badgeEnabled,
    );

    const row = await this.repository.update(id, body);
    return toDetail(row);
  }

  /**
   * Rewrite the staff-curated program sequence. `programIds` is the FULL ordered list for
   * the tenant (see ReorderProgramsRequestSchema) — the server derives `order` from array
   * position rather than trusting client-supplied numbers.
   */
  async reorderPrograms(tenantId: string, body: ReorderProgramsRequest): Promise<void> {
    this.assertResolvableScope();

    // Verify every id belongs to this tenant BEFORE writing — otherwise a caller could
    // splice another tenant's program id into the array and have its `order` rewritten.
    // Batched as one query rather than reorderModules' per-id loop: a full catalog reorder
    // can carry a hundred-plus ids, where N sequential lookups would be the dominant cost.
    const owned = await this.repository.findManyByIds(tenantId, body.programIds);
    const ownedIds = new Set(owned.map((row) => row.id));
    for (const id of body.programIds) {
      if (!ownedIds.has(id)) {
        throw new NotFoundException({ code: "courses.not_found", title: "Program not found" });
      }
    }

    await this.repository.reorderPrograms(body.programIds);
  }

  async publish(tenantId: string, id: string): Promise<ProgramDetail> {
    this.assertResolvableScope();
    const existing = await this.repository.findById(tenantId, id);
    if (!existing) {
      throw new NotFoundException({ code: "courses.not_found", title: "Program not found" });
    }
    const row = await this.repository.setStatus(id, "published");
    return toDetail(row);
  }

  async unpublish(tenantId: string, id: string): Promise<ProgramDetail> {
    this.assertResolvableScope();
    const existing = await this.repository.findById(tenantId, id);
    if (!existing) {
      throw new NotFoundException({ code: "courses.not_found", title: "Program not found" });
    }
    const row = await this.repository.setStatus(id, "archived");
    return toDetail(row);
  }

  /** Flip the marketing visibility flag (website listing). Separate from the status lifecycle. */
  async setVisibility(tenantId: string, id: string, isPublic: boolean): Promise<ProgramDetail> {
    this.assertResolvableScope();
    const existing = await this.repository.findById(tenantId, id);
    if (!existing) {
      throw new NotFoundException({ code: "courses.not_found", title: "Program not found" });
    }
    const row = await this.repository.setVisibility(id, isPublic);
    return toDetail(row);
  }

  async getCurriculum(tenantId: string, programId: string): Promise<CurriculumTree> {
    this.assertResolvableScope();
    const program = await this.repository.findById(tenantId, programId);
    if (!program) {
      throw new NotFoundException({ code: "courses.not_found", title: "Program not found" });
    }
    const tree = await this.repository.getCurriculumTree(programId);
    return {
      programId,
      modules: tree.modules.map(toModuleNode),
    };
  }

  // ── Modules ─────────────────────────────────────────────────────────────

  async createModule(tenantId: string, programId: string, body: CreateModuleRequest): Promise<ModuleNode> {
    this.assertResolvableScope();
    const program = await this.repository.findById(tenantId, programId);
    if (!program) {
      throw new NotFoundException({ code: "courses.not_found", title: "Program not found" });
    }
    const mod = await this.repository.createModule(programId, body);
    return toModuleNode({ ...mod, lessons: [] });
  }

  async updateModule(
    tenantId: string,
    programId: string,
    moduleId: string,
    body: UpdateModuleRequest,
  ): Promise<ModuleNode> {
    this.assertResolvableScope();
    const existing = await this.repository.findModuleInProgram(tenantId, programId, moduleId);
    if (!existing) {
      throw new NotFoundException({ code: "courses.module_not_found", title: "Module not found" });
    }
    const mod = await this.repository.updateModule(moduleId, body);
    return toModuleNode({ ...mod, lessons: [] });
  }

  async reorderModules(
    tenantId: string,
    programId: string,
    body: ReorderModulesRequest,
  ): Promise<CurriculumTree> {
    this.assertResolvableScope();
    const program = await this.repository.findById(tenantId, programId);
    if (!program) {
      throw new NotFoundException({ code: "courses.not_found", title: "Program not found" });
    }

    // Verify every supplied id actually belongs to this program before reordering — refusing
    // a cross-program id mix avoids silently reassigning order to modules outside this tree.
    for (const moduleId of body.moduleIds) {
      const mod = await this.repository.findModuleInProgram(tenantId, programId, moduleId);
      if (!mod) {
        throw new NotFoundException({ code: "courses.module_not_found", title: "Module not found" });
      }
    }

    await this.repository.reorderModules(body.moduleIds);
    return this.getCurriculum(tenantId, programId);
  }

  // ── Lessons ─────────────────────────────────────────────────────────────

  async createLesson(
    tenantId: string,
    programId: string,
    moduleId: string,
    body: CreateLessonRequest,
  ): Promise<LessonNode> {
    this.assertResolvableScope();
    const mod = await this.repository.findModuleInProgram(tenantId, programId, moduleId);
    if (!mod) {
      throw new NotFoundException({ code: "courses.module_not_found", title: "Module not found" });
    }
    const lesson = await this.repository.createLesson(moduleId, body);
    await this.resyncEnrolledProgress(programId);
    return toLessonNode(lesson);
  }

  /**
   * Bring every enrolled student's progress back in line with the curriculum that now
   * exists.
   *
   * Adding a lesson moves the DENOMINATOR of everybody's progress. Nothing used to rewrite
   * it: the rollup ran only when a student completed a lesson, so a student who had already
   * finished this programme kept a stored 100% and a "Completed" badge on every screen that
   * reads the column, while every screen that recomputes the fraction showed the real,
   * lower number.
   *
   * FAILING HERE MUST NOT FAIL THE EDIT. The lesson is already written and the staff
   * member did nothing wrong. A missed resync is recoverable — the next lesson added runs
   * it again, and the repair script sweeps the whole tenant — whereas a 500 thrown from
   * here would throw away the lesson they just wrote.
   */
  private async resyncEnrolledProgress(programId: string): Promise<void> {
    try {
      const result = await this.progress.resyncProgramProgress(programId);
      if (result.updated > 0) {
        this.logger.log(
          "[courses] curriculum change on program=" + programId + " resynced " +
            result.updated + "/" + result.scanned + " enrollment(s), " + result.reopened + " reopened.",
        );
      }
    } catch (error) {
      this.logger.error(
        "[courses] progress resync failed for program=" + programId +
          " after a curriculum change. Run 'pnpm resync:progress' to repair.",
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /** One lesson with its body, for the editor (the tree omits `content` on purpose). */
  async getLesson(tenantId: string, programId: string, moduleId: string, lessonId: string): Promise<LessonDetail> {
    this.assertResolvableScope();
    const lesson = await this.repository.findLessonInModule(tenantId, programId, moduleId, lessonId);
    if (!lesson) {
      throw new NotFoundException({ code: "courses.lesson_not_found", title: "Lesson not found" });
    }
    return toLessonDetail(lesson);
  }

  /**
   * Soft-deletes a lesson. Removing a lesson moves every enrolled student's progress
   * DENOMINATOR exactly as adding one does, so the same resync runs (and, as there, a
   * failed resync must not fail the delete — see resyncEnrolledProgress).
   */
  async deleteLesson(tenantId: string, programId: string, moduleId: string, lessonId: string): Promise<void> {
    this.assertResolvableScope();
    const existing = await this.repository.findLessonInModule(tenantId, programId, moduleId, lessonId);
    if (!existing) {
      throw new NotFoundException({ code: "courses.lesson_not_found", title: "Lesson not found" });
    }
    await this.repository.softDeleteLesson(lessonId);
    await this.resyncEnrolledProgress(programId);
  }

  /** Soft-deletes a module and all of its lessons, then resyncs progress (see deleteLesson). */
  async deleteModule(tenantId: string, programId: string, moduleId: string): Promise<void> {
    this.assertResolvableScope();
    const mod = await this.repository.findModuleInProgram(tenantId, programId, moduleId);
    if (!mod) {
      throw new NotFoundException({ code: "courses.module_not_found", title: "Module not found" });
    }
    await this.repository.softDeleteModule(moduleId);
    await this.resyncEnrolledProgress(programId);
  }

  async updateLesson(
    tenantId: string,
    programId: string,
    moduleId: string,
    lessonId: string,
    body: UpdateLessonRequest,
  ): Promise<LessonNode> {
    this.assertResolvableScope();
    const existing = await this.repository.findLessonInModule(tenantId, programId, moduleId, lessonId);
    if (!existing) {
      throw new NotFoundException({ code: "courses.lesson_not_found", title: "Lesson not found" });
    }
    const lesson = await this.repository.updateLesson(lessonId, body);
    return toLessonNode(lesson);
  }

  async reorderLessons(
    tenantId: string,
    programId: string,
    moduleId: string,
    body: ReorderLessonsRequest,
  ): Promise<CurriculumTree> {
    this.assertResolvableScope();
    const mod = await this.repository.findModuleInProgram(tenantId, programId, moduleId);
    if (!mod) {
      throw new NotFoundException({ code: "courses.module_not_found", title: "Module not found" });
    }

    for (const lessonId of body.lessonIds) {
      const lesson = await this.repository.findLessonInModule(tenantId, programId, moduleId, lessonId);
      if (!lesson) {
        throw new NotFoundException({ code: "courses.lesson_not_found", title: "Lesson not found" });
      }
    }

    await this.repository.reorderLessons(body.lessonIds);
    return this.getCurriculum(tenantId, programId);
  }
}

/** Row → staff DTO. `storageKey` is never selected, so it cannot leak here. */
function toLessonResource(row: {
  id: string;
  lessonId: string;
  title: string;
  type: string;
  size: number | null;
  createdAt: Date;
}): LessonResource {
  return {
    id: row.id,
    lessonId: row.lessonId,
    title: row.title,
    type: row.type as LessonResource["type"],
    sizeBytes: row.size,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * A struck-through "was" price must be STRICTLY above the real price. Equal renders as
 * `₹6,999 ₹6,999`; below advertises a saving that runs the wrong way. Either is a false
 * price claim on a public page, so it is rejected at write time rather than papered over
 * at render time (the public projection ALSO nulls a bad value out — defence in depth,
 * because rows can predate this check or be written by a future code path).
 *
 * Null/undefined is always valid: it means "no strike, show a single price".
 */
function assertCompareAtAbovePrice(pricePaise: number, compareAtPricePaise: number | null | undefined): void {
  if (compareAtPricePaise == null) return;
  if (compareAtPricePaise > pricePaise) return;
  throw new BadRequestException({
    code: "courses.compare_at_price_not_above_price",
    title: "Compare-at price must be higher than the price",
    detail:
      `compareAtPricePaise (${compareAtPricePaise}) must be strictly greater than pricePaise ` +
      `(${pricePaise}). Leave it empty to show a single price.`,
  });
}

/**
 * A visible badge must actually be renderable — it needs both a colour to draw and text to
 * show. Either can be missing only through a partial PATCH; the create path always carries
 * the whole object.
 *
 * Rejected at write time rather than skipped at render time, so the CRM tells staff their
 * badge is incomplete instead of silently showing nothing on the live site.
 */
function assertBadgeConfigured(
  badgeColor: string | null,
  badgeLabel: string | null,
  badgeEnabled: boolean,
): void {
  if (!badgeEnabled) return;
  if (!badgeColor) {
    throw new BadRequestException({
      code: "courses.badge_color_required",
      title: "Badge needs a colour",
      detail: "Pick a badge colour before switching the badge on.",
    });
  }
  if (!badgeLabel?.trim()) {
    throw new BadRequestException({
      code: "courses.badge_label_required",
      title: "Badge needs text",
      detail: "Enter the text to display before switching the badge on.",
    });
  }
}

function toSummary(row: ProgramRow): ProgramSummary {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    domain: row.domain,
    // `programs.level` is nullable in the DB (pre-P1 column); the wire contract requires a
    // value. "beginner" is the documented default fallback for legacy/untagged rows pending
    // a Wave 3b backfill migration.
    level: (row.level ?? "beginner") as ProgramSummary["level"],
    mode: row.mode as ProgramSummary["mode"],
    durationWeeks: row.durationWeeks ?? 0,
    pricePaise: row.pricePaise,
    compareAtPricePaise: row.compareAtPricePaise,
    status: row.status as ProgramSummary["status"],
    isPublic: row.isPublic,
    order: row.order,
    badgeColor: row.badgeColor,
    badgeLabel: row.badgeLabel,
    badgeEnabled: row.badgeEnabled,
    createdAt: row.createdAt.toISOString(),
  };
}

function toDetail(row: ProgramRow): ProgramDetail {
  return {
    ...toSummary(row),
    emi: Array.isArray(row.emi) ? (row.emi as ProgramDetail["emi"]) : [],
    summary: row.summary,
    seo: (row.seo as ProgramDetail["seo"]) ?? null,
    cardSummary: row.cardSummary,
    outcomes: Array.isArray(row.outcomes) ? (row.outcomes as string[]) : null,
    ogImageUrl: mintCdnUrl(row.ogImageKey),
    brochureUrl: mintCdnUrl(row.brochureKey),
    scholarshipAvailable: row.scholarshipAvailable,
    enrollmentEnabled: row.enrollmentEnabled,
    enrollmentPaymentUrl: row.enrollmentPaymentUrl,
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
    updatedAt: row.updatedAt.toISOString(),
  };
}


function toModuleNode(mod: ModuleRow & { lessons: LessonRow[] }): ModuleNode {
  return {
    id: mod.id,
    title: mod.title,
    order: mod.order,
    lessons: mod.lessons.map(toLessonNode),
  };
}

function toLessonDetail(lesson: LessonRow): LessonDetail {
  return { ...toLessonNode(lesson), content: lesson.content };
}

function toLessonNode(lesson: LessonRow): LessonNode {
  return {
    id: lesson.id,
    title: lesson.title,
    type: lesson.type as LessonNode["type"],
    order: lesson.order,
    isPreview: lesson.isPreview,
  };
}
