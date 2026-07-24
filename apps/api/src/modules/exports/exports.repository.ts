// apps/api/src/modules/exports/exports.repository.ts
//
// Prisma data access ONLY for the `export_jobs` table (CLAUDE.md §3.3: "repository —
// Prisma data access only ... No business logic"). ExportsService is the only caller.
// Every query is ALWAYS tenant-scoped. The `ExportJob` Prisma model already exists
// (db-architect Wave 1, docs/plans/phase-7.md task #4) with soft-delete + the
// `AUDITED_MODELS` extension covering its own create/update lifecycle (see
// apps/api/src/prisma/audit.extension.ts). AC-36 additionally requires an EXPLICIT
// `entity='export'` audit_logs row on completion — `writeAuditLog()` below is that
// separate write (mirrors certificates.repository.ts's `writeAuditLog` helper).

import { Injectable } from "@nestjs/common";
import type { ExportJobStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";

export interface ExportJobRow {
  id: string;
  tenantId: string;
  requestedById: string;
  requestedByName: string | null;
  type: string;
  format: string;
  params: Prisma.JsonValue;
  status: ExportJobStatus;
  storageKey: string | null;
  error: string | null;
  rowCount: number | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface CreateExportJobInput {
  tenantId: string;
  requestedById: string;
  type: string;
  format: string;
  /** The caller-supplied filter params (already zod-validated at the controller boundary). */
  params: Record<string, unknown>;
}

export interface ListExportJobsFilters {
  tenantId: string;
  /** Restrict to jobs requested by this user (own/branch/assigned-scope callers only see their own export history — export_jobs carries no branch/batch column of its own). */
  requestedById?: string;
  type?: string;
  status?: ExportJobStatus;
  page: number;
  pageSize: number;
}

@Injectable()
export class ExportsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateExportJobInput): Promise<ExportJobRow> {
    // `export_jobs.params` (Wave 1 schema) has no dedicated `format` column — the
    // Prisma model is frozen at { id, tenantId, requestedById, type, params, status,
    // storageKey, error, rowCount, ...soft-delete }. `format` (csv|pdf) is persisted
    // INSIDE the `params` JSON envelope alongside the caller's actual filter params
    // (never flattened together with them) so `findById`/`list` can always recover
    // both the intended output format AND the exact filters used, without a schema
    // migration. See `toRow()` below for the corresponding unwrap.
    const row = await this.prisma.client.exportJob.create({
      data: {
        tenantId: input.tenantId,
        requestedById: input.requestedById,
        type: input.type,
        params: { format: input.format, filters: input.params } as Prisma.InputJsonValue,
        status: "queued",
      },
      include: { requestedBy: { select: { name: true } } },
    });
    return toRow(row);
  }

  async findById(tenantId: string, id: string): Promise<ExportJobRow | null> {
    const row = await this.prisma.client.exportJob.findFirst({
      where: { id, tenantId },
      include: { requestedBy: { select: { name: true } } },
    });
    return row ? toRow(row) : null;
  }

  async list(filters: ListExportJobsFilters): Promise<{ rows: ExportJobRow[]; total: number }> {
    const where: Prisma.ExportJobWhereInput = {
      tenantId: filters.tenantId,
      ...(filters.requestedById ? { requestedById: filters.requestedById } : {}),
      ...(filters.type ? { type: filters.type } : {}),
      ...(filters.status ? { status: filters.status } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.client.exportJob.findMany({
        where,
        include: { requestedBy: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
      this.prisma.client.exportJob.count({ where }),
    ]);

    return { rows: rows.map(toRow), total };
  }

  async markRunning(id: string): Promise<void> {
    await this.prisma.client.exportJob.update({ where: { id }, data: { status: "running" } });
  }

  async markSucceeded(id: string, data: { storageKey: string; rowCount: number }): Promise<void> {
    await this.prisma.client.exportJob.update({
      where: { id },
      data: { status: "succeeded", storageKey: data.storageKey, rowCount: data.rowCount, error: null },
    });
  }

  async markFailed(id: string, sanitizedError: string): Promise<void> {
    await this.prisma.client.exportJob.update({
      where: { id },
      data: { status: "failed", error: sanitizedError },
    });
  }

  // ─── Audit logging (AC-36 — separate, explicit entity='export' row) ────────────

  async writeAuditLog(data: {
    tenantId: string;
    actorId: string;
    entityId: string;
    action: string;
    after: unknown;
  }): Promise<void> {
    await this.prisma.client.auditLog.create({
      data: {
        tenantId: data.tenantId,
        actorId: data.actorId,
        entity: "export",
        entityId: data.entityId,
        action: data.action,
        after: data.after as Prisma.InputJsonValue,
      },
    });
  }
}

function toRow(row: {
  id: string;
  tenantId: string;
  requestedById: string;
  type: string;
  params: Prisma.JsonValue;
  status: ExportJobStatus;
  storageKey: string | null;
  error: string | null;
  rowCount: number | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  requestedBy: { name: string } | null;
}): ExportJobRow {
  const envelope = (row.params ?? {}) as { format?: unknown; filters?: unknown };
  const format = typeof envelope.format === "string" ? envelope.format : "csv";
  const filters = (envelope.filters ?? {}) as Prisma.JsonValue;
  return {
    id: row.id,
    tenantId: row.tenantId,
    requestedById: row.requestedById,
    requestedByName: row.requestedBy?.name ?? null,
    type: row.type,
    format,
    params: filters,
    status: row.status,
    storageKey: row.storageKey,
    error: row.error,
    rowCount: row.rowCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}
