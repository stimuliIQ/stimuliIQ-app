// apps/api/src/modules/admin/users.service.ts
//
// Business logic for Admin ▸ Users (staff-account credential management). No Prisma
// here (CLAUDE.md §3.3). Permission keys users.view/create/edit/delete are seeded at
// scope=all for super_admin + admin only, so like roles.service.ts there is no
// data-scope resolution — only the safety guards below:
//
//   - Students never surface here (repository filters to non-student roles) and the
//     `student` role can never be assigned from this surface — student accounts are
//     owned by the enrollment flow.
//   - You cannot deactivate/suspend YOURSELF (locking the last admin out of the CRM
//     one click at a time is a classic foot-gun).
//   - A password reset or a deactivation revokes every refresh session for the target
//     user (a rotated credential or a disabled account must not keep working until the
//     old refresh token expires).
//   - Every mutation writes one explicit audit row (entity="User") with before/after.

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import * as argon2 from "argon2";
import type {
  StaffUser,
  CreateStaffUserRequest,
  ListStaffUsersQuery,
  UpdateStaffUserRequest,
  ResetStaffUserPasswordResponse,
} from "@repo/types";
import { UsersAdminRepository, type StaffUserRow } from "./users.repository";
import { RolesRepository } from "./roles.repository";
import { SCOPE_RANK } from "./scope-rank";
import { AuthRepository } from "../auth/auth.repository";
import { TwoFactorStore } from "../auth/lib/two-factor-store";
import { ARGON2_HASH_OPTIONS } from "../auth/lib/argon2-params";
import { generateTemporaryPassword } from "../auth/lib/temporary-password";
import { MAIL_PROVIDER, type MailProvider } from "../notifications/providers/mail/mail-provider.interface";
import { renderBrandedEmail, escapeEmailHtml } from "../notifications/dispatch/email-layout";
import { validateEnv } from "../../config/env";
import { PaginatedResult } from "../../common/dto/paginated-result";

function toDto(row: StaffUserRow): StaffUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    status: row.status,
    roles: row.userRoles.map((ur) => ({ id: ur.role.id, key: ur.role.key, name: ur.role.name })),
    lastLoginAt: row.lastLoginAt ? row.lastLoginAt.toISOString() : null,
    teamId: row.teamId,
    teamName: row.team?.name ?? null,
    // The branch is per role assignment, but the form offers ONE picker — so the first
    // non-null one is reported. Every assignment gets the same value on write, so they only
    // differ for rows seeded before this field was writable.
    branchId: row.userRoles.find((ur) => ur.branchId !== null)?.branchId ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** The audit snapshot — never includes the password hash. */
function auditSnapshot(row: StaffUserRow) {
  return {
    name: row.name,
    email: row.email,
    phone: row.phone,
    status: row.status,
    roles: row.userRoles.map((ur) => ur.role.key),
  };
}

@Injectable()
export class UsersAdminService {
  private readonly logger = new Logger(UsersAdminService.name);

  constructor(
    private readonly repository: UsersAdminRepository,
    private readonly rolesRepository: RolesRepository,
    private readonly authRepository: AuthRepository,
    private readonly twoFactorStore: TwoFactorStore,
    @Inject(MAIL_PROVIDER) private readonly mail: MailProvider,
  ) {}

  async list(tenantId: string, query: ListStaffUsersQuery): Promise<PaginatedResult<StaffUser>> {
    const { rows, total } = await this.repository.list(tenantId, {
      search: query.search,
      roleId: query.roleId,
      status: query.status,
      page: query.page,
      pageSize: query.pageSize,
    });
    return new PaginatedResult(rows.map(toDto), {
      page: query.page,
      pageSize: query.pageSize,
      total,
      hasMore: query.page * query.pageSize < total,
    });
  }

  async getById(tenantId: string, id: string): Promise<StaffUser> {
    const row = await this.repository.findById(tenantId, id);
    if (!row) throw new NotFoundException({ code: "users.not_found", title: "User not found" });
    return toDto(row);
  }

