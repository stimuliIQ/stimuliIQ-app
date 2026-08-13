// apps/api/src/modules/students/lms-account-provisioning.service.ts
//
// LMS account provisioning (lifecycle-redesign P3). "Immediately after successful
// enrollment, automatically create the student's LMS account" — generate a temporary
// password, activate the login, and email the student their credentials + login URL.
//
// A student record is created at lead-conversion time as a `users` row with an EMPTY
// passwordHash + status `invited` (see students.repository.createStudentWithUser) — a
// profile with no usable login. This service turns that into a real, gated login the
// first time the student is enrolled into a batch.
//
// IDEMPOTENT + NON-DESTRUCTIVE: provisioning only ever acts on an account that has NEVER
// had a password set (passwordHash === ""). A student who already has a login — temporary
// (already provisioned, email already sent) or real (already onboarded) — is left
// completely untouched, so it is safe to call from every enrollment path and to call
// more than once. It NEVER overwrites an existing password.
//
// The temporary password is emailed and NEVER logged or returned. The forced first-login
// change (must_change_password gate + POST /auth/change-password) rotates it immediately.

import { Inject, Injectable, Logger } from "@nestjs/common";
import * as argon2 from "argon2";
import { PrismaService } from "../../prisma/prisma.service";
import { ARGON2_HASH_OPTIONS } from "../auth/lib/argon2-params";
import { generateTemporaryPassword } from "../auth/lib/temporary-password";
import { AuthRepository } from "../auth/auth.repository";
import { MAIL_PROVIDER, type MailProvider } from "../notifications/providers/mail/mail-provider.interface";
import { renderBrandedEmail, escapeEmailHtml } from "../notifications/dispatch/email-layout";
import { validateEnv } from "../../config/env";

@Injectable()
export class LmsAccountProvisioningService {
  private readonly logger = new Logger(LmsAccountProvisioningService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(MAIL_PROVIDER) private readonly mail: MailProvider,
    private readonly authRepository: AuthRepository,
  ) {}

  /**
   * Provision an LMS login for the student behind `studentProfileId` if one has not been
   * provisioned yet. Returns `true` when it provisioned (and emailed), `false` when it was
   * a no-op (already had a login, or the profile/user was missing). Never throws for the
   * no-op cases — enrollment must not fail because onboarding email did.
   */
  async provisionForStudentProfile(tenantId: string, studentProfileId: string): Promise<boolean> {
    const creds = await this.provisionQuiet(tenantId, studentProfileId);
    if (!creds) return false;
    await this.sendWelcomeEmail(creds.email, creds.name, creds.tempPassword);
    return true;
  }

  /**
   * Provision WITHOUT sending the standalone welcome email — the caller owns the
   * communication. Used by the payment-capture paths so the student gets ONE email
   * (receipt + credentials) instead of two. Returns the credentials on a fresh
   * provision, or null when the account already had a login (nothing to send).
   * The temp password is returned ONLY so the caller can embed it in its own
   * email — never log or persist it.
   */
  async provisionQuiet(
    tenantId: string,
    studentProfileId: string,
  ): Promise<{ email: string; name: string; tempPassword: string } | null> {
    const profile = await this.prisma.client.studentProfile.findFirst({
      where: { id: studentProfileId, tenantId },
      select: { id: true, user: { select: { id: true, email: true, name: true, passwordHash: true } } },
    });
    if (!profile?.user) {
      this.logger.warn(`[LmsProvisioning] no user for student profile ${studentProfileId} — skipping.`);
      return null;
    }

    const { user } = profile;
    // Idempotency + safety: only provision an account that has NEVER had a password.
    if (user.passwordHash !== "") {
      return null;
    }

    const tempPassword = generateTemporaryPassword();
    const passwordHash = await argon2.hash(tempPassword, ARGON2_HASH_OPTIONS);

    // Raise the first-login gate and activate the account in one write. A guarded
    // updateMany (WHERE passwordHash = "") closes the race where two enrollment paths
    // provision the same student concurrently — the second write matches zero rows.
    const updated = await this.prisma.client.user.updateMany({
      where: { id: user.id, passwordHash: "" },
      data: { passwordHash, mustChangePassword: true, status: "active" },
    });
    if (updated.count === 0) {
      // Lost the race — another path just provisioned. Do NOT hand out a password
      // that is no longer the account's password.
      return null;
    }

    return { email: user.email, name: user.name, tempPassword };
  }

