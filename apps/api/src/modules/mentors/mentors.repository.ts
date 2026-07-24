// apps/api/src/modules/mentors/mentors.repository.ts
//
// Prisma data access ONLY for the `mentors` hiring-record table (CLAUDE.md §3.3:
// "repository — Prisma data access only, applies soft-delete + data-scope filters. No
// business logic."). `MentorsService` is the only caller.
//
// SCOPE (docs/specs/phase-8-mentor.md Part 7 RBAC table + the ground-truth schema note in
// packages/types/src/crm/mentors.schemas.ts file header):
//   `mentors` has NO `branch_id` column — the shipped schema cannot support Branch
//   Manager's branch-scoped mentor directory (the spec's AC-4/AC-5 intent). The seed
//   grants `mentors.*` to branch_manager at `RolePermissionScope.branch`, but there is no
//   column to filter on. This repository therefore applies NO restriction for either
//   "all" or "branch" scope — mentors are effectively TENANT-level for every caller who
//   holds a `mentors.*` permission (per this task's explicit brief: "Mentors are
//   TENANT-level (no branch_id) — the list is NOT branch-filtered"). This is a known,
//   flagged gap (not a silent behavior this repository introduces) — a follow-up
//   migration adding `mentors.branch_id` would close it; tracked in
//   docs/phase-8-followups.md.
//
// Soft-delete + audit are both handled transparently by the Prisma client extensions
// (apps/api/src/prisma/soft-delete.extension.ts / audit.extension.ts already list
// `Mentor`/`BatchMentor`) — this repository never writes to `audit_logs` directly.

import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { MentorEngagementStatus } from "@prisma/client";
import type { MentorSocialLinks } from "@repo/types";
import { PrismaService } from "../../prisma/prisma.service";

export interface MentorRow {
  id: string;
  tenantId: string;
  userId: string | null;
  fullName: string;
  email: string;
  phone: string | null;
  externalInstitute: string;
  expertise: string[];
  engagementStatus: MentorEngagementStatus;
  joinedAt: Date | null;
  notes: string | null;
  // Public marketing-profile fields (bound to the web /mentors page).
  photoKey: string | null;
  title: string | null;
  bio: string | null;
  yearsExperience: number | null;
  socialLinks: MentorSocialLinks | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  assignedBatchCount: number;
}

/** Marketing-profile fields persisted on create/update (raw `photoKey`, never a URL). */
export interface MentorProfileFields {
  photoKey: string | null;
  title: string | null;
  bio: string | null;
  yearsExperience: number | null;
  socialLinks: MentorSocialLinks | null;
}

export interface MentorAssignedBatchRow {
  batchMentorId: string;
  batchId: string;
  batchName: string;
  programTitle: string;
  status: string;
  isLead: boolean;
  assignedAt: Date;
}

export interface ListMentorsFilters {
  tenantId: string;
  search?: string;
  engagementStatus?: MentorEngagementStatus;
  expertise?: string;
  includeDeleted: boolean;
  page: number;
  pageSize: number;
}

/** Batch name for one still-active assignment blocking a soft-delete (AC-12). */
export interface BlockingAssignment {
  batchMentorId: string;
  batchName: string;
}

const MENTOR_INCLUDE = {
  _count: {
    select: { batchMentors: { where: { deletedAt: null } } },
  },
} satisfies Prisma.MentorInclude;

type MentorWithIncludes = Prisma.MentorGetPayload<{ include: typeof MENTOR_INCLUDE }>;

function toExpertiseArray(value: Prisma.JsonValue | null): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

/** Coerce the `social_links` JSON column into the typed object (drops non-string/unknown keys). */
function toSocialLinks(value: Prisma.JsonValue | null): MentorSocialLinks | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  const pick = (k: string): string | undefined => (typeof obj[k] === "string" ? (obj[k] as string) : undefined);
  const links: MentorSocialLinks = {};
  for (const k of ["linkedin", "twitter", "github", "website"] as const) {
    const v = pick(k);
    if (v) links[k] = v;
  }
  return Object.keys(links).length > 0 ? links : null;
}

