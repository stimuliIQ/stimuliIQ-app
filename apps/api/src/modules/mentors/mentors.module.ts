// apps/api/src/modules/mentors/mentors.module.ts
//
// Wires the Phase-8 Mentor feature module (docs/04-trd-architecture.md §2.2 template,
// docs/specs/phase-8-mentor.md). Four controllers, three service+repository pairs:
//   - MentorsController              — WS-1 mentor hiring-record CRUD (/crm/mentors*).
//   - BatchMentorsController         — WS-2 batch<->mentor M:N assignment
//                                       (/crm/batches/:id/mentors*).
//   - BatchCompletionController      — WS-3 completion rollup + mark-complete
//                                       (/crm/batches/:id/completion*, /complete).
//   - MentorDashboardController      — WS-4 mentor-facing dashboard (/me/mentor/dashboard).
//
// Imports:
//   AuthModule        — JwtAuthGuard, PermissionsGuard, ScopeInterceptor.
//   CommonScopeModule  — EnrollmentScopeRepository.resolveBatchIdsForMentor (LOCK-2/Rule M-1).
//   CertificatesModule — CertificatesService.isEligible, the P4 eligibility engine REUSED
//                        verbatim by BatchCompletionService (LOCK-4 — never reimplemented).

import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { CommonScopeModule } from "../common-scope/common-scope.module";
import { CertificatesModule } from "../certificates/certificates.module";
import { StorageProviderModule } from "../storage/providers/storage/storage-provider.module";
import { MentorsController } from "./mentors.controller";
import { MentorsService } from "./mentors.service";
import { MentorsRepository } from "./mentors.repository";
import { BatchMentorsController } from "./batch-mentors.controller";
import { BatchMentorsService } from "./batch-mentors.service";
import { BatchMentorsRepository } from "./batch-mentors.repository";
import { BatchCompletionController } from "./batch-completion.controller";
import { BatchCompletionService } from "./batch-completion.service";
import { BatchCompletionRepository } from "./batch-completion.repository";
import { MentorDashboardController } from "./mentor-dashboard.controller";
import { MentorDashboardService } from "./mentor-dashboard.service";

@Module({
  imports: [AuthModule, CommonScopeModule, CertificatesModule, StorageProviderModule],
  controllers: [
    MentorsController,
    BatchMentorsController,
    BatchCompletionController,
    MentorDashboardController,
  ],
  providers: [
    MentorsService,
    MentorsRepository,
    BatchMentorsService,
    BatchMentorsRepository,
    BatchCompletionService,
    BatchCompletionRepository,
    MentorDashboardService,
  ],
  exports: [MentorsRepository],
})
export class MentorsModule {}
