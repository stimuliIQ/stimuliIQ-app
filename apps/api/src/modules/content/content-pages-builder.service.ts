// apps/api/src/modules/content/content-pages-builder.service.ts
//
// Business logic for the Phase-10 page builder (docs/specs/phase-10-page-builder.md).
// No Prisma here (CLAUDE.md §3.3) — persistence goes through ContentPagesRepository
// (page rows) and ContentPageVersionsRepository (version snapshots + the atomic
// save-before-apply transaction). Same scope=all-only convention as every other
// content service (page-builder pages are not branch-scoped — spec "Data scope: all
// only"). `content.builder` is super_admin-only (prisma/seed.ts) — enforced entirely
// by the controller's `@RequirePermission`, not re-checked here.

import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { PageBuilderBlockSchema, isCoreTemplateSlug, validatePageBodyAgainstTemplate, type TemplateValidationError } from "@repo/types";
import type {
  ContentPageBuilderDetail,
  ContentPageMediaUploadUrlRequest,
  ContentPageVersionDetail,
  ContentPageVersionSummary,
  CreateBuilderPageRequest,
  ListContentPageVersionsQuery,
  PageBuilderBlock,
  PreviewBuilderPageRequest,
  PreviewBuilderPageResponse,
  RevertContentPageVersionRequest,
  SaveBuilderPageRequest,
  SignedUploadResponse,
} from "@repo/types";

/** Same 60-block page-level ceiling as SaveBuilderPageRequestSchema (packages/types/src/content/pages.schemas.ts). */
const RevertBodySchema = z.array(PageBuilderBlockSchema).max(60);
import { ContentPagesRepository, type ContentPageRow } from "./content-pages.repository";
import { ContentPageVersionsRepository, type ContentPageVersionRow } from "./content-page-versions.repository";
import { LiveCollectionResolverService } from "./live-collection-resolver.service";
import { isReservedBuilderSlug } from "./content-pages-builder.constants";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { requireScopeContext } from "../auth/lib/scope-context";
import { isUniqueViolation } from "./content.util";
import type { RequestUser } from "../auth/lib/request-user";
import { STORAGE_PROVIDER, type StorageProvider } from "../storage/providers/storage/storage-provider.interface";
import { S3StorageProvider } from "../storage/providers/storage/s3-storage.provider";

function toBuilderDetail(row: ContentPageRow, currentVersion: number): ContentPageBuilderDetail {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    status: row.status,
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    isBuilderManaged: true,
    body: row.body as unknown as PageBuilderBlock[],
    seoTitle: row.seoTitle,
    seoDescription: row.seoDescription,
    seoImagePath: row.seoImagePath,
    updatedAt: row.updatedAt.toISOString(),
    currentVersion,
  };
}

function toVersionSummary(row: ContentPageVersionRow): ContentPageVersionSummary {
  return { version: row.version, title: row.title, createdBy: row.createdBy, createdAt: row.createdAt.toISOString() };
}

function toVersionDetail(row: ContentPageVersionRow): ContentPageVersionDetail {
  return { ...toVersionSummary(row), body: row.body as unknown as PageBuilderBlock[], seoTitle: row.seoTitle, seoDescription: row.seoDescription, seoImagePath: row.seoImagePath };
}

function templateViolationError(slug: string, errors: TemplateValidationError[]): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: "content.builder.template_violation",
    title: "Page layout does not match its locked template",
    detail: `"${slug}" is a locked-template page (docs/plans/phase-11-locked-templates.md) — sections cannot be added, removed, reordered, or given the wrong type; only field values may change.`,
    errors,
  });
}

function versionConflictError(currentVersion: number, expectedVersion: number, action: "saving" | "reverting"): ConflictException {
  return new ConflictException({
    code: "content.builder.version_conflict",
    title: "Version conflict",
    detail: `This page was changed by someone else since it was loaded (current version is ${currentVersion}, expected ${expectedVersion}). Reload before ${action}.`,
  });
}

