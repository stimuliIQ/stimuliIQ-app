// apps/api/src/modules/campaigns/campaigns.controller.ts
//
// HTTP boundary for the CampaignsModule (WS-2, docs/plans/phase-6.md task #7).
// (CLAUDE.md §3.3: "controller — HTTP boundary, validates DTO via the global Zod pipe,
// returns DTO. No Prisma / no business logic in controllers.")
//
// ─── ROUTE MAP ────────────────────────────────────────────────────────────────
//   CRM (JwtAuthGuard + PermissionsGuard, all-scope campaigns.*):
//     GET    /campaigns/templates            campaigns.view
//     POST   /campaigns/templates            campaigns.create   (DLT id required sms/whatsapp)
//     GET    /campaigns/templates/:id        campaigns.view
//     PATCH  /campaigns/templates/:id        campaigns.edit
//     DELETE /campaigns/templates/:id        campaigns.delete
//     GET    /campaigns                      campaigns.view
//     POST   /campaigns                      campaigns.create
//     GET    /campaigns/:id                  campaigns.view
//     PATCH  /campaigns/:id                  campaigns.edit
//     DELETE /campaigns/:id                  campaigns.delete
//     POST   /campaigns/:id/send             campaigns.send   (consent+suppression+DLT gated)
//     POST   /campaigns/:id/pause            campaigns.send
//     POST   /campaigns/:id/cancel           campaigns.send
//     GET    /campaigns/:id/recipients       campaigns.view
//     GET    /campaigns/:id/metrics          campaigns.view
//
//   PUBLIC webhook (NO auth, HMAC-verified, CSRF-excluded in app.module.ts):
//     POST   /campaigns/webhooks/:channel    (channel = email | whatsapp)
//
// ROUTE ORDERING: the static `templates`/`webhooks` segments are declared before the
// `:id` param routes so Nest/Express match them literally (never as `:id=templates`).
//
// SECURITY:
//   - CRM routes: server-side RBAC via PermissionsGuard + @RequirePermission (all-scope).
//   - Webhook: no session; HMAC verified via the provider's verifyWebhookSignature
//     (FAIL CLOSED — 401 on missing/invalid signature or absent secret). Idempotent by
//     provider_message_id in the service. A forged/duplicate receipt cannot corrupt status.
//   - No provider secret ever appears in a response or log.

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import type {
  CampaignDto,
  CampaignDetailDto,
  CampaignTemplateDto,
  CampaignRecipientDto,
  CampaignMetricsDto,
  CreateCampaignTemplateDto,
  UpdateCampaignTemplateDto,
  CreateCampaignDto,
  UpdateCampaignDto,
  ListCampaignsQuery,
  ListCampaignRecipientsQuery,
  ListCampaignTemplatesQuery,
} from "@repo/types";
import {
  CreateCampaignTemplateDtoSchema,
  UpdateCampaignTemplateDtoSchema,
  CreateCampaignDtoSchema,
  UpdateCampaignDtoSchema,
  ListCampaignsQuerySchema,
  ListCampaignRecipientsQuerySchema,
  ListCampaignTemplatesQuerySchema,
} from "@repo/types";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { ScopeInterceptor } from "../auth/interceptors/scope.interceptor";
import { RequirePermission } from "../auth/decorators/require-permission.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/lib/request-user";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { CampaignsService } from "./campaigns.service";

// ─────────────────────────────────────────────────────────────────────────────
// CRM controller — authenticated, RBAC all-scope
// ─────────────────────────────────────────────────────────────────────────────

