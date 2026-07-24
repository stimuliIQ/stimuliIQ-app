// apps/api/src/modules/content/site-settings.service.ts
//
// Business logic for `SiteSetting` (docs/specs/phase-10-page-builder.md). No Prisma here
// (CLAUDE.md §3.3). `site_settings.view`/`.edit` are super_admin-only (prisma/seed.ts) —
// enforced by the controller's `@RequirePermission`; this service additionally enforces
// scope=all (same "page-builder/site-wide config is not branch-scoped" posture as
// ContentPagesBuilderService).
//
// KEYED VALIDATION (site-settings.schemas.ts header): `PUT .../:key`'s `value` is
// validated at RUNTIME against `SiteSettingValueSchemaByKey[key]` — the schema depends
// on the path param, not the route itself, so it cannot be a static per-route zod body
// schema at the controller layer. Both the key AND the value are validated here.

import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  SiteSettingKeySchema,
  SiteSettingValueSchemaByKey,
  type SiteSetting,
  type ListSiteSettingsQuery,
  type UpsertSiteSettingRequest,
  type PublicSiteSettingsResponse,
} from "@repo/types";
import { SiteSettingsRepository, type SiteSettingRow } from "./site-settings.repository";
import { requireScopeContext } from "../auth/lib/scope-context";
import { TENANT_SLUG } from "./content.util";
import { keyToGroup, DEFAULT_PUBLIC_SITE_SETTINGS } from "./site-settings.constants";

function toDto(row: SiteSettingRow): SiteSetting {
  return { id: row.id, key: row.key as SiteSetting["key"], group: row.group as SiteSetting["group"], value: row.value, updatedAt: row.updatedAt.toISOString() };
}

function notFoundError(key: string): NotFoundException {
  return new NotFoundException({ code: "site_settings.not_found", title: "Site setting not found", detail: `"${key}" is not a recognized site setting key.` });
}

@Injectable()
export class SiteSettingsService {
  constructor(private readonly repository: SiteSettingsRepository) {}

  private assertAllScope(): void {
    const scope = requireScopeContext();
    if (scope.scope !== "all") {
      throw new ForbiddenException({ code: "site_settings.scope_unresolvable", title: "Scope not supported", detail: `The "${scope.scope}" data-scope is not resolvable for site settings.` });
    }
  }

  async list(tenantId: string, query: ListSiteSettingsQuery): Promise<SiteSetting[]> {
    this.assertAllScope();
    const rows = await this.repository.findAll(tenantId, query.group);
    return rows.map(toDto);
  }

  async getByKey(tenantId: string, key: string): Promise<SiteSetting> {
    this.assertAllScope();
    const parsedKey = SiteSettingKeySchema.safeParse(key);
    if (!parsedKey.success) throw notFoundError(key);
    const row = await this.repository.findByKey(tenantId, parsedKey.data);
    if (!row) throw notFoundError(key);
    return toDto(row);
  }

  /**
   * `PUT /crm/site-settings/:key` — 404 for any `:key` outside the 7 seeded literals
   * (this endpoint upserts existing keys only, never creates a new one); 400 with
   * field-level errors when `value` fails that key's closed shape
   * (`SiteSettingValueSchemaByKey[key]`).
   */
  async upsert(tenantId: string, key: string, body: UpsertSiteSettingRequest): Promise<SiteSetting> {
    this.assertAllScope();
    const parsedKey = SiteSettingKeySchema.safeParse(key);
    if (!parsedKey.success) throw notFoundError(key);

    const valueSchema = SiteSettingValueSchemaByKey[parsedKey.data];
    const parsedValue = valueSchema.safeParse(body.value);
    if (!parsedValue.success) {
      throw new BadRequestException({
        code: "validation.failed",
        title: "Validation failed",
        detail: `"${key}"'s value failed validation.`,
        errors: parsedValue.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      });
    }

    const row = await this.repository.upsert(tenantId, parsedKey.data, keyToGroup(parsedKey.data), parsedValue.data as Prisma.InputJsonValue);
    return toDto(row);
  }

  /**
   * `GET /public/site-settings` — anonymous, cacheable. All 7 keys are guaranteed by
   * seed; if one is missing/corrupted (fails re-validation against its own schema —
   * defense in depth against a hand-edited row), falls back to
   * `DEFAULT_PUBLIC_SITE_SETTINGS[key]` rather than 500ing.
   */
  async getPublic(): Promise<PublicSiteSettingsResponse> {
    const tenantId = await this.repository.getTenantIdBySlug(TENANT_SLUG);
    if (!tenantId) throw new NotFoundException({ code: "content.tenant_not_found", title: "Tenant not found" });
    const rows = await this.repository.findAll(tenantId);
    const byKey = new Map(rows.map((row) => [row.key, row.value]));

    const result = {} as Record<string, unknown>;
    for (const key of SiteSettingKeySchema.options) {
      const raw = byKey.get(key);
      const schema = SiteSettingValueSchemaByKey[key];
      const parsed = raw !== undefined ? schema.safeParse(raw) : undefined;
      result[key] = parsed?.success ? parsed.data : DEFAULT_PUBLIC_SITE_SETTINGS[key];
    }
    return result as PublicSiteSettingsResponse;
  }
}