  /**
   * Reissue LMS login credentials for the student behind `studentProfileId` — a
   * staff-triggered action (CRM "resend credentials"), for a lost/bounced/compromised
   * temporary password. Returns `{ email }` on success, `null` when the profile/user was
   * not found (in this tenant) — the caller maps that to a 404.
   *
   * UNLIKE `provisionForStudentProfile`, this is explicit and NOT gated on
   * `passwordHash === ""` — it rotates the credential whether the account was never
   * provisioned, provisioned-but-unused, or already fully onboarded. Reissuing always
   * re-raises `mustChangePassword: true`, which is the correct security posture for a
   * credential reset (the old password, whatever it was, must stop working). This is a
   * direct staff action (not a concurrent-enrollment race), so it uses a plain `update`
   * rather than the guarded `updateMany` idempotency dance in `provisionForStudentProfile`.
   *
   * SECURITY (post-review fix): also revokes every live session for this user, same as
   * the student's own `AuthService.changePassword()` does. Without this, an attacker (or
   * anyone) holding the OLD access/refresh token would keep a working session even after
   * staff rotate the password specifically because it was lost/compromised — the whole
   * point of a forced reissue is to kill that old credential, not just its password half.
   */
  async resendCredentials(tenantId: string, studentProfileId: string): Promise<{ email: string } | null> {
    const profile = await this.prisma.client.studentProfile.findFirst({
      where: { id: studentProfileId, tenantId },
      select: { id: true, user: { select: { id: true, email: true, name: true } } },
    });
    if (!profile?.user) {
      return null;
    }

    const { user } = profile;
    const tempPassword = generateTemporaryPassword();
    const passwordHash = await argon2.hash(tempPassword, ARGON2_HASH_OPTIONS);

    await this.prisma.client.user.update({
      where: { id: user.id },
      data: { passwordHash, mustChangePassword: true, status: "active" },
    });
    await this.authRepository.revokeAllSessionsForUser(user.id);

    // Same failure isolation as provisionForStudentProfile (never fail the caller-facing
    // action just because the email bounced) — the credential rotation itself already
    // succeeded, so this always returns the email regardless of send outcome.
    await this.sendWelcomeEmail(user.email, user.name, tempPassword);
    return { email: user.email };
  }

  private async sendWelcomeEmail(email: string, name: string, tempPassword: string): Promise<void> {
    const env = validateEnv();
    const loginUrl = `${env.LMS_APP_URL}/login`;
    try {
      await this.mail.send({
        to: email,
        subject: "Welcome to stimuliIQ — your learning account is ready",
        html: renderBrandedEmail({
          title: "Your learning account is ready",
          greeting: `Hi ${escapeEmailHtml(name)},`,
          paragraphs: ["Your stimuliIQ learning account has been created. Use the details below to sign in:"],
          details: [
            { label: "Username", value: escapeEmailHtml(email) },
            { label: "Temporary password", value: escapeEmailHtml(tempPassword) },
          ],
          button: { label: "Sign in to the LMS", url: loginUrl },
          footnote:
            "For your security you'll be asked to set a new password the first time you sign in. " +
            "Please don't share these details with anyone.",
        }),
        tags: [{ name: "category", value: "lms_welcome" }],
      });
    } catch (err) {
      // Never fail the enrollment because the welcome email bounced — the account IS
      // provisioned; staff can re-send credentials or the student can use "forgot
      // password". Logged (without the password) for follow-up.
      this.logger.error(
        `[LmsProvisioning] welcome email failed for ${email}: ${err instanceof Error ? err.message : "unknown error"}`,
      );
    }
  }
}


