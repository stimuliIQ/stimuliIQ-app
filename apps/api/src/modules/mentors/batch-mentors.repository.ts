// apps/api/src/modules/mentors/batch-mentors.repository.ts
//
// Prisma data access ONLY for the `batch_mentors` M:N assignment join (WS-2, docs/specs/
// phase-8-mentor.md). `BatchMentorsService` is the only caller. Also owns the minimal
// `batches` reads this module needs for scope/status checks (tenant/branch/status) —
// deliberately NOT importing `BatchesRepository` from the batches module, mirroring the
// existing precedent of `CertificatesRepository` reading `batch`/`module`/`assignment`
// directly rather than depending on sibling-module repositories (keeps this module's own
// dependency graph bounded per CLAUDE.md "keep modules cleanly bounded").
//
// Soft-delete + audit for `BatchMentor` are both handled transparently by the Prisma
// client extensions (Mentor/BatchMentor are already listed in both).

import { Injectable } from "@nestjs/common";
import type { BatchStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";

export interface BatchScopeRow {
  id: string;
  tenantId: string;
  branchId: string;
  name: string;
  status: BatchStatus;
}

export interface BatchMentorAssignmentRow {
  batchMentorId: string;
  mentorId: string;
  mentorFullName: string;
  mentorEmail: string;
  mentorExternalInstitute: string;
  mentorEngagementStatus: string;
  isLead: boolean;
  assignedAt: Date;
}

@Injectable()
export class BatchMentorsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Minimal batch row for scope/status checks — tenant-scoped, IDOR→null for cross-tenant. */
  async findBatchScopeRow(tenantId: string, batchId: string): Promise<BatchScopeRow | null> {
    const row = await this.prisma.client.batch.findFirst({
      where: { id: batchId, tenantId, deletedAt: null },
      select: { id: true, tenantId: true, branchId: true, name: true, status: true },
    });
    return row;
  }

  /** Branch ids the caller's `user_roles` rows are scoped to (mirrors BatchesRepository.listCallerBranchIds). */
  async listCallerBranchIds(userId: string): Promise<string[]> {
    const rows = await this.prisma.client.userRole.findMany({
      where: { userId, branchId: { not: null } },
      select: { branchId: true },
    });
    return rows.map((row) => row.branchId).filter((id): id is string => id !== null);
  }

  async listActiveForBatch(tenantId: string, batchId: string): Promise<BatchMentorAssignmentRow[]> {
    const rows = await this.prisma.client.batchMentor.findMany({
      where: { tenantId, batchId, deletedAt: null },
      include: { mentor: true },
      orderBy: [{ isLead: "desc" }, { assignedAt: "asc" }],
    });
    return rows.map((row) => ({
      batchMentorId: row.id,
      mentorId: row.mentorId,
      mentorFullName: row.mentor.fullName,
      mentorEmail: row.mentor.email,
      mentorExternalInstitute: row.mentor.externalInstitute,
      mentorEngagementStatus: row.mentor.engagementStatus,
      isLead: row.isLead,
      assignedAt: row.assignedAt,
    }));
  }

  async findActiveByBatchAndMentor(
    tenantId: string,
    batchId: string,
    mentorId: string,
  ): Promise<{ id: string; isLead: boolean } | null> {
    const row = await this.prisma.client.batchMentor.findFirst({
      where: { tenantId, batchId, mentorId, deletedAt: null },
      select: { id: true, isLead: true },
    });
    return row;
  }

  /** AC-21: at most one lead mentor per batch — clears every OTHER active row's lead flag. */
  async clearOtherLeads(tenantId: string, batchId: string, exceptBatchMentorId?: string): Promise<void> {
    await this.prisma.client.batchMentor.updateMany({
      where: {
        tenantId,
        batchId,
        deletedAt: null,
        isLead: true,
        ...(exceptBatchMentorId ? { id: { not: exceptBatchMentorId } } : {}),
      },
      data: { isLead: false },
    });
  }

  /** May throw a Prisma P2002 on the partial-unique (batch_id, mentor_id) WHERE deleted_at IS NULL — caller catches it. */
  async createAssignment(data: {
    tenantId: string;
    batchId: string;
    mentorId: string;
    isLead: boolean;
    assignedByUserId: string;
  }): Promise<{ id: string }> {
    const row = await this.prisma.client.batchMentor.create({
      data: {
        tenantId: data.tenantId,
        batchId: data.batchId,
        mentorId: data.mentorId,
        isLead: data.isLead,
        assignedAt: new Date(),
        assignedByUserId: data.assignedByUserId,
      },
    });
    return { id: row.id };
  }

  async updateIsLead(id: string, isLead: boolean): Promise<void> {
    await this.prisma.client.batchMentor.update({ where: { id }, data: { isLead } });
  }

  /** AC-24/Rule M-5: soft-unassign — never hard-deleted. */
  async softRemove(id: string): Promise<void> {
    await this.prisma.client.batchMentor.delete({ where: { id } }); // rewritten to soft-delete by the extension.
  }

  async findById(tenantId: string, id: string): Promise<{ id: string; batchId: string; mentorId: string } | null> {
    const row = await this.prisma.client.batchMentor.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true, batchId: true, mentorId: true },
    });
    return row;
  }
}
