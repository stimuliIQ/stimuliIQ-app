// apps/api/src/modules/tickets/kb-articles.service.ts
//
// Business logic for the knowledge-base article surface (docs/plans/phase-9-completion.md
// T21). No Prisma here (CLAUDE.md §3.3). `kb.view` is readable authenticated-wide (every
// staff/student role holds it at scope=all — reference material, no per-row scoping);
// `kb.edit` gates admin CRUD (support/content_editor, scope=all). Public reads (published
// only) are served by a SEPARATE, unauthenticated method — never mix the two projections.

import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  CreateKbArticleRequest,
  KbArticleDetail,
  KbArticleSummary,
  ListKbArticlesQuery,
  ListPublicKbArticlesQuery,
  PublicKbArticleDetail,
  PublicKbArticleSummary,
  UpdateKbArticleRequest,
} from "@repo/types";
import { KbArticlesRepository, type KbArticleRow } from "./kb-articles.repository";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { requireScopeContext } from "../auth/lib/scope-context";

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

const TENANT_SLUG = "stimuliiq"; // Single-tenant (mirrors public-catalog.service.ts).

@Injectable()
export class KbArticlesService {
  constructor(private readonly repository: KbArticlesRepository) {}

  private assertAllScope(): void {
    const scope = requireScopeContext();
    if (scope.scope !== "all") {
      throw new ForbiddenException({
        code: "kb.scope_unresolvable",
        title: "Scope not supported",
        detail: `The "${scope.scope}" data-scope is not resolvable for knowledge-base articles.`,
      });
    }
  }

  // ─── Admin (CRM) CRUD ────────────────────────────────────────────────────

  async list(tenantId: string, query: ListKbArticlesQuery): Promise<PaginatedResult<KbArticleSummary>> {
    this.assertAllScope();
    const { rows, total } = await this.repository.list({
      tenantId,
      category: query.category,
      published: query.published,
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

  async getById(tenantId: string, id: string): Promise<KbArticleDetail> {
    this.assertAllScope();
    const row = await this.repository.findById(tenantId, id);
    if (!row) throw new NotFoundException({ code: "kb.not_found", title: "Knowledge-base article not found" });
    return toDetail(row);
  }

  async create(tenantId: string, body: CreateKbArticleRequest): Promise<KbArticleDetail> {
    this.assertAllScope();
    try {
      const created = await this.repository.create(tenantId, {
        title: body.title,
        slug: body.slug,
        body: body.body,
        category: body.category ?? null,
        published: body.published,
      });
      const row = await this.repository.findById(tenantId, created.id);
      if (!row) throw new NotFoundException({ code: "kb.not_found", title: "Knowledge-base article not found after creation" });
      return toDetail(row);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException({ code: "kb.slug_taken", title: "Slug already in use", detail: `slug="${body.slug}" is already used by another article.` });
      }
      throw err;
    }
  }

  async update(tenantId: string, id: string, body: UpdateKbArticleRequest): Promise<KbArticleDetail> {
    this.assertAllScope();
    const existing = await this.repository.findById(tenantId, id);
    if (!existing) throw new NotFoundException({ code: "kb.not_found", title: "Knowledge-base article not found" });

    try {
      await this.repository.update(id, {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.slug !== undefined ? { slug: body.slug } : {}),
        ...(body.body !== undefined ? { body: body.body } : {}),
        ...(body.category !== undefined ? { category: body.category } : {}),
        ...(body.published !== undefined ? { published: body.published } : {}),
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException({ code: "kb.slug_taken", title: "Slug already in use" });
      }
      throw err;
    }

    const updated = await this.repository.findById(tenantId, id);
    if (!updated) throw new NotFoundException({ code: "kb.not_found", title: "Knowledge-base article not found after update" });
    return toDetail(updated);
  }

  async softDelete(tenantId: string, id: string): Promise<void> {
    this.assertAllScope();
    const existing = await this.repository.findById(tenantId, id);
    if (!existing) throw new NotFoundException({ code: "kb.not_found", title: "Knowledge-base article not found" });
    await this.repository.softDelete(id);
  }

  // ─── Public (anonymous, published only) ─────────────────────────────────

  private async resolveTenantId(): Promise<string> {
    const tenantId = await this.repository.getTenantIdBySlug(TENANT_SLUG);
    if (!tenantId) throw new NotFoundException({ code: "kb.tenant_not_found", title: "Tenant not found" });
    return tenantId;
  }

  async listPublic(query: ListPublicKbArticlesQuery): Promise<PublicKbArticleSummary[]> {
    const tenantId = await this.resolveTenantId();
    const rows = await this.repository.listPublished({
      tenantId,
      category: query.category,
      search: query.search,
      limit: query.limit,
    });
    return rows.map(toPublicSummary);
  }

  async getPublicBySlug(slug: string): Promise<PublicKbArticleDetail> {
    const tenantId = await this.resolveTenantId();
    const row = await this.repository.findPublishedBySlug(tenantId, slug);
    if (!row) throw new NotFoundException({ code: "kb.not_found", title: "Knowledge-base article not found" });
    return { ...toPublicSummary(row), body: row.body };
  }
}

function toSummary(row: KbArticleRow): KbArticleSummary {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    category: row.category,
    published: row.published,
    createdAt: row.createdAt.toISOString(),
  };
}

function toDetail(row: KbArticleRow): KbArticleDetail {
  return { ...toSummary(row), body: row.body, updatedAt: row.updatedAt.toISOString() };
}

function toPublicSummary(row: KbArticleRow): PublicKbArticleSummary {
  return { id: row.id, title: row.title, slug: row.slug, category: row.category };
}
