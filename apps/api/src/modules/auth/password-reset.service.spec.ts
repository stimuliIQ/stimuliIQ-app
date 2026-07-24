// apps/api/src/modules/auth/password-reset.service.spec.ts
//
// Unit tests for PasswordResetService: request() is ALWAYS 200 with the SAME generic
// message (enumeration resistance) whether or not the account exists, mail is only sent
// for a real active-with-password user, confirm() single-use token + session revocation.

import { BadRequestException, UnprocessableEntityException } from "@nestjs/common";

// The service builds the reset URL from validateEnv().LMS_APP_URL. Mock it so this spec
// is self-contained (previously it relied on a warm validateEnv() cache populated by an
// earlier spec in the same worker — passing in the full suite but failing in isolation).
jest.mock("../../config/env", () => ({
  validateEnv: jest.fn(() => ({
    LMS_APP_URL: "https://lms.stimuliiq.test",
    CRM_APP_URL: "https://crm.stimuliiq.test",
  })),
}));

import { PasswordResetService } from "./password-reset.service";
import { AuthRepository } from "./auth.repository";
import { PasswordResetStore } from "./lib/password-reset-store";
import { RedisService } from "../../redis/redis.service";
import type { MailProvider } from "../notifications/providers/mail/mail-provider.interface";

type Mocked<T> = { [K in keyof T]: T[K] extends (...args: never[]) => unknown ? jest.Mock : T[K] };

function mockAuthRepository(): Mocked<AuthRepository> {
  return {
    findUserByEmail: jest.fn(),
    findUserById: jest.fn(),
    updatePasswordHash: jest.fn(),
    revokeAllSessionsForUser: jest.fn(),
  } as unknown as Mocked<AuthRepository>;
}

function mockStore(): Mocked<PasswordResetStore> {
  return { issue: jest.fn(), consume: jest.fn() } as unknown as Mocked<PasswordResetStore>;
}

function mockMail(): Mocked<MailProvider> {
  return { send: jest.fn().mockResolvedValue({ providerMessageId: "msg-1" }), verifyWebhookSignature: jest.fn() } as unknown as Mocked<MailProvider>;
}

function mockRedis(): { client: { incr: jest.Mock; expire: jest.Mock } } {
  return { client: { incr: jest.fn().mockResolvedValue(1), expire: jest.fn() } };
}

const ACTIVE_USER = { id: "user-1", email: "student@example.test", passwordHash: "$argon2id$...", status: "active" };

describe("PasswordResetService", () => {
  let service: PasswordResetService;
  let repo: Mocked<AuthRepository>;
  let store: Mocked<PasswordResetStore>;
  let mail: Mocked<MailProvider>;
  let redis: { client: { incr: jest.Mock; expire: jest.Mock } };

  beforeEach(() => {
    repo = mockAuthRepository();
    store = mockStore();
    mail = mockMail();
    redis = mockRedis();
    service = new PasswordResetService(
      repo as unknown as AuthRepository,
      store as unknown as PasswordResetStore,
      redis as unknown as RedisService,
      mail as unknown as MailProvider,
    );
  });

  describe("request() — enumeration resistance", () => {
    it("returns the SAME generic message for an unknown email", async () => {
      repo.findUserByEmail.mockResolvedValue(null);
      const result = await service.request("nobody@example.test");
      expect(result.message).toMatch(/if an account exists/i);
      expect(mail.send).not.toHaveBeenCalled();
    });

    it("returns the SAME generic message AND sends mail for a real active user", async () => {
      repo.findUserByEmail.mockResolvedValue(ACTIVE_USER);
      store.issue.mockResolvedValue("plaintext-token");

      const result = await service.request(ACTIVE_USER.email);
      expect(result.message).toMatch(/if an account exists/i);
      expect(mail.send).toHaveBeenCalledWith(expect.objectContaining({ to: ACTIVE_USER.email }));
    });

    it("builds the reset link on LMS_APP_URL by default (no audience)", async () => {
      repo.findUserByEmail.mockResolvedValue(ACTIVE_USER);
      store.issue.mockResolvedValue("plaintext-token");

      await service.request(ACTIVE_USER.email);
      expect(mail.send).toHaveBeenCalledWith(
        expect.objectContaining({ html: expect.stringContaining("https://lms.stimuliiq.test/reset-password?token=") }),
      );
    });

    it("builds the reset link on CRM_APP_URL for a staff (audience=crm) request", async () => {
      repo.findUserByEmail.mockResolvedValue(ACTIVE_USER);
      store.issue.mockResolvedValue("plaintext-token");

      await service.request(ACTIVE_USER.email, "crm");
      expect(mail.send).toHaveBeenCalledWith(
        expect.objectContaining({ html: expect.stringContaining("https://crm.stimuliiq.test/reset-password?token=") }),
      );
    });

    it("does NOT send mail for an OTP-only account (no password set) — same generic response", async () => {
      repo.findUserByEmail.mockResolvedValue({ ...ACTIVE_USER, passwordHash: "" });
      const result = await service.request(ACTIVE_USER.email);
      expect(result.message).toMatch(/if an account exists/i);
      expect(mail.send).not.toHaveBeenCalled();
    });

    it("does NOT send mail for a suspended account — same generic response", async () => {
      repo.findUserByEmail.mockResolvedValue({ ...ACTIVE_USER, status: "suspended" });
      const result = await service.request(ACTIVE_USER.email);
      expect(result.message).toMatch(/if an account exists/i);
      expect(mail.send).not.toHaveBeenCalled();
    });

    it("returns the generic response WITHOUT sending mail when rate-limited (never a distinguishable response)", async () => {
      repo.findUserByEmail.mockResolvedValue(ACTIVE_USER);
      redis.client.incr.mockResolvedValue(4); // over REQUEST_RATE_LIMIT_MAX_ATTEMPTS=3
      const result = await service.request(ACTIVE_USER.email);
      expect(result.message).toMatch(/if an account exists/i);
      expect(mail.send).not.toHaveBeenCalled();
    });

    it("never lets a mail-provider failure escape to the caller", async () => {
      repo.findUserByEmail.mockResolvedValue(ACTIVE_USER);
      store.issue.mockResolvedValue("plaintext-token");
      mail.send.mockRejectedValue(new Error("SES down"));
      await expect(service.request(ACTIVE_USER.email)).resolves.toEqual(expect.objectContaining({ message: expect.any(String) }));
    });
  });

  describe("confirm()", () => {
    it("422s TOKEN_INVALID_OR_EXPIRED for an unknown/expired/already-used token", async () => {
      store.consume.mockResolvedValue(null);
      await expect(service.confirm("bad-token", "NewPassw0rd!")).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it("422s when the token was valid but the account is no longer active", async () => {
      store.consume.mockResolvedValue("user-1");
      repo.findUserById.mockResolvedValue({ ...ACTIVE_USER, status: "suspended" });
      await expect(service.confirm("token", "NewPassw0rd!")).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it("sets a new password hash and revokes every existing session on success", async () => {
      store.consume.mockResolvedValue("user-1");
      repo.findUserById.mockResolvedValue(ACTIVE_USER);

      const result = await service.confirm("token", "NewPassw0rd!");
      expect(result).toEqual({ reset: true });
      expect(repo.updatePasswordHash).toHaveBeenCalledWith("user-1", expect.any(String));
      expect(repo.revokeAllSessionsForUser).toHaveBeenCalledWith("user-1");
    });

    it("rejects an empty new password", async () => {
      store.consume.mockResolvedValue("user-1");
      repo.findUserById.mockResolvedValue(ACTIVE_USER);
      await expect(service.confirm("token", "")).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
