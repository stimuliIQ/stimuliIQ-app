// apps/api/src/modules/growth/lead-forms.service.ts
//
// Business logic for the configurable lead-capture form manager (Phase-9 Completion
// T12/T14/T32 — closed by this task). Admin CRUD lives at /crm/lead-forms
// (lead_forms.view/edit, scope=all). Public read (active only, by key) lets the `web`
// app fetch a form's field config before submitting via the existing
// POST /public/leads (unchanged — this module is config-only, never captures a lead
// itself).
//
// No Prisma here (CLAUDE.md §3.3) — all DB access via LeadFormsRepository.

import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  CreateLeadFormRequest,
  LeadForm,
  LeadFormField,
  ListLeadFormsQuery,
  PublicLeadForm,
  UpdateLeadFormRequest,
} from "@repo/types";
import { LeadFormsRepository, type LeadFormRow } from "./lead-forms.repository";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { requireScopeContext } from "../auth/lib/scope-context";

const TENANT_SLUG = "stimuliiq"; // Single-tenant (mirrors public-catalog.service.ts).

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

function toFields(value: Prisma.JsonValue): LeadFormField[] {
  return Array.isArray(value) ? (value as unknown as LeadFormField[]) : [];
}

@Injectable()
export class LeadFormsService {
  constructor(private readonly repository: LeadFormsRepository) {}

  private assertAllScope(): void {
    const scope = requireScopeContext();
    if (scope.scope !== "all") {
      throw new ForbiddenException({
        code: "lead_forms.scope_unresolvable",
        title: "Scope not supported",
        detail: `The "${scope.scope}" data-scope is not resolvable for lead-form configs.`,
      });
    }
  }

  // ─── Admin (CRM) CRUD ────────────────────────────────────────────────────

  async list(tenantId: string, query: ListLeadFormsQuery): Promise<PaginatedResult<LeadForm>> {
    this.assertAllScope();
    const { rows, total } = await this.repository.list({
      tenantId,
      active: query.active,
      page: query.page,
      pageSize: query.pageSize,
    });
    return new PaginatedResult(rows.map(toDto), {
      page: query.page,
      pageSize: query.pageSize,
      total,
      hasMore: query.page * query.pageSize < total,
    });
  }

  async getById(tenantId: string, id: string): Promise<LeadForm> {
    this.assertAllScope();
    const row = await this.repository.findById(tenantId, id);
    if (!row) throw new NotFoundException({ code: "lead_forms.not_found", title: "Lead form not found" });
    return toDto(row);
  }

  async create(tenantId: string, body: CreateLeadFormRequest): Promise<LeadForm> {
    this.assertAllScope();
    const existing = await this.repository.findByKey(tenantId, body.key);
    if (existing) {
      throw new ConflictException({ code: "lead_forms.key_taken", title: "Key already in use", detail: `key="${body.key}" is already used by another lead form.` });
    }
    try {
      const created = await this.repository.create(tenantId, {
        key: body.key,
        name: body.name,
        fields: body.fields as Prisma.InputJsonValue,
        targetProgramId: body.targetProgramId ?? null,
        active: body.active,
      });
      const row = await this.repository.findById(tenantId, created.id);
      if (!row) throw new NotFoundException({ code: "lead_forms.not_found", title: "Lead form not found after creation" });
      return toDto(row);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException({ code: "lead_forms.key_taken", title: "Key already in use" });
      }
      throw err;
    }
  }

  async update(tenantId: string, id: string, body: UpdateLeadFormRequest): Promise<LeadForm> {
    this.assertAllScope();
    const existing = await this.repository.findById(tenantId, id);
    if (!existing) throw new NotFoundException({ code: "lead_forms.not_found", title: "Lead form not found" });

    if (body.key !== undefined && body.key !== existing.key) {
      const clash = await this.repository.findByKey(tenantId, body.key);
      if (clash) {
        throw new ConflictException({ code: "lead_forms.key_taken", title: "Key already in use" });
      }
    }

    try {
      await this.repository.update(id, {
        ...(body.key !== undefined ? { key: body.key } : {}),
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.fields !== undefined ? { fields: body.fields as Prisma.InputJsonValue } : {}),
        ...(body.targetProgramId !== undefined ? { targetProgramId: body.targetProgramId ?? null } : {}),
        ...(body.active !== undefined ? { active: body.active } : {}),
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException({ code: "lead_forms.key_taken", title: "Key already in use" });
      }
      throw err;
    }

    const updated = await this.repository.findById(tenantId, id);
    if (!updated) throw new NotFoundException({ code: "lead_forms.not_found", title: "Lead form not found after update" });
    return toDto(updated);
  }

  async softDelete(tenantId: string, id: string): Promise<void> {
    this.assertAllScope();
    const existing = await this.repository.findById(tenantId, id);
    if (!existing) throw new NotFoundException({ code: "lead_forms.not_found", title: "Lead form not found" });
    await this.repository.softDelete(id);
  }

  // ─── Public (anonymous, active only) ─────────────────────────────────────

  private async resolveTenantId(): Promise<string> {
    const tenantId = await this.repository.getTenantIdBySlug(TENANT_SLUG);
    if (!tenantId) throw new NotFoundException({ code: "lead_forms.tenant_not_found", title: "Tenant not found" });
    return tenantId;
  }

  async getPublicByKey(key: string): Promise<PublicLeadForm> {
    const tenantId = await this.resolveTenantId();
    const row = await this.repository.findActiveByKey(tenantId, key);
    if (!row) throw new NotFoundException({ code: "lead_forms.not_found", title: "Lead form not found" });
    return {
      key: row.key,
      name: row.name,
      fields: toFields(row.fields),
      targetProgramId: row.targetProgramId,
    };
  }
}

function toDto(row: LeadFormRow): LeadForm {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    fields: toFields(row.fields),
    targetProgramId: row.targetProgramId,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
