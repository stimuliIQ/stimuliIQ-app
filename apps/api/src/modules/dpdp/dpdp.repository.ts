// apps/api/src/modules/dpdp/dpdp.repository.ts
//
// Prisma data access ONLY (CLAUDE.md §3.3, docs/04-trd-architecture.md §2.1). No business
// logic here — the redaction DECISION (which fields, which rows) lives in DpdpService;
// this file only reads/writes rows.

import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { PII_FIELD_REGISTRY } from "../../prisma/audit.extension";

export interface SubjectIdentifiers {
  id: string;
  email: string | null;
  phone: string | null;
  name: string | null;
}

export interface CandidateAuditRow {
  id: string;
  entity: string;
  entityId: string;
  before: unknown;
  after: unknown;
}

@Injectable()
export class DpdpRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Finds the subject user WITHIN THE CALLER'S TENANT (never cross-tenant — a tenant
   * boundary violation here would let one tenant's admin erase another tenant's user).
   * Includes soft-deleted users: `deletedAt: undefined` opts out of the soft-delete
   * extension's auto-injected `deletedAt: null` filter (same idiom as
   * commerce.repository.ts's `findOrderById(..., includeDeleted)`) — an erasure request
   * for an already-offboarded (soft-deleted) user must still be honorable.
   */
  async findSubject(tenantId: string, subjectUserId: string): Promise<SubjectIdentifiers | null> {
    const user = await this.prisma.client.user.findFirst({
      where: { tenantId, id: subjectUserId, deletedAt: undefined },
      select: { id: true, email: true, phone: true, name: true },
    });
    return user ?? null;
  }

  /**
   * Loads every audit_logs row in this tenant whose `entity` is one of the PII-bearing
   * models registered in `PII_FIELD_REGISTRY` (audit.extension.ts) — bounded by tenant
   * AND by entity, never a cross-tenant or whole-table scan.
   */
  async findCandidateAuditRows(tenantId: string): Promise<CandidateAuditRow[]> {
    const models = Object.keys(PII_FIELD_REGISTRY);
    return this.prisma.client.auditLog.findMany({
      where: { tenantId, entity: { in: models } },
      select: { id: true, entity: true, entityId: true, before: true, after: true },
    });
  }

  /**
   * Overwrites the before/after JSON of ONE existing audit_logs row with its redacted
   * form. This is a controlled, targeted field-level redaction — NOT a delete, and NOT a
   * wholesale snapshot replacement of fields outside the PII registry (Rule H-5: the
   * audit trail's non-PII shape survives).
   */
  async redactAuditRow(id: string, before: unknown, after: unknown): Promise<void> {
    await this.prisma.client.auditLog.update({
      where: { id },
      data: {
        before: (before ?? undefined) as Prisma.InputJsonValue | undefined,
        after: (after ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  }

  /**
   * Writes the erasure ACTION's own audit_logs row (AC-64: "the erasure action itself
   * writes a new audit_logs row recording that the erasure occurred"). Written directly
   * (not via the audit Prisma extension's automatic per-mutation hook, which only fires
   * for AUDITED_MODELS create/update/delete — this is a distinct, explicit accountability
   * record for the erasure ACTION itself, entity="DpdpErasure", mirroring
   * RolesRepository.recordPermissionMatrixAudit's identical "explicit manual audit write"
   * pattern for a bulk operation that isn't a single-row Prisma mutation).
   */
  async recordErasureAudit(args: {
    tenantId: string;
    actorId: string;
    subjectUserId: string;
    redactedRowCount: number;
    ip?: string;
  }): Promise<void> {
    await this.prisma.client.auditLog.create({
      data: {
        tenantId: args.tenantId,
        actorId: args.actorId,
        entity: "DpdpErasure",
        entityId: args.subjectUserId,
        action: "erasure",
        before: undefined,
        after: { subjectUserId: args.subjectUserId, redactedRowCount: args.redactedRowCount },
        ip: args.ip ?? null,
      },
    });
  }
}
