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
import { FeatureFlagsController, FeatureFlagsEvaluateController } from "./feature-flags.controller";
import { FeatureFlagsService } from "./feature-flags.service";
import { FeatureFlagsRepository } from "./feature-flags.repository";
import { SettingsController } from "./settings.controller";
import { SettingsService } from "./settings.service";
import { SettingsRepository } from "./settings.repository";
import { CompanyProfileService } from "./company-profile.service";

@Module({
  imports: [AuthModule, RedisModule],
  controllers: [FeatureFlagsController, FeatureFlagsEvaluateController, SettingsController],
  providers: [FeatureFlagsService, FeatureFlagsRepository, SettingsService, SettingsRepository, CompanyProfileService],
  exports: [FeatureFlagsService, SettingsService, CompanyProfileService],
})
export class PlatformModule {}
