// apps/api/src/modules/content/content.module.ts
//
// Wires the Phase-9 Headless Content module (docs/plans/phase-9-completion.md T22) PLUS
// the Phase-10 Page Builder + SiteSetting surface (docs/specs/phase-10-page-builder.md).
// Five CRM-managed resource types (blog, testimonials, partners, faculty bios, generic
// pages) each with a CRM controller + a public (published-only) controller, the
// content-intake surface (newsletter/contact/careers — public writes + CRM admin reads),
// the page-builder CRUD/version-history/preview surface, and the SiteSetting CRUD +
// public read surface.
//
// Imports:
//   AuthModule              — JwtAuthGuard, PermissionsGuard, ScopeInterceptor.
//   CaptchaProviderModule    — CAPTCHA_PROVIDER token (content-intake's public writes).
//   StorageProviderModule    — STORAGE_PROVIDER token (career-application resume signed download).
//   PublicModule             — exports PublicCatalogService, reused (not duplicated) by
//                              LiveCollectionResolverService to resolve
//                              `live_collection_ref(collection=programs|mentors)` blocks
//                              through the SAME public-projection query/mapping every
//                              other `/public/programs`, `/public/mentors` caller uses.
//   PublicBookingRateLimiter — reused directly (RedisService is @Global), same pattern as
//                              public.module.ts.

import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { CaptchaProviderModule } from "../captcha/providers/captcha/captcha-provider.module";
import { StorageProviderModule } from "../storage/providers/storage/storage-provider.module";
import { PublicModule } from "../public/public.module";
import { PublicBookingRateLimiter } from "../leads/lib/public-booking-rate-limiter";

import { BlogController, PublicBlogController } from "./blog.controller";
import { BlogService } from "./blog.service";
import { BlogRepository } from "./blog.repository";

import { TestimonialsController, PublicTestimonialsController } from "./testimonials.controller";
import { TestimonialsService } from "./testimonials.service";
import { TestimonialsRepository } from "./testimonials.repository";

import { PartnersController, PublicPartnersController } from "./partners.controller";
import { PartnersService } from "./partners.service";
import { PartnersRepository } from "./partners.repository";

// Phase-11 locked templates — Colleges (dedicated CRM screen over the Partner model).
import { CollegesController } from "./colleges.controller";
import { CollegesService } from "./colleges.service";
import { CollegesRepository } from "./colleges.repository";

import { FacultyBiosController, PublicFacultyBiosController } from "./faculty-bios.controller";
import { FacultyBiosService } from "./faculty-bios.service";
import { FacultyBiosRepository } from "./faculty-bios.repository";

import { ContentPagesController, PublicContentPagesController } from "./content-pages.controller";
import { ContentPagesService } from "./content-pages.service";
import { ContentPagesRepository } from "./content-pages.repository";

import { ContentIntakeController, PublicContentIntakeController } from "./content-intake.controller";
import { ContentIntakeService } from "./content-intake.service";
import { ContentIntakeRepository } from "./content-intake.repository";

// Phase-10 page builder.
import { ContentPagesBuilderController } from "./content-pages-builder.controller";
import { ContentPagesBuilderService } from "./content-pages-builder.service";
import { ContentPageVersionsRepository } from "./content-page-versions.repository";
import { LiveCollectionResolverService } from "./live-collection-resolver.service";

// Phase-10 SiteSetting.
import { SiteSettingsController, PublicSiteSettingsController } from "./site-settings.controller";
import { SiteSettingsService } from "./site-settings.service";
import { SiteSettingsRepository } from "./site-settings.repository";

@Module({
  imports: [AuthModule, CaptchaProviderModule, StorageProviderModule, PublicModule],
  controllers: [
    BlogController,
    PublicBlogController,
    TestimonialsController,
    PublicTestimonialsController,
    PartnersController,
    PublicPartnersController,
    CollegesController,
    FacultyBiosController,
    PublicFacultyBiosController,
    ContentPagesController,
    PublicContentPagesController,
    ContentIntakeController,
    PublicContentIntakeController,
    ContentPagesBuilderController,
    SiteSettingsController,
    PublicSiteSettingsController,
  ],
  providers: [
    BlogService,
    BlogRepository,
    TestimonialsService,
    TestimonialsRepository,
    PartnersService,
    PartnersRepository,
    CollegesService,
    CollegesRepository,
    FacultyBiosService,
    FacultyBiosRepository,
    ContentPagesService,
    ContentPagesRepository,
    ContentIntakeService,
    ContentIntakeRepository,
    ContentPagesBuilderService,
    ContentPageVersionsRepository,
    LiveCollectionResolverService,
    SiteSettingsService,
    SiteSettingsRepository,
    // Rate limiter — same Redis fixed-window pattern as PublicBookingsController (ADR-0019).
    PublicBookingRateLimiter,
  ],
})
export class ContentModule {}
