// apps/api/src/modules/careers/job-openings.service.ts
//
// Business logic for CRM ▸ Careers ▸ Openings and the public roles list on /careers.
// Spec: docs/specs/careers-hiring.md, ADR-0066.
//
// TWO MAPPERS, DELIBERATELY: `toPublicDto` and `toCrmDto` are separate functions rather
// than one with a flag, so a CRM-only field (status, applicant counts) has no path onto the
// marketing site. `toCrmDto` builds on `toPublicDto`, so the public shape can never drift
// out from under the CRM one.
//
// Scope: content-adjacent CRUD is scope=all only, matching partners/colleges — a job advert
// is a company-wide artefact, not a branch's.

import { ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type {
  CreateJobOpeningRequest,
  JobOpening,
  JobOpeningStatus,
  JobOpeningWorkMode,
  ListJobOpeningsQuery,
  ListPublicJobOpeningsQuery,
  PublicJobOpening,
  UpdateJobOpeningRequest,
} from "@repo/types";
import { isJobOpeningLive, slugifyJobOpeningTitle } from "@repo/types";
import { JobOpeningsRepository, type ApplicationCounts, type JobOpeningRow } from "./job-openings.repository";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { requireScopeContext } from "../auth/lib/scope-context";
import { TENANT_SLUG } from "../content/content.util";

/** `YYYY-MM-DD` in UTC — the one date representation this module compares against. */
export function toDateOnlyString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Midnight UTC for a `YYYY-MM-DD` string, for DATE-column comparisons. */
function toUtcMidnight(dateOnly: string): Date {
  return new Date(`${dateOnly}T00:00:00.000Z`);
}

/**
 * Reads a JSON column that is contractually a string[].
 *
 * Never trusts the column: a hand-edited row, or a value written before this shape existed,
 * must degrade to an empty list rather than throwing inside a public page render.
 */
function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

export function toPublicJobOpeningDto(row: JobOpeningRow): PublicJobOpening {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    department: row.department,
    employmentType: row.employmentType,
    location: row.location,
    // `workMode`/`status` are app-boundary-constrained on every write path (zod), never
    // DB-constrained — cast at this one read-mapping choke point, matching the convention
    // ContentIntakeService already uses for CareerApplication.status.
    workMode: (row.workMode as JobOpeningWorkMode | null) ?? null,
    experienceLevel: row.experienceLevel,
    summary: row.summary,
    description: row.description,
    responsibilities: toStringArray(row.responsibilities),
    requirements: toStringArray(row.requirements),
    compensationNote: row.compensationNote,
    openingsCount: row.openingsCount,
    closesOn: row.closesOn ? toDateOnlyString(row.closesOn) : null,
    postedAt: (row.publishedAt ?? row.createdAt).toISOString(),
  };
}

function toCrmJobOpeningDto(row: JobOpeningRow, counts: ApplicationCounts | undefined, today: string): JobOpening {
  const status = row.status as JobOpeningStatus;
  return {
    ...toPublicJobOpeningDto(row),
    status,
    order: row.order,
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    applicationCount: counts?.total ?? 0,
    pendingApplicationCount: counts?.pending ?? 0,
    // Computed with the SAME shared helper the public list filters by, so the CRM badge and
    // the site can never disagree about what "live" means.
    isLive: isJobOpeningLive({ status, closesOn: row.closesOn ? toDateOnlyString(row.closesOn) : null }, today),
  };
}

@Injectable()
export class JobOpeningsService {
  constructor(private readonly repository: JobOpeningsRepository) {}

  private assertAllScope(): void {
    const scope = requireScopeContext();
    if (scope.scope !== "all") {
      throw new ForbiddenException({
        code: "careers.scope_unresolvable",
        title: "Scope not supported",
        detail: `The "${scope.scope}" data-scope is not resolvable for job openings.`,
      });
    }
  }

  private async resolveTenantId(): Promise<string> {
    const tenantId = await this.repository.getTenantIdBySlug(TENANT_SLUG);
    if (!tenantId) throw new NotFoundException({ code: "careers.tenant_not_found", title: "Tenant not found" });
    return tenantId;
  }

  // ── Public ────────────────────────────────────────────────────────────────

  /** GET /api/v1/public/careers/openings — published, non-lapsed roles only. */
  async listPublic(query: ListPublicJobOpeningsQuery): Promise<PublicJobOpening[]> {
    const tenantId = await this.resolveTenantId();
    return this.listPublicForTenant(tenantId, query);
  }