function builderPageNotFoundError(): NotFoundException {
  return new NotFoundException({ code: "content.not_found", title: "Builder page not found" });
}

@Injectable()
export class ContentPagesBuilderService {
  constructor(
    private readonly pagesRepository: ContentPagesRepository,
    private readonly versionsRepository: ContentPageVersionsRepository,
    private readonly liveCollectionResolver: LiveCollectionResolverService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  private assertAllScope(): void {
    const scope = requireScopeContext();
    if (scope.scope !== "all") {
      throw new ForbiddenException({ code: "content.scope_unresolvable", title: "Scope not supported", detail: `The "${scope.scope}" data-scope is not resolvable for the page builder.` });
    }
  }

  /**
   * Server-side enforcement of a core-template page's fixed layout (Phase-11 locked
   * templates, docs/plans/phase-11-locked-templates.md P3: "the server, not just the UI,
   * enforces the lock"). Every add/remove/reorder/wrong-type/invalid-data mutation of a
   * locked page's `body` is rejected here with a 422 and structured, per-section errors —
   * never a silent partial apply. Non-core slugs (`isCoreTemplateSlug` false) pass through
   * completely unchanged: this phase does not touch the generic/ad-hoc page path (see
   * page-templates.schemas.ts file header). Returns the template-registry-reparsed body
   * (same values, freshly zod-parsed against each section's own schema) so persistence
   * always writes a body that passed BOTH the strict block-union check (the controller's
   * `ZodValidationPipe`) AND this template-shape check.
   */
  private enforceTemplateLock(slug: string, body: PageBuilderBlock[]): PageBuilderBlock[] {
    if (!isCoreTemplateSlug(slug)) return body;
    const result = validatePageBodyAgainstTemplate(slug, body);
    if (!result.success) throw templateViolationError(slug, result.errors);
    return result.data;
  }

  /**
   * `POST /crm/content-pages/builder` — create a new, empty (`body=[]`) builder page.
   * `status` is forced `published` immediately (AC 5/13). No version row is created —
   * there is no "previous state" to snapshot yet; the FIRST `PUT .../builder` save
   * creates version 1.
   */
  async create(tenantId: string, body: CreateBuilderPageRequest): Promise<ContentPageBuilderDetail> {
    this.assertAllScope();
    if (isReservedBuilderSlug(body.slug)) {
      throw new ConflictException({
        code: "content.builder.slug_reserved",
        title: "Slug is reserved",
        detail: `"/${body.slug}" collides with an existing web route and cannot be used for a new page-builder page.`,
      });
    }
    // Defense-in-depth (Phase-11 locked templates, P3): `RESERVED_BUILDER_SLUGS` above
    // and `CoreTemplateSlugSchema` (page-templates.schemas.ts) are two INDEPENDENTLY
    // maintained lists that happen to overlap on every one of today's 6 core slugs — the
    // check above already blocks every core-template slug from reaching here in normal
    // operation. This branch exists so that if a core page is ever soft-deleted and a
    // fresh `POST .../builder` is attempted at the same now-free slug, an EMPTY (`[]`)
    // body can never be persisted for a locked-template slug — a locked template page
    // always requires every one of its fixed sections.
    if (isCoreTemplateSlug(body.slug)) {
      this.enforceTemplateLock(body.slug, []);
    }
    try {
      const created = await this.pagesRepository.create(tenantId, {
        slug: body.slug,
        title: body.title,
        body: [] as Prisma.InputJsonValue,
        seoTitle: body.seoTitle ?? null,
        seoDescription: body.seoDescription ?? null,
        seoImagePath: body.seoImagePath ?? null,
        status: "published",
        publishedAt: new Date(),
        isBuilderManaged: true,
      });
      const row = await this.pagesRepository.findById(tenantId, created.id);
      if (!row) throw new NotFoundException({ code: "content.not_found", title: "Builder page not found after creation" });
      return toBuilderDetail(row, 0);
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException({ code: "content.slug_taken", title: "Slug already in use" });
      throw err;
    }
  }

  /** Shared existence + isBuilderManaged guard for every id-scoped builder endpoint. */
  private async requireBuilderPage(tenantId: string, id: string): Promise<ContentPageRow> {
    const existing = await this.pagesRepository.findById(tenantId, id);
    if (!existing || !existing.isBuilderManaged) throw builderPageNotFoundError();
    return existing;
  }

  /**
   * `PUT /crm/content-pages/:id/builder` — save (AC 1/2/3/5/6/12/13). `body.body` is
   * already validated against the strict block union by the controller's
   * `ZodValidationPipe` before this is called (AC 12 — a malformed block never reaches
   * here). `expectedVersion` optimistic-concurrency check + the save-before-apply
   * snapshot both happen atomically inside `applyWithVersionSnapshot` (Edge case #5).
   *
   * Phase-11 locked templates (docs/plans/phase-11-locked-templates.md P3): when
   * `existing.slug` is a core template slug, `body.body` is ADDITIONALLY validated
   * against that slug's fixed section list (`enforceTemplateLock`) BEFORE the DB
   * transaction ever starts — a wrong layout is rejected with 422 and never reaches
   * the version-snapshot write. Non-core (ad-hoc) pages are unaffected.
   */
  async save(tenantId: string, user: RequestUser, id: string, body: SaveBuilderPageRequest): Promise<ContentPageBuilderDetail> {
    this.assertAllScope();
    const existing = await this.requireBuilderPage(tenantId, id);
    const validatedBody = this.enforceTemplateLock(existing.slug, body.body);
    const result = await this.versionsRepository.applyWithVersionSnapshot(
      tenantId,
      id,
      body.expectedVersion,
      {
        title: body.title !== undefined ? body.title : existing.title,
        body: validatedBody as unknown as Prisma.InputJsonValue,
        seoTitle: body.seoTitle !== undefined ? body.seoTitle : existing.seoTitle,
        seoDescription: body.seoDescription !== undefined ? body.seoDescription : existing.seoDescription,
        seoImagePath: body.seoImagePath !== undefined ? body.seoImagePath : existing.seoImagePath,
      },
      user.id,
    );
    if (!result.ok) {
      if (result.reason === "not_found") throw builderPageNotFoundError();
      throw versionConflictError(result.currentVersion, body.expectedVersion, "saving");
    }
    return toBuilderDetail(result.row, result.newVersion);
  }

  /**
   * `POST /crm/content-pages/:id/preview` (AC 4) — READ-ONLY: no persistence, no
   * version bump, no audit-log write (nothing is mutated). Resolves `live_collection_ref`
   * blocks through the SAME resolver the public read path uses.
   */
  async preview(tenantId: string, id: string, body: PreviewBuilderPageRequest): Promise<PreviewBuilderPageResponse> {
    this.assertAllScope();
    await this.requireBuilderPage(tenantId, id);
    const blocks = await this.liveCollectionResolver.resolveKnownBlocks(tenantId, body.body);
    return { blocks };
  }

  async listVersions(tenantId: string, id: string, query: ListContentPageVersionsQuery): Promise<PaginatedResult<ContentPageVersionSummary>> {
    this.assertAllScope();
    await this.requireBuilderPage(tenantId, id);
    const { rows, total } = await this.versionsRepository.list({ tenantId, contentPageId: id, page: query.page, pageSize: query.pageSize });
    return new PaginatedResult(rows.map(toVersionSummary), { page: query.page, pageSize: query.pageSize, total, hasMore: query.page * query.pageSize < total });
  }

  async getVersion(tenantId: string, id: string, version: number): Promise<ContentPageVersionDetail> {
    this.assertAllScope();
    await this.requireBuilderPage(tenantId, id);
    const row = await this.versionsRepository.findVersionByNumber(tenantId, id, version);
    if (!row) throw new NotFoundException({ code: "content.builder.version_not_found", title: "Version not found" });
    return toVersionDetail(row);
  }

  /**
   * `POST /crm/content-pages/:id/versions/:version/revert` (AC 7) — same
   * save-before-apply + optimistic-concurrency contract as `save()`; the only
   * difference is WHAT is applied (a prior version's snapshot instead of a
   * client-submitted body). History is append-only: reverting itself creates a NEW
   * version capturing what was live immediately before the revert — never rewinds or
   * deletes existing version rows.
   */
  async revert(tenantId: string, user: RequestUser, id: string, version: number, body: RevertContentPageVersionRequest): Promise<ContentPageBuilderDetail> {
    this.assertAllScope();
    const existing = await this.requireBuilderPage(tenantId, id);
    const target = await this.versionsRepository.findVersionByNumber(tenantId, id, version);
    if (!target) throw new NotFoundException({ code: "content.builder.version_not_found", title: "Version not found" });

    // Re-validate (Wave security review L2): `target.body` was valid against
    // PageBuilderBlockSchema when it was WRITTEN, but the registry itself can change
    // between then and now (a block `type` tightened/removed — the "revert" analogue of
    // Edge case #9's unknown-block-type handling on the PUBLIC read path). Applying an
    // unvalidated snapshot straight to the live row would bypass the same strict-union
    // guarantee `save()` enforces on every other write — reject loudly instead.
    const parsedBody = RevertBodySchema.safeParse(target.body);
    if (!parsedBody.success) {
      throw new UnprocessableEntityException({
        code: "content.builder.version_no_longer_valid",
        title: "This version can no longer be reverted to",
        detail: "The stored snapshot no longer matches the current page-builder block registry (e.g. a block type was removed or its shape changed). Revert is blocked to avoid applying an invalid page body.",
        errors: parsedBody.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      });
    }

    // Phase-11 locked templates (P3): a version snapshot may predate the template lock
    // (written before this page's slug became a locked core template, or before a
    // registry change tightened its section list) — reverting to it must not silently put
    // a locked page back into a shape the lock would otherwise reject. Non-core slugs are
    // unaffected (`enforceTemplateLock` is a no-op for them).
    const templateCheckedBody = this.enforceTemplateLock(existing.slug, parsedBody.data);

    const result = await this.versionsRepository.applyWithVersionSnapshot(
      tenantId,
      id,
      body.expectedVersion,
      {
        title: target.title,
        body: templateCheckedBody as unknown as Prisma.InputJsonValue,
        seoTitle: target.seoTitle,
        seoDescription: target.seoDescription,
        seoImagePath: target.seoImagePath,
      },
      user.id,
    );
    if (!result.ok) {
      if (result.reason === "not_found") throw builderPageNotFoundError();
      throw versionConflictError(result.currentVersion, body.expectedVersion, "reverting");
    }
    return toBuilderDetail(result.row, result.newVersion);
  }

  /**
   * `POST /crm/content-pages/media-upload-url` — mint a short-lived signed PUT URL for a
   * page-builder marketing image (a `hero`/`image`/`media_gallery`/etc. block's image
   * field). The client PUTs the image directly to the returned URL, then embeds the
   * returned `storageKey` in the relevant block field before saving. The raw bucket URL
   * is never returned (only the presigned PUT URL + the opaque key).
   * Key: marketing_images/{tenantId}/{uuid}-{filename}. Mirrors
   * CoursesService#getImageUploadUrl / MentorsService#getPhotoUploadUrl. `content.builder`
   * is super_admin-only — enforced entirely by the controller's `@RequirePermission`.
   */
  async getMediaUploadUrl(tenantId: string, body: ContentPageMediaUploadUrlRequest): Promise<SignedUploadResponse> {
    this.assertAllScope();
    const { randomUUID } = await import("node:crypto");
    const key = S3StorageProvider.buildKey({
      namespace: "marketing_images",
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
}
