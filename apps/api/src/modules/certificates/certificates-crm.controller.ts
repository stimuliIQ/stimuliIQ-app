// apps/api/src/modules/certificates/certificates-crm.controller.ts
//
// CRM HTTP boundary for Certificates + eligibility (ops/admin/faculty).
// Mounted at /api/v1/crm (via global prefix).
//
// Route map (matches @repo/api-client CertificatesApi SDK + OpenAPI):
//   GET    /crm/certificates/eligibility          → listEligibility (certificates.view)
//   GET    /crm/certificates/eligibility-batches  → listEligibilityBatches (certificates.view)
//   GET    /crm/certificates/eligibility/:enrollmentId → getEligibilityDetail (certificates.view)
//   POST   /crm/certificates                       → issueCertificate (certificates.issue)
//   POST   /crm/certificates/:enrollmentId/recommend → recommendCertificate (certificates.recommend)
//   GET    /crm/certificates/:id                   → getCertificate (certificates.view)
//   GET    /crm/certificates/:id/download          → downloadCertificate (certificates.view)
//   PATCH  /crm/certificates/:id/revoke            → revokeCertificate (certificates.revoke) AUDITED
//   POST   /crm/certificates/:enrollmentId/reissue → reissueCertificate (certificates.issue) AUDITED
//   GET    /crm/certificate-templates              → listTemplates (certificates.view)
//   GET    /crm/certificates                       → listCertificates (certificates.view)
//
// SECURITY:
//   - @RequirePermission + ScopeInterceptor enforced on every route.
//   - Faculty assigned-scope for recommend: only assigned batches.
//   - Admin/Ops all-scope for issue/revoke/reissue.
//   - IDOR → 404 (not 403) for cross-batch access.
//   - Issue/revoke/reissue are AUDITED with before/after in service.
//   - No business logic in this file — all delegated to CertificatesService.

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import type {
  CertificateCrmDetail,
  CertificateDownloadQuery,
  CertificateDownloadResponse,
  CertificateTemplateSummary,
  CertificateTemplateDetail,
  CertificateSpecimenResponse,
  CreateCertificateTemplateRequest,
  UpdateCertificateTemplateRequest,
  BulkIssueCertificatesRequest,
  BulkIssueCertificatesResponse,
  EligibilityListItem,
  EligibilityBatchSummary,
  EligibilityResult,
  IssueCertificateRequest,
  RecommendCertificateRequest,
  RevokeCertificateRequest,
  ReissueCertificateRequest,
  ListCertificatesQuery,
  ListEligibilityQuery,
  ListEligibilityBatchesQuery,
} from "@repo/types";
import {
  IssueCertificateRequestSchema,
  RecommendCertificateRequestSchema,
  RevokeCertificateRequestSchema,
  ReissueCertificateRequestSchema,
  CreateCertificateTemplateRequestSchema,
  UpdateCertificateTemplateRequestSchema,
  BulkIssueCertificatesRequestSchema,
  CertificateDownloadQuerySchema,
  ListCertificatesQuerySchema,
  ListEligibilityQuerySchema,
  ListEligibilityBatchesQuerySchema,
} from "@repo/types";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { ScopeInterceptor } from "../auth/interceptors/scope.interceptor";
import { RequirePermission } from "../auth/decorators/require-permission.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/lib/request-user";
import { requireScopeContext } from "../auth/lib/scope-context";
import { assertAuthoringScope } from "../common-scope/authoring-scope";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { CertificatesService } from "./certificates.service";

