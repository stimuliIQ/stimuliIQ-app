// apps/api/src/modules/mentors/mentors.service.ts
//
// Business logic for the mentor hiring-record CRUD (WS-1, docs/specs/phase-8-mentor.md).
// No Prisma here (CLAUDE.md §3.3) — all persistence goes through `MentorsRepository`.
//
// SCOPE: `mentors` carries no `branch_id` column (see mentors.repository.ts file header)
// — `all` and `branch` scope both resolve to "no restriction" (tenant-wide), a flagged,
// documented gap rather than a silent omission. `assigned`/`own` are never seeded for
// `mentors.*` (Rule M-3: the Mentor role never holds any `mentors.*` permission), so
// encountering either here is defensive fail-closed handling, not an expected path.
//
// BUSINESS-RULE ERROR CODES (mirrors mentors.schemas.ts file header — these are 422/409s
// the global ZodValidationPipe cannot produce, since they are not zod shape checks):
//   422 JOINED_DATE_REQUIRED           — engagementStatus='active' with no joinedAt (AC-3).
//   409 MENTOR_HAS_ACTIVE_ASSIGNMENTS  — soft-delete blocked while assigned (AC-12), with
//                                         ProblemDetails.errors[] = [{path:"batchMentorId", message:batchName}, ...].

import { ConflictException, ForbiddenException, Inject, Injectable, UnprocessableEntityException, NotFoundException } from "@nestjs/common";
import type {
  CreateMentorRequest,
  MentorDetail,
  MentorSummary,
  UpdateMentorRequest,
  ListMentorsQuery,
  MentorPhotoUploadUrlRequest,
  SignedUploadResponse,
} from "@repo/types";
import { MentorsRepository, type MentorRow } from "./mentors.repository";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { requireScopeContext } from "../auth/lib/scope-context";
import { STORAGE_PROVIDER, type StorageProvider } from "../storage/providers/storage/storage-provider.interface";
import { S3StorageProvider } from "../storage/providers/storage/s3-storage.provider";
import { validateEnv } from "../../config/env";

