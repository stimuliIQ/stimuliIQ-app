// apps/api/src/modules/content/content-pages.service.ts
//
// Business logic for the generic block-based CMS page surface (docs/plans/phase-9-
// completion.md T22). Same scope=all-only + publish-gate conventions as blog.service.ts.
// `body` is an array of typed content blocks — rendered through the DOMPurify sink
// (@repo/ui, T19) at every `type: 'richtext'` block on the way OUT (ADR-0045); stored raw
// on the way in (CRM-authored, permission-gated).

import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { ContentBlock, ContentPageDetail, ContentPageSummary, CreateContentPageRequest, ListContentPagesQuery, PublicContentPage, UpdateContentPageRequest } from "@repo/types";
import { ContentPagesRepository, type ContentPageRow } from "./content-pages.repository";
import { LiveCollectionResolverService } from "./live-collection-resolver.service";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { requireScopeContext } from "../auth/lib/scope-context";
import { TENANT_SLUG, isUniqueViolation } from "./content.util";

function toBlocks(value: Prisma.JsonValue): ContentBlock[] {
  return Array.isArray(value) ? (value as unknown as ContentBlock[]) : [];
}

@Injectable()
export class ContentPagesService {
  constructor(
    private readonly repository: ContentPagesRepository,
    private readonly liveCollectionResolver: LiveCollectionResolverService,
  ) {}

  private assertAllScope(): void {
    const scope = requireScopeContext();
    if (scope.scope !== "all") {
      throw new ForbiddenException({ code: "content.scope_unresolvable", title: "Scope not supported", detail: `The "${scope.scope}" data-scope is not resolvable for headless content.` });
    }
  }

  /**
   * SECURITY FIX (api-designer review, tightened per Wave security review M2): the
   * generic PATCH/publish/delete endpoints are gated by `content.edit`/`content.publish`/
   * `content.delete` — permissions ALSO held by the `content_editor`/`marketing` roles.
   * A page-builder-managed row (isBuilderManaged=true) must NEVER be mutated through
   * these generic endpoints, UNCONDITIONALLY — not even by a caller who additionally
   * holds `content.builder`. The generic `update()`/`publish()`/`softDelete()` paths
   * write straight to the row with NO strict block-union validation and NO version
   * snapshot (docs/specs/phase-10-page-builder.md AC 6/12); allowing a content.builder
   * holder through this door would let them silently corrupt a builder page's `body`
   * with an unvalidated shape and skip the append-only version history the dedicated
   * `/builder` endpoints guarantee. Every builder edit — including by super_admin —
   * MUST go through `POST/PUT .../builder` and `.../versions/:version/revert`.
   */
  private assertGenericMutationAllowed(existing: ContentPageRow): void {
    if (!existing.isBuilderManaged) return;
    throw new ForbiddenException({
      code: "content.builder_managed_forbidden",
      title: "Page is managed by the page builder",
      detail: "This page is authored through the CRM page builder. Generic content-edit endpoints are blocked for builder-managed pages, unconditionally. Use the /builder endpoints (content.builder) for every edit, including reorders/deletes/publishes.",
    });
  }

  async list(tenantId: string, query: ListContentPagesQuery): Promise<PaginatedResult<ContentPageSummary>> {
    this.assertAllScope();
    const { rows, total } = await this.repository.list({ tenantId, status: query.status, search: query.search, isBuilderManaged: query.isBuilderManaged, page: query.page, pageSize: query.pageSize });
    return new PaginatedResult(rows.map(toSummary), { page: query.page, pageSize: query.pageSize, total, hasMore: query.page * query.pageSize < total });
  }

  async getById(tenantId: string, id: string): Promise<ContentPageDetail> {
    this.assertAllScope();
    const row = await this.repository.findById(tenantId, id);
    if (!row) throw new NotFoundException({ code: "content.not_found", title: "Content page not found" });
    return toDetail(row);
  }

  async create(tenantId: string, body: CreateContentPageRequest): Promise<ContentPageDetail> {
    this.assertAllScope();
    const status = body.status === "published" ? "draft" : body.status;
    try {
      const created = await this.repository.create(tenantId, {
        slug: body.slug,
        title: body.title,
        body: body.body as Prisma.InputJsonValue,
        seoTitle: body.seoTitle ?? null,
        seoDescription: body.seoDescription ?? null,
        seoImagePath: body.seoImagePath ?? null,
        status,
        publishedAt: null,
      });
      const row = await this.repository.findById(tenantId, created.id);
      if (!row) throw new NotFoundException({ code: "content.not_found", title: "Content page not found after creation" });
      return toDetail(row);
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException({ code: "content.slug_taken", title: "Slug already in use" });
      throw err;
    }
  }

