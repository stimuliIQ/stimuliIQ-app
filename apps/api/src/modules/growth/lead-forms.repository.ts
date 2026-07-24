// apps/api/src/modules/growth/lead-forms.repository.ts
//
// Prisma data access ONLY (CLAUDE.md §3.3). LeadFormsService is the only caller.
// Soft-delete + audit handled transparently by the Prisma client extensions.
// `key` carries a per-tenant partial-unique index in principle (WHERE deleted_at IS
// NULL) — enforced here via a P2002-catch in the service (no raw-SQL migration needed
// beyond what already exists for this model; see docs/phase-1-followups.md "partial
// unique indexes in raw SQL" note — this table predates that migration and has no DB
// constraint, so the service performs a defensive pre-check + catch).

import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";

export interface LeadFormRow {
  id: string;
  key: string;
  name: string;
  fields: Prisma.JsonValue;
  targetProgramId: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ListLeadFormsFilters {
  tenantId: string;
  active?: boolean;
  page: number;
  pageSize: number;
}

export interface CreateLeadFormData {
  key: string;
  name: string;
  fields: Prisma.InputJsonValue;
  targetProgramId: string | null;
  active: boolean;
}

export type UpdateLeadFormData = Partial<CreateLeadFormData>;

@Injectable()
export class LeadFormsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(filters: ListLeadFormsFilters): Promise<{ rows: LeadFormRow[]; total: number }> {
    const where: Prisma.LeadFormWhereInput = {
      tenantId: filters.tenantId,
      deletedAt: null,
      ...(filters.active !== undefined ? { active: filters.active } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.client.leadForm.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
      this.prisma.client.leadForm.count({ where }),
    ]);
    return { rows, total };
  }

  async findById(tenantId: string, id: string): Promise<LeadFormRow | null> {
    return this.prisma.client.leadForm.findFirst({ where: { id, tenantId, deletedAt: null } });
  }

  async findByKey(tenantId: string, key: string): Promise<LeadFormRow | null> {
    return this.prisma.client.leadForm.findFirst({ where: { tenantId, key, deletedAt: null } });
  }

  /** Public read: ACTIVE only. */
  async findActiveByKey(tenantId: string, key: string): Promise<LeadFormRow | null> {
    return this.prisma.client.leadForm.findFirst({ where: { tenantId, key, active: true, deletedAt: null } });
  }

  async create(tenantId: string, data: CreateLeadFormData): Promise<{ id: string }> {
    const row = await this.prisma.client.leadForm.create({ data: { tenantId, ...data } });
    return { id: row.id };
  }

  async update(id: string, patch: UpdateLeadFormData): Promise<void> {
    await this.prisma.client.leadForm.update({ where: { id }, data: patch });
  }

  async softDelete(id: string): Promise<void> {
    await this.prisma.client.leadForm.delete({ where: { id } }); // rewritten to soft-delete by the extension.
  }

  /** Resolves the tenant id for the public (unauthenticated) surface — mirrors public.repository.ts. */
  async getTenantIdBySlug(tenantSlug: string): Promise<string | null> {
    const row = await this.prisma.client.tenant.findUnique({ where: { slug: tenantSlug }, select: { id: true } });
    return row?.id ?? null;
  }
}
