// apps/api/src/modules/growth/growth.module.ts
//
// Phase-9 Completion T30 — per-city SEO data + bundles/tracks pricing, public read
// endpoints derived from existing Program/Branch/Batch data (docs/plans/
// phase-9-completion.md). No new schema — reuses PublicModule's projection.

import { Module } from "@nestjs/common";
import { PublicModule } from "../public/public.module";
import { AuthModule } from "../auth/auth.module";
import { GrowthController } from "./growth.controller";
import { GrowthService } from "./growth.service";
import { LandingPagesController, PublicLandingPagesController } from "./landing-pages.controller";
import { LandingPagesService } from "./landing-pages.service";
import { LandingPagesRepository } from "./landing-pages.repository";
import { LeadFormsController, PublicLeadFormsController } from "./lead-forms.controller";
import { LeadFormsService } from "./lead-forms.service";
import { LeadFormsRepository } from "./lead-forms.repository";

@Module({
  imports: [PublicModule, AuthModule],
  controllers: [
    GrowthController,
    LandingPagesController,
    PublicLandingPagesController,
    LeadFormsController,
    PublicLeadFormsController,
  ],
  providers: [GrowthService, LandingPagesService, LandingPagesRepository, LeadFormsService, LeadFormsRepository],
})
export class GrowthModule {}