function toMentorRow(row: MentorWithIncludes): MentorRow {
  return {
    id: row.id,
    tenantId: row.tenantId,
    userId: row.userId,
    fullName: row.fullName,
    email: row.email,
    phone: row.phone,
    externalInstitute: row.externalInstitute,
    expertise: toExpertiseArray(row.expertise),
    engagementStatus: row.engagementStatus,
    joinedAt: row.joinedAt,
    notes: row.notes,
    photoKey: row.photoKey,
    title: row.title,
    bio: row.bio,
    yearsExperience: row.yearsExperience,
    socialLinks: toSocialLinks(row.socialLinks),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
    assignedBatchCount: row._count.batchMentors,
  };
}

@Injectable()
export class MentorsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(filters: ListMentorsFilters): Promise<{ rows: MentorRow[]; total: number }> {
    const where: Prisma.MentorWhereInput = {
      tenantId: filters.tenantId,
      // The soft-delete extension re-injects `deletedAt: null` for any `where` missing
      // the `deletedAt` KEY entirely — `deletedAt: undefined` (a present key) is required
      // to actually opt out when `includeDeleted` is true (see BatchesRepository.list()
      // for the identical pattern).
      deletedAt: filters.includeDeleted ? undefined : null,
      ...(filters.engagementStatus ? { engagementStatus: filters.engagementStatus } : {}),
      ...(filters.search
        ? {
            OR: [
              { fullName: { contains: filters.search, mode: "insensitive" } },
              { externalInstitute: { contains: filters.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    // `expertise` (AC-7) is a Json string[] column (same modeling precedent as
    // `faculty_profiles.expertise`) — filtered in application code AFTER the DB fetch,
    // mirroring FacultyRepository.list()'s identical `expertise` handling, rather than a
    // provider-specific JSON `array_contains` where-clause. Applied AFTER pagination
    // (same accepted limitation as faculty's precedent) since it's a narrow, low-volume
    // directory filter, not a high-cardinality list.
    const [rows, total] = await Promise.all([
      this.prisma.client.mentor.findMany({
        where,
        include: MENTOR_INCLUDE,
        orderBy: { createdAt: "desc" },
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
      this.prisma.client.mentor.count({ where }),
    ]);

    const mapped = rows.map(toMentorRow);
    const filtered = filters.expertise
      ? mapped.filter((row) => row.expertise.includes(filters.expertise!))
      : mapped;

    return { rows: filtered, total };
  }

  async findById(tenantId: string, id: string, includeDeleted = false): Promise<MentorRow | null> {
    const row = await this.prisma.client.mentor.findFirst({
      where: { id, tenantId, deletedAt: includeDeleted ? undefined : null },
      include: MENTOR_INCLUDE,
    });
    return row ? toMentorRow(row) : null;
  }

  /** Currently-ACTIVE (non-removed) batch assignments for a mentor's detail view (AC's `assignedBatches`). */
  async listActiveAssignedBatches(tenantId: string, mentorId: string): Promise<MentorAssignedBatchRow[]> {
    const rows = await this.prisma.client.batchMentor.findMany({
      // F5: exclude soft-deleted batches via a relation filter — the soft-delete extension does
      // NOT filter nested `include`s, so without this a soft-deleted batch with a still-active
      // batch_mentors row would flow into the mentor dashboard and 500 it (the per-batch summary
      // re-queries the batch top-level with deletedAt:null → null → NotFoundException).
      where: { tenantId, mentorId, deletedAt: null, batch: { deletedAt: null } },
      include: { batch: { include: { program: { select: { title: true } } } } },
      orderBy: { assignedAt: "desc" },
    });
    return rows.map((row) => ({
      batchMentorId: row.id,
      batchId: row.batchId,
      batchName: row.batch.name,
      programTitle: row.batch.program.title,
      status: row.batch.status,
      isLead: row.isLead,
      assignedAt: row.assignedAt,
    }));
  }

  /** AC-12 soft-delete guard: batch names for every still-active assignment blocking a delete. */
  async listBlockingAssignments(tenantId: string, mentorId: string): Promise<BlockingAssignment[]> {
    const rows = await this.prisma.client.batchMentor.findMany({
      where: { tenantId, mentorId, deletedAt: null },
      include: { batch: { select: { name: true } } },
    });
    return rows.map((row) => ({ batchMentorId: row.id, batchName: row.batch.name }));
  }

  /** Used by the batch-assignment guard (AC-18: only `active` mentors may be assigned). */
  async findActiveAssignmentCandidate(
    tenantId: string,
    mentorId: string,
  ): Promise<{ id: string; engagementStatus: MentorEngagementStatus } | null> {
    const row = await this.prisma.client.mentor.findFirst({
      where: { id: mentorId, tenantId, deletedAt: null },
      select: { id: true, engagementStatus: true },
    });
    return row;
  }

  /** Own mentor profile lookup for the mentor-facing dashboard (Rule M-4: re-checked live, never cached). */
  async findOwnProfile(
    tenantId: string,
    userId: string,
  ): Promise<{ id: string; fullName: string; engagementStatus: MentorEngagementStatus } | null> {
    const row = await this.prisma.client.mentor.findFirst({
      where: { tenantId, userId, deletedAt: null },
      select: { id: true, fullName: true, engagementStatus: true },
    });
    return row;
  }

  // NOTE: no `emailExists()` helper here — `mentors.email` carries NO unique constraint
  // in the shipped schema (confirmed: prisma/migrations/20260708080000_mentors_core has
  // no unique index on `mentors.email`, unlike `users.email`). `POST /crm/mentors`
  // creates ONLY a `mentors` row (mentors.schemas.ts file header ground-truth deviation
  // #1) — it never touches `users`, so the Part-4 edge-case row's "standard uniqueness
  // handling on users.email applies" does not apply to this endpoint at all. Duplicate
  // mentor emails are therefore allowed by the shipped schema; enforcing app-level
  // uniqueness here would be inventing a constraint the schema doesn't have.

  async create(
    tenantId: string,
    data: {
      fullName: string;
      email: string;
      phone: string | null;
      externalInstitute: string;
      expertise: string[];
      engagementStatus: MentorEngagementStatus;
      joinedAt: Date | null;
      notes: string | null;
    } & Partial<MentorProfileFields>,
  ): Promise<{ id: string }> {
    const row = await this.prisma.client.mentor.create({
      data: {
        tenantId,
        fullName: data.fullName,
        email: data.email,
        phone: data.phone,
        externalInstitute: data.externalInstitute,
        expertise: data.expertise as Prisma.InputJsonValue,
        engagementStatus: data.engagementStatus,
        joinedAt: data.joinedAt,
        notes: data.notes,
        photoKey: data.photoKey ?? null,
        title: data.title ?? null,
        bio: data.bio ?? null,
        yearsExperience: data.yearsExperience ?? null,
        socialLinks: (data.socialLinks ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
    return { id: row.id };
  }

  async update(
    id: string,
    patch: Partial<{
      fullName: string;
      email: string;
      phone: string | null;
      externalInstitute: string;
      expertise: string[];
      engagementStatus: MentorEngagementStatus;
      joinedAt: Date | null;
      notes: string | null;
    } & MentorProfileFields>,
  ): Promise<void> {
    const { expertise, socialLinks, ...rest } = patch;
    await this.prisma.client.mentor.update({
      where: { id },
      data: {
        ...rest,
        ...(expertise !== undefined ? { expertise: expertise as Prisma.InputJsonValue } : {}),
        // `null` clears the column; an object replaces it; `undefined` (key absent) leaves it.
        ...(socialLinks !== undefined
          ? { socialLinks: (socialLinks ?? Prisma.DbNull) as Prisma.InputJsonValue | typeof Prisma.DbNull }
          : {}),
      },
    });
  }

  async softDelete(id: string): Promise<void> {
    await this.prisma.client.mentor.delete({ where: { id } }); // rewritten to soft-delete by the extension.
  }

  async restore(id: string): Promise<void> {
    await this.prisma.client.mentor.update({ where: { id }, data: { deletedAt: null } });
  }
}