@Controller("campaigns")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class CampaignsController {
  constructor(private readonly service: CampaignsService) {}

  // ─── Templates (static path — declared before :id) ────────────────────────

  @Get("templates")
  @RequirePermission("campaigns.view")
  async listTemplates(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(ListCampaignTemplatesQuerySchema)) query: ListCampaignTemplatesQuery,
  ): Promise<PaginatedResult<CampaignTemplateDto>> {
    return this.service.listTemplates(user.tenantId, query);
  }

  @Post("templates")
  @HttpCode(201)
  @RequirePermission("campaigns.create")
  async createTemplate(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(CreateCampaignTemplateDtoSchema)) body: CreateCampaignTemplateDto,
  ): Promise<CampaignTemplateDto> {
    return this.service.createTemplate(user.tenantId, user.id, body);
  }

  @Get("templates/:id")
  @RequirePermission("campaigns.view")
  async getTemplate(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<CampaignTemplateDto> {
    return this.service.getTemplate(user.tenantId, id);
  }

  @Patch("templates/:id")
  @RequirePermission("campaigns.edit")
  async updateTemplate(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdateCampaignTemplateDtoSchema)) body: UpdateCampaignTemplateDto,
  ): Promise<CampaignTemplateDto> {
    return this.service.updateTemplate(user.tenantId, user.id, id, body);
  }

  @Delete("templates/:id")
  @RequirePermission("campaigns.delete")
  async deleteTemplate(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<CampaignTemplateDto> {
    return this.service.deleteTemplate(user.tenantId, user.id, id);
  }

  // ─── Campaigns ────────────────────────────────────────────────────────────

  @Get()
  @RequirePermission("campaigns.view")
  async listCampaigns(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(ListCampaignsQuerySchema)) query: ListCampaignsQuery,
  ): Promise<PaginatedResult<CampaignDto>> {
    return this.service.listCampaigns(user.tenantId, query);
  }

  @Post()
  @HttpCode(201)
  @RequirePermission("campaigns.create")
  async createCampaign(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(CreateCampaignDtoSchema)) body: CreateCampaignDto,
  ): Promise<CampaignDetailDto> {
    return this.service.createCampaign(user.tenantId, user.id, body);
  }

  @Get(":id")
  @RequirePermission("campaigns.view")
  async getCampaign(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<CampaignDetailDto> {
    return this.service.getCampaign(user.tenantId, id);
  }

  @Patch(":id")
  @RequirePermission("campaigns.edit")
  async updateCampaign(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdateCampaignDtoSchema)) body: UpdateCampaignDto,
  ): Promise<CampaignDetailDto> {
    return this.service.updateCampaign(user.tenantId, user.id, id, body);
  }

  @Delete(":id")
  @RequirePermission("campaigns.delete")
  async deleteCampaign(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<CampaignDetailDto> {
    return this.service.deleteCampaign(user.tenantId, user.id, id);
  }

  @Post(":id/send")
  @HttpCode(200)
  @RequirePermission("campaigns.send")
  async sendCampaign(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<CampaignDetailDto> {
    return this.service.sendCampaign(user.tenantId, user.id, id);
  }

  @Post(":id/pause")
  @HttpCode(200)
  @RequirePermission("campaigns.send")
  async pauseCampaign(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<CampaignDetailDto> {
    return this.service.pauseCampaign(user.tenantId, user.id, id);
  }

  @Post(":id/cancel")
  @HttpCode(200)
  @RequirePermission("campaigns.send")
  async cancelCampaign(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<CampaignDetailDto> {
    return this.service.cancelCampaign(user.tenantId, user.id, id);
  }

  @Get(":id/recipients")
  @RequirePermission("campaigns.view")
  async listRecipients(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Query(new ZodValidationPipe(ListCampaignRecipientsQuerySchema)) query: ListCampaignRecipientsQuery,
  ): Promise<PaginatedResult<CampaignRecipientDto>> {
    return this.service.listRecipients(user.tenantId, id, query);
  }

  @Get(":id/metrics")
  @RequirePermission("campaigns.view")
  async getMetrics(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<CampaignMetricsDto> {
    return this.service.getCampaignMetrics(user.tenantId, id);
  }
}

// CampaignWebhookController (POST /campaigns/webhooks/:channel) now lives in
// campaign-webhook.controller.ts (see that file's header for why it was extracted).
