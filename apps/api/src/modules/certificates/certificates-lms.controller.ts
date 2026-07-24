// apps/api/src/modules/certificates/certificates-lms.controller.ts
//
// LMS HTTP boundary for student certificate access (own-scope only).
// Mounted at /api/v1 (via global prefix) — routes are /me/certificates/*.
//
// Route map (matches @repo/api-client CertificatesApi SDK + OpenAPI):
//   GET    /me/certificates                 → listStudentCertificates (certificates.view own)
//   GET    /me/certificates/:id             → getStudentCertificate   (certificates.view own)
//   GET    /me/certificates/:id/download    → downloadStudentCertificate (certificates.view own)
//
// SECURITY:
//   - JwtAuthGuard + PermissionsGuard on every route.
//   - Own-scope enforced: studentId resolved from JWT user.id (never trusted from client).
//   - IDOR → 404 for another student's certificate (service's findByIdForStudent).
//   - AC-F2/F3: 404 when cert not yet issued.
//   - AC-F5: 410 CERTIFICATE_REVOKED for revoked certs.
//   - Download URL is a SHORT-LIVED signed GET URL from StorageProvider — never a raw bucket URL.
//   - No business logic — all delegated to CertificatesService.

import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import type {
  CertificateListItem,
  CertificateDetail,
  CertificateDownloadResponse,
  ListCertificatesQuery,
} from "@repo/types";
import { ListCertificatesQuerySchema } from "@repo/types";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { ScopeInterceptor } from "../auth/interceptors/scope.interceptor";
import { RequirePermission } from "../auth/decorators/require-permission.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/lib/request-user";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { CertificatesService } from "./certificates.service";

@Controller("me")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class CertificatesLmsController {
  constructor(private readonly service: CertificatesService) {}

  /**
   * GET /api/v1/me/certificates
   * List the authenticated student's certificates.
   * Own-scope: only certificates belonging to this student.
   * Permission: certificates.view (scope: own)
   */
  @Get("certificates")
  @RequirePermission("certificates.view")
  async listCertificates(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(ListCertificatesQuerySchema)) query: ListCertificatesQuery,
  ): Promise<PaginatedResult<CertificateListItem>> {
    return this.service.listStudentCertificates(user.tenantId, user.id, query);
  }

  /**
   * GET /api/v1/me/certificates/:id
   * Get a single certificate detail for the authenticated student.
   * IDOR → 404 if the certificate belongs to another student.
   * Permission: certificates.view (scope: own)
   */
  @Get("certificates/:id")
  @RequirePermission("certificates.view")
  async getCertificate(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<CertificateDetail> {
    return this.service.getStudentCertificate(user.tenantId, user.id, id);
  }

  /**
   * GET /api/v1/me/certificates/:id/download
   * Mint a short-lived signed download URL for the certificate PDF.
   * AC-F1: valid cert → signed URL.
   * AC-F2/F3: 404 if no cert row (not yet issued) or ineligible.
   * AC-F4: 404 if another student's cert (IDOR).
   * AC-F5: 410 CERTIFICATE_REVOKED for revoked certs.
   * NEVER returns a raw S3/R2 bucket URL (AC-I2).
   * Permission: certificates.view (scope: own)
   */
  @Get("certificates/:id/download")
  @RequirePermission("certificates.view")
  async downloadCertificate(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<CertificateDownloadResponse> {
    return this.service.downloadStudentCertificate(user.tenantId, user.id, id);
  }
}
