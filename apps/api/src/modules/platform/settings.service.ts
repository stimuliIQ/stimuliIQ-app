// apps/api/src/modules/platform/settings.service.ts
//
// Business logic for system/company settings (T9/T14/T23, docs/plans/phase-9-completion.md).
// No Prisma here (CLAUDE.md §3.3) — all persistence goes through SettingsRepository.
//
// SCOPE: `settings` carries no `branch_id` column — `branch_manager`'s settings.view
// grant (seed: RolePermissionScope.branch) therefore resolves to "no restriction beyond
// tenant" (documented gap, mirrors MentorsService/MentorsRepository precedent exactly —
// see mentors.service.ts file header). WRITES (settings.edit) are further restricted:
// only a caller whose resolved scope is "all" may write ANY setting — since settings.edit
// is seeded exclusively via the admin/super_admin catch-all at scope=all (no non-admin
// role ever holds settings.edit per prisma/seed.ts), this also enforces the DTO's
// documented "system scope: Owner/Admin only" business rule without extra branching:
// nobody who could reach the write path could ever be scope=branch in the first place.

import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma, Setting as SettingRow } from "@prisma/client";
import type { Setting, ListSettingsQuery, SetSettingRequest, SettingScope } from "@repo/types";
import { SettingsRepository } from "./settings.repository";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { requireScopeContext } from "../auth/lib/scope-context";

function toDto(row: SettingRow): Setting {
  return {
    id: row.id,
    scope: row.scope as SettingScope,
    key: row.key,
    value: row.value,
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class SettingsService {
  constructor(private readonly repository: SettingsRepository) {}

  /** Reads: "all" and "branch" both resolve to "no restriction" (documented gap, no branch_id column). */
  private assertReadableScope(): void {
    const scope = requireScopeContext();
    if (scope.scope !== "all" && scope.scope !== "branch") {
      throw new ForbiddenException({
        code: "settings.scope_unresolvable",
        title: "Scope not supported",
        detail: `The "${scope.scope}" data-scope is not resolvable for the settings module.`,
      });
    }
  }

  /** Writes: only scope="all" (naturally only admin/super_admin, since settings.edit is never granted below scope=all). */
  private assertWritableScope(): void {
    const scope = requireScopeContext();
    if (scope.scope !== "all") {
      throw new ForbiddenException({
        code: "settings.write_forbidden",
        title: "Insufficient scope to write settings",
        detail: "Writing settings (system or company scope) requires the all-scope settings.edit grant.",
      });
    }
  }

  async list(tenantId: string, query: ListSettingsQuery): Promise<PaginatedResult<Setting>> {
    this.assertReadableScope();
    const { rows, total } = await this.repository.list({
      tenantId,
      scope: query.scope,
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

  async get(tenantId: string, scope: SettingScope, key: string): Promise<Setting> {
    this.assertReadableScope();
    const row = await this.repository.findByScopeAndKey(tenantId, scope, key);
    if (!row) throw new NotFoundException({ code: "settings.not_found", title: "Setting not found" });
    return toDto(row);
  }

  async set(tenantId: string, scope: SettingScope, key: string, body: SetSettingRequest): Promise<Setting> {
    this.assertWritableScope();
    const row = await this.repository.upsert(tenantId, scope, key, (body.value ?? null) as Prisma.InputJsonValue);
    return toDto(row);
  }
}