  /**
   * Tenant-scoped variant, called directly by the page-builder block resolver (which
   * already knows the tenant) so the careers page's Open Roles section does not pay for a
   * second tenant lookup on every render.
   */
  async listPublicForTenant(tenantId: string, query: ListPublicJobOpeningsQuery): Promise<PublicJobOpening[]> {
    const today = toDateOnlyString(new Date());
    const rows = await this.repository.listPublic({
      tenantId,
      department: query.department,
      location: query.location,
      workMode: query.workMode,
      today: toUtcMidnight(today),
      limit: query.limit,
    });
    return rows.map(toPublicJobOpeningDto);
  }

  /**
   * GET /api/v1/public/careers/openings/:slug — one role's full advert.
   *
   * 404s for anything not currently live, which deliberately includes a draft and a lapsed
   * role: the detail page must not become a side door onto an advert that is off the site.
   * The 404 is indistinguishable from "no such slug", which is also the right answer for a
   * candidate following a stale link.
   */
  async getPublicBySlug(slug: string): Promise<PublicJobOpening> {
    const tenantId = await this.resolveTenantId();
    const today = toDateOnlyString(new Date());
    const row = await this.repository.findPublicBySlug(tenantId, slug, toUtcMidnight(today));
    if (!row) {
      throw new NotFoundException({
        code: "careers.opening_not_found",
        title: "This role is no longer open",
        detail: "It may have been filled or closed since you last saw it. Our current openings are on the careers page.",
      });
    }
    return toPublicJobOpeningDto(row);
  }

  /**
   * Resolves the opening an anonymous applicant claims to be applying to, and confirms it
   * is genuinely open right now. Returns null when it is not — the caller records the
   * application anyway against its role snapshot (see SubmitCareerApplicationRequestSchema
   * on why a stale page must not cost us the applicant).
   */
  async findLiveOpeningForApply(tenantId: string, jobOpeningId: string): Promise<PublicJobOpening | null> {
    const row = await this.repository.findById(tenantId, jobOpeningId);
    if (!row) return null;
    const dto = toPublicJobOpeningDto(row);
    if (!isJobOpeningLive({ status: row.status as JobOpeningStatus, closesOn: dto.closesOn })) return null;
    return dto;
  }

  // ── CRM ───────────────────────────────────────────────────────────────────

  async list(tenantId: string, query: ListJobOpeningsQuery): Promise<PaginatedResult<JobOpening>> {
    this.assertAllScope();
    const { rows, total } = await this.repository.list({
      tenantId,
      status: query.status,
      department: query.department,
      search: query.search,
      page: query.page,
      pageSize: query.pageSize,
    });
    const counts = await this.repository.countApplicationsByOpening(tenantId, rows.map((r) => r.id));
    const today = toDateOnlyString(new Date());
    return new PaginatedResult(
      rows.map((row) => toCrmJobOpeningDto(row, counts.get(row.id), today)),
      { page: query.page, pageSize: query.pageSize, total, hasMore: query.page * query.pageSize < total },
    );
  }

  async getById(tenantId: string, id: string): Promise<JobOpening> {
    this.assertAllScope();
    const row = await this.repository.findById(tenantId, id);
    if (!row) throw new NotFoundException({ code: "careers.opening_not_found", title: "Job opening not found" });
    const counts = await this.repository.countApplicationsByOpening(tenantId, [row.id]);
    return toCrmJobOpeningDto(row, counts.get(row.id), toDateOnlyString(new Date()));
  }

  /**
   * Derives a unique slug. Staff may supply one; when they do not, it comes from the title.
   * A collision is a 422 with the offending slug named, rather than a silent `-2` suffix:
   * the slug is a public URL fragment somebody may already have shared, and quietly handing
   * back a different one than was asked for is how two roles end up looking like the same one.
   */
  private async resolveSlug(tenantId: string, title: string, requested: string | undefined, excludeId?: string): Promise<string> {
    const slug = requested ?? slugifyJobOpeningTitle(title);
    if (!slug) {
      throw new UnprocessableEntityException({
        code: "careers.slug_underivable",
        title: "Could not derive a slug",
        detail: "This title contains no characters usable in a URL. Please set the slug explicitly.",
      });
    }
    const clash = await this.repository.findBySlug(tenantId, slug, excludeId);
    if (clash) {
      throw new UnprocessableEntityException({
        code: "careers.slug_taken",
        title: "That slug is already in use",
        detail: `Another opening ("${clash.title}") already uses the slug "${slug}". Pick a different one.`,
      });
    }
    return slug;
  }