  async create(tenantId: string, actorId: string, body: CreateStaffUserRequest, ip?: string): Promise<StaffUser> {
    if (await this.repository.emailTaken(tenantId, body.email)) {
      throw new ConflictException({
        code: "users.email_taken",
        title: "Email already in use",
        detail: `A user with email "${body.email}" already exists.`,
      });
    }
    const roleIds = await this.resolveStaffRoleIds(tenantId, actorId, body.roleIds);
    const passwordHashForNew = await argon2.hash(body.password, ARGON2_HASH_OPTIONS);

    // Re-adding someone who was REMOVED. `users` has a full unique on (tenant, email), so
    // the address stays reserved by the soft-deleted row and a plain insert would hit a raw
    // P2002 — an unexplainable 500 for an admin who can see no such user. Restore instead:
    // the account comes back as the one they just described, and its audit history (which
    // hangs off this id) stays connected rather than being split across two rows.
    const removed = await this.repository.findAnyByEmail(tenantId, body.email);
    if (removed?.deletedAt) {
      await this.repository.restore({
        userId: removed.id,
        name: body.name,
        phone: body.phone ?? null,
        passwordHash: passwordHashForNew,
        roleIds,
        teamId: body.teamId ?? null,
        branchId: body.branchId ?? null,
      });
      const restored = await this.repository.findById(tenantId, removed.id);
      if (!restored) throw new NotFoundException({ code: "users.not_found", title: "User not found" });
      await this.repository.recordAudit({
        tenantId,
        actorId,
        userId: removed.id,
        action: "restore",
        before: undefined,
        after: { ...auditSnapshot(restored), restoredFromRemoved: true },
        ip,
      });
      return toDto(restored);
    }

    const passwordHash = passwordHashForNew;
    const userId = await this.repository.create({
      tenantId,
      name: body.name,
      email: body.email,
      phone: body.phone ?? null,
      passwordHash,
      roleIds,
      teamId: body.teamId ?? null,
      branchId: body.branchId ?? null,
    });

    const created = await this.repository.findById(tenantId, userId);
    if (!created) throw new NotFoundException({ code: "users.not_found", title: "User not found" });
    await this.repository.recordAudit({
      tenantId,
      actorId,
      userId,
      action: "create",
      before: undefined,
      after: auditSnapshot(created),
      ip,
    });
    return toDto(created);
  }

  async update(tenantId: string, actorId: string, id: string, body: UpdateStaffUserRequest, ip?: string): Promise<StaffUser> {
    const existing = await this.repository.findById(tenantId, id);
    if (!existing) throw new NotFoundException({ code: "users.not_found", title: "User not found" });

    if (id === actorId && body.status && body.status !== "active") {
      throw new ForbiddenException({
        code: "users.cannot_disable_self",
        title: "You cannot suspend or deactivate your own account",
        detail: "Ask another admin to change your account's status.",
      });
    }

    // Setting somebody's password from the edit form is the SAME power as
    // `POST :id/reset-password`, which is seeded for super_admin alone precisely so an
    // admin cannot mint a colleague's credentials (see the docstring on
    // ResetStaffUserPasswordResponseSchema). This field rode in under `users.edit`, which
    // admin also holds — and it is the stronger of the two, because the actor CHOOSES the
    // password here instead of a random one being mailed to the account holder. Gate it on
    // the same key the dedicated route uses.
    if (body.password) {
      const actorProfile = await this.authRepository.getRbacProfile(actorId);
      if (!actorProfile.permissions.some((p) => p.key === "users.reset_password")) {
        throw new ForbiddenException({
          code: "users.password_change_not_permitted",
          title: "You cannot set another user's password",
          detail:
            "Changing a staff member's credential requires the \"Reset Staff Passwords\" permission. " +
            "Ask a super admin to reset it — they can send the account holder a one-time password.",
        });
      }
    }

    const roleIds = body.roleIds ? await this.resolveStaffRoleIds(tenantId, actorId, body.roleIds) : undefined;
    const passwordHash = body.password ? await argon2.hash(body.password, ARGON2_HASH_OPTIONS) : undefined;

    await this.repository.update({
      userId: id,
      name: body.name,
      phone: body.phone,
      status: body.status,
      passwordHash,
      roleIds,
      teamId: body.teamId,
      branchId: body.branchId,
    });

    // A rotated credential or a no-longer-active account must not keep riding an
    // existing refresh session until natural expiry.
    if (body.password || (body.status && body.status !== "active")) {
      await this.authRepository.revokeAllSessionsForUser(id);
    }

    const updated = await this.repository.findById(tenantId, id);
    if (!updated) throw new NotFoundException({ code: "users.not_found", title: "User not found" });
    await this.repository.recordAudit({
      tenantId,
      actorId,
      userId: id,
      action: "update",
      before: auditSnapshot(existing),
      after: { ...auditSnapshot(updated), ...(body.password ? { passwordReset: true } : {}) },
      ip,
    });
    return toDto(updated);
  }

