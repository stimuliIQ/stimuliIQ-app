// apps/api/src/modules/assignments/storage.controller.ts
//
// Storage upload-URL endpoint (POST /api/v1/storage/upload-url).
// Wired inside AssignmentsModule — no separate module needed; avoid editing app.module.ts.
//
// This is the ONLY server endpoint the upload flow goes through. The client then
// PUTs the file DIRECTLY to S3/R2 via the returned signed URL — no file data
// ever passes through this API server.
//
// SECURITY:
//   - Requires authentication (JwtAuthGuard).
//   - Server validates enrollment ownership for purpose=submission.
//   - Key is scoped to submissions/{tenantId}/{enrollmentId}/... (AC-I1).
//   - URL TTL ≤ 15 minutes (AC-I1).
//   - Raw bucket URL is NEVER returned (AC-I2).
//   - permission: submissions.create (own scope) — student uploads only.

import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import type { SignedUploadResponse, GetUploadUrlRequest } from "@repo/types";
import { GetUploadUrlRequestSchema } from "@repo/types";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { ScopeInterceptor } from "../auth/interceptors/scope.interceptor";
import { RequirePermission } from "../auth/decorators/require-permission.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/lib/request-user";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { AssignmentsService } from "./assignments.service";

@Controller("storage")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class StorageController {
  constructor(private readonly service: AssignmentsService) {}

  /**
   * POST /api/v1/storage/upload-url
   *
   * Mint a short-lived signed PUT URL for a direct browser → S3/R2 upload.
   *
   * Flow:
   *   1. Client calls this endpoint with contentType + fileName + sizeBytes + enrollmentId.
   *   2. Server validates enrollment ownership (student must own the enrollment).
   *   3. Server builds a scoped key (submissions/{tenantId}/{enrollmentId}/...).
   *   4. Server mints a signed PUT URL via StorageProvider.
   *   5. Client PUTs the file directly to the signed URL (no API proxy).
   *   6. Client includes `storageKey` in the SubmitAssignmentRequest.files array.
   *
   * NEVER: proxy the file through this server. NEVER: store the uploadUrl.
   *
   * Permission: submissions.create (scope: own) — student upload only.
   */
  @Post("upload-url")
  @HttpCode(HttpStatus.OK)
  @RequirePermission("submissions.create")
  async getUploadUrl(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(GetUploadUrlRequestSchema)) body: GetUploadUrlRequest,
  ): Promise<SignedUploadResponse> {
    return this.service.getUploadUrl(user.id, user.tenantId, body);
  }
}
