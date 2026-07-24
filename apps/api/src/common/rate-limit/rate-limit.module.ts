// apps/api/src/common/rate-limit/rate-limit.module.ts
//
// Shared module for rate-limit guards consumed by MORE THAN ONE feature module
// (CommerceModule + CampaignsModule both apply WebhookIpRateLimitGuard to their
// respective public webhook controllers). Depends only on the @Global() RedisModule's
// RedisService, so no other imports are needed here.

import { Module } from "@nestjs/common";
import { WebhookIpRateLimitGuard } from "./webhook-ip-rate-limit.guard";

@Module({
  providers: [WebhookIpRateLimitGuard],
  exports: [WebhookIpRateLimitGuard],
})
export class RateLimitModule {}