@Injectable()
export class MentorsService {
  constructor(
    private readonly repository: MentorsRepository,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  /**
   * Mint a short-lived signed PUT URL for a mentor photo (WS-1 marketing-profile add-on).
   * The client PUTs the image directly to the returned URL, then submits `storageKey` as
   * `photoKey` on create/update. The raw bucket URL is never returned (only the presigned
   * PUT URL + the opaque key). Key: mentor_photos/{tenantId}/{uuid}-{filename}.
   */
  async getPhotoUploadUrl(tenantId: string, body: MentorPhotoUploadUrlRequest): Promise<SignedUploadResponse> {
    this.assertResolvableScope();
    const { randomUUID } = await import("node:crypto");
    const key = S3StorageProvider.buildKey({
      namespace: "mentor_photos",
      tenantId,
      uniqueId: randomUUID(),
      filename: body.fileName,
    });
    const result = await this.storage.getSignedUploadUrl({
      key,
      contentType: body.contentType,
      maxBytes: body.sizeBytes,
      ttlSeconds: 900, // ≤15 min
    });
    return {
      storageKey: result.storageKey,
      uploadUrl: result.url,
      expiresAt: result.expiresAt.toISOString(),
      additionalHeaders: result.requiredHeaders,
      maxSizeBytes: body.sizeBytes,
    };
  }

  /**
   * Resolves the current scope into a repository-level restriction. `mentors` has no
   * `branch_id` column (see repository file header) — "all" and "branch" both resolve to
   * "no restriction" today; anything else fails closed (403), since no `mentors.*`
   * permission is ever seeded at `assigned`/`own` (Rule M-3).
   */
  private assertResolvableScope(): void {
    const scope = requireScopeContext();
    if (scope.scope !== "all" && scope.scope !== "branch") {
      throw new ForbiddenException({
        code: "mentors.scope_unresolvable",
        title: "Scope not supported",
        detail: `The "${scope.scope}" data-scope is not resolvable for the mentors module.`,
      });
    }
  }

  async list(tenantId: string, query: ListMentorsQuery): Promise<PaginatedResult<MentorSummary>> {
    this.assertResolvableScope();

    // F3: `includeDeleted` is admin-only — only an `all`-scope caller may read soft-deleted
    // mentor rows; a `branch`-scoped mentors.view holder is forced to active rows.
    const includeDeleted = query.includeDeleted === true && requireScopeContext().scope === "all";

    const { rows, total } = await this.repository.list({
      tenantId,
      search: query.search,
      engagementStatus: query.engagementStatus,
      expertise: query.expertise,
      includeDeleted,
      page: query.page,
      pageSize: query.pageSize,
    });

    return new PaginatedResult(rows.map(toSummary), {
      page: query.page,
      pageSize: query.pageSize,
      total,
      hasMore: query.page * query.pageSize < total,
    });
  }

  async getById(tenantId: string, id: string): Promise<MentorDetail> {
    this.assertResolvableScope();
    const row = await this.repository.findById(tenantId, id);
    if (!row) throw new NotFoundException({ code: "mentors.not_found", title: "Mentor not found" });
    const assignedBatches = await this.repository.listActiveAssignedBatches(tenantId, id);
    return toDetail(row, assignedBatches);
  }

  async create(tenantId: string, body: CreateMentorRequest): Promise<MentorDetail> {
    this.assertResolvableScope();
    this.assertJoinedDateRule(body.engagementStatus, body.joinedAt ?? null);

    const created = await this.repository.create(tenantId, {
      fullName: body.fullName,
      email: body.email,
      phone: body.phone ?? null,
      externalInstitute: body.externalInstitute,
      expertise: body.expertise,
      engagementStatus: body.engagementStatus,
      joinedAt: body.joinedAt ? new Date(body.joinedAt) : null,
      notes: body.notes ?? null,
      photoKey: body.photoKey ?? null,
      title: body.title ?? null,
      bio: body.bio ?? null,
      yearsExperience: body.yearsExperience ?? null,
      socialLinks: body.socialLinks ?? null,
    });

    const row = await this.repository.findById(tenantId, created.id);
    if (!row) throw new NotFoundException({ code: "mentors.not_found", title: "Mentor not found after creation" });
    return toDetail(row, []);
  }

  async update(tenantId: string, id: string, body: UpdateMentorRequest): Promise<MentorDetail> {
    this.assertResolvableScope();
    const existing = await this.repository.findById(tenantId, id);
    if (!existing) throw new NotFoundException({ code: "mentors.not_found", title: "Mentor not found" });

    const effectiveStatus = body.engagementStatus ?? existing.engagementStatus;
    const effectiveJoinedAt =
      body.joinedAt !== undefined ? body.joinedAt : existing.joinedAt ? existing.joinedAt.toISOString().slice(0, 10) : null;
    this.assertJoinedDateRule(effectiveStatus, effectiveJoinedAt);

    await this.repository.update(id, {
      ...(body.fullName !== undefined ? { fullName: body.fullName } : {}),
      ...(body.email !== undefined ? { email: body.email } : {}),
      ...(body.phone !== undefined ? { phone: body.phone } : {}),
      ...(body.externalInstitute !== undefined ? { externalInstitute: body.externalInstitute } : {}),
      ...(body.expertise !== undefined ? { expertise: body.expertise } : {}),
      ...(body.engagementStatus !== undefined ? { engagementStatus: body.engagementStatus } : {}),
      ...(body.joinedAt !== undefined ? { joinedAt: body.joinedAt ? new Date(body.joinedAt) : null } : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
      ...(body.photoKey !== undefined ? { photoKey: body.photoKey } : {}),
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.bio !== undefined ? { bio: body.bio } : {}),
      ...(body.yearsExperience !== undefined ? { yearsExperience: body.yearsExperience } : {}),
      ...(body.socialLinks !== undefined ? { socialLinks: body.socialLinks } : {}),
    });

    const updated = await this.repository.findById(tenantId, id);
    if (!updated) throw new NotFoundException({ code: "mentors.not_found", title: "Mentor not found after update" });
    const assignedBatches = await this.repository.listActiveAssignedBatches(tenantId, id);
    return toDetail(updated, assignedBatches);
  }

  /** AC-3/AC-9: `engagementStatus='active'` requires a `joinedAt`; other statuses do not. */
  private assertJoinedDateRule(engagementStatus: string, joinedAt: string | null): void {
    if (engagementStatus === "active" && !joinedAt) {
      throw new UnprocessableEntityException({
        code: "JOINED_DATE_REQUIRED",
        title: "Joined date is required",
        detail: "engagementStatus='active' requires a joinedAt date.",
      });
    }
  }

  /** AC-11/AC-12: soft-delete requires `mentors.delete` (guard-enforced) and is blocked while actively assigned. */
  async softDelete(tenantId: string, id: string): Promise<MentorDetail> {
    this.assertResolvableScope();
    const existing = await this.repository.findById(tenantId, id);
    if (!existing) throw new NotFoundException({ code: "mentors.not_found", title: "Mentor not found" });

    const blocking = await this.repository.listBlockingAssignments(tenantId, id);
    if (blocking.length > 0) {
      throw new ConflictException({
        code: "MENTOR_HAS_ACTIVE_ASSIGNMENTS",
        title: "Mentor has active batch assignments",
        detail: "Remove this mentor from every batch before deleting their hiring record.",
        errors: blocking.map((b) => ({ path: "batchMentorId", message: b.batchName })),
      });
    }

    await this.repository.softDelete(id);
    const after = await this.repository.findById(tenantId, id, true);
    return toDetail(after!, []);
  }

  async restore(tenantId: string, id: string): Promise<MentorDetail> {
    this.assertResolvableScope();
    const existing = await this.repository.findById(tenantId, id, true);
    if (!existing) throw new NotFoundException({ code: "mentors.not_found", title: "Mentor not found" });

    await this.repository.restore(id);
    const after = await this.repository.findById(tenantId, id);
    const assignedBatches = await this.repository.listActiveAssignedBatches(tenantId, id);
    return toDetail(after!, assignedBatches);
  }
}

/**
 * Convert a raw S3/R2 object key to a public asset URL — the raw key is NEVER returned to
 * clients. Base is `PUBLIC_ASSET_BASE_URL` (default the prod CDN; `.../api/v1/assets` in
 * local dev). Same convention as content.util.ts's `mintCdnUrl`.
 */
function mintCdnUrl(key: string | null): string | null {
  if (!key) return null;
  const base = (validateEnv().PUBLIC_ASSET_BASE_URL ?? "https://cdn.stimuliiq.com").replace(/\/+$/, "");
  return `${base}/${key}`;
}

function toSummary(row: MentorRow): MentorSummary {
  return {
    id: row.id,
    userId: row.userId,
    fullName: row.fullName,
    email: row.email,
    phone: row.phone,
    externalInstitute: row.externalInstitute,
    expertise: row.expertise,
    engagementStatus: row.engagementStatus,
    joinedAt: row.joinedAt ? row.joinedAt.toISOString().slice(0, 10) : null,
    assignedBatchCount: row.assignedBatchCount,
    photoUrl: mintCdnUrl(row.photoKey),
    title: row.title,
    yearsExperience: row.yearsExperience,
    createdAt: row.createdAt.toISOString(),
  };
}

function toDetail(
  row: MentorRow,
  assignedBatches: Array<{
    batchMentorId: string;
    batchId: string;
    batchName: string;
    programTitle: string;
    status: string;
    isLead: boolean;
    assignedAt: Date;
  }>,
): MentorDetail {
  return {
    ...toSummary(row),
    notes: row.notes,
    bio: row.bio,
    socialLinks: row.socialLinks,
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
    updatedAt: row.updatedAt.toISOString(),
    assignedBatches: assignedBatches.map((b) => ({
      batchMentorId: b.batchMentorId,
      batchId: b.batchId,
      batchName: b.batchName,
      programTitle: b.programTitle,
      status: b.status as MentorDetail["assignedBatches"][number]["status"],
      isLead: b.isLead,
      assignedAt: b.assignedAt.toISOString(),
    })),
  };
}
