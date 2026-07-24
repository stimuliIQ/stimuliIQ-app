// apps/api/src/modules/content/site-settings.repository.ts
//
// Prisma data access ONLY (CLAUDE.md §3.3) for `SiteSetting`. SiteSettingsService is the
// only caller. Soft-delete + audit handled transparently by the Prisma client
// extensions (SiteSetting registered in both — see prisma/audit.extension.ts).
// `(tenantId, key)` is a raw-SQL partial-unique index (WHERE deleted_at IS NULL, same
// pattern as ContentPage.slug) — `upsert()` below does an explicit find-then-write
// rather than a Prisma-level `.upsert()` (which requires a `@@unique` Prisma can see;
// this partial index isn't one — see docs "Partial unique indexes in raw SQL").

import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";

export interface SiteSettingRow {
  id: string;
  key: string;
  group: string;
  value: Prisma.JsonValue;
  updatedAt: Date;
}

@Injectable()
export class SiteSettingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(tenantId: string, group?: string): Promise<SiteSettingRow[]> {
    return this.prisma.client.siteSetting.findMany({
      where: { tenantId, deletedAt: null, ...(group ? { group } : {}) },
      orderBy: [{ group: "asc" }, { key: "asc" }],
    });
  }

  async findByKey(tenantId: string, key: string): Promise<SiteSettingRow | null> {
    return this.prisma.client.siteSetting.findFirst({ where: { tenantId, key, deletedAt: null } });
  }

  /** Upsert-by-(tenantId,key) — matches the partial-unique `site_settings_active_tenant_key_key` index. */
  async upsert(tenantId: string, key: string, group: string, value: Prisma.InputJsonValue): Promise<SiteSettingRow> {
    const existing = await this.findByKey(tenantId, key);
    if (existing) {
      return this.prisma.client.siteSetting.update({ where: { id: existing.id }, data: { value, group } });
    }
    return this.prisma.client.siteSetting.create({ data: { tenantId, key, group, value } });
  }

  async getTenantIdBySlug(slug: string): Promise<string | null> {
    const row = await this.prisma.client.tenant.findUnique({ where: { slug }, select: { id: true } });
    return row?.id ?? null;
  }
}
