// apps/api/src/modules/growth/landing-pages.service.ts
//
// Business logic for the campaign landing-page manager (Phase-9 Completion T12/T14/T33/
// T40 — closed by this task). Admin CRUD lives at /crm/landing-pages (landing_pages.view/
// edit, scope=all — mirrors marketing's other campaign-funnel tooling). Public render
// (published only) resolves a (slug, variant) pair for A/B serving — when `variant` is
// omitted the server picks one of the published variants for that slug at random (simple,
// stateless A/B split — no sticky-session cookie in this pass, tracked as a follow-up).
//
// No Prisma here (CLAUDE.md §3.3) — all DB access via LandingPagesRepository.

import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  CreateLandingPageRequest,
  LandingPageDetail,
  LandingPageSummary,
  ListLandingPagesQuery,
  PublicLandingPage,
  UpdateLandingPageRequest,
} from "@repo/types";
import { LandingPagesRepository, type LandingPageRow } from "./landing-pages.repository";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { requireScopeContext } from "../auth/lib/scope-context";

const TENANT_SLUG = "stimuliiq"; // Single-tenant (mirrors public-catalog.service.ts).

type ContentBlockArray = LandingPageDetail["content"];

function toBlocks(value: Prisma.JsonValue): ContentBlockArray {
  return Array.isArray(value) ? (value as unknown as ContentBlockArray) : [];
}

@Injectable()
export class LandingPagesService {
  constructor(private readonly repository: LandingPagesRepository) {}

  private assertAllScope(): void {
    const scope = requireScopeContext();
    if (scope.scope !== "all" && scope.scope !== "branch") {
      throw new ForbiddenException({
        code: "landing_pages.scope_unresolvable",
        title: "Scope not supported",
        detail: `The "${scope.scope}" data-scope is not resolvable for landing pages.`,
      });
    }
  }

  // ─── Admin (CRM) CRUD ────────────────────────────────────────────────────

  async list(tenantId: string, query: ListLandingPagesQuery): Promise<PaginatedResult<LandingPageSummary>> {
    this.assertAllScope();
    const { rows, total } = await this.repository.list({
      tenantId,
      campaign: query.campaign,
      status: query.status,
      search: query.search,
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

  async getById(tenantId: string, id: string): Promise<LandingPageDetail> {
    this.assertAllScope();
    const row = await this.repository.findById(tenantId, id);
    if (!row) throw new NotFoundException({ code: "landing_pages.not_found", title: "Landing page not found" });
    return toDetail(row);
  }

  async create(tenantId: string, body: CreateLandingPageRequest): Promise<LandingPageDetail> {
    this.assertAllScope();
    const status = body.status === "published" ? "draft" : body.status;
    const created = await this.repository.create(tenantId, {
      campaign: body.campaign ?? null,
      slug: body.slug,
      title: body.title,
      variant: body.variant,
      content: body.content as Prisma.InputJsonValue,
      seoTitle: body.seoTitle ?? null,
      seoDescription: body.seoDescription ?? null,
      status,
      publishedAt: null,
    });
    const row = await this.repository.findById(tenantId, created.id);
    if (!row) throw new NotFoundException({ code: "landing_pages.not_found", title: "Landing page not found after creation" });
    return toDetail(row);
  }

  async update(tenantId: string, id: string, body: UpdateLandingPageRequest): Promise<LandingPageDetail> {
    this.assertAllScope();
    const existing = await this.repository.findById(tenantId, id);
    if (!existing) throw new NotFoundException({ code: "landing_pages.not_found", title: "Landing page not found" });

    // Publishing is an explicit action of PATCH here (unlike content-pages' separate
    // /publish route) — the CRM landing-page editor's "Publish" button sends
    // { status: "published" } directly; stamp publishedAt server-side the first time.
    const publishedAt =
      body.status === "published" && existing.status !== "published" ? new Date() : undefined;

    await this.repository.update(id, {
      ...(body.campaign !== undefined ? { campaign: body.campaign ?? null } : {}),
      ...(body.slug !== undefined ? { slug: body.slug } : {}),
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.variant !== undefined ? { variant: body.variant } : {}),
      ...(body.content !== undefined ? { content: body.content as Prisma.InputJsonValue } : {}),
      ...(body.seoTitle !== undefined ? { seoTitle: body.seoTitle ?? null } : {}),
      ...(body.seoDescription !== undefined ? { seoDescription: body.seoDescription ?? null } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(publishedAt !== undefined ? { publishedAt } : {}),
    });

    const updated = await this.repository.findById(tenantId, id);
    if (!updated) throw new NotFoundException({ code: "landing_pages.not_found", title: "Landing page not found after update" });
    return toDetail(updated);
  }

  async softDelete(tenantId: string, id: string): Promise<void> {
    this.assertAllScope();
    const existing = await this.repository.findById(tenantId, id);
    if (!existing) throw new NotFoundException({ code: "landing_pages.not_found", title: "Landing page not found" });
    await this.repository.softDelete(id);
  }

  // ─── Public (anonymous) render ───────────────────────────────────────────

  private async resolveTenantId(): Promise<string> {
    const tenantId = await this.repository.getTenantIdBySlug(TENANT_SLUG);
    if (!tenantId) throw new NotFoundException({ code: "landing_pages.tenant_not_found", title: "Tenant not found" });
    return tenantId;
  }

  async getPublicBySlug(slug: string, variant?: string): Promise<PublicLandingPage> {
    const tenantId = await this.resolveTenantId();
    const rows = await this.repository.findPublishedBySlug(tenantId, slug);
    if (rows.length === 0) {
      throw new NotFoundException({ code: "landing_pages.not_found", title: "Landing page not found" });
    }

    let selected: LandingPageRow | undefined;
    if (variant) {
      selected = rows.find((r) => r.variant === variant);
      if (!selected) {
        throw new NotFoundException({ code: "landing_pages.variant_not_found", title: "Landing page variant not found" });
      }
    } else {
      // Stateless A/B split: pick uniformly at random among the published variants.
      selected = rows[Math.floor(Math.random() * rows.length)];
    }

    if (!selected) {
      throw new NotFoundException({ code: "landing_pages.not_found", title: "Landing page not found" });
    }

    return {
      slug: selected.slug,
      variant: selected.variant,
      title: selected.title,
      content: toBlocks(selected.content),
      seoTitle: selected.seoTitle,
      seoDescription: selected.seoDescription,
    };
  }
}

function toSummary(row: LandingPageRow): LandingPageSummary {
  return {
    id: row.id,
    campaign: row.campaign,
    slug: row.slug,
    title: row.title,
    variant: row.variant,
    status: row.status,
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

function toDetail(row: LandingPageRow): LandingPageDetail {
  return {
    ...toSummary(row),
    content: toBlocks(row.content),
    seoTitle: row.seoTitle,
    seoDescription: row.seoDescription,
    updatedAt: row.updatedAt.toISOString(),
  };
}
