// apps/api/src/modules/campaigns/campaigns.module.ts
//
// CampaignsModule — WS-2 Campaigns (docs/plans/phase-6.md task #7).
//
// Layering (CLAUDE.md §3.3):
//   CampaignsController         — CRM CRUD + send/pause/cancel + metrics (RBAC all-scope)
//   CampaignWebhookController   — POST /campaigns/webhooks/:channel (public, HMAC-verified)
//   CampaignsService            — segment build (consent+suppression), idempotent send,
//                                 webhook status ingestion
//   CampaignsRepository         — Prisma data access (campaigns, templates, recipients,
//                                 leads/students segment queries, suppression check)
//
// Imports:
//   AuthModule            — JwtAuthGuard, PermissionsGuard, ScopeInterceptor
//   DispatchModule        — CAMPAIGN_SEND_PORT + TemplateRegistry (task #4)
//   MailProviderModule    — MAIL_PROVIDER (webhook signature verification — Svix)
//   WhatsAppProviderModule— WHATSAPP_PROVIDER (webhook signature verification — X-Hub-256)
//
// CSRF EXCLUSION (app.module.ts): POST /campaigns/webhooks/:channel is excluded from
// CsrfMiddleware (unauthenticated, HMAC-protected).

import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { RateLimitModule } from "../../common/rate-limit/rate-limit.module";
import { DispatchModule } from "../notifications/dispatch/dispatch.module";
import { MailProviderModule } from "../notifications/providers/mail/mail-provider.module";
import { WhatsAppProviderModule } from "../notifications/providers/whatsapp/whatsapp-provider.module";
import { CampaignsController } from "./campaigns.controller";
import { CampaignWebhookController } from "./campaign-webhook.controller";
import { CampaignsService } from "./campaigns.service";
import { CampaignsRepository } from "./campaigns.repository";

@Module({
  imports: [AuthModule, DispatchModule, MailProviderModule, WhatsAppProviderModule, RateLimitModule],
  controllers: [CampaignsController, CampaignWebhookController],
  providers: [CampaignsService, CampaignsRepository],
  exports: [CampaignsService],
})
export class CampaignsModule {}
