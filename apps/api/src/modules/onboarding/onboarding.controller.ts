// apps/api/src/modules/onboarding/onboarding.controller.ts
//
// HTTP boundary only (CLAUDE.md §3.3). Three controller classes, following the ADR-0019
// split this codebase already uses for every anonymous surface: unauthenticated public
// endpoints live in their OWN controller class with NO guards, so a guard can never be
// added to the authenticated class and silently assumed to cover the public one.
//
// ─── PublicOnboardingController @Controller("public/onboarding") — NO guards ──────
//   GET  /public/onboarding/form        the live question set (+ program choices)
//   POST /public/onboarding/upload-url  signed PUT for one file answer
//   POST /public/onboarding/submit      submit answers
//
//   Captcha-gated + per-IP rate-limited (both applied HERE, before the service runs) and
//   CSRF-excluded in app.module.ts — an anonymous visitor has no session to carry a CSRF
//   cookie, exactly like /public/leads and /public/careers/apply.
//
//   GET /form has no captcha: it is a read of the form's own configuration, needed to
//   render the page at all, and gating it behind a challenge would mean solving a captcha
//   before seeing a single question. It is still rate-limited.
//
// ─── OnboardingFieldsController @Controller("crm/onboarding/fields") ─────────────
//   Authoring the question set. `onboarding.fields.manage` — a separate key from the
//   submissions permissions because editing the form and reading responses are genuinely
//   different privileges: a counsellor should read submissions without being able to
//   silently delete the payment-receipt question.
//
// ─── OnboardingSubmissionsController @Controller("crm/onboarding/submissions") ───
//   onboarding.view / onboarding.edit / onboarding.delete.

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
} from "@nestjs/common";
import type {
  ApproveOnboardingSubmissionRequest,
  ApproveOnboardingSubmissionResponse,
  CreateOnboardingFieldRequest,
  DeleteOnboardingFieldResponse,
  DeleteOnboardingSubmissionResponse,
  ListOnboardingFieldsQuery,
  ListOnboardingSubmissionsQuery,
  OnboardingApprovableBatch,
  OnboardingField,
  OnboardingSubmissionDetail,
  OnboardingSubmissionSummary,
  OnboardingUploadUrlRequest,
  PublicOnboardingForm,
  RejectOnboardingSubmissionRequest,
  ReorderOnboardingFieldsRequest,
  SignedUploadResponse,
  SubmitOnboardingRequest,
  SubmitOnboardingResponse,
  UpdateOnboardingFieldRequest,
  UpdateOnboardingSubmissionRequest,
} from "@repo/types";
import {
  ApproveOnboardingSubmissionRequestSchema,
  CreateOnboardingFieldRequestSchema,
  ListOnboardingFieldsQuerySchema,
  ListOnboardingSubmissionsQuerySchema,
  OnboardingUploadUrlRequestSchema,
  RejectOnboardingSubmissionRequestSchema,
  ReorderOnboardingFieldsRequestSchema,
  SubmitOnboardingRequestSchema,
  UpdateOnboardingFieldRequestSchema,
  UpdateOnboardingSubmissionRequestSchema,
} from "@repo/types";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { ScopeInterceptor } from "../auth/interceptors/scope.interceptor";
import { RequirePermission } from "../auth/decorators/require-permission.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/lib/request-user";
import { OnboardingService } from "./onboarding.service";
import { OnboardingFieldsService } from "./onboarding-fields.service";

// ─────────────────────────────────────────────────────────────────────────────
// ANONYMOUS — NO guards, NO auth, CSRF-excluded via app.module.ts
// ─────────────────────────────────────────────────────────────────────────────

@Controller("public/onboarding")
export class PublicOnboardingController {
  constructor(private readonly service: OnboardingService) {}

  @Get("form")
  async getForm(@Ip() ip: string): Promise<PublicOnboardingForm> {
    await this.service.checkRateLimit(ip);
    return this.service.getPublicForm();
  }

  @Post("upload-url")
  @HttpCode(HttpStatus.OK)
  async getUploadUrl(
    @Ip() ip: string,
    @Body(new ZodValidationPipe(OnboardingUploadUrlRequestSchema)) body: OnboardingUploadUrlRequest,
  ): Promise<SignedUploadResponse> {
    await this.service.verifyCaptcha(body.captchaToken, ip);
    await this.service.checkRateLimit(ip);
    return this.service.getUploadUrl(body);
  }

