// Unit tests for LmsAccountProvisioningService (lifecycle-redesign P3).
//
// The service builds the login URL from validateEnv().LMS_APP_URL â€” mocked so this spec
// is self-contained (mirrors password-reset.service.spec.ts).
jest.mock("../../config/env", () => ({
  validateEnv: jest.fn(() => ({ LMS_APP_URL: "https://lms.stimuliiq.test" })),
}));

import * as argon2 from "argon2";
import { LmsAccountProvisioningService } from "./lms-account-provisioning.service";
import type { MailProvider } from "../notifications/providers/mail/mail-provider.interface";
import { STAFF_ISSUED_TOKEN_TTL_SECONDS } from "../auth/lib/password-reset-store";

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const PROFILE_ID = "22222222-2222-2222-2222-222222222222";
const USER_ID = "33333333-3333-3333-3333-333333333333";

function makeProfile(overrides: { passwordHash?: string } = {}) {
  return {
    id: PROFILE_ID,
    user: { id: USER_ID, email: "asha@example.com", name: "Asha Rao", passwordHash: overrides.passwordHash ?? "" },
  };
}

function makePrisma(profile: ReturnType<typeof makeProfile> | null, updateCount = 1) {
  const findFirst = jest.fn().mockResolvedValue(profile);
  const updateMany = jest.fn().mockResolvedValue({ count: updateCount });
  const update = jest.fn().mockResolvedValue({});
  return {
    prisma: { client: { studentProfile: { findFirst }, user: { updateMany, update } } },
    findFirst,
    updateMany,
    update,
  };
}

function makeMail(): Mocked {
  return { send: jest.fn().mockResolvedValue({ providerMessageId: "m1" }), verifyWebhookSignature: jest.fn() };
}
type Mocked = { send: jest.Mock; verifyWebhookSignature: jest.Mock };

function makeAuthRepository() {
  return { revokeAllSessionsForUser: jest.fn().mockResolvedValue(undefined) };
}

// resendCredentials now mints a single-use reset token instead of a temp password.
function makePasswordResetStore() {
  return { issue: jest.fn().mockResolvedValue("reset-token-abc"), consume: jest.fn() };
}

