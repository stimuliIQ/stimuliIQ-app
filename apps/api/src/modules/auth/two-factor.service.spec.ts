// apps/api/src/modules/auth/two-factor.service.spec.ts
//
// Unit tests for TwoFactorService: enroll -> verifyEnroll -> disable lifecycle,
// expired/invalid pending secret, wrong code, backup-code fallback for verifyCode().

import { NotFoundException, UnauthorizedException, UnprocessableEntityException } from "@nestjs/common";
import { TwoFactorService } from "./two-factor.service";
import { AuthRepository } from "./auth.repository";
import { TwoFactorStore } from "./lib/two-factor-store";
import { generateTotpCode } from "./lib/totp";

type Mocked<T> = { [K in keyof T]: T[K] extends (...args: never[]) => unknown ? jest.Mock : T[K] };

function mockAuthRepository(): Mocked<AuthRepository> {
  return {
    findUserById: jest.fn(),
    setTwoFaEnabled: jest.fn(),
  } as unknown as Mocked<AuthRepository>;
}

function mockStore(): Mocked<TwoFactorStore> {
  return {
    setPendingSecret: jest.fn(),
    getPendingSecret: jest.fn(),
    clearPendingSecret: jest.fn(),
    getActiveSecret: jest.fn(),
    activate: jest.fn(),
    deactivate: jest.fn(),
    consumeBackupCode: jest.fn(),
    countRemainingBackupCodes: jest.fn(),
  } as unknown as Mocked<TwoFactorStore>;
}

const USER = { id: "user-1", tenantId: "tenant-1", email: "admin@stimuliiq.test", twoFaEnabled: false };

describe("TwoFactorService", () => {
  let service: TwoFactorService;
  let repo: Mocked<AuthRepository>;
  let store: Mocked<TwoFactorStore>;

  beforeEach(() => {
    repo = mockAuthRepository();
    store = mockStore();
    service = new TwoFactorService(repo as unknown as AuthRepository, store as unknown as TwoFactorStore);
  });

  describe("status()", () => {
    it("404s when the user does not exist", async () => {
      repo.findUserById.mockResolvedValue(null);
      await expect(service.status("missing")).rejects.toBeInstanceOf(NotFoundException);
    });

    it("returns enabled=false with remainingBackupCodes=null when 2FA is off", async () => {
      repo.findUserById.mockResolvedValue({ ...USER, twoFaEnabled: false });
      const result = await service.status("user-1");
      expect(result).toEqual({ enabled: false, remainingBackupCodes: null });
      expect(store.countRemainingBackupCodes).not.toHaveBeenCalled();
    });

    it("returns the remaining backup code count when 2FA is on", async () => {
      repo.findUserById.mockResolvedValue({ ...USER, twoFaEnabled: true });
      store.countRemainingBackupCodes.mockResolvedValue(7);
      const result = await service.status("user-1");
      expect(result).toEqual({ enabled: true, remainingBackupCodes: 7 });
    });
  });

  describe("enroll() / verifyEnroll()", () => {
    it("enroll() generates a pending secret and returns an otpauth URL", async () => {
      repo.findUserById.mockResolvedValue(USER);
      const result = await service.enroll("user-1");
      expect(result.secret).toMatch(/^[A-Z2-7]+$/);
      expect(result.otpauthUrl).toContain("otpauth://totp/");
      expect(store.setPendingSecret).toHaveBeenCalledWith("user-1", result.secret);
    });

    it("verifyEnroll() 422s when there is no pending enrollment (expired/never started)", async () => {
      repo.findUserById.mockResolvedValue(USER);
      store.getPendingSecret.mockResolvedValue(null);
      await expect(service.verifyEnroll("user-1", "123456")).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it("verifyEnroll() 401s on a wrong code", async () => {
      repo.findUserById.mockResolvedValue(USER);
      store.getPendingSecret.mockResolvedValue("JBSWY3DPEHPK3PXP");
      await expect(service.verifyEnroll("user-1", "000000")).rejects.toBeInstanceOf(UnauthorizedException);
      expect(store.activate).not.toHaveBeenCalled();
    });

    it("verifyEnroll() activates 2FA + returns backup codes on a valid code", async () => {
      const secret = "JBSWY3DPEHPK3PXP";
      repo.findUserById.mockResolvedValue(USER);
      store.getPendingSecret.mockResolvedValue(secret);
      store.activate.mockResolvedValue(["ABCDE-12345", "FGHIJ-67890"]);
      const code = generateTotpCode(secret);

      const result = await service.verifyEnroll("user-1", code);
      expect(result).toEqual({ enabled: true, backupCodes: ["ABCDE-12345", "FGHIJ-67890"] });
      // Durable store: activated against the user's tenant (Postgres row), not Redis.
      expect(store.activate).toHaveBeenCalledWith("tenant-1", "user-1", secret);
      expect(repo.setTwoFaEnabled).toHaveBeenCalledWith("user-1", true);
    });
  });

  describe("disable()", () => {
    it("422s when 2FA is not currently enabled", async () => {
      repo.findUserById.mockResolvedValue({ ...USER, twoFaEnabled: false });
      await expect(service.disable("user-1", "123456")).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it("401s on an invalid code (neither TOTP nor a valid backup code)", async () => {
      repo.findUserById.mockResolvedValue({ ...USER, twoFaEnabled: true });
      store.getActiveSecret.mockResolvedValue("JBSWY3DPEHPK3PXP");
      store.consumeBackupCode.mockResolvedValue(false);
      await expect(service.disable("user-1", "000000")).rejects.toBeInstanceOf(UnauthorizedException);
      expect(store.deactivate).not.toHaveBeenCalled();
    });

    it("deactivates 2FA on a valid TOTP code", async () => {
      const secret = "JBSWY3DPEHPK3PXP";
      repo.findUserById.mockResolvedValue({ ...USER, twoFaEnabled: true });
      store.getActiveSecret.mockResolvedValue(secret);
      const code = generateTotpCode(secret);

      const result = await service.disable("user-1", code);
      expect(result).toEqual({ disabled: true });
      expect(store.deactivate).toHaveBeenCalledWith("user-1");
      expect(repo.setTwoFaEnabled).toHaveBeenCalledWith("user-1", false);
    });

    it("deactivates 2FA when given a valid (unused) backup code instead of a TOTP code", async () => {
      repo.findUserById.mockResolvedValue({ ...USER, twoFaEnabled: true });
      store.getActiveSecret.mockResolvedValue(null); // no active secret needed for backup path
      store.consumeBackupCode.mockResolvedValue(true);

      const result = await service.disable("user-1", "ABCDE-12345");
      expect(result).toEqual({ disabled: true });
    });
  });

  describe("verifyCode()", () => {
    it("falls through to a backup code when the input is not a 6-digit TOTP code", async () => {
      store.consumeBackupCode.mockResolvedValue(true);
      const result = await service.verifyCode("user-1", "ABCDE-12345");
      expect(result).toBe(true);
      expect(store.getActiveSecret).not.toHaveBeenCalled();
    });

    it("falls through to backup-code check when a 6-digit code fails TOTP verification", async () => {
      store.getActiveSecret.mockResolvedValue("JBSWY3DPEHPK3PXP");
      store.consumeBackupCode.mockResolvedValue(false);
      const result = await service.verifyCode("user-1", "000000");
      expect(result).toBe(false);
      expect(store.consumeBackupCode).toHaveBeenCalled();
    });
  });
});
