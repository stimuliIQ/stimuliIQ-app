// apps/api/src/modules/bulk-actions/saved-views.repository.ts
//
// Prisma data access ONLY for saved views (docs/plans/phase-9-completion.md T30).
//
// PERSISTENCE NOTE (documented deviation — see bulk-actions.schemas.ts's file header
// for the same class of constraint): there is no dedicated `SavedView` Prisma model —
// this task may only touch `prisma/` for the additive search-index migration (T29), so
// no new table could be added for this feature. Saved views are instead persisted as
// rows on the EXISTING `settings` table (`scope = company`), which already carries
// `tenantId` + an arbitrary JSON `value` — NOT because a saved view is a "company
// setting" semantically, but because it is the only pre-existing tenant-scoped
// key/JSON-value store available without a schema change. Per-user ownership (a saved
// view is own-scope, not shared company-wide) is enforced ENTIRELY in the `value` JSON
// payload (`value.userId`), NEVER by trusting the `settings.scope` column alone — every
// read/write below filters explicitly on `value.userId = callerId` in addition to
// `tenantId`. The `key` column additionally embeds `saved_view:<module>:<userId>:` as a
// prefix purely so `list()` can filter efficiently; ownership is still re-verified via
// `value.userId` on every mutation (belt-and-braces, since a key COULD in principle be
// hand-crafted to collide). FOLLOW-UP (flagged in this task's report): db-architect
// should add a proper `SavedView` model in a later migration wave; this repository's
// query shape is intentionally isolated (not reused by PlatformModule's
// SettingsRepository) so swapping the storage backend later is a one-file change.

import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { SettingScope, type Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import type { SavedViewModule } from "./dto";

export interface SavedViewRow {
  id: string;
  module: SavedViewModule;
  name: string;
  filters: Record<string, unknown>;
  createdAt: Date;
}

const KEY_PREFIX = "saved_view:";
const ALL_MODULES: readonly SavedViewModule[] = ["leads", "students"];

function keyFor(module: SavedViewModule, userId: string): string {
  return `${KEY_PREFIX}${module}:${userId}:${randomUUID()}`;
}

interface SavedViewValue {
  userId: string;
  name: string;
  filters: Record<string, unknown>;
}

@Injectable()
export class SavedViewsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    tenantId: string,
    userId: string,
    module: SavedViewModule,
    name: string,
    filters: Record<string, unknown>,
  ): Promise<SavedViewRow> {
    const value: SavedViewValue = { userId, name, filters };
    const row = await this.prisma.client.setting.create({
      data: {
        tenantId,
        scope: SettingScope.company,
        key: keyFor(module, userId),
        value: value as unknown as Prisma.InputJsonValue,
      },
    });
    return { id: row.id, module, name, filters, createdAt: row.createdAt };
  }

  async list(tenantId: string, userId: string, module?: SavedViewModule): Promise<SavedViewRow[]> {
    const modules = module ? [module] : ALL_MODULES;
    const rows = await this.prisma.client.setting.findMany({
      where: {
        tenantId,
        scope: SettingScope.company,
        // The key prefix already embeds userId, so this query is own-scope by
        // construction — the `value.userId` re-check inside `toRow()`'s caller below is
        // defense-in-depth, not the primary guard.
        OR: modules.map((m) => ({ key: { startsWith: `${KEY_PREFIX}${m}:${userId}:` } })),
      },
      orderBy: { createdAt: "desc" },
    });
    return rows
      .map((row) => toRow(row.id, row.key, row.value, row.createdAt))
      .filter((row): row is SavedViewRow => row !== null);
  }

  /** IDOR-safe by-id lookup: only returns a row this exact user owns. */
  async findOwnById(tenantId: string, userId: string, id: string): Promise<SavedViewRow | null> {
    const row = await this.prisma.client.setting.findFirst({ where: { id, tenantId, scope: SettingScope.company } });
    if (!row) return null;
    const value = row.value as unknown as SavedViewValue;
    if (!value || value.userId !== userId) return null; // ownership check — never trust the key alone.
    const module = moduleFromKey(row.key);
    if (!module) return null;
    return { id: row.id, module, name: value.name, filters: value.filters, createdAt: row.createdAt };
  }

  async softDelete(id: string): Promise<void> {
    await this.prisma.client.setting.delete({ where: { id } }); // rewritten to soft-delete by the extension.
  }
}

function moduleFromKey(key: string): SavedViewModule | null {
  const withoutPrefix = key.startsWith(KEY_PREFIX) ? key.slice(KEY_PREFIX.length) : null;
  if (!withoutPrefix) return null;
  const [module] = withoutPrefix.split(":");
  return (ALL_MODULES as readonly string[]).includes(module ?? "") ? (module as SavedViewModule) : null;
}

function toRow(id: string, key: string, value: unknown, createdAt: Date): SavedViewRow | null {
  const module = moduleFromKey(key);
  const v = value as SavedViewValue | null;
  if (!module || !v) return null;
  return { id, module, name: v.name, filters: v.filters, createdAt };
}
