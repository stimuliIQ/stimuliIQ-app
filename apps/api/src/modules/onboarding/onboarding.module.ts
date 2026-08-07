// apps/api/src/modules/onboarding/onboarding.module.ts
//
// Student onboarding form (stimuliiq.com/onboarding) — the CRM-authored question set plus
// the anonymous public submissions it collects.
//
// Imports:
//   AuthModule               — JwtAuthGuard, PermissionsGuard, ScopeInterceptor (CRM half).
//   CaptchaProviderModule    — CAPTCHA_PROVIDER for the anonymous writes.
//   StorageProviderModule    — STORAGE_PROVIDER for signed upload/download of file answers
//                              (the payment receipt).
//   PublicBookingRateLimiter — provided directly (RedisService is @Global), the same
//                              per-IP fixed-window limiter every other public write uses.

import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { CaptchaProviderModule } from "../captcha/providers/captcha/captcha-provider.module";
import { StorageProviderModule } from "../storage/providers/storage/storage-provider.module";
// Approval activates a student, so it reuses the SAME primitives the card-payment path
// uses rather than re-implementing them: StudentsModule exports StudentsRepository +
// LmsAccountProvisioningService, EnrollmentsModule exports EnrollmentsRepository (whose
// enrollOrRestore also performs the `lead → active` promotion in-transaction).
import { StudentsModule } from "../students/students.module";
import { EnrollmentsModule } from "../enrollments/enrollments.module";
import { PublicBookingRateLimiter } from "../leads/lib/public-booking-rate-limiter";

import {
  OnboardingFieldsController,
  OnboardingSubmissionsController,
  PublicOnboardingController,
} from "./onboarding.controller";
import { OnboardingService } from "./onboarding.service";
import { OnboardingFieldsService } from "./onboarding-fields.service";
import { OnboardingActivationService } from "./onboarding-activation.service";
import { OnboardingRepository } from "./onboarding.repository";

@Module({
  imports: [AuthModule, CaptchaProviderModule, StorageProviderModule, StudentsModule, EnrollmentsModule],
  controllers: [PublicOnboardingController, OnboardingFieldsController, OnboardingSubmissionsController],
  providers: [
    OnboardingService,
    OnboardingFieldsService,
    OnboardingActivationService,
    OnboardingRepository,
    PublicBookingRateLimiter,
  ],
})
export class OnboardingModule {}