  /** DELETE = deactivate (status=deactivated + revoke sessions), never a row wipe. */
  async deactivate(tenantId: string, actorId: string, id: string, ip?: string): Promise<StaffUser> {
    const existing = await this.repository.findById(tenantId, id);
    if (!existing) throw new NotFoundException({ code: "users.not_found", title: "User not found" });
    if (id === actorId) {
      throw new ForbiddenException({
        code: "users.cannot_disable_self",
        title: "You cannot deactivate your own account",
        detail: "Ask another admin to deactivate your account.",
      });
    }

    await this.repository.deactivate(id);
    await this.authRepository.revokeAllSessionsForUser(id);

    const updated = await this.repository.findById(tenantId, id);
    if (!updated) throw new NotFoundException({ code: "users.not_found", title: "User not found" });
    await this.repository.recordAudit({
      tenantId,
      actorId,
      userId: id,
      action: "delete",
      before: auditSnapshot(existing),
      after: auditSnapshot(updated),
      ip,
    });
    return toDto(updated);
  }

  /**
   * `DELETE /crm/admin/users/:id/permanent` — remove the account from the CRM entirely.
   *
   * SEPARATE FROM DEACTIVATE, and gated on its own `users.remove` permission held by
   * super_admin ALONE (deactivate is `users.delete`, which admin also holds). The two do
   * different jobs: deactivate blocks a login you still expect to see in the list — someone
   * on leave, someone suspended pending a review. This is for an account that should not be
   * in the product at all: a test login, a wrong address, a person who never joined.
   *
   * SOFT delete, not a row wipe. Audit rows, lead ownership and onboarding reviews all point
   * at this user id; a hard delete would either orphan those references or cascade real
   * history away. The row stays, `deleted_at` is set, and every read filters it out — so
   * from the CRM's point of view the account is gone, while "who approved this in July?"
   * still answers. Re-adding the same email later restores this row (see `create`).
   *
   * Three guards, each protecting against a way an admin can lock the company out:
   *   - never yourself (the classic one-click foot-gun, same as deactivate);
   *   - never the last active super_admin — with no super_admin nobody can grant the role
   *     back, and `users.remove` itself becomes unreachable;
   *   - sessions are revoked, because a removed account must not keep working on an
   *     existing refresh token until it expires naturally.
   */
  async remove(tenantId: string, actorId: string, id: string, ip?: string): Promise<void> {
    const existing = await this.repository.findById(tenantId, id);
    if (!existing) throw new NotFoundException({ code: "users.not_found", title: "User not found" });

    if (id === actorId) {
      throw new ForbiddenException({
        code: "users.cannot_remove_self",
        title: "You cannot delete your own account",
        detail: "Ask another super admin to remove it.",
      });
    }

    const isSuperAdmin = existing.userRoles.some((ur) => ur.role.key === "super_admin");
    if (isSuperAdmin) {
      const others = await this.repository.countOtherActiveUsersWithRole(tenantId, "super_admin", id);
      if (others === 0) {
        throw new ForbiddenException({
          code: "users.last_super_admin",
          title: "This is the last super admin",
          detail:
            "Deleting them would leave nobody able to manage roles or users. Create another super admin first, then remove this one.",
        });
      }
    }

    await this.repository.softDelete(id);
    await this.authRepository.revokeAllSessionsForUser(id);

    // Written from the PRE-delete snapshot: after the soft-delete the row no longer reads,
    // so this audit entry is the only remaining record of who the account belonged to.
    await this.repository.recordAudit({
      tenantId,
      actorId,
      userId: id,
      action: "delete",
      before: auditSnapshot(existing),
      after: { removed: true },
      ip,
    });
  }

