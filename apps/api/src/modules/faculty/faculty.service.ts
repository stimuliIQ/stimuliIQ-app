// apps/api/src/modules/faculty/faculty.service.ts
//
// Business logic for faculty management (docs/04-trd-architecture.md §2.1). Owns the
// data-scope DECISION: unlike students, "branch" scope IS fully resolvable for faculty
// (faculty_profiles.branchId is a direct column) — no Wave-3b gap here. "own"/"self"
// scope is resolved to the caller's own faculty_profiles row.
//
// IDOR / object-level authz: any GET/PATCH/DELETE by :id re-verifies the row is in the
// caller's tenant AND resolved scope before acting; out-of-scope/out-of-tenant ids return
// 404 (not 403) to avoid existence disclosure — consistent with the students module.

import { ForbiddenException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import * as argon2 from "argon2";
import type { FacultyDetail, FacultyResetPasswordResponse, FacultySummary } from "@repo/types";
import type { BatchSummary } from "@repo/types";
import { FacultyRepository, type FacultyRow } from "./faculty.repository";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { requireScopeContext } from "../auth/lib/scope-context";
import { PrismaService } from "../../prisma/prisma.service";
import { ARGON2_HASH_OPTIONS } from "../auth/lib/argon2-params";
import { AuthRepository } from "../auth/auth.repository";
import { MAIL_PROVIDER, type MailProvider } from "../notifications/providers/mail/mail-provider.interface";
import { validateEnv } from "../../config/env";
import type { CreateFacultyRequest, ListFacultyQuery, UpdateFacultyRequest } from "./dto";

@Injectable()
export class FacultyService {
  private readonly logger = new Logger(FacultyService.name);

  constructor(
    private readonly repository: FacultyRepository,
    private readonly prisma: PrismaService,
    @Inject(MAIL_PROVIDER) private readonly mail: MailProvider,
    private readonly authRepository: AuthRepository,
  ) {}

  /**
   * Resolves the current scope into repository-level restriction options, or throws 403
   * for anything this module cannot yet resolve ("assigned" — not seeded for faculty.* in
   * P1; fails closed defensively rather than guessing a filter).
   */
  private async resolveListRestriction(actorId: string): Promise<{
    restrictToBranchIds?: string[];
    restrictToOwnUserId?: string;
  }> {
    const scope = requireScopeContext();

    switch (scope.scope) {
      case "all":
        return {};
      case "branch": {
        const branchIds = await this.repository.listCallerBranchIds(actorId);
        // A branch_manager whose user_roles row carries no branchId has nothing to see —
        // empty array (not undefined) so the repository filters to zero rows, not "all".
        return { restrictToBranchIds: branchIds };
      }
      case "own":
        return { restrictToOwnUserId: actorId };
      case "assigned":
      default:
        throw new ForbiddenException({
          code: "faculty.scope_unresolvable",
          title: "Scope not yet supported",
          detail: `The "${scope.scope}" data-scope is not seeded/resolvable for the faculty module in P1.`,
        });
    }
  }

  /** Same scope resolution, for a single-row (by id) lookup — returns an allow/deny predicate's inputs. */
  private async resolveObjectRestriction(
    actorId: string,
  ): Promise<{ branchIds?: string[]; ownUserId?: string }> {
    const scope = requireScopeContext();
    switch (scope.scope) {
      case "all":
        return {};
      case "branch":
        return { branchIds: await this.repository.listCallerBranchIds(actorId) };
      case "own":
        return { ownUserId: actorId };
      case "assigned":
      default:
        throw new ForbiddenException({
          code: "faculty.scope_unresolvable",
          title: "Scope not yet supported",
          detail: `The "${scope.scope}" data-scope is not seeded/resolvable for the faculty module in P1.`,
        });
    }
  }

  private assertInScope(row: FacultyRow, restriction: { branchIds?: string[]; ownUserId?: string }): void {
    if (restriction.branchIds && !restriction.branchIds.includes(row.branchId ?? "")) {
      throw new NotFoundException({ code: "faculty.not_found", title: "Faculty not found" });
    }
    if (restriction.ownUserId && restriction.ownUserId !== row.userId) {
      throw new NotFoundException({ code: "faculty.not_found", title: "Faculty not found" });
    }
  }

  async list(tenantId: string, actorId: string, query: ListFacultyQuery): Promise<PaginatedResult<FacultySummary>> {
    const restriction = await this.resolveListRestriction(actorId);

    const { rows, total } = await this.repository.list({
      tenantId,
      search: query.search,
      branchId: query.branchId,
      expertise: query.expertise,
      includeDeleted: query.includeDeleted,
      page: query.page,
      pageSize: query.pageSize,
      ...restriction,
    });

    return new PaginatedResult(rows.map(toSummary), {
      page: query.page,
      pageSize: query.pageSize,
      total,
      hasMore: query.page * query.pageSize < total,
    });
  }

  async getById(tenantId: string, actorId: string, id: string): Promise<FacultyDetail> {
    const row = await this.repository.findById(tenantId, id);
    if (!row) {
      throw new NotFoundException({ code: "faculty.not_found", title: "Faculty not found" });
    }
    const restriction = await this.resolveObjectRestriction(actorId);
    this.assertInScope(row, restriction);

    const assignedBatches = await this.repository.listAssignedBatches(row.id);
    return toDetail(row, assignedBatches.map(toBatchSummary));
  }

  async create(tenantId: string, body: CreateFacultyRequest): Promise<FacultyDetail> {
    // Creating faculty is gated by `faculty.create`, seeded only at scope "all"
    // (super_admin/admin/branch_manager via branch — see prisma/seed.ts branchManagerGrants
    // includes faculty.create at scope=branch). Branch-scoped creators may only create
    // faculty within their own branch(es); enforce that explicitly here since "create" has
    // no existing row to scope-check against.
    const scope = requireScopeContext();
    if (scope.scope === "branch") {
      const branchIds = await this.repository.listCallerBranchIds(scope.actorId);
      if (!body.branchId || !branchIds.includes(body.branchId)) {
        throw new ForbiddenException({
          code: "faculty.branch_out_of_scope",
          title: "Branch out of scope",
          detail: "Branch managers may only create faculty within their own branch.",
        });
      }
    }

    const existing = await this.repository.findUserByEmail(tenantId, body.email);
    if (existing) {
      throw new ForbiddenException({
        code: "faculty.email_in_use",
        title: "Email already in use",
        detail: "A user with this email already exists in this tenant.",
      });
    }

    const created = await this.repository.createFacultyWithUser({
      tenantId,
      name: body.name,
      email: body.email,
      phone: body.phone,
      expertise: body.expertise,
      bio: body.bio,
      branchId: body.branchId,
    });

    const row = await this.repository.findById(tenantId, created.id);
    if (!row) {
      throw new NotFoundException({ code: "faculty.not_found", title: "Faculty not found after creation" });
    }
    return toDetail(row, []);
  }

  async update(tenantId: string, actorId: string, id: string, body: UpdateFacultyRequest): Promise<FacultyDetail> {
    const existing = await this.repository.findById(tenantId, id);
    if (!existing) {
      throw new NotFoundException({ code: "faculty.not_found", title: "Faculty not found" });
    }
    const restriction = await this.resolveObjectRestriction(actorId);
    this.assertInScope(existing, restriction);

    await this.repository.updateFaculty(id, existing.userId, body);

    const updated = await this.repository.findById(tenantId, id);
    if (!updated) {
      throw new NotFoundException({ code: "faculty.not_found", title: "Faculty not found after update" });
    }
    const assignedBatches = await this.repository.listAssignedBatches(updated.id);
    return toDetail(updated, assignedBatches.map(toBatchSummary));
  }

  async softDelete(tenantId: string, actorId: string, id: string): Promise<FacultyDetail> {
    const existing = await this.repository.findById(tenantId, id);
    if (!existing) {
      throw new NotFoundException({ code: "faculty.not_found", title: "Faculty not found" });
    }
    const restriction = await this.resolveObjectRestriction(actorId);
    this.assertInScope(existing, restriction);

    await this.repository.softDelete(id);
    const after = await this.repository.findById(tenantId, id, true);
    return toDetail(after!, []);
  }

  async restore(tenantId: string, actorId: string, id: string): Promise<FacultyDetail> {
    const existing = await this.repository.findById(tenantId, id, true);
    if (!existing) {
      throw new NotFoundException({ code: "faculty.not_found", title: "Faculty not found" });
    }
    const restriction = await this.resolveObjectRestriction(actorId);
    this.assertInScope(existing, restriction);

    await this.repository.restore(id);
    const after = await this.repository.findById(tenantId, id);
    const assignedBatches = await this.repository.listAssignedBatches(after!.id);
    return toDetail(after!, assignedBatches.map(toBatchSummary));
  }

  /**
   * Admin "reset password" action (parallels students'
   * `LmsAccountProvisioningService.resendCredentials`, adapted for a faculty member's CRM
   * login): staff-triggered reissue for a lost/forgotten/compromised credential. Same
   * scope-check pattern as `update()`/`restore()` — out-of-tenant/out-of-scope ids are a
   * 404 (IDOR posture consistent with the rest of this module).
   *
   * Kept self-contained here (rather than delegating to a shared provisioning service,
   * which is student-profile-coupled) since faculty accounts have no equivalent
   * "auto-provision on enrollment" flow to share code with — this is the only place
   * faculty credentials get rotated post-creation.
   *
   * SECURITY: rotates the password AND revokes every live session for the user (same as
   * the student version) — a credential reset that leaves old sessions alive doesn't
   * actually revoke the thing it was meant to revoke.
   */
  async resetPassword(tenantId: string, actorId: string, id: string): Promise<FacultyResetPasswordResponse> {
    const existing = await this.repository.findById(tenantId, id);
    if (!existing) {
      throw new NotFoundException({ code: "faculty.not_found", title: "Faculty not found" });
    }
    const restriction = await this.resolveObjectRestriction(actorId);
    this.assertInScope(existing, restriction);

    const tempPassword = generateTemporaryPassword();
    const passwordHash = await argon2.hash(tempPassword, ARGON2_HASH_OPTIONS);

    await this.prisma.client.user.update({
      where: { id: existing.userId },
      data: { passwordHash, mustChangePassword: true, status: "active" },
    });
    await this.authRepository.revokeAllSessionsForUser(existing.userId);

    // Failure-isolated: the credential rotation + session revocation already succeeded,
    // so this never fails the caller-facing action just because the email bounced.
    await this.sendPasswordResetEmail(existing.email, existing.name, tempPassword);
    return { email: existing.email };
  }

  private async sendPasswordResetEmail(email: string, name: string, tempPassword: string): Promise<void> {
    const env = validateEnv();
    const loginUrl = `${env.CRM_APP_URL}/login`;
    try {
      await this.mail.send({
        to: email,
        subject: "Your stimuliIQ staff password has been reset",
        html:
          `<p>Hi ${escapeHtml(name)},</p>` +
          `<p>Your stimuliIQ staff account password has been reset by an administrator. Use the details ` +
          `below to sign in to the admin dashboard:</p>` +
          `<ul>` +
          `<li><strong>Login:</strong> <a href="${loginUrl}">${loginUrl}</a></li>` +
          `<li><strong>Username:</strong> ${escapeHtml(email)}</li>` +
          `<li><strong>Temporary password:</strong> ${escapeHtml(tempPassword)}</li>` +
          `</ul>` +
          `<p>For your security you'll be asked to set a new password the next time you sign in. ` +
          `Please don't share these details with anyone.</p>` +
          `<p>If you didn't expect this, please contact your administrator immediately.</p>`,
        tags: [{ name: "category", value: "staff_password_reset" }],
      });
    } catch (err) {
      // Never fail the reset action because the email bounced — the credential rotation
      // + session revocation already succeeded; staff can retry or the faculty member can
      // use "forgot password". Logged (without the password) for follow-up.
      this.logger.error(
        `[FacultyService] password-reset email failed for ${email}: ${err instanceof Error ? err.message : "unknown error"}`,
      );
    }
  }
}

/**
 * A readable, reasonably strong one-time password: 16 url-safe base64 chars from 12
 * random bytes. Never persisted in plaintext (only its argon2 hash) and rotated on first
 * login. Not a long-lived credential, so human-friendliness (no ambiguous separators)
 * matters more than maximal entropy here. Mirrors the student-side helper in
 * lms-account-provisioning.service.ts (kept module-local rather than shared to keep the
 * faculty module self-contained, per this feature's build instructions).
 */
function generateTemporaryPassword(): string {
  return randomBytes(12).toString("base64url");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function toSummary(row: FacultyRow): FacultySummary {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    email: row.email,
    phone: row.phone,
    expertise: row.expertise,
    rating: row.rating,
    branchId: row.branchId,
    createdAt: row.createdAt.toISOString(),
  };
}

function toDetail(row: FacultyRow, assignedBatches: BatchSummary[]): FacultyDetail {
  return {
    ...toSummary(row),
    bio: row.bio,
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
    updatedAt: row.updatedAt.toISOString(),
    assignedBatches,
  };
}

function toBatchSummary(row: {
  id: string;
  programId: string;
  programTitle: string;
  branchId: string;
  branchName: string;
  facultyId: string | null;
  facultyName: string | null;
  name: string;
  startDate: Date;
  endDate: Date | null;
  capacity: number;
  enrolledCount: number;
  mode: string;
  status: string;
  createdAt: Date;
}): BatchSummary {
  return {
    id: row.id,
    programId: row.programId,
    programTitle: row.programTitle,
    branchId: row.branchId,
    branchName: row.branchName,
    facultyId: row.facultyId,
    facultyName: row.facultyName,
    name: row.name,
    startDate: row.startDate.toISOString().slice(0, 10),
    // Wave 3b resolved the Wave-3a gap: `BatchSummarySchema.endDate` is now nullable,
    // matching `batches.end_date` (nullable in the DB for open-ended/ongoing batches) —
    // no fallback/sentinel needed.
    endDate: row.endDate ? row.endDate.toISOString().slice(0, 10) : null,
    capacity: row.capacity,
    enrolledCount: row.enrolledCount,
    mode: row.mode as BatchSummary["mode"],
    status: row.status as BatchSummary["status"],
    createdAt: row.createdAt.toISOString(),
  };
}
