// apps/api/src/modules/mentors/mentor-dashboard.service.ts
//
// Business logic for the mentor-facing dashboard (WS-4, docs/specs/phase-8-mentor.md).
// No Prisma here (CLAUDE.md §3.3) — persistence goes through `MentorsRepository` (own
// profile + assigned-batch metadata) and `BatchCompletionService` (the rollup, REUSED
// verbatim — AC-50: every card is sourced from the SAME rollup function CRM staff use,
// never a separately-maintained mentor-only calculation).
//
// SCOPE/FAIL-CLOSED (LOCK-2/Rule M-1/Rule M-4, AC-46-51):
//   - No `mentors` row linked to the caller's userId, OR `engagementStatus != 'active'`
//     -> 403 (Rule M-4: re-checked LIVE on every request, never cached from login — this
//     mirrors AC-49's literal test scenario, which asserts 403 on the very next request
//     after an Admin flips engagementStatus away from 'active'). A missing profile is
//     treated identically (fail-closed at least as strictly as "not active").
//   - A valid, active mentor with ZERO `batch_mentors` rows -> 200 with `batches: []`
//     (AC-51 — a valid empty state, not an error).
//   - Each batch card's `studentCount`/`percentComplete` comes from
//     `BatchCompletionService.getSummary()`, which independently RE-VERIFIES the
//     "assigned" scope via `EnrollmentScopeRepository.resolveBatchIdsForMentor` for every
//     batch id — defense-in-depth even though step 1 already scoped the batch list to
//     this mentor's own assignments (AC-46/47/48 cross-batch/cross-mentor/cross-tenant
//     isolation).

import { ForbiddenException, Injectable } from "@nestjs/common";
import type { MentorDashboardBatchCard, MentorDashboardDto } from "@repo/types";
import { MentorsRepository } from "./mentors.repository";
import { BatchCompletionService } from "./batch-completion.service";

@Injectable()
export class MentorDashboardService {
  constructor(
    private readonly mentorsRepository: MentorsRepository,
    private readonly batchCompletionService: BatchCompletionService,
  ) {}

  async getDashboard(tenantId: string, userId: string): Promise<MentorDashboardDto> {
    const profile = await this.mentorsRepository.findOwnProfile(tenantId, userId);
    if (!profile || profile.engagementStatus !== "active") {
      throw new ForbiddenException({
        code: "mentor.dashboard_not_active",
        title: "Mentor dashboard unavailable",
        detail: "Your mentor engagement status is not currently active.",
      });
    }

    const assignedBatches = await this.mentorsRepository.listActiveAssignedBatches(tenantId, profile.id);

    // AC-51: zero assignments is a valid empty state, not an error.
    if (assignedBatches.length === 0) {
      return { mentorId: profile.id, mentorFullName: profile.fullName, batches: [] };
    }

    const cards: MentorDashboardBatchCard[] = await Promise.all(
      assignedBatches.map(async (batch): Promise<MentorDashboardBatchCard> => {
        // AC-50: reuses the SAME rollup CRM staff use for this exact batch. Also acts as
        // a defense-in-depth re-verification of the assigned-scope IDOR guard.
        const summary = await this.batchCompletionService.getSummary(tenantId, userId, batch.batchId);
        return {
          batchId: batch.batchId,
          batchName: batch.batchName,
          programTitle: batch.programTitle,
          status: summary.status,
          isLead: batch.isLead,
          studentCount: summary.totalActive,
          percentComplete: summary.percentComplete,
        };
      }),
    );

    return { mentorId: profile.id, mentorFullName: profile.fullName, batches: cards };
  }
}