@Controller("crm")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class CertificatesCrmController {
  constructor(private readonly service: CertificatesService) {}

  // ─── ELIGIBILITY LIST ────────────────────────────────────────────────────

  /**
   * GET /api/v1/crm/certificates/eligibility
   * List enrollments with eligibility status for the CRM Content > Certificates view.
   * Faculty (assigned-scope): only their assigned batches.
   * Admin/Ops (all-scope): all enrollments.
   * Permission: certificates.view
   */
  @Get("certificates/eligibility")
  @RequirePermission("certificates.view")
  async listEligibility(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(ListEligibilityQuerySchema)) query: ListEligibilityQuery,
  ): Promise<PaginatedResult<EligibilityListItem>> {
    const scope = assertAuthoringScope("certificates", requireScopeContext().scope);
    return this.service.listEligibility(user.tenantId, query, scope, user.id);
  }

  /**
   * GET /api/v1/crm/certificates/eligibility-batches
   * Batch-first landing view: one row per cohort with cheap headline counts.
   * The CRM drills from a row into ?batchId= on the eligibility list above.
   * Faculty (assigned-scope): only their assigned batches.
   * Permission: certificates.view
   *
   * ROUTE ORDER: declared before `certificates/:id` — Nest matches in declaration
   * order, and `:id` would otherwise swallow the literal `eligibility-batches`
   * segment and 400 on its ParseUUIDPipe.
   */
  @Get("certificates/eligibility-batches")
  @RequirePermission("certificates.view")
  async listEligibilityBatches(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(ListEligibilityBatchesQuerySchema)) query: ListEligibilityBatchesQuery,
  ): Promise<PaginatedResult<EligibilityBatchSummary>> {
    const scope = assertAuthoringScope("certificates", requireScopeContext().scope);
    return this.service.listEligibilityBatches(user.tenantId, query, scope, user.id);
  }

  /**
   * GET /api/v1/crm/certificates/eligibility/:enrollmentId
   * Eligibility detail for a single enrollment (the CRM eligibility drawer).
   * Faculty (assigned-scope): IDOR → 404 outside assigned batches.
   * Permission: certificates.view
   */
  @Get("certificates/eligibility/:enrollmentId")
  @RequirePermission("certificates.view")
  async getEligibilityDetail(
    @CurrentUser() user: RequestUser,
    @Param("enrollmentId", new ParseUUIDPipe()) enrollmentId: string,
  ): Promise<EligibilityResult> {
    const scope = assertAuthoringScope("certificates", requireScopeContext().scope);
    return this.service.getEligibilityDetail(user.tenantId, enrollmentId, scope, user.id);
  }

  // ─── LIST + GET CERTIFICATES ─────────────────────────────────────────────

  /**
   * GET /api/v1/crm/certificates
   * List issued certificates (ops/admin).
   * Permission: certificates.view
   */
  @Get("certificates")
  @RequirePermission("certificates.view")
  async listCertificates(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(ListCertificatesQuerySchema)) query: ListCertificatesQuery,
  ): Promise<PaginatedResult<CertificateCrmDetail>> {
    const scope = assertAuthoringScope("certificates", requireScopeContext().scope);
    return this.service.listCertificates(user.tenantId, query, scope, user.id);
  }

  /**
   * GET /api/v1/crm/certificates/:id/download
   * Signed, short-lived URL for the certificate PDF — the document the student receives.
   *
   * ROUTE ORDER: declared BEFORE `certificates/:id`. Nest matches in declaration order and
   * `:id` is the more general pattern; below it this would still work (the extra segment
   * makes the paths distinct), but keeping the specific route first is the rule the
   * eligibility-batches route above already had to learn.
   *
   * Unlike the student's own download this returns a REVOKED certificate too, and
   * regenerates a missing PDF rather than 404ing — see the service for why.
   * Permission: certificates.view (assigned scope is limited to the faculty's own batches).
   */
  @Get("certificates/:id/download")
  @RequirePermission("certificates.view")
  async downloadCertificate(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Query(new ZodValidationPipe(CertificateDownloadQuerySchema)) query: CertificateDownloadQuery,
  ): Promise<CertificateDownloadResponse> {
    const scope = assertAuthoringScope("certificates", requireScopeContext().scope);
    return this.service.downloadCrmCertificate(user.tenantId, id, scope, user.id, query.disposition);
  }

  /**
   * GET /api/v1/crm/certificates/:id
   * Get a single certificate (ops/admin).
   * Permission: certificates.view
   */
  @Get("certificates/:id")
  @RequirePermission("certificates.view")
  async getCertificate(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<CertificateCrmDetail> {
    const scope = assertAuthoringScope("certificates", requireScopeContext().scope);
    return this.service.getCertificate(user.tenantId, id, scope, user.id);
  }

  // ─── ISSUE ───────────────────────────────────────────────────────────────

  /**
   * POST /api/v1/crm/certificates
   * Issue a certificate for an eligible enrollment.
   * AC-E: eligibility gated; override flag for ops with all-scope.
   * AC-E6: 409 if cert already exists.
   * AUDITED. Permission: certificates.issue (scope: all | branch).
   */
  @Post("certificates")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission("certificates.issue")
  async issueCertificate(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(IssueCertificateRequestSchema)) body: IssueCertificateRequest,
  ): Promise<CertificateCrmDetail> {
    const scope = assertAuthoringScope("certificates", requireScopeContext().scope);
    return this.service.issueCertificate(user.id, user.tenantId, body, scope);
  }

  // ─── BULK ISSUE (Phase-9-completion gap #7) ─────────────────────────────

  /**
   * POST /api/v1/crm/certificates/bulk
   * Issue certificates for a list of eligible enrollments in one audited call.
   * Replaces the CRM bulk-issue dialog's former client-side per-row loop.
   * AUDITED (per-row + one summary row). Permission: certificates.issue (scope: all|branch).
   */
  @Post("certificates/bulk")
  @HttpCode(HttpStatus.OK)
  @RequirePermission("certificates.issue")
  async bulkIssueCertificates(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(BulkIssueCertificatesRequestSchema)) body: BulkIssueCertificatesRequest,
  ): Promise<BulkIssueCertificatesResponse> {
    const scope = assertAuthoringScope("certificates", requireScopeContext().scope);
    return this.service.bulkIssueCertificates(user.id, user.tenantId, body, scope);
  }

  // ─── RECOMMEND (faculty only) ────────────────────────────────────────────

  /**
   * POST /api/v1/crm/certificates/:enrollmentId/recommend
   * Faculty recommends an enrollment for certificate issuance.
   * AC-E5: flags eligibility WITHOUT issuing a cert row.
   * AUDITED. Permission: certificates.recommend (scope: assigned).
   */
  @Post("certificates/:enrollmentId/recommend")
  @HttpCode(HttpStatus.OK)
  @RequirePermission("certificates.recommend")
  async recommendCertificate(
    @CurrentUser() user: RequestUser,
    @Param("enrollmentId", new ParseUUIDPipe()) enrollmentId: string,
    @Body(new ZodValidationPipe(RecommendCertificateRequestSchema)) body: RecommendCertificateRequest,
  ): Promise<EligibilityResult> {
    const scope = assertAuthoringScope("certificates", requireScopeContext().scope);
    return this.service.recommendCertificate(user.id, user.tenantId, enrollmentId, body, scope);
  }

  // ─── REVOKE ──────────────────────────────────────────────────────────────

  /**
   * PATCH /api/v1/crm/certificates/:id/revoke
   * Revoke a certificate. Instant effect — no cache window (AC-G2).
   * AUDITED with before/after. Permission: certificates.revoke (scope: all).
   */
  @Patch("certificates/:id/revoke")
  @HttpCode(HttpStatus.OK)
  @RequirePermission("certificates.revoke")
  async revokeCertificate(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(RevokeCertificateRequestSchema)) body: RevokeCertificateRequest,
  ): Promise<CertificateCrmDetail> {
    return this.service.revokeCertificate(user.id, user.tenantId, id, body);
  }

  // ─── REISSUE ─────────────────────────────────────────────────────────────

  /**
   * POST /api/v1/crm/certificates/:enrollmentId/reissue
   * Reissue a revoked certificate. Soft-deletes old row; generates new cert_uid + PDF.
   * Old cert_uid → 404 on public verify (AC-G4).
   * AUDITED. Permission: certificates.issue (scope: all | branch).
   */
  @Post("certificates/:enrollmentId/reissue")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission("certificates.issue")
  async reissueCertificate(
    @CurrentUser() user: RequestUser,
    @Param("enrollmentId", new ParseUUIDPipe()) enrollmentId: string,
    @Body(new ZodValidationPipe(ReissueCertificateRequestSchema)) body: ReissueCertificateRequest,
  ): Promise<CertificateCrmDetail> {
    const scope = assertAuthoringScope("certificates", requireScopeContext().scope);
    return this.service.reissueCertificate(user.id, user.tenantId, enrollmentId, body, scope);
  }

  // ─── TEMPLATES ───────────────────────────────────────────────────────────

  /**
   * GET /api/v1/crm/certificate-templates
   * List active certificate templates for the issue form.
   * Permission: certificates.view
   */
  @Get("certificate-templates")
  @RequirePermission("certificates.view")
  async listTemplates(@CurrentUser() user: RequestUser): Promise<CertificateTemplateSummary[]> {
    // These two template reads were the only certificates routes that took no scope at
    // all, and `certificates.view` is seeded to the STUDENT role (at scope own, for
    // /me/certificates). So a student's session listed and read the certificate-template
    // designs — a staff configuration surface — simply because the two routes share a
    // permission key with the student's own certificate list. Narrowing here refuses
    // "own" exactly as the rest of the module does.
    assertAuthoringScope("certificates", requireScopeContext().scope);
    return this.service.listTemplates(user.tenantId);
  }

  /**
   * GET /api/v1/crm/certificate-templates/:id
   * Full template row incl. the CRM designer's saved field layout.
   * Permission: certificates.view.
   */
  @Get("certificate-templates/:id")
  @RequirePermission("certificates.view")
  async getTemplate(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<CertificateTemplateDetail> {
    assertAuthoringScope("certificates", requireScopeContext().scope);
    return this.service.getTemplateDetail(user.tenantId, id);
  }

  /**
   * POST /api/v1/crm/certificate-templates
   * Create a certificate template (design/fields/layout). AUDITED.
   * Permission: certificates.issue.
   */
  /**
   * GET /api/v1/crm/certificate-templates/:id/specimen
   *
   * Renders the document this template issues, with sample values, so a reviewer can see
   * what a student receives WITHOUT issuing one to somebody first. Read-only: no
   * Certificate row, no serial burned, no storage write.
   *
   * Permission: certificates.view, not certificates.issue — looking at what a template
   * produces is reading, and gating it on the issue permission would mean the people who
   * check a certificate's wording need the right to award one.
   */
  @Get("certificate-templates/:id/specimen")
  @RequirePermission("certificates.view")
  async getTemplateSpecimen(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<CertificateSpecimenResponse> {
    return this.service.renderTemplateSpecimen(user.tenantId, id);
  }

  @Post("certificate-templates")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission("certificates.issue")
  async createTemplate(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(CreateCertificateTemplateRequestSchema)) body: CreateCertificateTemplateRequest,
  ): Promise<CertificateTemplateDetail> {
    return this.service.createTemplate(user.id, user.tenantId, body);
  }

  /**
   * PATCH /api/v1/crm/certificate-templates/:id
   * Update a template — the CRM designer's "Save layout" action sends { layout } only.
   * AUDITED. Permission: certificates.issue.
   */
  @Patch("certificate-templates/:id")
  @HttpCode(HttpStatus.OK)
  @RequirePermission("certificates.issue")
  async updateTemplate(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdateCertificateTemplateRequestSchema)) body: UpdateCertificateTemplateRequest,
  ): Promise<CertificateTemplateDetail> {
    return this.service.updateTemplate(user.id, user.tenantId, id, body);
  }
}