describe("LmsAccountProvisioningService", () => {
  it("provisions a temp password + sends a welcome email for a never-provisioned account", async () => {
    const { prisma, updateMany } = makePrisma(makeProfile({ passwordHash: "" }));
    const mail = makeMail();
    const svc = new LmsAccountProvisioningService(
      prisma as never,
      mail as unknown as MailProvider,
      makeAuthRepository() as never,
      makePasswordResetStore() as never,
    );

    const result = await svc.provisionForStudentProfile(TENANT_ID, PROFILE_ID);

    expect(result).toBe(true);
    // Raised the gate + set a hash + activated, guarded on passwordHash === "".
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: USER_ID, passwordHash: "" },
        data: expect.objectContaining({ mustChangePassword: true, status: "active" }),
      }),
    );
    const hash = updateMany.mock.calls[0][0].data.passwordHash as string;
    expect(hash).toMatch(/^\$argon2/);

    // Emailed the credentials to the student.
    expect(mail.send).toHaveBeenCalledTimes(1);
    const sent = mail.send.mock.calls[0][0];
    expect(sent.to).toBe("asha@example.com");
    expect(sent.html).toContain("https://lms.stimuliiq.test/login");
    expect(sent.html).toContain("asha@example.com");

    // The emailed temp password must be the one that was actually hashed onto the account.
    const emailedPw = /Temporary password<\/td>\s*<td[^>]*>([^<]+)</.exec(sent.html)?.[1];
    expect(emailedPw).toBeTruthy();
    await expect(argon2.verify(hash, emailedPw as string)).resolves.toBe(true);
  });

  it("is a NON-DESTRUCTIVE no-op when the account already has a password", async () => {
    const { prisma, updateMany } = makePrisma(makeProfile({ passwordHash: "$argon2id$existing" }));
    const mail = makeMail();
    const svc = new LmsAccountProvisioningService(
      prisma as never,
      mail as unknown as MailProvider,
      makeAuthRepository() as never,
      makePasswordResetStore() as never,
    );

    const result = await svc.provisionForStudentProfile(TENANT_ID, PROFILE_ID);

    expect(result).toBe(false);
    expect(updateMany).not.toHaveBeenCalled();
    expect(mail.send).not.toHaveBeenCalled();
  });

  it("does NOT send a second email when it loses the concurrent-provision race (updateMany count 0)", async () => {
    const { prisma } = makePrisma(makeProfile({ passwordHash: "" }), 0);
    const mail = makeMail();
    const svc = new LmsAccountProvisioningService(
      prisma as never,
      mail as unknown as MailProvider,
      makeAuthRepository() as never,
      makePasswordResetStore() as never,
    );

    const result = await svc.provisionForStudentProfile(TENANT_ID, PROFILE_ID);

    expect(result).toBe(false);
    expect(mail.send).not.toHaveBeenCalled();
  });

  it("returns false (no throw) when the student profile / user is missing", async () => {
    const { prisma } = makePrisma(null);
    const mail = makeMail();
    const svc = new LmsAccountProvisioningService(
      prisma as never,
      mail as unknown as MailProvider,
      makeAuthRepository() as never,
      makePasswordResetStore() as never,
    );

    await expect(svc.provisionForStudentProfile(TENANT_ID, PROFILE_ID)).resolves.toBe(false);
    expect(mail.send).not.toHaveBeenCalled();
  });

  it("still provisions (returns true) even if the welcome email throws", async () => {
    const { prisma } = makePrisma(makeProfile({ passwordHash: "" }));
    const mail = makeMail();
    mail.send.mockRejectedValueOnce(new Error("Resend down"));
    const svc = new LmsAccountProvisioningService(
      prisma as never,
      mail as unknown as MailProvider,
      makeAuthRepository() as never,
      makePasswordResetStore() as never,
    );

    await expect(svc.provisionForStudentProfile(TENANT_ID, PROFILE_ID)).resolves.toBe(true);
  });

  describe("resendCredentials (CRM 'Resend LMS credentials' — issues a single-use reset LINK)", () => {
    it("invalidates the old password, revokes sessions, and emails a reset link — never a password", async () => {
      // Unlike provisionForStudentProfile, an EXISTING (non-empty) passwordHash must NOT
      // block this — it's an explicit staff-triggered reissue.
      const { prisma, update } = makePrisma(makeProfile({ passwordHash: "$argon2id$existing" }));
      const mail = makeMail();
      const authRepository = makeAuthRepository();
      const store = makePasswordResetStore();
      const svc = new LmsAccountProvisioningService(
        prisma as never,
        mail as unknown as MailProvider,
        authRepository as never,
        store as never,
      );

      const result = await svc.resendCredentials(TENANT_ID, PROFILE_ID);

      expect(result).toEqual({ email: "asha@example.com" });

      // The old password must stop working immediately — that is the point of the action.
      // The replacement hash is random and never disclosed, so nobody can sign in with it.
      const data = update.mock.calls[0][0].data as { passwordHash: string; mustChangePassword: boolean; status: string };
      expect(data.passwordHash).toMatch(/^\$argon2/);
      expect(data.passwordHash).not.toBe("$argon2id$existing");
      expect(data.status).toBe("active");
      // NOT re-raised: the emailed link IS the password-setting step. Raising it would
      // demand a temporary password that no longer exists.
      expect(data.mustChangePassword).toBe(false);
      // Never blank — "" is provisionQuiet's never-provisioned sentinel.
      expect(data.passwordHash).not.toBe("");

      // SECURITY: reissuing must kill any live session using the old credential.
      expect(authRepository.revokeAllSessionsForUser).toHaveBeenCalledWith(USER_ID);

      // A staff-issued link gets the long TTL, not the 30-minute self-service one.
      expect(store.issue).toHaveBeenCalledWith(USER_ID, STAFF_ISSUED_TOKEN_TTL_SECONDS);

      expect(mail.send).toHaveBeenCalledTimes(1);
      const sent = mail.send.mock.calls[0][0];
      expect(sent.to).toBe("asha@example.com");
      expect(sent.html).toContain("https://lms.stimuliiq.test/reset-password?token=reset-token-abc");
      // THE POINT OF THE CHANGE: no credential in the mailbox.
      expect(sent.html).not.toMatch(/Temporary password/i);
      expect(sent.html).not.toContain(data.passwordHash);
    });

    it("also works for a NEVER-provisioned account (passwordHash === '')", async () => {
      const { prisma, update } = makePrisma(makeProfile({ passwordHash: "" }));
      const mail = makeMail();
      const svc = new LmsAccountProvisioningService(
        prisma as never,
        mail as unknown as MailProvider,
        makeAuthRepository() as never,
        makePasswordResetStore() as never,
      );

      const result = await svc.resendCredentials(TENANT_ID, PROFILE_ID);

      expect(result).toEqual({ email: "asha@example.com" });
      expect(update).toHaveBeenCalledTimes(1);
      expect(mail.send).toHaveBeenCalledTimes(1);
    });

    it("returns null (no throw) when the student profile / user is missing (out-of-tenant/not-found)", async () => {
      const { prisma, update } = makePrisma(null);
      const mail = makeMail();
      const authRepository = makeAuthRepository();
      const store = makePasswordResetStore();
      const svc = new LmsAccountProvisioningService(
        prisma as never,
        mail as unknown as MailProvider,
        authRepository as never,
        store as never,
      );

      await expect(svc.resendCredentials(TENANT_ID, PROFILE_ID)).resolves.toBeNull();
      expect(update).not.toHaveBeenCalled();
      expect(mail.send).not.toHaveBeenCalled();
      expect(authRepository.revokeAllSessionsForUser).not.toHaveBeenCalled();
      // No token may be minted for a user we never found.
      expect(store.issue).not.toHaveBeenCalled();
    });

    it("still returns { email } (never throws) even if the email fails to send", async () => {
      const { prisma } = makePrisma(makeProfile({ passwordHash: "$argon2id$existing" }));
      const mail = makeMail();
      mail.send.mockRejectedValueOnce(new Error("Resend down"));
      const authRepository = makeAuthRepository();
      const svc = new LmsAccountProvisioningService(
        prisma as never,
        mail as unknown as MailProvider,
        authRepository as never,
        makePasswordResetStore() as never,
      );

      await expect(svc.resendCredentials(TENANT_ID, PROFILE_ID)).resolves.toEqual({ email: "asha@example.com" });
      // Session revocation must not depend on the email send succeeding.
      expect(authRepository.revokeAllSessionsForUser).toHaveBeenCalledWith(USER_ID);
    });
  });
});