  /**
   * Rotate a staff member's CRM password and email them a one-time replacement.
   *
   * Mirrors FacultyService.resetPassword (the only other staff-credential rotation in the
   * codebase) rather than inventing a second shape: same generator, same argon2 params,
   * same forced `mustChangePassword`, same session revocation, same branded email.
   *
   * SECURITY, and the reason this is `users.reset_password` (super_admin only) rather than
   * the super_admin+admin `users.edit`:
   *
   *   - The temporary password is NEVER returned to the caller. It exists only in the
   *     target's inbox. An actor who can trigger a reset therefore still cannot sign in as
   *     the target unless they also control that mailbox. Returning it here would turn this
   *     endpoint into "become any user", which is precisely what it must not be.
   *   - Self-reset is blocked. An admin changing their OWN password goes through the
   *     account screen, which requires the current password. Allowing it here would let a
   *     hijacked session lock out the real owner without ever proving knowledge of the
   *     existing credential.
   *   - Every live session for the target is revoked. A rotation that leaves old refresh
   *     tokens working has not actually revoked anything (same reasoning as deactivate()).
   *
   * The audit row is written from the PRE-reset snapshot, before the email is attempted, so
   * a bounced email cannot erase the record that the credential was rotated.
   */
  async resetPassword(
    tenantId: string,
    actorId: string,
    id: string,
    ip?: string,
  ): Promise<ResetStaffUserPasswordResponse> {
    const existing = await this.repository.findById(tenantId, id);
    if (!existing) throw new NotFoundException({ code: "users.not_found", title: "User not found" });

    if (id === actorId) {
      throw new ForbiddenException({
        code: "users.cannot_reset_own_password",
        title: "You cannot reset your own password here",
        detail:
          "Change your own password from your account settings, which asks for your current password first.",
      });
    }

    if (existing.status === "deactivated") {
      throw new ConflictException({
        code: "users.cannot_reset_deactivated",
        title: "This account is deactivated",
        detail:
          "Someone disabled this login on purpose. Reactivate the account first, then reset the password, " +
          "otherwise a password reset would quietly undo the deactivation.",
      });
    }

    // Captured BEFORE the rotation, which flips `invited` → `active`.
    const wasInvited = existing.status === "invited";

    const tempPassword = generateTemporaryPassword();
    const passwordHash = await argon2.hash(tempPassword, ARGON2_HASH_OPTIONS);

    // Rotation + audit commit together or not at all (see repository.setPassword). Only
    // once that has committed do we revoke sessions and send the mail, so a failure here
    // leaves the account exactly as it was rather than half-reset.
    await this.repository.setPassword({
      userId: id,
      passwordHash,
      tenantId,
      actorId,
      before: auditSnapshot(existing),
      ip,
    });
    await this.authRepository.revokeAllSessionsForUser(id);

    // An account that has never had a working credential is being INVITED, not reset —
    // telling a new colleague their password "has been reset" describes an event that never
    // happened and reads as a security alert. Same endpoint, same effect, honest wording.
    const isFirstCredential = wasInvited;
    await this.sendPasswordResetEmail(existing.email, existing.name, tempPassword, isFirstCredential);
    return { email: existing.email };
  }

  private async sendPasswordResetEmail(
    email: string,
    name: string,
    tempPassword: string,
    isFirstCredential: boolean,
  ): Promise<void> {
    const env = validateEnv();
    const loginUrl = `${env.CRM_APP_URL}/login`;
    try {
      await this.mail.send({
        to: email,
        subject: isFirstCredential
          ? "Your Stimuli IQ staff account is ready"
          : "Your Stimuli IQ staff password has been reset",
        html: renderBrandedEmail({
          title: isFirstCredential ? "Welcome to Stimuli IQ" : "Staff password reset",
          greeting: `Hi ${escapeEmailHtml(name)},`,
          paragraphs: [
            isFirstCredential
              ? "An administrator has set up your Stimuli IQ staff account. " +
                "Use the details below to sign in to the admin dashboard:"
              : "Your Stimuli IQ staff account password has been reset by an administrator. " +
                "Use the details below to sign in to the admin dashboard:",
          ],
          details: [
            { label: "Username", value: escapeEmailHtml(email) },
            { label: "Temporary password", value: escapeEmailHtml(tempPassword) },
          ],
          button: { label: "Sign in to the dashboard", url: loginUrl },
          footnote:
            "For your security you'll be asked to set a new password the next time you sign in. " +
            "Please don't share these details with anyone. If you didn't expect this, contact your administrator immediately.",
        }),
        tags: [
          { name: "category", value: isFirstCredential ? "staff_invitation" : "staff_password_reset" },
        ],
      });
    } catch (err) {
      // Never fail the reset because the email bounced — the rotation and session
      // revocation already happened, and reporting failure would invite the operator to
      // retry, minting a SECOND password and invalidating the one already in flight.
      this.logger.error(
        `[UsersAdminService] password-reset email failed for ${email}: ${
          err instanceof Error ? err.message : "unknown error"
        }`,
      );
    }
  }

