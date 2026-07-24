// apps/api/src/modules/content/colleges.repository.ts
//
// Prisma data access ONLY (CLAUDE.md §3.3). CollegesService is the only caller. Colleges
// are `Partner` rows filtered to `category: "college_partner"` (docs/plans/phase-11-locked-
// templates.md; crm/colleges.schemas.ts file header) — a DEDICATED repository (rather than
// reusing PartnersRepository) keeps the "college_partner" default/filter a single,
// undividable rule owned by this file, never re-derived at a call site, and keeps this
// bounded module separable from the generic hiring/tech-partner CRUD (partners.repository.ts)
// per CLAUDE.md §1/§2 module-boundary guidance. Both repositories read/write the SAME
// `partners` table — no schema/model duplication. Soft-delete + audit handled transparently
// by the Prisma client extensions (Partner is registered in both AUDITED_MODELS and the
// soft-delete extension's model list).
//
// `findById`/`update`/`softDelete` deliberately do NOT filter by category (mirrors
// partners.repository.ts) — once a college row's id is known (e.g. from `list()`), it stays
// addressable even if a caller later recategorises it away from "college_partner" (see
// crm/colleges.schemas.ts's `category` field comment). Only `list()` applies the
// college-scoping filter, so the Colleges screen never mixes in hiring/tech partner rows.

import { Injectable } from "@nestjs/common";
import type { ContentStatus as PrismaContentStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";

/** The fixed `Partner.category` value that marks a row as a college (vs. the generic
 *  hiring_partner/tech_partner categories the /crm/partners screen manages) — matches
 *  prisma/seed.ts's Phase-10 sample college rows and crm/colleges.schemas.ts's contract. */
export const COLLEGE_PARTNER_CATEGORY = "college_partner";

export interface CollegeRow {
  id: string;
  name: string;
  logoKey: string | null;
  url: string | null;
  category: string | null;
  focus: string | null;
  established: number | null;
  city: string | null;
  status: PrismaContentStatus;
  order: number;
  createdAt: Date;
}

@Injectable()
export class CollegesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(filters: {
    tenantId: string;
    status?: PrismaContentStatus;
    search?: string;
    city?: string;
    page: number;
    pageSize: number;
  }): Promise<{ rows: CollegeRow[]; total: number }> {
    const where: Prisma.PartnerWhereInput = {
      tenantId: filters.tenantId,
      deletedAt: null,
      category: COLLEGE_PARTNER_CATEGORY,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.search ? { name: { contains: filters.search, mode: "insensitive" } } : {}),
      ...(filters.city ? { city: filters.city } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.client.partner.findMany({ where, orderBy: [{ order: "asc" }, { createdAt: "desc" }], skip: (filters.page - 1) * filters.pageSize, take: filters.pageSize }),
      this.prisma.client.partner.count({ where }),
    ]);
    return { rows, total };
  }

  async findById(tenantId: string, id: string): Promise<CollegeRow | null> {
    return this.prisma.client.partner.findFirst({ where: { id, tenantId, deletedAt: null } });
  }

  async create(
    tenantId: string,
    data: {
      name: string;
      logoKey: string | null;
      url: string | null;
      category: string;
      focus: string | null;
      established: number | null;
      city: string | null;
      status: PrismaContentStatus;
      order: number;
    },
  ): Promise<{ id: string }> {
    const row = await this.prisma.client.partner.create({ data: { tenantId, ...data } });
    return { id: row.id };
  }

  async update(
    id: string,
    patch: Partial<{ name: string; logoKey: string | null; url: string | null; category: string; focus: string | null; established: number | null; city: string | null; status: PrismaContentStatus; order: number }>,
  ): Promise<void> {
    await this.prisma.client.partner.update({ where: { id }, data: patch });
  }

  async softDelete(id: string): Promise<void> {
    await this.prisma.client.partner.delete({ where: { id } }); // rewritten to soft-delete by the extension.
  }
}
