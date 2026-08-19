// apps/api/src/modules/content/content-intake.controller.ts
//
// HTTP boundary only (CLAUDE.md §3.3). Two controller classes (ADR-0019 pattern):
//   PublicContentIntakeController — anonymous writes (newsletter subscribe/unsubscribe,
//     contact submit). NO guards; captcha-gated + rate-limited (mirrors
//     PublicAnonymousWriteController in public.controller.ts exactly).
//   ContentIntakeController — CRM admin reads/status-updates (content.view/content.edit).
//
// Career applications used to live here too. They moved to modules/careers (ADR-0066) when
// hiring grew a lifecycle, four candidate emails and a permission boundary of its own — see
// careers.module.ts. The public URLs did not change.

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { ScopeInterceptor } from "../auth/interceptors/scope.interceptor";
import { RequirePermission } from "../auth/decorators/require-permission.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/lib/request-user";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { ContentIntakeService } from "./content-intake.service";
import {
  SubscribeNewsletterRequestSchema,
  type SubscribeNewsletterRequest,
  type SubscribeNewsletterResponse,
  UnsubscribeNewsletterQuerySchema,
  type UnsubscribeNewsletterQuery,
  ListNewsletterSubscriptionsQuerySchema,
  type ListNewsletterSubscriptionsQuery,
  type NewsletterSubscription,
  SubmitContactRequestSchema,
  type SubmitContactRequest,
  type SubmitContactResponse,
  UpdateContactSubmissionStatusRequestSchema,
  type UpdateContactSubmissionStatusRequest,
  ListContactSubmissionsQuerySchema,
  type ListContactSubmissionsQuery,
  type ContactSubmission,
} from "./dto";

// ─────────────────────────────────────────────────────────────────────────────
// ANONYMOUS public writes — NO guards, NO auth, CSRF-excluded via app.module.ts
// Captcha-gated + rate-limited + .strict() validated
// ─────────────────────────────────────────────────────────────────────────────

@Controller("public")
export class PublicContentIntakeController {
  constructor(private readonly service: ContentIntakeService) {}

  @Post("newsletter/subscribe")
  @HttpCode(HttpStatus.CREATED)
  async subscribeNewsletter(
    @Ip() ip: string,
    @Body(new ZodValidationPipe(SubscribeNewsletterRequestSchema)) body: SubscribeNewsletterRequest,
  ): Promise<SubscribeNewsletterResponse> {
    await this.service.verifyCaptcha(body.captchaToken, ip);
    await this.service.checkRateLimit(ip, "content.newsletter.rate_limited");
    return this.service.subscribeNewsletter(body, ip);
  }

  @Get("newsletter/unsubscribe")
  async unsubscribeNewsletter(
    @Query(new ZodValidationPipe(UnsubscribeNewsletterQuerySchema)) query: UnsubscribeNewsletterQuery,
  ): Promise<{ message: string }> {
    return this.service.unsubscribeNewsletter(query.token);
  }

  @Post("contact")
  @HttpCode(HttpStatus.CREATED)
  async submitContact(
    @Ip() ip: string,
    @Body(new ZodValidationPipe(SubmitContactRequestSchema)) body: SubmitContactRequest,
  ): Promise<SubmitContactResponse> {
    await this.service.verifyCaptcha(body.captchaToken, ip);
    await this.service.checkRateLimit(ip, "content.contact.rate_limited");
    return this.service.submitContact(body, ip);
  }

}

// ─────────────────────────────────────────────────────────────────────────────
// CRM admin reads/status-updates — content.view / content.edit
// ─────────────────────────────────────────────────────────────────────────────

@Controller("crm")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class ContentIntakeController {
  constructor(private readonly service: ContentIntakeService) {}

  @Get("newsletter-subscriptions")
  @RequirePermission("content.view")
  async listNewsletterSubscriptions(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(ListNewsletterSubscriptionsQuerySchema)) query: ListNewsletterSubscriptionsQuery,
  ): Promise<PaginatedResult<NewsletterSubscription>> {
    return this.service.listNewsletterSubscriptions(user.tenantId, query);
  }

  @Get("contact-submissions")
  @RequirePermission("content.view")
  async listContactSubmissions(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(ListContactSubmissionsQuerySchema)) query: ListContactSubmissionsQuery,
  ): Promise<PaginatedResult<ContactSubmission>> {
    return this.service.listContactSubmissions(user.tenantId, query);
  }

  @Patch("contact-submissions/:id")
  @RequirePermission("content.edit")
  async updateContactSubmission(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdateContactSubmissionStatusRequestSchema)) body: UpdateContactSubmissionStatusRequest,
  ): Promise<ContactSubmission> {
    return this.service.updateContactSubmissionStatus(user.tenantId, id, body);
  }

}
