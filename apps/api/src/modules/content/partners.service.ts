// apps/api/src/modules/content/partners.service.ts
//
// Business logic for the headless CMS partners surface (docs/plans/phase-9-completion.md
// T22). Same scope=all-only + publish-gate conventions as blog.service.ts.

import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { CreatePartnerRequest, ListPartnersQuery, Partner, PublicPartner, UpdatePartnerRequest } from "@repo/types";
import { PartnersRepository, type PartnerRow } from "./partners.repository";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { requireScopeContext } from "../auth/lib/scope-context";
import { TENANT_SLUG, mintCdnUrl } from "./content.util";

@Injectable()
export class PartnersService {
  constructor(private readonly repository: PartnersRepository) {}

  private assertAllScope(): void {
    const scope = requireScopeContext();
    if (scope.scope !== "all") {
      throw new ForbiddenException({ code: "content.scope_unresolvable", title: "Scope not supported", detail: `The "${scope.scope}" data-scope is not resolvable for headless content.` });
    }
  }

  async list(tenantId: string, query: ListPartnersQuery): Promise<PaginatedResult<Partner>> {
    this.assertAllScope();
    const { rows, total } = await this.repository.list({ tenantId, category: query.category, status: query.status, page: query.page, pageSize: query.pageSize });
    return new PaginatedResult(rows.map(toDto), { page: query.page, pageSize: query.pageSize, total, hasMore: query.page * query.pageSize < total });
  }

  async create(tenantId: string, body: CreatePartnerRequest): Promise<Partner> {
    this.assertAllScope();
    const status = body.status === "published" ? "draft" : body.status;
    const created = await this.repository.create(tenantId, {
      name: body.name,
      logoKey: body.logoKey ?? null,
      url: body.url ?? null,
      category: body.category ?? null,
      // focus/established/city — Phase-11 locked-templates P1 exposed these on the DTO
      // (docs/plans/phase-11-locked-templates.md) but they were never wired into this
      // Prisma call; CollegesService needs them persisted (backend-builder P3 fix).
      focus: body.focus ?? null,
      established: body.established ?? null,
      city: body.city ?? null,
      status,
      order: body.order,
    });
    const row = await this.repository.findById(tenantId, created.id);
    if (!row) throw new NotFoundException({ code: "content.not_found", title: "Partner not found after creation" });
    return toDto(row);
  }

  async update(tenantId: string, id: string, body: UpdatePartnerRequest): Promise<Partner> {
    this.assertAllScope();
    const existing = await this.repository.findById(tenantId, id);
    if (!existing) throw new NotFoundException({ code: "content.not_found", title: "Partner not found" });
    await this.repository.update(id, {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.logoKey !== undefined ? { logoKey: body.logoKey } : {}),
      ...(body.url !== undefined ? { url: body.url } : {}),
      ...(body.category !== undefined ? { category: body.category } : {}),
      ...(body.focus !== undefined ? { focus: body.focus } : {}),
      ...(body.established !== undefined ? { established: body.established } : {}),
      ...(body.city !== undefined ? { city: body.city } : {}),
      ...(body.order !== undefined ? { order: body.order } : {}),
      ...(body.status !== undefined && body.status !== "published" ? { status: body.status } : {}),
    });
    const updated = await this.repository.findById(tenantId, id);
    if (!updated) throw new NotFoundException({ code: "content.not_found", title: "Partner not found after update" });
    return toDto(updated);
  }

  async publish(tenantId: string, id: string): Promise<Partner> {
    this.assertAllScope();
    const existing = await this.repository.findById(tenantId, id);
    if (!existing) throw new NotFoundException({ code: "content.not_found", title: "Partner not found" });
    await this.repository.update(id, { status: "published" });
    const updated = await this.repository.findById(tenantId, id);
    if (!updated) throw new NotFoundException({ code: "content.not_found", title: "Partner not found after publish" });
    return toDto(updated);
  }

  async softDelete(tenantId: string, id: string): Promise<void> {
    this.assertAllScope();
    const existing = await this.repository.findById(tenantId, id);
    if (!existing) throw new NotFoundException({ code: "content.not_found", title: "Partner not found" });
    await this.repository.softDelete(id);
  }

  async listPublic(category?: string): Promise<PublicPartner[]> {
    const tenantId = await this.repository.getTenantIdBySlug(TENANT_SLUG);
    if (!tenantId) throw new NotFoundException({ code: "content.tenant_not_found", title: "Tenant not found" });
    const rows = await this.repository.listPublished(tenantId, category);
    return rows.map(toPublicDto);
  }
}

function toDto(row: PartnerRow): Partner {
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

function toPublicDto(row: PartnerRow): PublicPartner {
  return {
    id: row.id,
    name: row.name,
    logoUrl: mintCdnUrl(row.logoKey),
    url: row.url,
    category: row.category,
    focus: row.focus,
    established: row.established,
    city: row.city,
  };
}
