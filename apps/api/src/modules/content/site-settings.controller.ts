// apps/api/src/modules/content/site-settings.controller.ts
//
// HTTP boundary only (CLAUDE.md §3.3). Two controller classes (ADR-0019 pattern):
//   SiteSettingsController       — /crm/site-settings admin CRUD (super_admin only).
//   PublicSiteSettingsController — /public/site-settings anonymous, cacheable read.

import { Body, Controller, Get, Param, Put, Query, UseGuards, UseInterceptors } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { ScopeInterceptor } from "../auth/interceptors/scope.interceptor";
import { RequirePermission } from "../auth/decorators/require-permission.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/lib/request-user";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { SiteSettingsService } from "./site-settings.service";
import {
  ListSiteSettingsQuerySchema,
  type ListSiteSettingsQuery,
  type SiteSetting,
  UpsertSiteSettingRequestSchema,
  type UpsertSiteSettingRequest,
  type PublicSiteSettingsResponse,
} from "./dto";

@Controller("crm/site-settings")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class SiteSettingsController {
  constructor(private readonly service: SiteSettingsService) {}

  @Get()
  @RequirePermission("site_settings.view")
  async list(@CurrentUser() user: RequestUser, @Query(new ZodValidationPipe(ListSiteSettingsQuerySchema)) query: ListSiteSettingsQuery): Promise<SiteSetting[]> {
    return this.service.list(user.tenantId, query);
  }

  @Get(":key")
  @RequirePermission("site_settings.view")
  async getByKey(@CurrentUser() user: RequestUser, @Param("key") key: string): Promise<SiteSetting> {
    return this.service.getByKey(user.tenantId, key);
  }

  @Put(":key")
  @RequirePermission("site_settings.edit")
  async upsert(
    @CurrentUser() user: RequestUser,
    @Param("key") key: string,
    @Body(new ZodValidationPipe(UpsertSiteSettingRequestSchema)) body: UpsertSiteSettingRequest,
  ): Promise<SiteSetting> {
    return this.service.upsert(user.tenantId, key, body);
  }
}

@Controller("public/site-settings")
export class PublicSiteSettingsController {
  constructor(private readonly service: SiteSettingsService) {}

  /**
   * Anonymous, cacheable — all 7 values are non-sensitive sitewide marketing
   * primitives. No dedicated CDN/HTTP cache-control wiring exists for public content
   * reads elsewhere in this module (`GET /public/pages/:slug`, `/public/testimonials`,
   * etc. carry no explicit `Cache-Control` either) — this endpoint follows the SAME
   * convention (relies on `web`'s own ISR fetch cache, no new caching layer invented
   * here). See report for the explicit "no revalidation-webhook pattern exists" note.
   */
  @Get()
  async getAll(): Promise<PublicSiteSettingsResponse> {
    return this.service.getPublic();
  }
}