  /**
   * Admin rescue path — clears 2FA for a user who has lost BOTH their authenticator and
   * access to their inbox (the self-service email-OTP flow covers everyone else; see
   * TwoFactorRecoveryService).
   *
   * Gated on `twofa.reset` at the controller, deliberately SEPARATE from the own-scope
   * `twofa.manage` every role already holds — bundling them would have handed every
   * student the ability to strip a colleague's second factor.
   *
   * Self-clearing is blocked for the same reason deactivate() blocks self-deactivation,
   * and then some: an admin who can silently drop their own second factor turns a
   * hijacked admin session into a permanent 2FA bypass with no second party involved.
   * An admin who genuinely lost their device uses the email-OTP flow, or another admin.
   *
   * Idempotent: clearing a user who has no 2FA returns `cleared: false` rather than
   * erroring — the desired end state ("this user is not blocked by 2FA") already holds.
   */
  async clearTwoFactor(
    tenantId: string,
    actorId: string,
    id: string,
    reason: string,
    ip?: string,
  ): Promise<{ cleared: boolean }> {
    const existing = await this.repository.findById(tenantId, id);
    if (!existing) throw new NotFoundException({ code: "users.not_found", title: "User not found" });
    if (id === actorId) {
      throw new ForbiddenException({
        code: "users.cannot_clear_own_two_factor",
        title: "You cannot clear your own two-factor authentication",
        detail: "Use the recovery link on the sign-in page, or ask another admin.",
      });
    }

    const target = await this.authRepository.findUserById(id);
    if (!target?.twoFaEnabled) return { cleared: false };

    await this.twoFactorStore.deactivate(id);
    await this.authRepository.setTwoFaEnabled(id, false);
    // The target's live sessions predate the factor removal — end them so the account
    // is re-authenticated from scratch under its new (weaker) posture.
    await this.authRepository.revokeAllSessionsForUser(id);
    await this.authRepository.recordTwoFactorAudit({
      tenantId,
      actorId,
      userId: id,
      action: "two_factor.admin_clear",
      reason,
      ip,
    });

    return { cleared: true };
  }

  /**
   * Every requested roleId must exist in this tenant, must not be the student role, and
   * must not carry more authority than the ACTOR already holds.
   *
   * That last clause is the same privilege-escalation rule `RolesService.clone()` and
   * `RolesService.updatePermissions()` enforce on the role editor, applied here because
   * the user editor is the other door into the same room. `users.edit` is seeded for
   * super_admin AND admin, and this function previously rejected only `student` — so an
   * admin could `PATCH /crm/admin/users/<own-id>` with the `super_admin` role id (readable
   * straight off `GET /crm/admin/users`) and hold, one request later, every key the seed
   * deliberately kept out of the catalog for them: `users.remove`, `users.reset_password`,
   * `leave.approve`, `leave.manage`, `org.teams.manage`, `marketing_targets.manage`,
   * `content.builder`. Assigning a role you could not have built is the same act as
   * building it, and it now fails the same way.
   */
  private async resolveStaffRoleIds(tenantId: string, actorId: string, requested: string[]): Promise<string[]> {
    const unique = [...new Set(requested)];
    const roles = await this.repository.findRolesByIds(tenantId, unique);
    if (roles.length !== unique.length) {
      throw new NotFoundException({ code: "users.role_not_found", title: "One or more roles were not found" });
    }
    const student = roles.find((role) => role.key === "student");
    if (student) {
      throw new BadRequestException({
        code: "users.student_role_not_allowed",
        title: "Student accounts are not managed here",
        detail: "Student logins are provisioned by the enrollment flow, assign staff roles only.",
      });
    }

    const actorProfile = await this.authRepository.getRbacProfile(actorId);
    const actorScopeByKey = new Map(actorProfile.permissions.map((p) => [p.key, p.scope]));

    for (const role of roles) {
      const grants = await this.rolesRepository.getRoleGrantsWithIds(role.id);
      for (const grant of grants) {
        const actorScope = actorScopeByKey.get(grant.permissionKey);
        if (!actorScope) {
          throw new ForbiddenException({
            code: "users.privilege_escalation",
            title: "Cannot assign a role that holds a permission you do not",
            detail:
              `"${role.name}" holds "${grant.permissionKey}", which you do not. ` +
              "Assigning it would hand out more authority than you have. Ask somebody who holds it to make the change.",
          });
        }
        if (SCOPE_RANK[grant.scope] > SCOPE_RANK[actorScope]) {
          throw new ForbiddenException({
            code: "users.privilege_escalation",
            title: "Cannot assign a broader scope than your own",
            detail:
              `"${role.name}" holds "${grant.permissionKey}" at scope "${grant.scope}" and you hold it at "${actorScope}".`,
          });
        }
      }
    }

    return unique;
  }
}
