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
//
// TWO DIFFERENT ACTIONS LIVE HERE, and they no longer work the same way:
//
//   provisionForStudentProfile / provisionQuiet — FIRST contact, on enrollment. Still
//     mints a temporary password and emails it, because the student has no account to
//     reset yet and no way to prove they own the mailbox.
//
//   resendCredentials — STAFF re-issuing access for a lost/compromised login. Emails a
//     single-use, 24-hour reset LINK and never a password (see that method for why).

import { Inject, Injectable, Logger } from "@nestjs/common";
import * as argon2 from "argon2";
import { PrismaService } from "../../prisma/prisma.service";
import { ARGON2_HASH_OPTIONS } from "../auth/lib/argon2-params";
import { generateTemporaryPassword } from "../auth/lib/temporary-password";
import { AuthRepository } from "../auth/auth.repository";
import { PasswordResetStore, STAFF_ISSUED_TOKEN_TTL_SECONDS } from "../auth/lib/password-reset-store";
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
    private readonly passwordResetStore: PasswordResetStore,
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
   * Reissue LMS access for the student behind `studentProfileId` — a staff-triggered
   * action (CRM "Resend LMS credentials"), for a lost/bounced/compromised login. Returns
   * `{ email }` on success, `null` when the profile/user was not found (in this tenant) —
   * the caller maps that to a 404.
   *
   * ─── SENDS A SINGLE-USE LINK, NOT A PASSWORD ────────────────────────────────────────
   *
   * This used to mint a temporary password and email it in plain text. Two things were
   * wrong with that, and both bit in production:
   *
   *   1. SECURITY. The password sat in the student's mailbox indefinitely, readable by
   *      anyone who ever gained access to it, and in whatever mail logs and backups it
   *      passed through. A reset link is single-use and expires; once used it is worthless.
   *
   *   2. DELIVERABILITY. "Here is your password" is one of the strongest spam signals a
   *      transactional email can carry. Staff clicked Resend, Resend reported `delivered`,
   *      and the student still never saw it — because it was filtered. A link-only email
   *      is scored far more kindly, which is the difference between an email that exists
   *      and an email that arrives.
   *
   * The old password is still invalidated IMMEDIATELY, which is the whole point of the
   * action — it is used when a credential is lost or compromised, so it must stop working
   * whether or not the student ever opens the mail. We do that by overwriting the hash
   * with a fresh random secret that is never disclosed to anyone, rather than by blanking
   * it: `passwordHash === ""` is the "never provisioned" sentinel `provisionQuiet` gates
   * on, and blanking it here would make a later enrollment silently re-provision the
   * account. The student regains access through the emailed link, or through the ordinary
   * "Forgot password" flow, which still works because the account stays active with a
   * (non-empty) hash.
   *
   * `mustChangePassword` is deliberately CLEARED rather than raised. The link IS the
   * password-setting step: completing it proves control of the mailbox and lets the
   * student choose their own password, which is strictly stronger than the temporary-
   * password screen the gate exists to force. Leaving it raised would have demanded a
   * temporary password that no longer exists — the same deadlock PasswordResetService
   * documents at its own `setPasswordAndClearMustChange` call.
   *
   * SECURITY: also revokes every live session, same as the student's own
   * `AuthService.changePassword()`. Without it, anyone holding the OLD access/refresh
   * token would keep a working session after staff reset the account precisely because it
   * was compromised — killing the password alone is only half the credential.
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
    // Never disclosed, never logged, never returned — this exists only so the previous
    // password stops working while leaving a non-empty hash behind (see the doc above).
    const unusablePasswordHash = await argon2.hash(generateTemporaryPassword(), ARGON2_HASH_OPTIONS);

    await this.prisma.client.user.update({
      where: { id: user.id },
      data: { passwordHash: unusablePasswordHash, mustChangePassword: false, status: "active" },
    });
    await this.authRepository.revokeAllSessionsForUser(user.id);

    // 24h rather than the self-service 30 minutes: nobody warned the student this was
    // coming, so reading it the same evening must still work. See
    // STAFF_ISSUED_TOKEN_TTL_SECONDS.
    const token = await this.passwordResetStore.issue(user.id, STAFF_ISSUED_TOKEN_TTL_SECONDS);

    // Same failure isolation as provisionForStudentProfile (never fail the caller-facing
    // action just because the email bounced) — the credential was already invalidated, so
    // this returns the email regardless of send outcome.
    await this.sendSetPasswordEmail(user.email, user.name, token);
    return { email: user.email };
  }

  /**
   * The staff-triggered "set your password" email — a link, never a credential.
   * Deliberately kept separate from `sendWelcomeEmail`: that one still carries a
   * temporary password because it is the FIRST contact after enrollment, where the
   * student has no account to reset yet and no way to prove ownership.
   */
  private async sendSetPasswordEmail(email: string, name: string, token: string): Promise<void> {
    const env = validateEnv();
    const resetUrl = `${env.LMS_APP_URL}/reset-password?token=${encodeURIComponent(token)}`;
    try {
      await this.mail.send({
        to: email,
        subject: "Set your stimuliIQ password",
        html: renderBrandedEmail({
          title: "Set your password",
          greeting: `Hi ${escapeEmailHtml(name)},`,
          paragraphs: [
            "Your stimuliIQ learning account is ready. Use the button below to choose your password and sign in.",
            "This link works once and expires in 24 hours. Your previous password no longer works.",
          ],
          button: { label: "Set my password", url: resetUrl },
          footnote:
            "If you did not expect this email, you can ignore it — the link cannot be used to read anything " +
            "about your account, and nobody can sign in until a new password is set.",
        }),
        tags: [{ name: "category", value: "lms_set_password" }],
      });
    } catch (err) {
      // The credential was already invalidated and the token already issued — the student
      // can still use "Forgot password". Logged (without the token) for follow-up.
      this.logger.error(
        `[LmsProvisioning] set-password email failed for ${email}: ${err instanceof Error ? err.message : "unknown error"}`,
      );
    }
  }

  private async sendWelcomeEmail(email: string, name: string, tempPassword: string): Promise<void> {
    const env = validateEnv();
    const loginUrl = `${env.LMS_APP_URL}/login`;
    try {
      await this.mail.send({
        to: email,
        subject: "Welcome to stimuliIQ: your learning account is ready",
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


