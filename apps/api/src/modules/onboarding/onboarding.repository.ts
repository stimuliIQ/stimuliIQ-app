// apps/api/src/modules/onboarding/onboarding.repository.ts
//
// Prisma data access ONLY (CLAUDE.md §3.3). Covers both halves of the onboarding form —
// the staff-authored question set (`onboarding_fields`) and the student answers
// (`onboarding_submissions`) — because they are read together on every meaningful call
// (rendering the public form, mapping a submission for the CRM) and splitting them would
// buy nothing but an extra hop.
//
// Soft-delete and audit are handled transparently by the Prisma client extensions — both
// models are registered in SOFT_DELETE_MODELS and AUDITED_MODELS, so `.delete()` here
// writes `deleted_at` and every read auto-filters. The explicit `deletedAt: null` filters
// below are belt-and-braces (and make the intent readable at the call site).

import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  OnboardingFieldType as PrismaOnboardingFieldType,
  OnboardingIdentityRole as PrismaOnboardingIdentityRole,
  OnboardingSubmissionStatus as PrismaSubmissionStatus,
} from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";

export interface OnboardingFieldRow {
  id: string;
  key: string;
  label: string;
  helpText: string | null;
  placeholder: string | null;
  type: PrismaOnboardingFieldType;
  required: boolean;
  options: Prisma.JsonValue | null;
  allowOther: boolean;
  identityRole: PrismaOnboardingIdentityRole;
  sortOrder: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface OnboardingSubmissionRow {
  id: string;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  programId: string | null;
  answers: Prisma.JsonValue;
  status: PrismaSubmissionStatus;
  reviewNotes: string | null;
  reviewedAt: Date | null;
  /** Set only by a successful approval — also the idempotency guard against re-activating. */
  studentProfileId: string | null;
  createdAt: Date;
  /** `pricePaise`/`currency` ride along so the approve dialog knows what it will invoice. */
  program: { title: string; pricePaise: number; currency: string } | null;
  reviewedBy: { name: string } | null;
}

/** Selection shared by every submission read so list and detail can never drift. */
const SUBMISSION_SELECT = {
  id: true,
  fullName: true,
  email: true,
  phone: true,
  programId: true,
  answers: true,
  status: true,
  reviewNotes: true,
  reviewedAt: true,
  studentProfileId: true,
  createdAt: true,
  program: { select: { title: true, pricePaise: true, currency: true } },
  reviewedBy: { select: { name: true } },
} satisfies Prisma.OnboardingSubmissionSelect;

@Injectable()
export class OnboardingRepository {
  constructor(private readonly prisma: PrismaService) {}

  async getTenantIdBySlug(slug: string): Promise<string | null> {
    const tenant = await this.prisma.client.tenant.findFirst({ where: { slug, deletedAt: null }, select: { id: true } });
    return tenant?.id ?? null;
  }

  // ── Fields (the question set) ────────────────────────────────────────────

