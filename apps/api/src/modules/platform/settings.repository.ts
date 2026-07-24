// apps/api/src/modules/platform/settings.repository.ts
//
// Prisma data access ONLY for `settings` (CLAUDE.md §3.3). SettingsService is the only
// caller. Soft-delete + audit are handled transparently by the Prisma client extensions
// (Setting is already registered in both).
//
// Tenant-scoped only — same "no branch_id column" precedent as FeatureFlagsRepository;
// SettingsService narrows "branch" scope (branch_manager's settings.view grant) to
// "no restriction beyond tenant" (documented gap, mirrors MentorsRepository).

import { Injectable } from "@nestjs/common";
import type { Prisma, Setting as SettingRow, SettingScope } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";

export interface ListSettingsFilters {
  tenantId: string;
  scope?: SettingScope;
  page: number;
  pageSize: number;
}

@Injectable()
export class SettingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(filters: ListSettingsFilters): Promise<{ rows: SettingRow[]; total: number }> {
    const where: Prisma.SettingWhereInput = {
      tenantId: filters.tenantId,
      ...(filters.scope ? { scope: filters.scope } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.client.setting.findMany({
        where,
        orderBy: [{ scope: "asc" }, { key: "asc" }],
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
      this.prisma.client.setting.count({ where }),
    ]);

    return { rows, total };
  }

  findByScopeAndKey(tenantId: string, scope: SettingScope, key: string): Promise<SettingRow | null> {
    return this.prisma.client.setting.findFirst({ where: { tenantId, scope, key } });
  }

  /** Upsert-by-(tenantId,scope,key) — matches the partial-unique `settings_active_tenant_scope_key_key` index. */
  async upsert(tenantId: string, scope: SettingScope, key: string, value: Prisma.InputJsonValue): Promise<SettingRow> {
    const existing = await this.findByScopeAndKey(tenantId, scope, key);
    if (existing) {
      return this.prisma.client.setting.update({ where: { id: existing.id }, data: { value } });
    }
    return this.prisma.client.setting.create({ data: { tenantId, scope, key, value } });
  }
}
