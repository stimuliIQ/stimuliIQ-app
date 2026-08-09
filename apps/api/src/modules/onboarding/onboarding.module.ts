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
// The offline payment the uploaded receipt is proof of: approving runs the ORDINARY
// order → manual-payment → invoice lifecycle rather than a private copy of it, so an
// onboarding student looks like any other paying student in the ledger. CommerceModule
// exports CommerceService; nothing in commerce imports onboarding, so there is no cycle.
import { CommerceModule } from "../commerce/commerce.module";
// MAIL_PROVIDER for the rejection notice (the only email this module sends itself).
import { MailProviderModule } from "../notifications/providers/mail/mail-provider.module";
import { PublicBookingRateLimiter } from "../leads/lib/public-booking-rate-limiter";

import {
  OnboardingFieldsController,
  OnboardingSubmissionsController,
  PublicOnboardingController,
} from "./onboarding.controller";
import { OnboardingService } from "./onboarding.service";
import { OnboardingFieldsService } from "./onboarding-fields.service";
import { OnboardingActivationService } from "./onboarding-activation.service";
import { OnboardingNotificationService } from "./onboarding-notification.service";
import { OnboardingRepository } from "./onboarding.repository";

@Module({
  imports: [
    AuthModule,
    CaptchaProviderModule,
    StorageProviderModule,
    StudentsModule,
    EnrollmentsModule,
    CommerceModule,
    MailProviderModule,
  ],
  controllers: [PublicOnboardingController, OnboardingFieldsController, OnboardingSubmissionsController],
  providers: [
    OnboardingService,
    OnboardingFieldsService,
    OnboardingActivationService,
    OnboardingNotificationService,
    OnboardingRepository,
    PublicBookingRateLimiter,
  ],
})
export class OnboardingModule {}