  async update(tenantId: string, id: string, body: UpdateContentPageRequest): Promise<ContentPageDetail> {
    this.assertAllScope();
    const existing = await this.repository.findById(tenantId, id);
    if (!existing) throw new NotFoundException({ code: "content.not_found", title: "Content page not found" });
    this.assertGenericMutationAllowed(existing);
    try {
      await this.repository.update(id, {
        ...(body.slug !== undefined ? { slug: body.slug } : {}),
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.body !== undefined ? { body: body.body as Prisma.InputJsonValue } : {}),
        ...(body.seoTitle !== undefined ? { seoTitle: body.seoTitle } : {}),
        ...(body.seoDescription !== undefined ? { seoDescription: body.seoDescription } : {}),
        ...(body.seoImagePath !== undefined ? { seoImagePath: body.seoImagePath } : {}),
        ...(body.status !== undefined && body.status !== "published" ? { status: body.status } : {}),
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException({ code: "content.slug_taken", title: "Slug already in use" });
      throw err;
    }
    const updated = await this.repository.findById(tenantId, id);
    if (!updated) throw new NotFoundException({ code: "content.not_found", title: "Content page not found after update" });
    return toDetail(updated);
  }

  async publish(tenantId: string, id: string): Promise<ContentPageDetail> {
    this.assertAllScope();
    const existing = await this.repository.findById(tenantId, id);
    if (!existing) throw new NotFoundException({ code: "content.not_found", title: "Content page not found" });
    this.assertGenericMutationAllowed(existing);
    await this.repository.update(id, { status: "published", publishedAt: new Date() });
    const updated = await this.repository.findById(tenantId, id);
    if (!updated) throw new NotFoundException({ code: "content.not_found", title: "Content page not found after publish" });
    return toDetail(updated);
  }

  async softDelete(tenantId: string, id: string): Promise<void> {
    this.assertAllScope();
    const existing = await this.repository.findById(tenantId, id);
    if (!existing) throw new NotFoundException({ code: "content.not_found", title: "Content page not found" });
    this.assertGenericMutationAllowed(existing);
    await this.repository.softDelete(id);
  }

  /**
   * `GET /public/pages/:slug`. For `isBuilderManaged` rows, `live_collection_ref` blocks
   * are resolved server-side (testimonials/partners/programs/mentors, always re-applying
   * each source's `status='published'` filter — never bypassable from the stored
   * selection criteria) through the SAME resolver `POST .../preview` uses, so the public
   * page and the CRM preview render identically (docs/specs/phase-10-page-builder.md
   * AC 4/11). A raw stored block whose `type` no longer exists in the closed registry
   * (Edge case #9 — e.g. a page reverted to a version predating a since-removed block
   * type) is silently skipped, never a 500.
   */
  async getPublicBySlug(slug: string): Promise<PublicContentPage> {
    const tenantId = await this.repository.getTenantIdBySlug(TENANT_SLUG);
    if (!tenantId) throw new NotFoundException({ code: "content.tenant_not_found", title: "Tenant not found" });
    const row = await this.repository.findPublishedBySlug(tenantId, slug);
    if (!row) throw new NotFoundException({ code: "content.not_found", title: "Content page not found" });
    if (row.isBuilderManaged) {
      const body = await this.liveCollectionResolver.resolveRawBlocks(tenantId, row.body);
      return { slug: row.slug, title: row.title, isBuilderManaged: true, body, seoTitle: row.seoTitle, seoDescription: row.seoDescription, seoImagePath: row.seoImagePath };
    }
    return { slug: row.slug, title: row.title, isBuilderManaged: false, body: toBlocks(row.body), seoTitle: row.seoTitle, seoDescription: row.seoDescription, seoImagePath: row.seoImagePath };
  }
}

function toSummary(row: ContentPageRow): ContentPageSummary {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    status: row.status,
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    isBuilderManaged: row.isBuilderManaged,
  };
}

function toDetail(row: ContentPageRow): ContentPageDetail {
  return { ...toSummary(row), body: toBlocks(row.body), seoTitle: row.seoTitle, seoDescription: row.seoDescription, seoImagePath: row.seoImagePath, updatedAt: row.updatedAt.toISOString() };
}
