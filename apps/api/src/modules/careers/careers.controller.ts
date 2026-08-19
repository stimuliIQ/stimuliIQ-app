// apps/api/src/modules/careers/careers.controller.ts
//
// HTTP boundary only (CLAUDE.md §3.3). Three controller classes, split by audience
// (ADR-0019 pattern):
//
//   PublicCareersController      — anonymous. Open roles, the resume upload URL, and the
//                                  apply POST. NO guards; captcha-gated + rate-limited.
//   JobOpeningsController        — CRM ▸ Careers ▸ Openings CRUD.
//   CareerApplicationsController — CRM ▸ Careers ▸ Applications: the queue, the candidate
//                                  record, and the four review verbs.
//
// ── PERMISSIONS: WHY CAREERS HAS ITS OWN KEYS ───────────────────────────────────────
// This module does NOT reuse `content.*` the way colleges and partners do, even though a
// job advert is content and lives next to them on the marketing site. Three keys instead:
//
//   careers.openings.manage — write the adverts (create/edit/publish/close/delete).
//   careers.view            — read the application queue. This is the one that matters:
//                             an application carries a stranger's name, phone number,
//                             resume and cover letter. A content editor who can rewrite
//                             the homepage has no business reading CVs.
//   careers.review          — decide an application. Every one of these verbs emails a
//                             real person, so the authority to send that mail is separated
//                             from the ability to read the queue.
//
// The split follows the onboarding precedent (`onboarding.view/edit` vs
// `onboarding.fields.manage`, P12): reading a queue and changing what the world sees are
// different privileges, and so are reading a candidate and judging them.