  @Post("submit")
  @HttpCode(HttpStatus.CREATED)
  async submit(
    @Ip() ip: string,
    @Body(new ZodValidationPipe(SubmitOnboardingRequestSchema)) body: SubmitOnboardingRequest,
  ): Promise<SubmitOnboardingResponse> {
    await this.service.verifyCaptcha(body.captchaToken, ip);
    await this.service.checkRateLimit(ip);
    return this.service.submit(body, ip);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CRM — authoring the question set
// ─────────────────────────────────────────────────────────────────────────────

@Controller("crm/onboarding/fields")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class OnboardingFieldsController {
  constructor(private readonly service: OnboardingFieldsService) {}

  @Get()
  @RequirePermission("onboarding.view")
  async list(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(ListOnboardingFieldsQuerySchema)) query: ListOnboardingFieldsQuery,
  ): Promise<OnboardingField[]> {
    return this.service.list(user.tenantId, query);
  }

  @Post()
  @RequirePermission("onboarding.fields.manage")
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(CreateOnboardingFieldRequestSchema)) body: CreateOnboardingFieldRequest,
  ): Promise<OnboardingField> {
    return this.service.create(user.tenantId, body);
  }

  /** Declared BEFORE `:id` so "reorder" is never captured as a (non-uuid) field id. */
  @Post("reorder")
  @RequirePermission("onboarding.fields.manage")
  @HttpCode(HttpStatus.OK)
  async reorder(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(ReorderOnboardingFieldsRequestSchema)) body: ReorderOnboardingFieldsRequest,
  ): Promise<OnboardingField[]> {
    return this.service.reorder(user.tenantId, body);
  }

  @Patch(":id")
  @RequirePermission("onboarding.fields.manage")
  async update(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdateOnboardingFieldRequestSchema)) body: UpdateOnboardingFieldRequest,
  ): Promise<OnboardingField> {
    return this.service.update(user.tenantId, id, body);
  }

  @Delete(":id")
  @RequirePermission("onboarding.fields.manage")
  async remove(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<DeleteOnboardingFieldResponse> {
    await this.service.remove(user.tenantId, id);
    return { deleted: true };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CRM — reading and triaging what students sent
// ─────────────────────────────────────────────────────────────────────────────

@Controller("crm/onboarding/submissions")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class OnboardingSubmissionsController {
  constructor(private readonly service: OnboardingService) {}

  @Get()
  @RequirePermission("onboarding.view")
  async list(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(ListOnboardingSubmissionsQuerySchema)) query: ListOnboardingSubmissionsQuery,
  ): Promise<PaginatedResult<OnboardingSubmissionSummary>> {
    return this.service.listSubmissions(user.tenantId, query);
  }

  @Get(":id")
  @RequirePermission("onboarding.view")
  async get(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<OnboardingSubmissionDetail> {
    return this.service.getSubmissionById(user.tenantId, id);
  }

  /** Open cohorts of this submission's program — what the approve dialog offers. */
  @Get(":id/batches")
  @RequirePermission("onboarding.edit")
  async listBatches(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<OnboardingApprovableBatch[]> {
    return this.service.listApprovableBatches(user.tenantId, id);
  }

  /**
   * The decision that ACTIVATES a student: creates or matches them, enrols them into the
   * chosen batch, promotes them to Active, and emails their LMS login. Separate from PATCH
   * precisely because those consequences should never ride on a generic status write.
   */
  @Post(":id/approve")
  @RequirePermission("onboarding.edit")
  @HttpCode(HttpStatus.OK)
  async approve(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(ApproveOnboardingSubmissionRequestSchema)) body: ApproveOnboardingSubmissionRequest,
  ): Promise<ApproveOnboardingSubmissionResponse> {
    return this.service.approveSubmission(user.tenantId, id, body, user.id);
  }

  @Post(":id/reject")
  @RequirePermission("onboarding.edit")
  @HttpCode(HttpStatus.OK)
  async reject(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(RejectOnboardingSubmissionRequestSchema)) body: RejectOnboardingSubmissionRequest,
  ): Promise<OnboardingSubmissionDetail> {
    return this.service.rejectSubmission(user.tenantId, id, body, user.id);
  }

  /** Notes, and the two side-effect-free decisions (reject / hold). */
  @Patch(":id")
  @RequirePermission("onboarding.edit")
  async update(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdateOnboardingSubmissionRequestSchema)) body: UpdateOnboardingSubmissionRequest,
  ): Promise<OnboardingSubmissionDetail> {
    return this.service.updateSubmission(user.tenantId, id, body, user.id);
  }

  @Delete(":id")
  @RequirePermission("onboarding.delete")
  async remove(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<DeleteOnboardingSubmissionResponse> {
    await this.service.deleteSubmission(user.tenantId, id);
    return { deleted: true };
  }
}
