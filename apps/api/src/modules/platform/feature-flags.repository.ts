// apps/api/src/modules/platform/feature-flags.repository.ts
//
// Prisma data access ONLY for `feature_flags` (CLAUDE.md §3.3). FeatureFlagsService is
// the only caller. Soft-delete + audit are handled transparently by the Prisma client
// extensions (FeatureFlag is already registered in both — see prisma/audit.extension.ts
// / prisma/soft-delete.extension.ts).
//
// Tenant-scoped only — `feature_flags` carries no `branch_id`/`assigned_to`/`owner`
// column, so (mirroring MentorsRepository's documented precedent) there is no
// meaningful narrowing beyond tenant_id; the service's assertResolvableScope() only
// ever needs to allow scope="all" for this module (flags.view/flags.edit are seeded
// exclusively at the admin/super_admin catch-all, scope=all — see
// platform.permission-catalog.spec.ts).

import { Injectable } from "@nestjs/common";
import type { Prisma, FeatureFlag as FeatureFlagRow } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";

export interface ListFeatureFlagsFilters {
  tenantId: string;
  enabled?: boolean;
  search?: string;
  page: number;
  pageSize: number;
}

@Injectable()
export class FeatureFlagsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(filters: ListFeatureFlagsFilters): Promise<{ rows: FeatureFlagRow[]; total: number }> {
    const where: Prisma.FeatureFlagWhereInput = {
      tenantId: filters.tenantId,
      ...(filters.enabled !== undefined ? { enabled: filters.enabled } : {}),
      ...(filters.search ? { key: { contains: filters.search, mode: "insensitive" } } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.client.featureFlag.findMany({
        where,
        orderBy: { key: "asc" },
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
      this.prisma.client.featureFlag.count({ where }),
    ]);

    return { rows, total };
  }

  findByKey(tenantId: string, key: string): Promise<FeatureFlagRow | null> {
    return this.prisma.client.featureFlag.findFirst({ where: { tenantId, key } });
  }

  /** Bulk-read for the /feature-flags/evaluate endpoint — bounded by the caller's `keys` list. */
  findByKeys(tenantId: string, keys: string[]): Promise<FeatureFlagRow[]> {
    return this.prisma.client.featureFlag.findMany({ where: { tenantId, key: { in: keys } } });
  }

  /** Upsert-by-(tenantId,key) — matches the partial-unique `feature_flags_active_tenant_key_key` index. */
  async upsertByKey(
    tenantId: string,
    key: string,
    data: { enabled: boolean; rollout: Prisma.InputJsonValue | typeof Prisma.JsonNull; description: string | null },
  ): Promise<FeatureFlagRow> {
    const existing = await this.findByKey(tenantId, key);
    if (existing) {
      return this.prisma.client.featureFlag.update({
        where: { id: existing.id },
        data: { enabled: data.enabled, rollout: data.rollout, description: data.description },
      });
    }
    return this.prisma.client.featureFlag.create({
      data: { tenantId, key, enabled: data.enabled, rollout: data.rollout, description: data.description },
    });
  }
}
