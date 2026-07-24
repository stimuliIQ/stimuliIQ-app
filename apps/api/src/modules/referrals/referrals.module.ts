// apps/api/src/modules/referrals/referrals.module.ts
//
// Wires the Phase-9 Completion Referrals/Affiliate feature module (T11/T25,
// docs/plans/phase-9-completion.md): own-scope link generation (/me/referrals),
// anonymous redeem (/public/referrals/redeem), and CRM oversight (/crm/referrals).
//
// Imports:
//   AuthModule — JwtAuthGuard, PermissionsGuard, ScopeInterceptor.

import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { CaptchaProviderModule } from "../captcha/providers/captcha/captcha-provider.module";
import { MyReferralsController, PublicReferralsController, CrmReferralsController } from "./referrals.controller";
import { ReferralsService } from "./referrals.service";
import { ReferralsRepository } from "./referrals.repository";
import { PublicReferralRateLimiter } from "./lib/public-referral-rate-limiter";

// CaptchaProviderModule — CAPTCHA_PROVIDER token for the public redeem endpoint (Wave 6 M2).
// PublicReferralRateLimiter uses RedisService directly (RedisModule is @Global).
@Module({
  imports: [AuthModule, CaptchaProviderModule],
  controllers: [MyReferralsController, PublicReferralsController, CrmReferralsController],
  providers: [ReferralsService, ReferralsRepository, PublicReferralRateLimiter],
  exports: [ReferralsService],
})
export class ReferralsModule {}
