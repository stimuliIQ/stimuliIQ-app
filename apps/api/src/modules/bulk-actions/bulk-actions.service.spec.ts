// apps/api/src/modules/bulk-actions/bulk-actions.service.spec.ts
//
// Unit tests for BulkActionsService, per-row isolation: a failure (out-of-scope /
// invalid transition) on one id must never abort the rest of the batch, and the
// underlying already-scope-checked single-row service methods are what's actually
// called (never a re-implemented scope filter).

import { NotFoundException } from "@nestjs/common";
import { BulkActionsService } from "./bulk-actions.service";
import type { LeadsService } from "../leads/leads.service";
import type { StudentsService } from "../students/students.service";

describe("BulkActionsService", () => {
  let leadsService: jest.Mocked<Pick<LeadsService, "assignOwner" | "moveStage">>;
  let studentsService: jest.Mocked<Pick<StudentsService, "update">>;
  let service: BulkActionsService;

  beforeEach(() => {
    leadsService = { assignOwner: jest.fn(), moveStage: jest.fn() };
    studentsService = { update: jest.fn() };
    service = new BulkActionsService(
      leadsService as unknown as LeadsService,
      studentsService as unknown as StudentsService,
    );
  });

  describe("bulkAssignLeads", () => {
    it("calls LeadsService.assignOwner per id and reports per-row success", async () => {
      leadsService.assignOwner.mockResolvedValue(undefined as never);

      const result = await service.bulkAssignLeads("tenant-1", { ids: ["l1", "l2"], ownerId: "owner-1" });

      expect(leadsService.assignOwner).toHaveBeenCalledWith("tenant-1", "l1", { ownerId: "owner-1" });
      expect(leadsService.assignOwner).toHaveBeenCalledWith("tenant-1", "l2", { ownerId: "owner-1" });
      expect(result.successCount).toBe(2);
      expect(result.failureCount).toBe(0);
    });

    it("isolates a row that is out of the caller's scope (404), does not abort the batch", async () => {
      leadsService.assignOwner
        .mockResolvedValueOnce(undefined as never)
        .mockRejectedValueOnce(new NotFoundException({ code: "leads.not_found", title: "Lead not found" }))
        .mockResolvedValueOnce(undefined as never);

      const result = await service.bulkAssignLeads("tenant-1", { ids: ["l1", "l2-out-of-scope", "l3"], ownerId: null });

      expect(leadsService.assignOwner).toHaveBeenCalledTimes(3);
      expect(result.successCount).toBe(2);
      expect(result.failureCount).toBe(1);
      expect(result.results.find((r) => r.id === "l2-out-of-scope")).toMatchObject({ success: false });
    });
  });

  describe("bulkMoveLeadsStage", () => {
    it("calls LeadsService.moveStage per id", async () => {
      leadsService.moveStage.mockResolvedValue(undefined as never);

      await service.bulkMoveLeadsStage("tenant-1", { ids: ["l1"], stage: "follow_up" });

      expect(leadsService.moveStage).toHaveBeenCalledWith("tenant-1", "l1", { stage: "follow_up" });
    });
  });

  describe("bulkUpdateStudentsStatus", () => {
    it("calls StudentsService.update per id with only the status field", async () => {
      studentsService.update.mockResolvedValue(undefined as never);

      const result = await service.bulkUpdateStudentsStatus("tenant-1", { ids: ["s1", "s2"], status: "alumni" });

      expect(studentsService.update).toHaveBeenCalledWith("tenant-1", "s1", { status: "alumni" });
      expect(studentsService.update).toHaveBeenCalledWith("tenant-1", "s2", { status: "alumni" });
      expect(result.successCount).toBe(2);
    });

    it("isolates a row outside the caller's branch/assigned scope (404)", async () => {
      studentsService.update
        .mockRejectedValueOnce(new NotFoundException({ code: "students.not_found", title: "Student not found" }))
        .mockResolvedValueOnce(undefined as never);

      const result = await service.bulkUpdateStudentsStatus("tenant-1", { ids: ["s-out", "s-in"], status: "active" });

      expect(result.successCount).toBe(1);
      expect(result.failureCount).toBe(1);
    });
  });
});
