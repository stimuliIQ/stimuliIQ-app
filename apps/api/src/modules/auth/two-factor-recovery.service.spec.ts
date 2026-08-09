// apps/api/src/modules/auth/two-factor-recovery.service.spec.ts
//
// Unit tests for the "I lost my authenticator" flow. The properties under test are the
// SECURITY ones, because this endpoint's whole job is to remove a factor:
//   - request() is indistinguishable across every rejection reason (enumeration).
//   - request() fails CLOSED when Redis is down.
//   - confirm() re-verifies the password, so an intercepted code alone is useless.
//   - confirm() revokes sessions and audits, and issues NO session of its own.

import { UnprocessableEntityException } from "@nestjs/common";
import { TwoFactorRecoveryService } from "./two-factor-recovery.service";
import { AuthRepository } from "./auth.repository";
import { AuthService } from "./auth.service";
import { TwoFactorStore } from "./lib/two-factor-store";
import { TwoFactorRecoveryStore } from "./lib/two-factor-recovery-store";
import { RedisService } from "../../redis/redis.service";
import type { MailProvider } from "../notifications/providers/mail/mail-provider.interface";

const EMAIL = "priya@stimuliiq.com";
const PASSWORD = "Sup3rSecret!x";
const USER = { id: "user-1", tenantId: "tenant-1", email: EMAIL, twoFaEnabled: true };

function build(overrides?: { redisIncr?: jest.Mock }) {
  const authRepository = {
    findUserById: jest.fn().mockResolvedValue(USER),
    setTwoFaEnabled: jest.fn(),
    revokeAllSessionsForUser: jest.fn(),
    recordTwoFactorAudit: jest.fn(),
  } as unknown as jest.Mocked<AuthRepository>;

  const authService = {
    verifyCredentialsOnly: jest.fn().mockResolvedValue({ id: USER.id, twoFaEnabled: true }),
  } as unknown as jest.Mocked<AuthService>;

  const twoFactorStore = { deactivate: jest.fn() } as unknown as jest.Mocked<TwoFactorStore>;

  const store = {
    issue: jest.fn().mockResolvedValue({ code: "123456", expiresInMinutes: 15 }),
    verify: jest.fn().mockResolvedValue(true),
  } as unknown as jest.Mocked<TwoFactorRecoveryStore>;

  // Fresh-window counter by default (incr -> 1, under the max), so the limiter allows.
  const incr = overrides?.redisIncr ?? jest.fn().mockResolvedValue(1);
  const redis = { client: { incr, expire: jest.fn() } } as unknown as RedisService;

  const mail = { send: jest.fn().mockResolvedValue(undefined) } as unknown as jest.Mocked<MailProvider>;

  const service = new TwoFactorRecoveryService(authRepository, authService, twoFactorStore, store, redis, mail);
  return { service, authRepository, authService, twoFactorStore, store, mail, incr };
}

