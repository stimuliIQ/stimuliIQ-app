// apps/api/src/modules/exports/exports.module.ts
//
// ExportsModule — Phase 7 on-demand CSV/PDF exports (docs/plans/phase-7.md task #8).
//
// Layering (CLAUDE.md §3.3):
//   ExportsController — HTTP boundary, RBAC (reports.export)
//   ExportsService     — permission gating, generation dispatch, CSV/PDF rendering,
//                        StorageProvider upload + signed-URL minting, audit logging
//   ExportsRepository — Prisma data access ONLY (export_jobs CRUD + explicit audit write)
//
// Imports:
//   AuthModule              — JwtAuthGuard, PermissionsGuard, ScopeInterceptor
//   AnalyticsModule         — AnalyticsService (the 8 report-backed export types reuse
//                              the EXACT SAME scoped dashboard methods, Rule H-2)
//   StudentsModule/LeadsModule/CommerceModule/CampaignsModule — reuse their existing
//                              scoped `.list()`/`.listPayments()`/`.listRecipients()`
//                              methods (same Rule H-2 rationale) + repositories for
//                              campaign-audience contact enrichment
//   StorageProviderModule   — STORAGE_PROVIDER (putObject + signed download URL)
//   ReportPdfModule         — REPORT_PDF_PORT (PDF rendering for report-backed types)

import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AnalyticsModule } from "../analytics/analytics.module";
import { StudentsModule } from "../students/students.module";
import { LeadsModule } from "../leads/leads.module";
import { CommerceModule } from "../commerce/commerce.module";
import { CampaignsModule } from "../campaigns/campaigns.module";
import { StorageProviderModule } from "../storage/providers/storage/storage-provider.module";
import { ReportPdfModule } from "./providers/pdf/report-pdf.module";
import { ExportsController } from "./exports.controller";
import { ExportsService } from "./exports.service";
import { ExportsRepository } from "./exports.repository";

@Module({
  imports: [
    AuthModule,
    AnalyticsModule,
    StudentsModule,
    LeadsModule,
    CommerceModule,
    CampaignsModule,
    StorageProviderModule,
    ReportPdfModule,
  ],
  controllers: [ExportsController],
  providers: [ExportsService, ExportsRepository],
  exports: [ExportsService],
})
export class ExportsModule {}
