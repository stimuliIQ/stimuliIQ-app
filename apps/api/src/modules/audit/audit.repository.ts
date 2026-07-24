// apps/api/src/modules/audit/audit.repository.ts
//
// Prisma data access ONLY (docs/04-trd-architecture.md §2.1). AuditService is the only
// caller. Read-only — `audit_logs` is append-only (see audit.extension.ts file header:
// "explicitly EXEMPT from soft-delete") and has no write API of its own here; every
// mutating endpoint elsewhere writes its own row via the Prisma audit extension.
// `audit_logs.*` is seeded at scope=all only (super_admin/admin) — no branch/assigned/own
// scope exists for this module in P1 (confirmed against prisma/seed.ts).

import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

export interface ListAuditLogsFilters {
  tenantId: string;
  entity?: string;
  entityId?: string;
  actorId?: string;
  action?: "create" | "update" | "delete" | "restore";
  from?: Date;
  to?: Date;
  page: number;
  pageSize: number;
}

export interface AuditLogRow {
  id: string;
  actorId: string | null;
  actorName: string | null;
  entity: string;
  entityId: string;
  action: string;
  before: unknown;
  after: unknown;
  ip: string | null;
  createdAt: Date;
}

@Injectable()
export class AuditRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(filters: ListAuditLogsFilters): Promise<{ rows: AuditLogRow[]; total: number }> {
    const where = {
      tenantId: filters.tenantId,
      ...(filters.entity ? { entity: filters.entity } : {}),
      ...(filters.entityId ? { entityId: filters.entityId } : {}),
      ...(filters.actorId ? { actorId: filters.actorId } : {}),
      ...(filters.action ? { action: filters.action } : {}),
      ...(filters.from || filters.to
        ? { createdAt: { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lte: filters.to } : {}) } }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.client.auditLog.findMany({
        where,
        include: { actor: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
      this.prisma.client.auditLog.count({ where }),
    ]);

    return {
      rows: rows.map((row) => ({
        id: row.id,
        actorId: row.actorId,
        actorName: row.actor?.name ?? null,
        entity: row.entity,
        entityId: row.entityId,
        action: row.action,
        before: row.before,
        after: row.after,
        ip: row.ip,
        createdAt: row.createdAt,
      })),
      total,
    };
  }
}
