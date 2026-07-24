// apps/api/src/modules/audit/audit.service.ts
//
// Business logic for the read-only audit-log viewer (docs/04-trd-architecture.md §2.1,
// docs/03 §7.16 / §20(b)). `audit_logs.view` is seeded at scope=all only — no data-scope
// resolution needed here. `before`/`after` are returned exactly as redacted at WRITE time
// by the Prisma audit extension (see audit.extension.ts) — never re-redacted/re-exposed
// of secrets here, since the secret fields were already stripped before the row was ever
// persisted.

import { Injectable } from "@nestjs/common";
import type { AuditLogEntry } from "@repo/types";
import { AuditRepository, type AuditLogRow } from "./audit.repository";
import { PaginatedResult } from "../../common/dto/paginated-result";
import type { ListAuditLogsQuery } from "./dto";

@Injectable()
export class AuditService {
  constructor(private readonly repository: AuditRepository) {}

  async list(tenantId: string, query: ListAuditLogsQuery): Promise<PaginatedResult<AuditLogEntry>> {
    const { rows, total } = await this.repository.list({
      tenantId,
      entity: query.entity,
      entityId: query.entityId,
      actorId: query.actorId,
      action: query.action,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
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
}

function toDto(row: AuditLogRow): AuditLogEntry {
  return {
    id: row.id,
    actorId: row.actorId,
    actorName: row.actorName,
    entity: row.entity,
    entityId: row.entityId,
    action: row.action as AuditLogEntry["action"],
    before: (row.before as AuditLogEntry["before"]) ?? null,
    after: (row.after as AuditLogEntry["after"]) ?? null,
    ip: row.ip,
    createdAt: row.createdAt.toISOString(),
  };
}
