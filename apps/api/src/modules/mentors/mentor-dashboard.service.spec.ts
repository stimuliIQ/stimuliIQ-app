// apps/api/src/modules/mentors/mentor-dashboard.service.spec.ts
//
// Unit tests for MentorDashboardService (WS-4, docs/specs/phase-8-mentor.md). Covers:
//   AC-46/47/48 — cross-batch/cross-mentor/cross-tenant isolation (IDOR -> empty/404 via
//     the reused BatchCompletionService.getSummary scope check).
//   AC-49/Rule M-4 — engagementStatus re-checked LIVE every request (403 when not active
//     or when no mentor profile is linked).
//   AC-50 — each card is sourced from the SAME rollup CRM staff use.
//   AC-51 — zero assignments is a valid empty state (200), not an error.

import { ForbiddenException } from "@nestjs/common";
import { MentorDashboardService } from "./mentor-dashboard.service";
import { MentorsRepository, type MentorAssignedBatchRow } from "./mentors.repository";
import { BatchCompletionService } from "./batch-completion.service";
import type { BatchCompletionSummaryDto } from "@repo/types";

type Mocked<T> = { [K in keyof T]: T[K] extends (...args: never[]) => unknown ? jest.Mock : T[K] };

function mockMentorsRepo(): Mocked<MentorsRepository> {
  return {
    findOwnProfile: jest.fn(),
    listActiveAssignedBatches: jest.fn(),
  } as unknown as Mocked<MentorsRepository>;
}

function mockBatchCompletionService(): Mocked<BatchCompletionService> {
  return { getSummary: jest.fn() } as unknown as Mocked<BatchCompletionService>;
}

function summaryFor(batchId: string, overrides: Partial<BatchCompletionSummaryDto> = {}): BatchCompletionSummaryDto {
  return {
    batchId,
    batchName: "Full-Stack HYD-01",
    status: "active",
    completedAt: null,
    totalActive: 12,
    certified: 1,
    eligibleNotIssued: 2,
    inProgress: 9,
    dropped: 0,
    percentComplete: 45.5,
    assignmentsSubmittedPct: null,
    assessmentsPassedPct: null,
    finalProjectApprovedPct: null,
    canTransitionToComplete: true,
    ...overrides,
  };
}

describe("MentorDashboardService", () => {
  let service: MentorDashboardService;
  let mentorsRepo: Mocked<MentorsRepository>;
  let batchCompletion: Mocked<BatchCompletionService>;

  beforeEach(() => {
    mentorsRepo = mockMentorsRepo();
    batchCompletion = mockBatchCompletionService();
    service = new MentorDashboardService(
      mentorsRepo as unknown as MentorsRepository,
      batchCompletion as unknown as BatchCompletionService,
    );
  });

  describe("AC-49/Rule M-4: engagementStatus is re-checked live, never cached", () => {
    it("403 when the caller has no mentors row linked to their userId", async () => {
      mentorsRepo.findOwnProfile.mockResolvedValue(null);

      await expect(service.getDashboard("tenant-1", "user-with-no-profile")).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(mentorsRepo.listActiveAssignedBatches).not.toHaveBeenCalled();
    });

    it("403 when engagementStatus has been flipped away from active", async () => {
      mentorsRepo.findOwnProfile.mockResolvedValue({ id: "mentor-1", fullName: "Dr. Ramesh", engagementStatus: "inactive" });

      await expect(service.getDashboard("tenant-1", "user-1")).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("succeeds when engagementStatus is active", async () => {
      mentorsRepo.findOwnProfile.mockResolvedValue({ id: "mentor-1", fullName: "Dr. Ramesh", engagementStatus: "active" });
      mentorsRepo.listActiveAssignedBatches.mockResolvedValue([]);

      const result = await service.getDashboard("tenant-1", "user-1");

      expect(result.mentorId).toBe("mentor-1");
    });
  });

  describe("AC-51: zero assignments is a valid empty state", () => {
    it("returns 200 with batches: [] — not an error", async () => {
      mentorsRepo.findOwnProfile.mockResolvedValue({ id: "mentor-1", fullName: "Dr. Ramesh", engagementStatus: "active" });
      mentorsRepo.listActiveAssignedBatches.mockResolvedValue([]);

      const result = await service.getDashboard("tenant-1", "user-1");

      expect(result.batches).toEqual([]);
      expect(batchCompletion.getSummary).not.toHaveBeenCalled();
    });
  });

  describe("AC-50: dashboard cards reuse the SAME rollup CRM staff use", () => {
    it("composes each card from listActiveAssignedBatches metadata + BatchCompletionService.getSummary", async () => {
      mentorsRepo.findOwnProfile.mockResolvedValue({ id: "mentor-1", fullName: "Dr. Ramesh", engagementStatus: "active" });
      const row: MentorAssignedBatchRow = {
        batchMentorId: "bm-1",
        batchId: "batch-1",
        batchName: "Full-Stack HYD-01",
        programTitle: "Full-Stack Web Development",
        status: "active",
        isLead: true,
        assignedAt: new Date("2026-01-10T00:00:00Z"),
      };
      mentorsRepo.listActiveAssignedBatches.mockResolvedValue([row]);
      batchCompletion.getSummary.mockResolvedValue(summaryFor("batch-1", { totalActive: 20, percentComplete: 63.5 }));

      const result = await service.getDashboard("tenant-1", "user-1");

      expect(result.batches).toEqual([
        {
          batchId: "batch-1",
          batchName: "Full-Stack HYD-01",
          programTitle: "Full-Stack Web Development",
          status: "active",
          isLead: true,
          studentCount: 20,
          percentComplete: 63.5,
        },
      ]);
      expect(batchCompletion.getSummary).toHaveBeenCalledWith("tenant-1", "user-1", "batch-1");
    });
  });

  describe("AC-46/47/48: cross-batch/cross-mentor/cross-tenant isolation via the reused scope check", () => {
    it("propagates a 404 from the rollup call if a batch somehow fails the assigned-scope re-check", async () => {
      mentorsRepo.findOwnProfile.mockResolvedValue({ id: "mentor-1", fullName: "Dr. Ramesh", engagementStatus: "active" });
      mentorsRepo.listActiveAssignedBatches.mockResolvedValue([
        {
          batchMentorId: "bm-1",
          batchId: "batch-1",
          batchName: "Full-Stack HYD-01",
          programTitle: "Full-Stack Web Development",
          status: "active",
          isLead: false,
          assignedAt: new Date("2026-01-10T00:00:00Z"),
        },
      ]);
      batchCompletion.getSummary.mockRejectedValue(new Error("defense-in-depth 404"));

      await expect(service.getDashboard("tenant-1", "user-1")).rejects.toThrow("defense-in-depth 404");
    });
  });
});
