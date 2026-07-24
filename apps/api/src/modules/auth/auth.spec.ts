// apps/api/src/modules/auth/auth.spec.ts
//
// Unit tests for AuthService (business logic) plus the RBAC guard chain
// (PermissionsGuard + JwtAuthGuard) and ScopeInterceptor, per CLAUDE.md §3 DoD rule 10
// ("new feature without tests = not done") and docs/plans/phase-0.md task #8. Full
// integration coverage (real Postgres/Redis via testcontainers, hitting the live HTTP
// routes) is handed off to qa-engineer; these are fast, collaborator-mocked unit tests
// proving the service/guard logic itself (rotation, reuse-detection, OTP single-use,
// permission allow/deny, scope publication) independent of infra.

import { ConflictException, ForbiddenException, UnauthorizedException, UnprocessableEntityException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import * as argon2 from "argon2";

// Wraps the REAL argon2.verify in a jest.fn so tests can assert it was actually called
// (and with what hash) without disturbing its real behavior (argon2.hash() elsewhere in
// this file still uses the genuine implementation) — argon2's native binding exports are
// non-configurable, so `jest.spyOn(argon2, "verify")` directly throws
// "Cannot redefine property"; wrapping via jest.mock's factory avoids that.
jest.mock("argon2", () => {
  const actual = jest.requireActual("argon2");
  return { ...actual, verify: jest.fn(actual.verify) };
});

import { DUMMY_PASSWORD_HASH } from "./lib/argon2-params";
import { AuthService } from "./auth.service";
import { AuthRepository } from "./auth.repository";
import { TokenService } from "./lib/token.service";
import { OtpStore } from "./lib/otp-store";
import { LoginRateLimiter } from "./lib/login-rate-limiter";
import { SMS_PROVIDER, type SmsProvider } from "./providers/sms/sms-provider.interface";
import { PermissionsGuard } from "./guards/permissions.guard";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import type { RequestUser } from "./lib/request-user";

type Mocked<T> = { [K in keyof T]: T[K] extends (...args: never[]) => unknown ? jest.Mock : T[K] };

function mockAuthRepository(): Mocked<AuthRepository> {
  return {
    findUserByEmail: jest.fn(),
    findUserByPhone: jest.fn(),
    findUserById: jest.fn(),
    updateLastLoginAt: jest.fn(),
    getRbacProfile: jest.fn(),
    createSession: jest.fn(),
    findSessionById: jest.fn(),
    rotateSessionRefreshHash: jest.fn(),
    revokeSession: jest.fn(),
    countActiveSessionsForUser: jest.fn(),
    getTenantBySlug: jest.fn(),
    createUserFromPhone: jest.fn(),
    assignDefaultRole: jest.fn(),
    setPasswordAndClearMustChange: jest.fn(),
    revokeAllSessionsForUser: jest.fn(),
  } as unknown as Mocked<AuthRepository>;
}

function mockTokenService(): Mocked<TokenService> {
  return {
    signAccessToken: jest.fn().mockResolvedValue("access.jwt"),
    signRefreshToken: jest.fn().mockResolvedValue("refresh.jwt"),
    verifyAccessToken: jest.fn(),
    verifyRefreshToken: jest.fn(),
    hashRefreshToken: jest.fn((token: string) => `hash(${token})`),
  } as unknown as Mocked<TokenService>;
}

const ACTIVE_USER = {
  id: "user-1",
  tenantId: "tenant-1",
  email: "admin@stimuliiq.test",
  phone: null as string | null,
  name: "Admin",
  avatar: null as string | null,
  status: "active",
  passwordHash: "",
};

describe("AuthService", () => {
  let service: AuthService;
  let repo: Mocked<AuthRepository>;
  let tokens: Mocked<TokenService>;
  let otpStore: Mocked<OtpStore>;
  let loginRateLimiter: Mocked<LoginRateLimiter>;
  let smsProvider: Mocked<SmsProvider>;

  beforeEach(() => {
    repo = mockAuthRepository();
    tokens = mockTokenService();
    otpStore = {
      issue: jest.fn(),
      isRateLimited: jest.fn().mockResolvedValue(false),
      markRequested: jest.fn(),
      verify: jest.fn(),
      invalidate: jest.fn(),
    } as unknown as Mocked<OtpStore>;
    loginRateLimiter = {
      hit: jest.fn().mockResolvedValue(false),
      reset: jest.fn(),
    } as unknown as Mocked<LoginRateLimiter>;
    smsProvider = { sendOtp: jest.fn().mockResolvedValue({ delivered: false }) } as unknown as Mocked<SmsProvider>;

    repo.getTenantBySlug.mockResolvedValue({ id: "tenant-1", slug: "stimuliiq" });
    repo.getRbacProfile.mockResolvedValue({ roleKeys: ["student"], permissions: [] });
    repo.createSession.mockResolvedValue({ id: "session-1" });

    service = new AuthService(
      repo as unknown as AuthRepository,
      tokens as unknown as TokenService,
      otpStore as unknown as OtpStore,
      loginRateLimiter as unknown as LoginRateLimiter,
      smsProvider as unknown as SmsProvider,
    );
  });

  describe("login", () => {
    it("rejects unknown email with a generic invalid-credentials error (no user enumeration)", async () => {
      repo.findUserByEmail.mockResolvedValue(null);
      await expect(service.login("nobody@stimuliiq.test", "whatever", {})).rejects.toThrow(UnauthorizedException);
    });

    it("rejects a wrong password", async () => {
      const passwordHash = await argon2.hash("correct-password");
      repo.findUserByEmail.mockResolvedValue({ ...ACTIVE_USER, passwordHash });
      await expect(service.login(ACTIVE_USER.email, "wrong-password", {})).rejects.toThrow(UnauthorizedException);
    });

    it("rejects an inactive account even with the correct password", async () => {
      const passwordHash = await argon2.hash("correct-password");
      repo.findUserByEmail.mockResolvedValue({ ...ACTIVE_USER, passwordHash, status: "suspended" });
      await expect(service.login(ACTIVE_USER.email, "correct-password", {})).rejects.toThrow(UnauthorizedException);
    });

    it("issues a session + tokens on valid credentials and resets the rate limiter", async () => {
      const passwordHash = await argon2.hash("correct-password");
      repo.findUserByEmail.mockResolvedValue({ ...ACTIVE_USER, passwordHash });

      const result = await service.login(ACTIVE_USER.email, "correct-password", { ip: "127.0.0.1" });

      expect(result.session.user.id).toBe(ACTIVE_USER.id);
      expect(result.tokens.accessToken).toBe("access.jwt");
      expect(result.tokens.refreshToken).toBe("refresh.jwt");
      expect(typeof result.tokens.csrfToken).toBe("string");
      expect(loginRateLimiter.reset).toHaveBeenCalledWith(ACTIVE_USER.email);
      expect(repo.createSession).toHaveBeenCalled();
      expect(repo.rotateSessionRefreshHash).toHaveBeenCalledWith("session-1", "hash(refresh.jwt)", expect.any(Date));
    });

    it("rejects when the rate limiter reports too many attempts", async () => {
      loginRateLimiter.hit.mockResolvedValue(true);
      await expect(service.login(ACTIVE_USER.email, "anything", {})).rejects.toThrow();
      expect(repo.findUserByEmail).not.toHaveBeenCalled();
    });

    // ─── AC: login enumeration resistance (Phase-7 Wave 2 security hardening batch A,
    // item 4 — closes P0 followups M-5) ─────────────────────────────────────────────

    describe("enumeration resistance (M-5)", () => {
      async function captureError(email: string, password: string): Promise<{ code: unknown; title: unknown }> {
        try {
          await service.login(email, password, {});
          throw new Error("expected login() to throw");
        } catch (err) {
          const response = (err as UnauthorizedException).getResponse() as Record<string, unknown>;
          return { code: response["code"], title: response["title"] };
        }
      }

      it("unknown email and a disabled (suspended) account return the IDENTICAL error code + title", async () => {
        repo.findUserByEmail.mockResolvedValueOnce(null);
        const unknownEmailError = await captureError("nobody@stimuliiq.test", "whatever-password");

        const passwordHash = await argon2.hash("correct-password");
        repo.findUserByEmail.mockResolvedValueOnce({ ...ACTIVE_USER, passwordHash, status: "suspended" });
        const disabledAccountError = await captureError(ACTIVE_USER.email, "correct-password");

        expect(unknownEmailError).toEqual(disabledAccountError);
        expect(unknownEmailError).toEqual({ code: "auth.invalid_credentials", title: "Invalid email or password" });
      });

      it("unknown email and a wrong password for a real active account return the IDENTICAL error code + title", async () => {
        repo.findUserByEmail.mockResolvedValueOnce(null);
        const unknownEmailError = await captureError("nobody@stimuliiq.test", "whatever-password");

        const passwordHash = await argon2.hash("correct-password");
        repo.findUserByEmail.mockResolvedValueOnce({ ...ACTIVE_USER, passwordHash });
        const wrongPasswordError = await captureError(ACTIVE_USER.email, "totally-wrong-password");

        expect(unknownEmailError).toEqual(wrongPasswordError);
      });

      it("an OTP-only account (no password set) returns the SAME generic error as an unknown account", async () => {
        repo.findUserByEmail.mockResolvedValueOnce(null);
        const unknownEmailError = await captureError("nobody@stimuliiq.test", "whatever-password");

        repo.findUserByEmail.mockResolvedValueOnce({ ...ACTIVE_USER, passwordHash: "" });
        const otpOnlyAccountError = await captureError(ACTIVE_USER.email, "any-password");

        expect(unknownEmailError).toEqual(otpOnlyAccountError);
      });

      it("performs a real argon2 verification against the fixed dummy hash for an unknown account (comparable timing, no short-circuit)", async () => {
        repo.findUserByEmail.mockResolvedValue(null);
        (argon2.verify as jest.Mock).mockClear();

        await expect(service.login("nobody@stimuliiq.test", "whatever", {})).rejects.toThrow(UnauthorizedException);

        // A real (non-skipped) verify() call happened against the dummy hash — timing
        // is not short-circuited for the "no such user" path, closing the
        // response-timing side channel (M-5).
        expect(argon2.verify).toHaveBeenCalledWith(DUMMY_PASSWORD_HASH, "whatever");
      });
    });
  });

  // ─── AC: app/role boundary gate (audience) — a `student` may only sign into the
  // LMS; any staff role may only sign into the CRM. Layered on top of per-endpoint
  // RBAC (see @repo/types AppAudienceSchema). ────────────────────────────────────
  describe("audience / app-role boundary gate", () => {
    async function loginWith(roleKeys: string[], audience: "lms" | "crm" | undefined) {
      const passwordHash = await argon2.hash("correct-password");
      repo.findUserByEmail.mockResolvedValue({ ...ACTIVE_USER, passwordHash });
      repo.getRbacProfile.mockResolvedValue({ roleKeys, permissions: [] });
      return service.login(ACTIVE_USER.email, "correct-password", {}, audience);
    }

    async function audienceErrorCode(roleKeys: string[], audience: "lms" | "crm"): Promise<unknown> {
      try {
        await loginWith(roleKeys, audience);
        throw new Error("expected login() to throw");
      } catch (err) {
        if (!(err instanceof ForbiddenException)) throw err;
        return (err.getResponse() as Record<string, unknown>)["code"];
      }
    }

    it("student signing into the LMS is allowed", async () => {
      const result = await loginWith(["student"], "lms");
      expect(result.session.user.id).toBe(ACTIVE_USER.id);
      expect(repo.createSession).toHaveBeenCalled();
    });

    it("student signing into the CRM is rejected with 403 (no session issued)", async () => {
      await expect(loginWith(["student"], "crm")).rejects.toThrow(ForbiddenException);
      expect(await audienceErrorCode(["student"], "crm")).toBe("auth.audience_forbidden");
      expect(repo.createSession).not.toHaveBeenCalled();
    });

    it("staff (admin) signing into the CRM is allowed", async () => {
      const result = await loginWith(["admin"], "crm");
      expect(result.session.user.id).toBe(ACTIVE_USER.id);
    });

    it("staff (admin) signing into the LMS is rejected with 403", async () => {
      await expect(loginWith(["admin"], "lms")).rejects.toThrow(ForbiddenException);
      expect(await audienceErrorCode(["admin"], "lms")).toBe("auth.audience_forbidden");
    });

    it("mentor (external staff hire) may sign into the CRM but not the LMS", async () => {
      await expect(loginWith(["mentor"], "crm")).resolves.toBeDefined();
      await expect(loginWith(["mentor"], "lms")).rejects.toThrow(ForbiddenException);
    });

    it("a user with no roles is fail-closed out of BOTH apps", async () => {
      await expect(loginWith([], "lms")).rejects.toThrow(ForbiddenException);
      await expect(loginWith([], "crm")).rejects.toThrow(ForbiddenException);
    });

    it("omitting audience skips the gate (backward-compatible; RBAC still governs endpoints)", async () => {
      await expect(loginWith(["student"], undefined)).resolves.toBeDefined();
      await expect(loginWith(["admin"], undefined)).resolves.toBeDefined();
    });

    it("verifyOtp enforces the same gate: an existing staff account cannot OTP-login into the LMS", async () => {
      otpStore.verify.mockResolvedValue(true);
      repo.findUserByPhone.mockResolvedValue({ ...ACTIVE_USER, phone: "+919999999999" });
      repo.getRbacProfile.mockResolvedValue({ roleKeys: ["admin"], permissions: [] });
      await expect(service.verifyOtp("+919999999999", "123456", {}, "lms")).rejects.toThrow(ForbiddenException);
    });
  });

  // ─── verifyCredentialsOnly() — T28 2FA login gate (docs/plans/phase-9-completion.md) ──
  // Purely additive method; does NOT touch login()'s tested behavior above.

  describe("verifyCredentialsOnly", () => {
    it("returns null for unknown email (same enumeration-resistant shape as login())", async () => {
      repo.findUserByEmail.mockResolvedValue(null);
      const result = await service.verifyCredentialsOnly("nobody@stimuliiq.test", "whatever");
      expect(result).toBeNull();
    });

    it("returns null for a wrong password", async () => {
      const passwordHash = await argon2.hash("correct-password");
      repo.findUserByEmail.mockResolvedValue({ ...ACTIVE_USER, passwordHash });
      const result = await service.verifyCredentialsOnly(ACTIVE_USER.email, "wrong-password");
      expect(result).toBeNull();
    });

    it("returns {id, twoFaEnabled} on valid credentials WITHOUT issuing a session", async () => {
      const passwordHash = await argon2.hash("correct-password");
      repo.findUserByEmail.mockResolvedValue({ ...ACTIVE_USER, passwordHash, twoFaEnabled: true });

      const result = await service.verifyCredentialsOnly(ACTIVE_USER.email, "correct-password");
      expect(result).toEqual({ id: ACTIVE_USER.id, twoFaEnabled: true });
      expect(repo.createSession).not.toHaveBeenCalled();
      expect(tokens.signAccessToken).not.toHaveBeenCalled();
    });

    it("rejects when the rate limiter reports too many attempts", async () => {
      loginRateLimiter.hit.mockResolvedValue(true);
      await expect(service.verifyCredentialsOnly(ACTIVE_USER.email, "anything")).rejects.toThrow();
    });
  });

  describe("refresh — rotation + reuse detection", () => {
    const SESSION = { id: "session-1", revokedAt: null, expiresAt: new Date(Date.now() + 60_000), refreshHash: "hash(old-refresh)" };

    it("rotates the session when the presented token matches the stored hash", async () => {
      tokens.verifyRefreshToken.mockResolvedValue({ sub: ACTIVE_USER.id, sid: "session-1" });
      repo.findSessionById.mockResolvedValue(SESSION);
      repo.findUserById.mockResolvedValue(ACTIVE_USER);
      tokens.hashRefreshToken.mockReturnValueOnce("hash(old-refresh)"); // matches SESSION.refreshHash

      const result = await service.refresh("old-refresh", {});

      expect(repo.revokeSession).not.toHaveBeenCalled();
      expect(repo.rotateSessionRefreshHash).toHaveBeenCalledWith("session-1", expect.any(String), expect.any(Date));
      expect(result.tokens.accessToken).toBe("access.jwt");
    });

    it("detects reuse (hash mismatch on a still-valid session) and revokes the session with 409", async () => {
      tokens.verifyRefreshToken.mockResolvedValue({ sub: ACTIVE_USER.id, sid: "session-1" });
      repo.findSessionById.mockResolvedValue(SESSION);
      tokens.hashRefreshToken.mockReturnValueOnce("hash(stale-replayed-token)"); // does NOT match

      await expect(service.refresh("stale-replayed-token", {})).rejects.toThrow(ConflictException);
      expect(repo.revokeSession).toHaveBeenCalledWith("session-1");
    });

    it("rejects with 401 when no refresh token is presented", async () => {
      await expect(service.refresh(undefined, {})).rejects.toThrow(UnauthorizedException);
    });

    it("rejects with 401 when the session is already revoked", async () => {
      tokens.verifyRefreshToken.mockResolvedValue({ sub: ACTIVE_USER.id, sid: "session-1" });
      repo.findSessionById.mockResolvedValue({ ...SESSION, revokedAt: new Date() });
      await expect(service.refresh("some-token", {})).rejects.toThrow(UnauthorizedException);
      // No reuse-revocation action needed — session is already revoked, nothing left to revoke.
      expect(repo.revokeSession).not.toHaveBeenCalled();
    });

    it("rejects with 401 when the JWT itself fails verification", async () => {
      tokens.verifyRefreshToken.mockRejectedValue(new Error("bad signature"));
      await expect(service.refresh("garbage", {})).rejects.toThrow(UnauthorizedException);
    });
  });

  describe("logout", () => {
    it("revokes the session for a valid refresh token", async () => {
      tokens.verifyRefreshToken.mockResolvedValue({ sub: ACTIVE_USER.id, sid: "session-1" });
      await service.logout("refresh-token");
      expect(repo.revokeSession).toHaveBeenCalledWith("session-1");
    });

    it("is a no-op (never throws) when no refresh token is presented", async () => {
      await expect(service.logout(undefined)).resolves.toBeUndefined();
      expect(repo.revokeSession).not.toHaveBeenCalled();
    });

    it("is a no-op (never throws) for an already-invalid token", async () => {
      tokens.verifyRefreshToken.mockRejectedValue(new Error("expired"));
      await expect(service.logout("expired-token")).resolves.toBeUndefined();
    });
  });

  describe("OTP request + verify", () => {
    it("requestOtp delegates code delivery to the SmsProvider interface (never a vendor SDK directly)", async () => {
      otpStore.issue.mockResolvedValue({ code: "123456", expiresInSeconds: 300 });

      const result = await service.requestOtp("+919999999999");

      expect(smsProvider.sendOtp).toHaveBeenCalledWith({ phone: "+919999999999", code: "123456" });
      expect(result).toEqual({ phone: "+919999999999", expiresInSeconds: 300, delivered: false });
    });

    it("requestOtp rejects when the per-phone rate limit window is active", async () => {
      otpStore.isRateLimited.mockResolvedValue(true);
      await expect(service.requestOtp("+919999999999")).rejects.toThrow();
      expect(otpStore.issue).not.toHaveBeenCalled();
    });

    it("verifyOtp rejects an invalid/expired code", async () => {
      otpStore.verify.mockResolvedValue(false);
      await expect(service.verifyOtp("+919999999999", "000000", {})).rejects.toThrow(UnauthorizedException);
    });

    it("verifyOtp creates a new student account on first-time phone login", async () => {
      otpStore.verify.mockResolvedValue(true);
      repo.findUserByPhone.mockResolvedValue(null);
      repo.createUserFromPhone.mockResolvedValue({ ...ACTIVE_USER, id: "user-2", phone: "+919999999999" });

      const result = await service.verifyOtp("+919999999999", "123456", {});

      expect(repo.createUserFromPhone).toHaveBeenCalledWith("tenant-1", "+919999999999");
      expect(repo.assignDefaultRole).toHaveBeenCalledWith("user-2", "tenant-1", "student");
      expect(result.session.user.id).toBe("user-2");
    });

    it("verifyOtp reuses an existing account without re-creating it", async () => {
      otpStore.verify.mockResolvedValue(true);
      repo.findUserByPhone.mockResolvedValue({ ...ACTIVE_USER, phone: "+919999999999" });

      await service.verifyOtp("+919999999999", "123456", {});

      expect(repo.createUserFromPhone).not.toHaveBeenCalled();
    });

    it("verifyOtp: a disabled account returns the SAME generic error code/title as an invalid/expired code (enumeration resistance, M-5)", async () => {
      otpStore.verify.mockResolvedValueOnce(false);
      let invalidCodeError: { code: unknown; title: unknown };
      try {
        await service.verifyOtp("+919999999999", "000000", {});
        throw new Error("expected throw");
      } catch (err) {
        const response = (err as UnauthorizedException).getResponse() as Record<string, unknown>;
        invalidCodeError = { code: response["code"], title: response["title"] };
      }

      otpStore.verify.mockResolvedValueOnce(true);
      repo.findUserByPhone.mockResolvedValue({ ...ACTIVE_USER, phone: "+919999999999", status: "suspended" });
      let disabledAccountError: { code: unknown; title: unknown };
      try {
        await service.verifyOtp("+919999999999", "123456", {});
        throw new Error("expected throw");
      } catch (err) {
        const response = (err as UnauthorizedException).getResponse() as Record<string, unknown>;
        disabledAccountError = { code: response["code"], title: response["title"] };
      }

      expect(invalidCodeError).toEqual(disabledAccountError);
      expect(invalidCodeError).toEqual({ code: "auth.invalid_otp", title: "Invalid or expired OTP" });
    });
  });

  describe("getMe", () => {
    it("returns the resolved user + roles + permissions", async () => {
      repo.findUserById.mockResolvedValue(ACTIVE_USER);
      repo.getRbacProfile.mockResolvedValue({ roleKeys: ["admin"], permissions: [{ key: "audit_log.list", scope: "all" }] });

      const me = await service.getMe(ACTIVE_USER.id, ACTIVE_USER.tenantId);

      expect(me.user.id).toBe(ACTIVE_USER.id);
      expect(me.roles).toEqual(["admin"]);
      expect(me.permissions).toEqual([{ key: "audit_log.list", scope: "all" }]);
      expect(me.tenantId).toBe(ACTIVE_USER.tenantId);
    });

    it("throws 401 if the user no longer exists", async () => {
      repo.findUserById.mockResolvedValue(null);
      await expect(service.getMe("ghost", "tenant-1")).rejects.toThrow(UnauthorizedException);
    });
  });

  // lifecycle-redesign P3 — first-login / self-service password change.
  describe("changePassword", () => {
    it("rotates the password, clears the gate, and revokes all sessions on success", async () => {
      const passwordHash = await argon2.hash("temp-Password-1");
      repo.findUserById.mockResolvedValue({ ...ACTIVE_USER, passwordHash });

      const result = await service.changePassword(ACTIVE_USER.id, "temp-Password-1", "new-Password-2");

      expect(result).toEqual({ changed: true });
      expect(repo.setPasswordAndClearMustChange).toHaveBeenCalledTimes(1);
      const [userId, newHash] = repo.setPasswordAndClearMustChange.mock.calls[0];
      expect(userId).toBe(ACTIVE_USER.id);
      // The stored hash must verify against the NEW password, not the old one.
      await expect(argon2.verify(newHash as string, "new-Password-2")).resolves.toBe(true);
      expect(repo.revokeAllSessionsForUser).toHaveBeenCalledWith(ACTIVE_USER.id);
    });

    it("rejects a wrong current password with 422 and never writes", async () => {
      const passwordHash = await argon2.hash("the-real-password");
      repo.findUserById.mockResolvedValue({ ...ACTIVE_USER, passwordHash });

      await expect(service.changePassword(ACTIVE_USER.id, "wrong-guess", "new-Password-2")).rejects.toThrow(
        UnprocessableEntityException,
      );
      expect(repo.setPasswordAndClearMustChange).not.toHaveBeenCalled();
      expect(repo.revokeAllSessionsForUser).not.toHaveBeenCalled();
    });

    it("rejects reusing the same password with 422", async () => {
      const passwordHash = await argon2.hash("same-Password-1");
      repo.findUserById.mockResolvedValue({ ...ACTIVE_USER, passwordHash });

      await expect(service.changePassword(ACTIVE_USER.id, "same-Password-1", "same-Password-1")).rejects.toThrow(
        UnprocessableEntityException,
      );
      expect(repo.setPasswordAndClearMustChange).not.toHaveBeenCalled();
    });

    it("rejects with 422 when the account has no usable password (constant-time, no disclosure)", async () => {
      repo.findUserById.mockResolvedValue({ ...ACTIVE_USER, passwordHash: "" });
      await expect(service.changePassword(ACTIVE_USER.id, "anything", "new-Password-2")).rejects.toThrow(
        UnprocessableEntityException,
      );
    });
  });
});

describe("PermissionsGuard", () => {
  function contextWith(metadata: string | undefined, user: RequestUser | undefined) {
    const req: { user?: RequestUser; scope?: unknown } = { user };
    return {
      reflector: { getAllAndOverride: () => metadata },
      context: {
        switchToHttp: () => ({ getRequest: () => req }),
        getHandler: () => undefined,
        getClass: () => undefined,
      },
      req,
    };
  }

  it("allows routes with no @RequirePermission metadata (authentication-only)", () => {
    const reflector = new Reflector();
    jest.spyOn(reflector, "getAllAndOverride").mockReturnValue(undefined);
    const guard = new PermissionsGuard(reflector);
    const { context } = contextWith(undefined, {
      id: "u1",
      tenantId: "t1",
      roles: [],
      permissions: [],
      mustChangePassword: false,
    });

    expect(guard.canActivate(context as never)).toBe(true);
  });

  it("denies with 403 when the user lacks the required permission grant", () => {
    const reflector = new Reflector();
    jest.spyOn(reflector, "getAllAndOverride").mockReturnValue("audit_log.list");
    const guard = new PermissionsGuard(reflector);
    const { context } = contextWith("audit_log.list", {
      id: "u1",
      tenantId: "t1",
      roles: ["student"],
      permissions: [],
      mustChangePassword: false,
    });

    expect(() => guard.canActivate(context as never)).toThrow(ForbiddenException);
  });

  it("allows + publishes the matched scope onto req.scope when the grant exists", () => {
    const reflector = new Reflector();
    jest.spyOn(reflector, "getAllAndOverride").mockReturnValue("audit_log.list");
    const guard = new PermissionsGuard(reflector);
    const { context, req } = contextWith("audit_log.list", {
      id: "u1",
      tenantId: "t1",
      roles: ["admin"],
      permissions: [{ key: "audit_log.list", scope: "all" }],
      mustChangePassword: false,
    });

    expect(guard.canActivate(context as never)).toBe(true);
    expect(req.scope).toEqual({ permissionKey: "audit_log.list", scope: "all" });
  });
});

describe("JwtAuthGuard", () => {
  it("throws 401 when no access_token cookie is present", async () => {
    const tokenService = { verifyAccessToken: jest.fn() } as unknown as TokenService;
    const authRepository = { findUserById: jest.fn() } as unknown as AuthRepository;
    const guard = new JwtAuthGuard(tokenService, authRepository);

    const req = { cookies: {}, user: undefined };
    const context = { switchToHttp: () => ({ getRequest: () => req }) };

    await expect(guard.canActivate(context as never)).rejects.toThrow(UnauthorizedException);
  });

  it("passes through and sets req.user when req.user is already populated (middleware ran first)", async () => {
    const tokenService = { verifyAccessToken: jest.fn() } as unknown as TokenService;
    const authRepository = { findUserById: jest.fn() } as unknown as AuthRepository;
    const guard = new JwtAuthGuard(tokenService, authRepository);

    const user: RequestUser = { id: "u1", tenantId: "t1", roles: ["student"], permissions: [], mustChangePassword: false };
    const req = { cookies: {}, user };
    const context = { switchToHttp: () => ({ getRequest: () => req }) };

    await expect(guard.canActivate(context as never)).resolves.toBe(true);
    expect(req.user).toBe(user);
  });
});

describe("SMS_PROVIDER DI token", () => {
  it("is a distinct symbol used to bind the swappable provider interface", () => {
    expect(typeof SMS_PROVIDER).toBe("symbol");
  });
});