describe("TwoFactorRecoveryService", () => {
  describe("request", () => {
    it("mails a code for a qualifying account", async () => {
      const { service, store, mail } = build();

      const result = await service.request(EMAIL, PASSWORD);

      expect(store.issue).toHaveBeenCalledWith(USER.id);
      expect(mail.send).toHaveBeenCalledWith(expect.objectContaining({ to: EMAIL }));
      expect(result.message).toMatch(/if that account exists/i);
    });

    it("never puts the code anywhere but the email body", async () => {
      const { service, mail } = build();
      await service.request(EMAIL, PASSWORD);

      const sent = (mail.send as jest.Mock).mock.calls[0]![0] as { html: string; subject: string };
      expect(sent.html).toContain("123456");
      expect(sent.subject).not.toContain("123456");
    });

    it.each([
      ["no such user / wrong password", null],
      ["a real account with 2FA NOT enrolled", { id: USER.id, twoFaEnabled: false }],
    ])("returns the SAME generic message and sends nothing for %s", async (_label, credentialResult) => {
      const { service, authService, mail, store } = build();
      (authService.verifyCredentialsOnly as jest.Mock).mockResolvedValue(credentialResult);

      const result = await service.request(EMAIL, PASSWORD);

      const { service: happy } = build();
      const happyResult = await happy.request(EMAIL, PASSWORD);
      // Byte-identical to the success response — the caller learns nothing.
      expect(result.message).toBe(happyResult.message);
      expect(mail.send).not.toHaveBeenCalled();
      expect(store.issue).not.toHaveBeenCalled();
    });

    it("swallows a mail-provider failure — a send error must not become an enumeration oracle", async () => {
      const { service, mail } = build();
      (mail.send as jest.Mock).mockRejectedValue(new Error("SES is down"));

      await expect(service.request(EMAIL, PASSWORD)).resolves.toMatchObject({
        message: expect.stringMatching(/if that account exists/i),
      });
    });

    it("FAILS CLOSED when Redis errors — no code is issued", async () => {
      const { service, store, mail } = build({ redisIncr: jest.fn().mockRejectedValue(new Error("redis down")) });

      const result = await service.request(EMAIL, PASSWORD);

      expect(store.issue).not.toHaveBeenCalled();
      expect(mail.send).not.toHaveBeenCalled();
      // ...but still the same generic 200 body.
      expect(result.message).toMatch(/if that account exists/i);
    });

    it("stays silent (same message, no send) once over the per-email window", async () => {
      const { service, mail } = build({ redisIncr: jest.fn().mockResolvedValue(4) }); // max is 3.
      const result = await service.request(EMAIL, PASSWORD);
      expect(mail.send).not.toHaveBeenCalled();
      expect(result.message).toMatch(/if that account exists/i);
    });
  });

  describe("confirm", () => {
    it("disables 2FA, revokes every session, and audits — without issuing a session", async () => {
      const { service, authRepository, twoFactorStore } = build();

      const result = await service.confirm(EMAIL, PASSWORD, "123456", { ip: "1.2.3.4" });

      expect(result).toEqual({ reset: true });
      expect(twoFactorStore.deactivate).toHaveBeenCalledWith(USER.id);
      expect(authRepository.setTwoFaEnabled).toHaveBeenCalledWith(USER.id, false);
      expect(authRepository.revokeAllSessionsForUser).toHaveBeenCalledWith(USER.id);
      expect(authRepository.recordTwoFactorAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: "two_factor.recovery_reset", userId: USER.id, actorId: null, ip: "1.2.3.4" }),
      );
      // The returned shape carries no tokens/csrf — recovery is not a login.
      expect(Object.keys(result)).toEqual(["reset"]);
    });

    it("rejects a WRONG PASSWORD even with a valid code — the emailed code alone is not enough", async () => {
      const { service, authService, store, twoFactorStore } = build();
      (authService.verifyCredentialsOnly as jest.Mock).mockResolvedValue(null);

      await expect(service.confirm(EMAIL, "wrong", "123456")).rejects.toBeInstanceOf(UnprocessableEntityException);
      // The code is not even checked, so a wrong password can't burn someone's attempts.
      expect(store.verify).not.toHaveBeenCalled();
      expect(twoFactorStore.deactivate).not.toHaveBeenCalled();
    });

    it("rejects a bad/expired/replayed code and leaves 2FA ON", async () => {
      const { service, store, authRepository, twoFactorStore } = build();
      (store.verify as jest.Mock).mockResolvedValue(false);

      await expect(service.confirm(EMAIL, PASSWORD, "000000")).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(twoFactorStore.deactivate).not.toHaveBeenCalled();
      expect(authRepository.setTwoFaEnabled).not.toHaveBeenCalled();
    });

    it("gives the SAME error for bad credentials, no enrolment, and a bad code", async () => {
      const codes: string[] = [];
      for (const setup of [
        (b: ReturnType<typeof build>) => (b.authService.verifyCredentialsOnly as jest.Mock).mockResolvedValue(null),
        (b: ReturnType<typeof build>) =>
          (b.authService.verifyCredentialsOnly as jest.Mock).mockResolvedValue({ id: USER.id, twoFaEnabled: false }),
        (b: ReturnType<typeof build>) => (b.store.verify as jest.Mock).mockResolvedValue(false),
      ]) {
        const harness = build();
        setup(harness);
        await harness.service.confirm(EMAIL, PASSWORD, "000000").catch((err: UnprocessableEntityException) => {
          codes.push((err.getResponse() as { code: string }).code);
        });
      }
      expect(codes).toEqual(["RECOVERY_CODE_INVALID", "RECOVERY_CODE_INVALID", "RECOVERY_CODE_INVALID"]);
    });
  });
});