import {
  Body,
  Controller,
  Delete,
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
  UsePipes,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { ScopeInterceptor } from "../auth/interceptors/scope.interceptor";
import { RequirePermission } from "../auth/decorators/require-permission.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/lib/request-user";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { JobOpeningsService } from "./job-openings.service";
import { CareerApplicationsService } from "./career-applications.service";
import {
  ListPublicJobOpeningsQuerySchema,
  type ListPublicJobOpeningsQuery,
  type PublicJobOpening,
  CreateJobOpeningRequestSchema,
  type CreateJobOpeningRequest,
  UpdateJobOpeningRequestSchema,
  type UpdateJobOpeningRequest,
  ListJobOpeningsQuerySchema,
  type ListJobOpeningsQuery,
  type JobOpening,
  SubmitCareerApplicationRequestSchema,
  type SubmitCareerApplicationRequest,
  type SubmitCareerApplicationResponse,
  PublicCareerResumeUploadUrlRequestSchema,
  type PublicCareerResumeUploadUrlRequest,
  type PublicCareerResumeUploadUrlResponse,
  ListCareerApplicationsQuerySchema,
  type ListCareerApplicationsQuery,
  type CareerApplicationSummary,
  type CareerApplicationDetail,
  HoldCareerApplicationRequestSchema,
  type HoldCareerApplicationRequest,
  ShortlistCareerApplicationRequestSchema,
  type ShortlistCareerApplicationRequest,
  OfferCareerApplicationRequestSchema,
  type OfferCareerApplicationRequest,
  RejectCareerApplicationRequestSchema,
  type RejectCareerApplicationRequest,
  OfferLetterUploadUrlRequestSchema,
  type OfferLetterUploadUrlRequest,
  type ResendAcknowledgementResponse,
  type SignedUploadResponse,
} from "./dto";

// ─────────────────────────────────────────────────────────────────────────────
// ANONYMOUS public surface — NO guards, NO auth, CSRF-excluded via app.module.ts
// Reads are open; every WRITE is captcha-gated + rate-limited + .strict() validated.
// ─────────────────────────────────────────────────────────────────────────────

@Controller("public/careers")
export class PublicCareersController {
  constructor(
    private readonly openings: JobOpeningsService,
    private readonly applications: CareerApplicationsService,
  ) {}

  /**
   * GET /api/v1/public/careers/openings — the live roles.
   *
   * Deliberately NOT captcha-gated or rate-limited: it is a read of published marketing
   * content, the same as /public/programs or /public/partners. The careers page itself
   * gets these through the page-builder block resolver; this endpoint exists for direct
   * consumers (the apply deep-link, and anything that wants the roles without the page).
   */
  @Get("openings")
  async listOpenings(
    @Query(new ZodValidationPipe(ListPublicJobOpeningsQuerySchema)) query: ListPublicJobOpeningsQuery,
  ): Promise<PublicJobOpening[]> {
    return this.openings.listPublic(query);
  }

  @Post("resume-upload-url")
  @HttpCode(HttpStatus.OK)
  async getResumeUploadUrl(
    @Ip() ip: string,
    @Body(new ZodValidationPipe(PublicCareerResumeUploadUrlRequestSchema)) body: PublicCareerResumeUploadUrlRequest,
  ): Promise<PublicCareerResumeUploadUrlResponse> {
    await this.applications.verifyCaptcha(body.captchaToken, ip);
    await this.applications.checkRateLimit(ip);
    return this.applications.getResumeUploadUrl(body);
  }

  @Post("apply")
  @HttpCode(HttpStatus.CREATED)
  async apply(
    @Ip() ip: string,
    @Body(new ZodValidationPipe(SubmitCareerApplicationRequestSchema)) body: SubmitCareerApplicationRequest,
  ): Promise<SubmitCareerApplicationResponse> {
    await this.applications.verifyCaptcha(body.captchaToken, ip);
    await this.applications.checkRateLimit(ip);
    return this.applications.submit(body);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CRM ▸ Careers ▸ Openings — careers.openings.manage
// ─────────────────────────────────────────────────────────────────────────────

@Controller("crm/job-openings")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class JobOpeningsController {
  constructor(private readonly service: JobOpeningsService) {}

  /**
   * Reading the openings list is `careers.view`, not `careers.openings.manage`: the
   * applications screen filters by opening, so anyone who can work the queue must be able
   * to see the list of roles. Only the WRITES require the manage key.
   */
  @Get()
  @RequirePermission("careers.view")
  async list(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(ListJobOpeningsQuerySchema)) query: ListJobOpeningsQuery,
  ): Promise<PaginatedResult<JobOpening>> {
    return this.service.list(user.tenantId, query);
  }

  @Get(":id")
  @RequirePermission("careers.view")
  async get(@CurrentUser() user: RequestUser, @Param("id", new ParseUUIDPipe()) id: string): Promise<JobOpening> {
    return this.service.getById(user.tenantId, id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission("careers.openings.manage")
  @UsePipes(new ZodValidationPipe(CreateJobOpeningRequestSchema))
  async create(@CurrentUser() user: RequestUser, @Body() body: CreateJobOpeningRequest): Promise<JobOpening> {
    return this.service.create(user.tenantId, body);
  }

  @Patch(":id")
  @RequirePermission("careers.openings.manage")
  async update(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdateJobOpeningRequestSchema)) body: UpdateJobOpeningRequest,
  ): Promise<JobOpening> {
    return this.service.update(user.tenantId, id, body);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.OK)
  @RequirePermission("careers.openings.manage")
  async remove(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<{ deleted: true }> {
    await this.service.softDelete(user.tenantId, id);
    return { deleted: true };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CRM ▸ Careers ▸ Applications — careers.view to read, careers.review to decide
// ─────────────────────────────────────────────────────────────────────────────

@Controller("crm/career-applications")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class CareerApplicationsController {
  constructor(private readonly service: CareerApplicationsService) {}

  /**
   * Declared BEFORE the `:id` routes so the static segment is not swallowed by the param
   * route — the same ordering convention MentorsController#photoUploadUrl follows.
   * It is scoped to an application id because an offer letter belongs to a candidate, not
   * to a free-floating upload bucket.
   */
  @Post(":id/offer-letter-upload-url")
  @HttpCode(HttpStatus.OK)
  @RequirePermission("careers.review")
  async offerLetterUploadUrl(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(OfferLetterUploadUrlRequestSchema)) body: OfferLetterUploadUrlRequest,
  ): Promise<SignedUploadResponse> {
    return this.service.getOfferLetterUploadUrl(user.tenantId, id, body);
  }

  @Get()
  @RequirePermission("careers.view")
  async list(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(ListCareerApplicationsQuerySchema)) query: ListCareerApplicationsQuery,
  ): Promise<PaginatedResult<CareerApplicationSummary>> {
    return this.service.list(user.tenantId, query);
  }

  /** Includes short-lived signed download URLs for the resume and (if any) the offer letter. */
  @Get(":id")
  @RequirePermission("careers.view")
  async get(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<CareerApplicationDetail> {
    return this.service.getById(user.tenantId, id);
  }

  // ── The four review verbs ──────────────────────────────────────────────────
  // One endpoint each, never a status PATCH. See careers.schemas.ts's file header.

  @Post(":id/hold")
  @HttpCode(HttpStatus.OK)
  @RequirePermission("careers.review")
  async hold(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(HoldCareerApplicationRequestSchema)) body: HoldCareerApplicationRequest,
  ): Promise<CareerApplicationDetail> {
    return this.service.hold(user.tenantId, id, user.id, body);
  }

  @Post(":id/shortlist")
  @HttpCode(HttpStatus.OK)
  @RequirePermission("careers.review")
  async shortlist(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(ShortlistCareerApplicationRequestSchema)) body: ShortlistCareerApplicationRequest,
  ): Promise<CareerApplicationDetail> {
    return this.service.shortlist(user.tenantId, id, user.id, body);
  }

  @Post(":id/offer")
  @HttpCode(HttpStatus.OK)
  @RequirePermission("careers.review")
  async offer(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(OfferCareerApplicationRequestSchema)) body: OfferCareerApplicationRequest,
  ): Promise<CareerApplicationDetail> {
    return this.service.offer(user.tenantId, id, user.id, body);
  }

  @Post(":id/reject")
  @HttpCode(HttpStatus.OK)
  @RequirePermission("careers.review")
  async reject(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(RejectCareerApplicationRequestSchema)) body: RejectCareerApplicationRequest,
  ): Promise<CareerApplicationDetail> {
    return this.service.reject(user.tenantId, id, user.id, body);
  }

  // ── Supporting actions ─────────────────────────────────────────────────────

  /** Re-send the "thanks for applying" mail when the automatic one never went out. */
  @Post(":id/resend-acknowledgement")
  @HttpCode(HttpStatus.OK)
  @RequirePermission("careers.review")
  async resendAcknowledgement(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<ResendAcknowledgementResponse> {
    return this.service.resendAcknowledgement(user.tenantId, id);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.OK)
  @RequirePermission("careers.review")
  async remove(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<{ deleted: true }> {
    await this.service.softDelete(user.tenantId, id);
    return { deleted: true };
  }
}
