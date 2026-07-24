// apps/api/src/modules/content/faculty-bios.service.ts
//
// Business logic for the headless CMS public faculty-bio surface (docs/plans/phase-9-
// completion.md T22). Same scope=all-only + publish-gate conventions as blog.service.ts.

import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { CreateFacultyBioRequest, FacultyBio, FacultyBioSocialLinks, ListFacultyBiosQuery, PublicFacultyBio, UpdateFacultyBioRequest } from "@repo/types";
import type { Prisma } from "@prisma/client";
import { FacultyBiosRepository, type FacultyBioRow } from "./faculty-bios.repository";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { requireScopeContext } from "../auth/lib/scope-context";
import { TENANT_SLUG, mintCdnUrl } from "./content.util";

@Injectable()
export class FacultyBiosService {
  constructor(private readonly repository: FacultyBiosRepository) {}

  private assertAllScope(): void {
    const scope = requireScopeContext();
    if (scope.scope !== "all") {
      throw new ForbiddenException({ code: "content.scope_unresolvable", title: "Scope not supported", detail: `The "${scope.scope}" data-scope is not resolvable for headless content.` });
    }
  }

  async list(tenantId: string, query: ListFacultyBiosQuery): Promise<PaginatedResult<FacultyBio>> {
    this.assertAllScope();
    const { rows, total } = await this.repository.list({ tenantId, status: query.status, page: query.page, pageSize: query.pageSize });
    return new PaginatedResult(rows.map(toDto), { page: query.page, pageSize: query.pageSize, total, hasMore: query.page * query.pageSize < total });
  }

  async create(tenantId: string, body: CreateFacultyBioRequest): Promise<FacultyBio> {
    this.assertAllScope();
    const status = body.status === "published" ? "draft" : body.status;
    const created = await this.repository.create(tenantId, {
      facultyProfileId: body.facultyProfileId ?? null,
      name: body.name,
      photoKey: body.photoKey ?? null,
      title: body.title ?? null,
      bio: body.bio,
      socialLinks: body.socialLinks as Prisma.InputJsonValue | undefined,
      status,
      order: body.order,
    });
    const row = await this.repository.findById(tenantId, created.id);
    if (!row) throw new NotFoundException({ code: "content.not_found", title: "Faculty bio not found after creation" });
    return toDto(row);
  }

  async update(tenantId: string, id: string, body: UpdateFacultyBioRequest): Promise<FacultyBio> {
    this.assertAllScope();
    const existing = await this.repository.findById(tenantId, id);
    if (!existing) throw new NotFoundException({ code: "content.not_found", title: "Faculty bio not found" });
    await this.repository.update(id, {
      ...(body.facultyProfileId !== undefined ? { facultyProfileId: body.facultyProfileId } : {}),
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.photoKey !== undefined ? { photoKey: body.photoKey } : {}),
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.bio !== undefined ? { bio: body.bio } : {}),
      ...(body.socialLinks !== undefined ? { socialLinks: body.socialLinks as Prisma.InputJsonValue } : {}),
      ...(body.order !== undefined ? { order: body.order } : {}),
      ...(body.status !== undefined && body.status !== "published" ? { status: body.status } : {}),
    });
    const updated = await this.repository.findById(tenantId, id);
    if (!updated) throw new NotFoundException({ code: "content.not_found", title: "Faculty bio not found after update" });
    return toDto(updated);
  }

  async publish(tenantId: string, id: string): Promise<FacultyBio> {
    this.assertAllScope();
    const existing = await this.repository.findById(tenantId, id);
    if (!existing) throw new NotFoundException({ code: "content.not_found", title: "Faculty bio not found" });
    await this.repository.update(id, { status: "published" });
    const updated = await this.repository.findById(tenantId, id);
    if (!updated) throw new NotFoundException({ code: "content.not_found", title: "Faculty bio not found after publish" });
    return toDto(updated);
  }

  async softDelete(tenantId: string, id: string): Promise<void> {
    this.assertAllScope();
    const existing = await this.repository.findById(tenantId, id);
    if (!existing) throw new NotFoundException({ code: "content.not_found", title: "Faculty bio not found" });
    await this.repository.softDelete(id);
  }

  async listPublic(): Promise<PublicFacultyBio[]> {
    const tenantId = await this.repository.getTenantIdBySlug(TENANT_SLUG);
    if (!tenantId) throw new NotFoundException({ code: "content.tenant_not_found", title: "Tenant not found" });
    const rows = await this.repository.listPublished(tenantId);
    return rows.map(toPublicDto);
  }
}

function toSocialLinks(value: Prisma.JsonValue | null): FacultyBioSocialLinks | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as FacultyBioSocialLinks;
}

function toDto(row: FacultyBioRow): FacultyBio {
  return {
    id: row.id,
    facultyProfileId: row.facultyProfileId,
    name: row.name,
    photoUrl: mintCdnUrl(row.photoKey),
    title: row.title,
    bio: row.bio,
    socialLinks: toSocialLinks(row.socialLinks),
    status: row.status,
    order: row.order,
    createdAt: row.createdAt.toISOString(),
  };
}

function toPublicDto(row: FacultyBioRow): PublicFacultyBio {
  return { id: row.id, name: row.name, photoUrl: mintCdnUrl(row.photoKey), title: row.title, bio: row.bio, socialLinks: toSocialLinks(row.socialLinks) };
}
