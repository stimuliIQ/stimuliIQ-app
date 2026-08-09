// apps/api/src/modules/platform/platform.module.ts
//
// Wires the Phase-9 Completion Platform feature module (T9/T23,
// docs/plans/phase-9-completion.md): feature flags (admin CRUD + any-authenticated
// cached evaluate) + system/company settings (admin CRUD).
//
// Imports:
//   AuthModule — JwtAuthGuard, PermissionsGuard, ScopeInterceptor.
//   RedisModule — RedisService (flag-evaluation cache).

import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { RedisModule } from "../../redis/redis.module";
import { SettingsController } from "./settings.controller";
import { SettingsService } from "./settings.service";
import { SettingsRepository } from "./settings.repository";
import { CompanyProfileService } from "./company-profile.service";

@Module({
  imports: [AuthModule, RedisModule],
  controllers: [SettingsController],
  providers: [SettingsService, SettingsRepository, CompanyProfileService],
  exports: [SettingsService, CompanyProfileService],
})
export class PlatformModule {}
