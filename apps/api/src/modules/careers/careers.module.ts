// apps/api/src/modules/careers/careers.module.ts
//
// Hiring: the CRM-managed job openings shown on /careers, the public apply flow, and the
// four-verb application review with its candidate emails.
// Spec: docs/specs/careers-hiring.md. Decision record: ADR-0066.
//
// WHY THIS IS ITS OWN MODULE, not more of `content`:
// The public apply endpoint and the CRM application list used to live in
// content-intake.*, alongside newsletter signups and contact-form messages, because all
// three were the same thing then — an anonymous form posting into a table nobody had built
// a screen for. Careers is no longer that. It owns a lifecycle (draft → published → closed
// advert; new → held/shortlisted/selected/rejected candidate), it sends four distinct
// emails, it reads and writes two storage namespaces, and — the deciding reason — it holds
// unsolicited PII about people who do not work here. Its permission boundary is therefore
// genuinely different from "who may edit the site", which is what `content.*` means. Giving
// it its own module makes that boundary a structural fact rather than a convention.
//
// Imports:
//   AuthModule               — JwtAuthGuard, PermissionsGuard, ScopeInterceptor.
//   CaptchaProviderModule    — CAPTCHA_PROVIDER, gating the anonymous apply writes.
//   StorageProviderModule    — STORAGE_PROVIDER: signed resume/offer-letter upload URLs,
//                              signed downloads for reviewers, and the one server-side
//                              byte read in the codebase (attaching the offer letter).
//   MailProviderModule       — MAIL_PROVIDER, for the four candidate emails. A candidate is
//                              not a platform user, so this does NOT go through
//                              NotificationsModule; see careers-notification.service.ts.
//   PublicBookingRateLimiter — reused directly (RedisService is @Global), the same
//                              per-IP fixed-window limiter every other anonymous write
//                              uses (ADR-0019).
//
// Exports JobOpeningsService so the page-builder's `job_openings` block resolver
// (LiveCollectionResolverService, in ContentModule) can render live roles onto /careers
// without duplicating the published-only query.

import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { CaptchaProviderModule } from "../captcha/providers/captcha/captcha-provider.module";
import { StorageProviderModule } from "../storage/providers/storage/storage-provider.module";
import { MailProviderModule } from "../notifications/providers/mail/mail-provider.module";
import { PublicBookingRateLimiter } from "../leads/lib/public-booking-rate-limiter";

import {
  CareerApplicationsController,
  JobOpeningsController,
  PublicCareersController,
} from "./careers.controller";
import { JobOpeningsService } from "./job-openings.service";
import { JobOpeningsRepository } from "./job-openings.repository";
import { CareerApplicationsService } from "./career-applications.service";
import { CareerApplicationsRepository } from "./career-applications.repository";
import { CareersNotificationService } from "./careers-notification.service";

@Module({
  imports: [AuthModule, CaptchaProviderModule, StorageProviderModule, MailProviderModule],
  controllers: [PublicCareersController, JobOpeningsController, CareerApplicationsController],
  providers: [
    JobOpeningsService,
    JobOpeningsRepository,
    CareerApplicationsService,
    CareerApplicationsRepository,
    CareersNotificationService,
    PublicBookingRateLimiter,
  ],
  exports: [JobOpeningsService],
})
export class CareersModule {}
