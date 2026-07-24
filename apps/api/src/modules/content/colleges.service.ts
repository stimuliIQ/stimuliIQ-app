// apps/api/src/modules/content/colleges.service.ts
//
// Business logic for the dedicated Colleges CRM screen (docs/plans/phase-11-locked-
// templates.md P3; crm/colleges.schemas.ts). A College is a `Partner` row scoped to
// `category: "college_partner"` (CollegesRepository) — mirrors partners.service.ts's
// scope=all-only convention (page-builder/content-adjacent CRUD is not branch-scoped) and
// its `mintCdnUrl` logo-URL convention. This is also where `focus`/`established`/`city`
// actually get persisted on create/update — PartnersService (generic /crm/partners CRUD)
// exposes those three fields on its DTOs (Phase-11 P1) but does not wire them into its
// create/update Prisma calls; CollegesService is the first caller that needs them, so they
// are wired here. No public read endpoint here (see colleges.controller.ts header) — public
// colleges surface via the EXISTING `/public/partners?category=college_partner` read path.

import { ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { College, CollegeLogoUploadUrlRequest, CreateCollegeRequest, ListCollegesQuery, SignedUploadResponse, UpdateCollegeRequest } from "@repo/types";
import { CollegesRepository, type CollegeRow, COLLEGE_PARTNER_CATEGORY } from "./colleges.repository";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { requireScopeContext } from "../auth/lib/scope-context";
import { mintCdnUrl } from "./content.util";
import { STORAGE_PROVIDER, type StorageProvider } from "../storage/providers/storage/storage-provider.interface";
import { S3StorageProvider } from "../storage/providers/storage/s3-storage.provider";

@Injectable()
export class CollegesService {
  constructor(
    private readonly repository: CollegesRepository,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  private assertAllScope(): void {
    const scope = requireScopeContext();
    if (scope.scope !== "all") {
      throw new ForbiddenException({ code: "content.scope_unresolvable", title: "Scope not supported", detail: `The "${scope.scope}" data-scope is not resolvable for colleges.` });
    }
  }

  async list(tenantId: string, query: ListCollegesQuery): Promise<PaginatedResult<College>> {
    this.assertAllScope();
    const { rows, total } = await this.repository.list({ tenantId, status: query.status, search: query.search, city: query.city, page: query.page, pageSize: query.pageSize });
    return new PaginatedResult(rows.map(toDto), { page: query.page, pageSize: query.pageSize, total, hasMore: query.page * query.pageSize < total });
  }

  async create(tenantId: string, body: CreateCollegeRequest): Promise<College> {
    this.assertAllScope();
    const created = await this.repository.create(tenantId, {
      name: body.name,
      logoKey: body.logoKey ?? null,
      url: body.url ?? null,
      category: body.category, // zod-defaulted to COLLEGE_PARTNER_CATEGORY when omitted.
      focus: body.focus ?? null,
      established: body.established ?? null,
      city: body.city ?? null,
      status: body.status,
      order: body.order,
    });
    const row = await this.repository.findById(tenantId, created.id);
    if (!row) throw new NotFoundException({ code: "content.not_found", title: "College not found after creation" });
    return toDto(row);
  }

  async update(tenantId: string, id: string, body: UpdateCollegeRequest): Promise<College> {
    this.assertAllScope();
    const existing = await this.repository.findById(tenantId, id);
    if (!existing) throw new NotFoundException({ code: "content.not_found", title: "College not found" });
    await this.repository.update(id, {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.logoKey !== undefined ? { logoKey: body.logoKey } : {}),
      ...(body.url !== undefined ? { url: body.url } : {}),
      ...(body.category !== undefined ? { category: body.category } : {}),
      ...(body.focus !== undefined ? { focus: body.focus } : {}),
      ...(body.established !== undefined ? { established: body.established } : {}),
      ...(body.city !== undefined ? { city: body.city } : {}),
      ...(body.order !== undefined ? { order: body.order } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
    });
    const updated = await this.repository.findById(tenantId, id);
    if (!updated) throw new NotFoundException({ code: "content.not_found", title: "College not found after update" });
    return toDto(updated);
  }

  async softDelete(tenantId: string, id: string): Promise<void> {
    this.assertAllScope();
    const existing = await this.repository.findById(tenantId, id);
    if (!existing) throw new NotFoundException({ code: "content.not_found", title: "College not found" });
    await this.repository.softDelete(id);
  }

  /**
   * `POST /crm/colleges/logo-upload-url` — mint a signed PUT URL for a college logo.
   * Mirrors `MentorsService#getPhotoUploadUrl` / `ContentPagesBuilderService#getMediaUploadUrl`.
   */
  async getLogoUploadUrl(tenantId: string, body: CollegeLogoUploadUrlRequest): Promise<SignedUploadResponse> {
    this.assertAllScope();
    const { randomUUID } = await import("node:crypto");
    const key = S3StorageProvider.buildKey({
      namespace: "college_logos",
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

function toDto(row: CollegeRow): College {
  return {
    id: row.id,
    name: row.name,
    logoUrl: mintCdnUrl(row.logoKey),
    url: row.url,
    category: row.category,
    focus: row.focus,
    established: row.established,
    city: row.city,
    status: row.status,
    order: row.order,
    createdAt: row.createdAt.toISOString(),
  };
}

// Re-exported so tests/callers that only need "the college category constant" don't have to
// reach into the repository module directly.
export { COLLEGE_PARTNER_CATEGORY };