  async create(tenantId: string, body: CreateJobOpeningRequest): Promise<JobOpening> {
    this.assertAllScope();
    const slug = await this.resolveSlug(tenantId, body.title, body.slug ?? undefined);
    const created = await this.repository.create(tenantId, {
      title: body.title,
      slug,
      department: body.department ?? null,
      employmentType: body.employmentType,
      location: body.location,
      workMode: body.workMode ?? null,
      experienceLevel: body.experienceLevel ?? null,
      summary: body.summary,
      description: body.description ?? null,
      responsibilities: body.responsibilities,
      requirements: body.requirements,
      compensationNote: body.compensationNote ?? null,
      status: body.status,
      order: body.order,
      openingsCount: body.openingsCount,
      closesOn: body.closesOn ? toUtcMidnight(body.closesOn) : null,
      // Stamped the moment it first goes live, so "posted 3 days ago" on the site means
      // when the advert appeared, not when somebody first drafted it.
      publishedAt: body.status === "published" ? new Date() : null,
    });
    return this.getById(tenantId, created.id);
  }

  async update(tenantId: string, id: string, body: UpdateJobOpeningRequest): Promise<JobOpening> {
    this.assertAllScope();
    const existing = await this.repository.findById(tenantId, id);
    if (!existing) throw new NotFoundException({ code: "careers.opening_not_found", title: "Job opening not found" });

    // Re-derive the slug only when the title or the slug itself is actually being changed —
    // an unrelated PATCH (say, bumping `order`) must not renumber a live public URL.
    let slug: string | undefined;
    if (body.slug !== undefined || (body.title !== undefined && body.title !== existing.title)) {
      slug = await this.resolveSlug(tenantId, body.title ?? existing.title, body.slug ?? undefined, id);
    }

    const goingLive = body.status === "published" && existing.status !== "published";

    await this.repository.update(id, {
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(slug !== undefined ? { slug } : {}),
      ...(body.department !== undefined ? { department: body.department ?? null } : {}),
      ...(body.employmentType !== undefined ? { employmentType: body.employmentType } : {}),
      ...(body.location !== undefined ? { location: body.location } : {}),
      ...(body.workMode !== undefined ? { workMode: body.workMode ?? null } : {}),
      ...(body.experienceLevel !== undefined ? { experienceLevel: body.experienceLevel ?? null } : {}),
      ...(body.summary !== undefined ? { summary: body.summary } : {}),
      ...(body.description !== undefined ? { description: body.description ?? null } : {}),
      ...(body.responsibilities !== undefined ? { responsibilities: body.responsibilities } : {}),
      ...(body.requirements !== undefined ? { requirements: body.requirements } : {}),
      ...(body.compensationNote !== undefined ? { compensationNote: body.compensationNote ?? null } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.order !== undefined ? { order: body.order } : {}),
      ...(body.openingsCount !== undefined ? { openingsCount: body.openingsCount } : {}),
      ...(body.closesOn !== undefined ? { closesOn: body.closesOn ? toUtcMidnight(body.closesOn) : null } : {}),
      // Set once, on the first publish, and never cleared: un-publishing and re-publishing
      // an advert does not make it a new advert.
      ...(goingLive && !existing.publishedAt ? { publishedAt: new Date() } : {}),
    });

    return this.getById(tenantId, id);
  }

  /**
   * Soft-deletes an opening. A soft delete is an UPDATE, so the FK is untouched and each
   * application keeps pointing at the row — but every read filters `deletedAt`, so the
   * detail view reports `jobOpening: null` and falls back to the application's own `role`
   * snapshot. A reviewer therefore still sees what each person applied for.
   *
   * Closing is almost always the better move and the CRM says so; this exists for adverts
   * posted by mistake.
   */
  async softDelete(tenantId: string, id: string): Promise<void> {
    this.assertAllScope();
    const existing = await this.repository.findById(tenantId, id);
    if (!existing) throw new NotFoundException({ code: "careers.opening_not_found", title: "Job opening not found" });
    await this.repository.softDelete(id);
  }
}
