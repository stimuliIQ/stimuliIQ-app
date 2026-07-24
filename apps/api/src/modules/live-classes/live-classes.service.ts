// apps/api/src/modules/live-classes/live-classes.service.ts
//
// Business logic for the Live Class module (docs/plans/phase-9-completion.md T20).
// No Prisma here (CLAUDE.md §3.3) — all persistence goes through `LiveClassesRepository`.
// Depends ONLY on the `LiveClassProvider` interface (CLAUDE.md §3.7 — never a vendor SDK
// directly) and the `LiveClassReminderPort` seam (T18/R1 BullMQ integration).
//
// SCOPE (docs/plans/phase-9-completion.md T20, prisma/seed.ts P9 grants):
//   liveclass.view/join   -> all | branch | assigned | own
//   liveclass.create/edit/cancel -> all | assigned (branch_manager/student never hold these)
//
// JOIN SECURITY CONTRACT (mirrors live-class-provider.interface.ts's documented contract):
//   1. Scope/enrollment is verified BEFORE calling provider.getJoinUrl() — never after.
//   2. hostJoinUrl-equivalent access is granted only when the caller IS the host
//      (hostUserId === actorId) — every other caller (including admin) gets the
//      attendee-scoped URL, never the host URL, per the interface's SECURITY CONTRACT §1.
//   3. Attendance auto-sync (T20 "<=60s of join"): when the join succeeds AND the resolved
//      scope for THIS call was "own" (i.e. the caller matched liveclass.join at own-scope —
//      by construction only the `student` role is ever seeded at that scope), the service
//      writes the attendance row SYNCHRONOUSLY in the same request — trivially satisfying
//      any "<=60s" latency bound since it happens inline, not via a poll/webhook race.

import { ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type {
  CreateLiveClassRequest,
  JoinLiveClassResponse,
  LiveClassDetail,
  LiveClassSummary,
  ListLiveClassesQuery,
  ListMyLiveClassesQuery,
  MyLiveClass,
  UpdateLiveClassRequest,
} from "@repo/types";
import { LiveClassesRepository, type LiveClassRow } from "./live-classes.repository";
import { EnrollmentScopeRepository } from "../common-scope/enrollment-scope.repository";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { requireScopeContext } from "../auth/lib/scope-context";
import { LIVE_CLASS_PROVIDER, type LiveClassProvider } from "../lms/providers/live-class/live-class-provider.interface";
import {
  LIVE_CLASS_REMINDER_PORT,
  DEFAULT_REMINDER_OFFSET_MINUTES,
  type LiveClassReminderPort,
} from "./reminders/live-class-reminder.port";

interface Restriction {
  branchIds?: string[];
  batchIds?: string[];
}

/** A batchId that can never match a real row — used to force "zero rows" fail-closed when a caller has no resolvable profile. */
const UNRESOLVABLE_ID = "00000000-0000-0000-0000-000000000000";

@Injectable()
export class LiveClassesService {
  private readonly logger = new Logger(LiveClassesService.name);

  constructor(
    private readonly repository: LiveClassesRepository,
    private readonly scopeRepository: EnrollmentScopeRepository,
    @Inject(LIVE_CLASS_PROVIDER) private readonly provider: LiveClassProvider,
    @Inject(LIVE_CLASS_REMINDER_PORT) private readonly reminders: LiveClassReminderPort,
  ) {}

  // ─── Scope resolution ───────────────────────────────────────────────────────

  private async resolveRestriction(tenantId: string, actorId: string): Promise<Restriction> {
    const scope = requireScopeContext();
    switch (scope.scope) {
      case "all":
        return {};
      case "branch": {
        const branchIds = await this.repository.listCallerBranchIds(actorId);
        return { branchIds };
      }
      case "assigned": {
        const [facultyBatchIds, mentorBatchIds] = await Promise.all([
          this.resolveFacultyBatchIds(tenantId, actorId),
          this.scopeRepository.resolveBatchIdsForMentor(tenantId, actorId),
        ]);
        const merged = [...new Set([...facultyBatchIds, ...mentorBatchIds])];
        return { batchIds: merged.length > 0 ? merged : [UNRESOLVABLE_ID] };
      }
      case "own": {
        const batchIds = await this.scopeRepository.resolveBatchIdsForStudent(tenantId, actorId);
        return { batchIds: batchIds.length > 0 ? batchIds : [UNRESOLVABLE_ID] };
      }
      default:
        throw new ForbiddenException({
          code: "liveclass.scope_unresolvable",
          title: "Scope not supported",
          detail: `The "${scope.scope}" data-scope is not resolvable for the live-class module.`,
        });
    }
  }

  /** Faculty's "assigned" batches — resolved via facultyProfile.id, reusing the shared common-scope helper. */
  private async resolveFacultyBatchIds(tenantId: string, actorId: string): Promise<string[]> {
    // facultyProfile.id is required by resolveBatchIdsForFaculty; resolve it inline (no
    // circular dependency on BatchesRepository — same "each repository owns its own
    // scope-resolution queries" convention as batches.repository.ts's file header).
    const facultyProfileId = await this.repository.findOwnFacultyProfileId(tenantId, actorId);
    if (!facultyProfileId) return [];
    return this.scopeRepository.resolveBatchIdsForFaculty(tenantId, facultyProfileId);
  }

  /** Only "all"/"assigned" scopes may create/edit/cancel a live class (branch/own never seeded for these actions). */
  private assertCanManage(): void {
    const scope = requireScopeContext();
    if (scope.scope !== "all" && scope.scope !== "assigned") {
      throw new ForbiddenException({
        code: "liveclass.scope_cannot_manage",
        title: "Scope cannot manage live classes",
        detail: `The "${scope.scope}" data-scope cannot schedule/edit/cancel live classes.`,
      });
    }
  }

  private assertRowInScope(row: LiveClassRow, restriction: Restriction): void {
    if (restriction.branchIds && !restriction.branchIds.includes(row.branchId)) {
      throw new NotFoundException({ code: "liveclass.not_found", title: "Live class not found" });
    }
    if (restriction.batchIds && !restriction.batchIds.includes(row.batchId)) {
      throw new NotFoundException({ code: "liveclass.not_found", title: "Live class not found" });
    }
  }

  // ─── CRM: list / get / schedule / update / cancel ──────────────────────────

  async list(tenantId: string, actorId: string, query: ListLiveClassesQuery): Promise<PaginatedResult<LiveClassSummary>> {
    const restriction = await this.resolveRestriction(tenantId, actorId);

    const { rows, total } = await this.repository.list({
      tenantId,
      batchId: query.batchId,
      programId: query.programId,
      status: query.status,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      page: query.page,
      pageSize: query.pageSize,
      restrictToBranchIds: restriction.branchIds,
      restrictToBatchIds: restriction.batchIds,
    });

    return new PaginatedResult(rows.map(toSummary), {
      page: query.page,
      pageSize: query.pageSize,
      total,
      hasMore: query.page * query.pageSize < total,
    });
  }

  async getById(tenantId: string, actorId: string, id: string): Promise<LiveClassDetail> {
    const row = await this.repository.findById(tenantId, id);
    if (!row) throw new NotFoundException({ code: "liveclass.not_found", title: "Live class not found" });
    const restriction = await this.resolveRestriction(tenantId, actorId);
    this.assertRowInScope(row, restriction);
    return toDetail(row);
  }

  async schedule(tenantId: string, actorId: string, body: CreateLiveClassRequest): Promise<LiveClassDetail> {
    this.assertCanManage();

    const batch = await this.repository.findBatchForCreate(tenantId, body.batchId);
    if (!batch) throw new NotFoundException({ code: "liveclass.batch_not_found", title: "Batch not found" });

    // "assigned" scope callers may only schedule for a batch within their own assigned set.
    const restriction = await this.resolveRestriction(tenantId, actorId);
    if (restriction.batchIds && !restriction.batchIds.includes(body.batchId)) {
      throw new NotFoundException({ code: "liveclass.batch_not_found", title: "Batch not found" });
    }

    const hostOk = await this.repository.userExists(tenantId, body.hostUserId);
    if (!hostOk) throw new NotFoundException({ code: "liveclass.host_not_found", title: "Host user not found" });

    if (new Date(body.endsAt).getTime() <= new Date(body.startsAt).getTime()) {
      throw new ConflictException({
        code: "liveclass.invalid_time_range",
        title: "Invalid time range",
        detail: "endsAt must be after startsAt.",
      });
    }

    // FAIL CLOSED (live-class-provider.interface.ts contract): createMeeting throws when
    // credentials are absent — the caller surfaces 503, never a fabricated meeting row.
    let providerMeetingId: string | null = null;
    try {
      const result = await this.provider.createMeeting({
        topic: body.title,
        startTime: new Date(body.startsAt),
        durationMinutes: Math.round((new Date(body.endsAt).getTime() - new Date(body.startsAt).getTime()) / 60_000),
        hostUserId: body.hostUserId,
      });
      providerMeetingId = result.providerMeetingId;
    } catch (err) {
      this.logger.error(`[LiveClassesService] provider.createMeeting failed: ${String(err)}`);
      throw new ConflictException({
        code: "liveclass.provider_unavailable",
        title: "Live-class provider unavailable",
        detail: "The live-class provider could not be reached. Please try again.",
      });
    }

    const created = await this.repository.create(tenantId, {
      batchId: body.batchId,
      programId: batch.programId,
      title: body.title,
      provider: body.provider,
      providerMeetingId,
      joinUrl: null,
      startsAt: new Date(body.startsAt),
      endsAt: new Date(body.endsAt),
      hostUserId: body.hostUserId,
    });

    await this.scheduleReminders(tenantId, created.id, body.title, new Date(body.startsAt), body.batchId, body.hostUserId);

    const row = await this.repository.findById(tenantId, created.id);
    if (!row) throw new NotFoundException({ code: "liveclass.not_found", title: "Live class not found after creation" });
    return toDetail(row);
  }

  async update(tenantId: string, actorId: string, id: string, body: UpdateLiveClassRequest): Promise<LiveClassDetail> {
    this.assertCanManage();
    const existing = await this.repository.findById(tenantId, id);
    if (!existing) throw new NotFoundException({ code: "liveclass.not_found", title: "Live class not found" });
    const restriction = await this.resolveRestriction(tenantId, actorId);
    this.assertRowInScope(existing, restriction);

    if (existing.status !== "scheduled") {
      throw new ConflictException({
        code: "liveclass.not_editable",
        title: "Live class is not editable",
        detail: `Live classes with status="${existing.status}" cannot be rescheduled.`,
      });
    }

    if (body.hostUserId) {
      const hostOk = await this.repository.userExists(tenantId, body.hostUserId);
      if (!hostOk) throw new NotFoundException({ code: "liveclass.host_not_found", title: "Host user not found" });
    }

    const nextStartsAt = body.startsAt ? new Date(body.startsAt) : existing.startsAt;
    const nextEndsAt = body.endsAt ? new Date(body.endsAt) : existing.endsAt;
    if (nextEndsAt.getTime() <= nextStartsAt.getTime()) {
      throw new ConflictException({
        code: "liveclass.invalid_time_range",
        title: "Invalid time range",
        detail: "endsAt must be after startsAt.",
      });
    }

    await this.repository.update(id, {
      ...(body.title ? { title: body.title } : {}),
      ...(body.startsAt ? { startsAt: nextStartsAt } : {}),
      ...(body.endsAt ? { endsAt: nextEndsAt } : {}),
      ...(body.hostUserId ? { hostUserId: body.hostUserId } : {}),
    });

    // AC (T20): re-schedule reminders if startsAt changed.
    if (body.startsAt) {
      await this.scheduleReminders(
        tenantId,
        id,
        body.title ?? existing.title,
        nextStartsAt,
        existing.batchId,
        body.hostUserId ?? existing.hostUserId,
      );
    }

    const updated = await this.repository.findById(tenantId, id);
    if (!updated) throw new NotFoundException({ code: "liveclass.not_found", title: "Live class not found after update" });
    return toDetail(updated);
  }

  async cancel(tenantId: string, actorId: string, id: string): Promise<LiveClassDetail> {
    this.assertCanManage();
    const existing = await this.repository.findById(tenantId, id);
    if (!existing) throw new NotFoundException({ code: "liveclass.not_found", title: "Live class not found" });
    const restriction = await this.resolveRestriction(tenantId, actorId);
    this.assertRowInScope(existing, restriction);

    if (existing.status === "cancelled" || existing.status === "completed") {
      throw new ConflictException({
        code: "liveclass.already_terminal",
        title: "Live class already ended",
        detail: `Live classes with status="${existing.status}" cannot be cancelled.`,
      });
    }

    if (existing.providerMeetingId) {
      try {
        await this.provider.endMeeting({ providerMeetingId: existing.providerMeetingId });
      } catch (err) {
        // Non-fatal — the row is still marked cancelled locally even if the vendor call
        // fails (e.g. the meeting already ended on the vendor side).
        this.logger.warn(`[LiveClassesService] provider.endMeeting failed (non-fatal): ${String(err)}`);
      }
    }

    await this.repository.update(id, { status: "cancelled" });

    const recipients = await this.reminderRecipientUserIds(tenantId, existing.batchId, existing.hostUserId);
    await this.reminders.cancelReminders(id, recipients, DEFAULT_REMINDER_OFFSET_MINUTES);

    const after = await this.repository.findById(tenantId, id);
    if (!after) throw new NotFoundException({ code: "liveclass.not_found", title: "Live class not found after cancel" });
    return toDetail(after);
  }

  // ─── LMS: student's own live classes ────────────────────────────────────────

  async listMine(tenantId: string, actorId: string, query: ListMyLiveClassesQuery): Promise<PaginatedResult<MyLiveClass>> {
    const restriction = await this.resolveRestriction(tenantId, actorId);
    const now = new Date();

    const { rows, total } = await this.repository.list({
      tenantId,
      status: query.status,
      from: query.upcoming ? now : undefined,
      page: query.page,
      pageSize: query.pageSize,
      restrictToBranchIds: restriction.branchIds,
      restrictToBatchIds: restriction.batchIds,
    });

    return new PaginatedResult(rows.map(toMyLiveClass), {
      page: query.page,
      pageSize: query.pageSize,
      total,
      hasMore: query.page * query.pageSize < total,
    });
  }

  // ─── Join (shared CRM + LMS entrypoint) ─────────────────────────────────────

  async join(tenantId: string, actorId: string, id: string): Promise<JoinLiveClassResponse> {
    const row = await this.repository.findById(tenantId, id);
    if (!row) throw new NotFoundException({ code: "liveclass.not_found", title: "Live class not found" });

    // Resolve the joiner's own display name/email server-side — NEVER trust a client-
    // supplied name/email for the provider's registrant/roster record.
    const actor = await this.repository.findUserContact(tenantId, actorId);
    if (!actor) throw new NotFoundException({ code: "liveclass.not_found", title: "Live class not found" });

    const scope = requireScopeContext();
    const restriction = await this.resolveRestriction(tenantId, actorId);
    this.assertRowInScope(row, restriction);

    if (row.status === "cancelled" || row.status === "completed") {
      throw new ConflictException({
        code: "liveclass.not_joinable",
        title: "Live class is not joinable",
        detail: `Live classes with status="${row.status}" cannot be joined.`,
      });
    }

    if (!row.providerMeetingId) {
      throw new ConflictException({
        code: "liveclass.provider_meeting_missing",
        title: "Live class has no provider meeting",
        detail: "This session was not successfully created with the live-class provider.",
      });
    }

    const isHost = row.hostUserId === actorId;
    const result = await this.provider.getJoinUrl({
      providerMeetingId: row.providerMeetingId,
      userId: actorId,
      userName: actor.name,
      userEmail: actor.email,
      role: isHost ? "host" : "attendee",
    });

    // Session transitions to "live" on first join, within its scheduled window.
    if (row.status === "scheduled") {
      await this.repository.update(id, { status: "live" });
    }

    // T20 attendance auto-sync (<=60s of join): only for callers who matched liveclass.join
    // at "own" scope — by seed construction, only the `student` role is ever granted that
    // scope for this permission (see prisma/seed.ts P9 grants). Written SYNCHRONOUSLY in
    // this same request, trivially satisfying the "<=60s" latency bound.
    if (scope.scope === "own") {
      const enrollment = await this.repository.findActiveEnrollmentForBatch(tenantId, row.batchId, actorId);
      if (enrollment) {
        await this.repository.upsertLiveAttendance({
          tenantId,
          enrollmentId: enrollment.enrollmentId,
          liveClassId: id,
          markedAt: new Date(),
        });
      }
    }

    return {
      joinUrl: result.url,
      provider: row.provider,
      expiresAt: (result.expiresAt ?? new Date(Date.now() + 5 * 60_000)).toISOString(),
    };
  }

  // ─── Reminders (T18/R1 BullMQ integration) ──────────────────────────────────

  private async reminderRecipientUserIds(tenantId: string, batchId: string, hostUserId: string): Promise<string[]> {
    const students = await this.repository.listBatchStudentRecipients(tenantId, batchId);
    return [...new Set([...students.map((s) => s.userId), hostUserId])];
  }

  private async scheduleReminders(
    tenantId: string,
    liveClassId: string,
    title: string,
    startsAt: Date,
    batchId: string,
    hostUserId: string,
  ): Promise<void> {
    const [students, host] = await Promise.all([
      this.repository.listBatchStudentRecipients(tenantId, batchId),
      this.repository.findUserContact(tenantId, hostUserId),
    ]);

    const recipients = [
      ...students.map((s) => ({ userId: s.userId, tenantId, toEmail: s.email })),
      ...(host ? [{ userId: hostUserId, tenantId, toEmail: host.email }] : []),
    ];

    if (recipients.length === 0) return;

    try {
      await this.reminders.scheduleReminders({
        liveClassId,
        title,
        startsAt,
        offsetMinutes: DEFAULT_REMINDER_OFFSET_MINUTES,
        recipients,
      });
    } catch (err) {
      // Non-fatal — scheduling failure must never block the live-class create/update itself.
      this.logger.warn(`[LiveClassesService] scheduleReminders failed (non-fatal): ${String(err)}`);
    }
  }
}

// ─── DTO mapping ────────────────────────────────────────────────────────────

function toSummary(row: LiveClassRow): LiveClassSummary {
  return {
    id: row.id,
    batchId: row.batchId,
    batchName: row.batchName,
    programId: row.programId,
    programTitle: row.programTitle,
    title: row.title,
    provider: row.provider,
    status: row.status,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    hostUserId: row.hostUserId,
    hostName: row.hostName,
    createdAt: row.createdAt.toISOString(),
  };
}

function toDetail(row: LiveClassRow): LiveClassDetail {
  return {
    ...toSummary(row),
    providerMeetingId: row.providerMeetingId,
    recordingUrl: row.recordingUrl,
    attendeeCount: row.attendeeCount,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toMyLiveClass(row: LiveClassRow): MyLiveClass {
  const now = Date.now();
  const startsAtMs = row.startsAt.getTime();
  const preJoinWindowMs = 10 * 60_000; // 10 minutes before start.
  const canJoin =
    row.status === "live" || (row.status === "scheduled" && startsAtMs - preJoinWindowMs <= now && now <= row.endsAt.getTime());
  return {
    id: row.id,
    batchId: row.batchId,
    programId: row.programId,
    programTitle: row.programTitle,
    title: row.title,
    status: row.status,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    hostName: row.hostName,
    canJoin,
  };
}
