// apps/api/src/modules/marketing-targets/marketing-targets.module.ts
//
// Monthly marketing targets (docs/specs/marketing-targets.md, ADR-0067).
//
// Imports AuthModule only — JwtAuthGuard and PermissionsGuard. Every route is staff-only,
// there is no public surface, and the feature sends no notifications: a target is a number
// you look at, not an event anybody needs to be told about. (If "you hit your target" ever
// becomes a notification, that is the moment to import NotificationsModule.)
import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";

import {
  MarketingTargetsAdminController,
  MyMarketingTargetController,
} from "./marketing-targets.controller";
import { MarketingTargetsRepository } from "./marketing-targets.repository";
import { MarketingTargetsService } from "./marketing-targets.service";

@Module({
  imports: [AuthModule],
  // MyMarketingTargetController is listed FIRST so its literal `me` route is matched before
  // the admin controller's parameterised routes on the same base path.
  controllers: [MyMarketingTargetController, MarketingTargetsAdminController],
  providers: [MarketingTargetsService, MarketingTargetsRepository],
})
export class MarketingTargetsModule {}
