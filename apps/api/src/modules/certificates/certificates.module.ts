// apps/api/src/modules/certificates/certificates.module.ts
//
// P4 Wave 4 task #8 — Certificates + eligibility + public verify.
// Pre-registered in AppModule — DO NOT edit app.module.ts.
//
// Layering (CLAUDE.md §3.3):
//   controller → service → repository.
//   RBAC via @RequirePermission + PermissionsGuard + ScopeInterceptor on
//   authenticated routes. The public verify controller has NO guards (separate class).
//
// Security invariants enforced:
//   - Eligibility engine reads directly from DB (no sibling module deps — parallel W4).
//   - cert_uid verified by RECOMPUTING HMAC (not bare DB lookup) — AC-H3/H4.
//   - Public verify: unauthenticated + rate-limited per IP (VerifyRateLimiter).
//   - Download URL is a SHORT-LIVED signed GET URL — no raw bucket URL ever returned.
//   - Issue/revoke/reissue all audited with before/after in the service.
//   - IDOR → 404 for cross-student/cross-tenant access.
//   - Cache-Control: no-store on /verify/:certUid (instant revocation, AC-G2).
//
// Controllers:
//   CertificatesCrmController  — CRM routes at /crm/certificates*, /crm/certificate-templates
//   CertificatesLmsController  — LMS routes at /me/certificates*
//   CertificatesVerifyController — PUBLIC route at /verify/:certUid (NO auth guards)
//
// Imports:
//   AuthModule              — JwtAuthGuard, PermissionsGuard, ScopeInterceptor
//   CertificatePdfModule    — CERTIFICATE_PDF_PORT (Noop/Sync adapter)
//   StorageProviderModule   — STORAGE_PROVIDER token (Noop/S3/R2)
//   RedisModule             — GLOBAL (no explicit import needed); VerifyRateLimiter uses
//                             RedisService which is globally provided by the @Global RedisModule.

import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { CertificatePdfModule } from "./providers/pdf/certificate-pdf.module";
import { StorageProviderModule } from "../storage/providers/storage/storage-provider.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { StudentsModule } from "../students/students.module";
import { CertificatesRepository } from "./certificates.repository";
import { CertificatesService } from "./certificates.service";
import { CertificatesCrmController } from "./certificates-crm.controller";
import { CertificatesLmsController } from "./certificates-lms.controller";
import { CertificatesVerifyController } from "./certificates-verify.controller";
import { VerifyRateLimiter } from "./lib/verify-rate-limiter";

@Module({
  imports: [
    AuthModule,
    CertificatePdfModule,
    StorageProviderModule,
    // Phase-9 Completion T31 / R3: notifyCertificateReady (post-issuance).
    NotificationsModule,
    // Resolves enrollment.studentId -> {userId, email, phone, name}.
    StudentsModule,
  ],
  controllers: [
    CertificatesCrmController,
    CertificatesLmsController,
    CertificatesVerifyController,
  ],
  providers: [
    CertificatesService,
    CertificatesRepository,
    VerifyRateLimiter,
  ],
  exports: [
    CertificatesService,
    CertificatesRepository,
  ],
})
export class CertificatesModule {}