  async listFields(tenantId: string, filters?: { active?: boolean }): Promise<OnboardingFieldRow[]> {
    return this.prisma.client.onboardingField.findMany({
      where: { tenantId, deletedAt: null, ...(filters?.active !== undefined ? { active: filters.active } : {}) },
      // `sortOrder` is the staff-chosen sequence; `createdAt` only breaks ties so two
      // fields sharing an order never swap places between requests.
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
  }

  async findFieldById(tenantId: string, id: string): Promise<OnboardingFieldRow | null> {
    return this.prisma.client.onboardingField.findFirst({ where: { id, tenantId, deletedAt: null } });
  }

  async findFieldByKey(tenantId: string, key: string): Promise<OnboardingFieldRow | null> {
    return this.prisma.client.onboardingField.findFirst({ where: { key, tenantId, deletedAt: null } });
  }

  async createField(
    tenantId: string,
    data: {
      key: string;
      label: string;
      helpText: string | null;
      placeholder: string | null;
      type: PrismaOnboardingFieldType;
      required: boolean;
      options: string[] | null;
      allowOther: boolean;
      identityRole: PrismaOnboardingIdentityRole;
      sortOrder: number;
      active: boolean;
    },
  ): Promise<{ id: string }> {
    const row = await this.prisma.client.onboardingField.create({
      data: { tenantId, ...data, options: data.options ?? Prisma.DbNull },
      select: { id: true },
    });
    return row;
  }

  async updateField(id: string, patch: Prisma.OnboardingFieldUpdateInput): Promise<void> {
    await this.prisma.client.onboardingField.update({ where: { id }, data: patch });
  }

  async softDeleteField(id: string): Promise<void> {
    await this.prisma.client.onboardingField.delete({ where: { id } }); // rewritten to soft-delete.
  }

  /** Clears `identityRole` on every OTHER field currently claiming `role` (see the service). */
  async clearIdentityRole(tenantId: string, role: PrismaOnboardingIdentityRole, exceptFieldId: string): Promise<void> {
    await this.prisma.client.onboardingField.updateMany({
      where: { tenantId, deletedAt: null, identityRole: role, id: { not: exceptFieldId } },
      data: { identityRole: "none" },
    });
  }

  /** Applies a whole reorder in one transaction so the list is never half-sorted. */
  async reorderFields(tenantId: string, orderedIds: string[]): Promise<void> {
    await this.prisma.client.$transaction(
      orderedIds.map((id, index) =>
        this.prisma.client.onboardingField.updateMany({
          where: { id, tenantId, deletedAt: null },
          data: { sortOrder: index },
        }),
      ),
    );
  }

  /** Highest `sortOrder` in use, so a newly added question lands at the bottom. */
  async maxFieldSortOrder(tenantId: string): Promise<number> {
    const row = await this.prisma.client.onboardingField.findFirst({
      where: { tenantId, deletedAt: null },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });
    return row?.sortOrder ?? -1;
  }

  // ── Programs (choices for a `program`-typed field) ───────────────────────

  /**
   * Programs a student may pick on the public form. Deliberately the same gate the public
   * catalog uses (`isPublic` + `published`) — a program not visible on the site must not
   * be selectable on the onboarding form either.
   */
  async listSelectablePrograms(tenantId: string): Promise<Array<{ id: string; title: string }>> {
    return this.prisma.client.program.findMany({
      where: { tenantId, deletedAt: null, isPublic: true, status: "published" },
      orderBy: [{ order: "asc" }, { title: "asc" }],
      select: { id: true, title: true },
    });
  }

  async findProgramById(tenantId: string, id: string): Promise<{ id: string; title: string } | null> {
    return this.prisma.client.program.findFirst({
      where: { id, tenantId, deletedAt: null, isPublic: true, status: "published" },
      select: { id: true, title: true },
    });
  }

  // ── Submissions ──────────────────────────────────────────────────────────

  async createSubmission(
    tenantId: string,
    data: {
      fullName: string | null;
      email: string | null;
      phone: string | null;
      programId: string | null;
      answers: Prisma.InputJsonValue;
      ipHash: string;
    },
  ): Promise<{ id: string }> {
    return this.prisma.client.onboardingSubmission.create({ data: { tenantId, ...data }, select: { id: true } });
  }

  async listSubmissions(filters: {
    tenantId: string;
    status?: PrismaSubmissionStatus;
    programId?: string;
    search?: string;
    page: number;
    pageSize: number;
  }): Promise<{ rows: OnboardingSubmissionRow[]; total: number }> {
    const where: Prisma.OnboardingSubmissionWhereInput = {
      tenantId: filters.tenantId,
      deletedAt: null,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.programId ? { programId: filters.programId } : {}),
      // Search spans exactly the three denormalised identity columns — the reason they
      // exist. Searching inside the `answers` JSON would need a GIN index and would still
      // match staff-defined fields nobody expects to be searchable.
      ...(filters.search
        ? {
            OR: [
              { fullName: { contains: filters.search, mode: "insensitive" } },
              { email: { contains: filters.search, mode: "insensitive" } },
              { phone: { contains: filters.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.client.onboardingSubmission.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
        select: SUBMISSION_SELECT,
      }),
      this.prisma.client.onboardingSubmission.count({ where }),
    ]);
    return { rows, total };
  }

  async findSubmissionById(tenantId: string, id: string): Promise<OnboardingSubmissionRow | null> {
    return this.prisma.client.onboardingSubmission.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: SUBMISSION_SELECT,
    });
  }

  async updateSubmission(
    id: string,
    patch: {
      status?: PrismaSubmissionStatus;
      reviewNotes?: string | null;
      reviewedById?: string;
      reviewedAt?: Date;
      studentProfileId?: string;
    },
  ): Promise<void> {
    await this.prisma.client.onboardingSubmission.update({ where: { id }, data: patch });
  }

  /**
   * Batches a submission can be approved into — the open cohorts of the program the student
   * picked. `completed`/`archived` batches are excluded: enrolling someone into a finished
   * cohort is never the intent, and offering it invites a misclick.
   */
  async listApprovableBatches(tenantId: string, programId: string): Promise<Array<{ id: string; name: string; startDate: Date | null; status: string }>> {
    const rows = await this.prisma.client.batch.findMany({
      where: { tenantId, programId, deletedAt: null, status: { in: ["planned", "active"] } },
      orderBy: [{ startDate: "asc" }, { name: "asc" }],
      select: { id: true, name: true, startDate: true, status: true },
    });
    return rows;
  }

  async softDeleteSubmission(id: string): Promise<void> {
    await this.prisma.client.onboardingSubmission.delete({ where: { id } }); // rewritten to soft-delete.
  }
}
