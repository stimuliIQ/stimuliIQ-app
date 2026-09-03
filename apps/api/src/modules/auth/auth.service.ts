// apps/api/src/modules/auth/auth.service.ts
//
// Business logic for authentication (docs/04-trd-architecture.md §2.1: "service layer —
// business logic, transactions, orchestrates repositories + providers"). Never touches
// Prisma directly (delegates to AuthRepository) and never calls a vendor SDK directly
// (delegates OTP delivery to the injected SmsProvider interface, CLAUDE.md §3.7).
//
// Refresh rotation + reuse detection (locked decision):
//   - Each `sessions` row IS the rotation family: `refreshHash` always holds the hash of
//     the one currently-valid refresh token for that session.
//   - The refresh JWT embeds `sid` (session id). On `/auth/refresh`, we look up that
//     session, hash the presented token, and compare to the stored `refreshHash`.
//   - Match -> rotate: issue new access+refresh, update `refreshHash` in place.
//   - Mismatch (but session exists, not yet revoked/expired) -> REUSE DETECTED: someone
//     presented a refresh token that is no longer current for this session (i.e. a stale,
//     already-rotated token was replayed) -> revoke the whole session (family) and 401.
//   - Session not found / revoked / expired -> 401 (no further reuse-detection action
//     needed; there is nothing left to revoke).

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
  UnprocessableEntityException,
} from "@nestjs/common";
import * as argon2 from "argon2";
import type {
  AppAudience,
  AuthSessionData,
  ChangePasswordResponse,
  MeResponse,
  OtpRequestData,
  UserSummary,
} from "@repo/types";
import { AuthRepository } from "./auth.repository";
import { TokenService } from "./lib/token.service";
import { OtpStore } from "./lib/otp-store";
import { LoginRateLimiter } from "./lib/login-rate-limiter";
import { generateCsrfToken } from "./lib/cookies";
import { DUMMY_PASSWORD_HASH, ARGON2_HASH_OPTIONS } from "./lib/argon2-params";
import { SMS_PROVIDER, type SmsProvider } from "./providers/sms/sms-provider.interface";

const TENANT_SLUG = "stimuliiq"; // Phase 0: single tenant. Multi-tenant resolution (subdomain/host) lands later.

// App/role boundary gate (see @repo/types AppAudienceSchema). `student` is the ONLY
// role that belongs to the LMS; every other role (admin, faculty, mentor, counsellor,
// finance, …) is staff and belongs to the CRM. A user with no roles belongs to neither
// (fail-closed). This is layered on top of per-endpoint RBAC — it stops the wrong kind of
// account signing INTO an app at all, so a student never lands in the staff dashboard
// (and a staff member never lands in the student portal), regardless of what any single
// endpoint's permission check would later allow.
const LMS_ROLE = "student";

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  csrfToken: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly authRepository: AuthRepository,
    private readonly tokenService: TokenService,
    private readonly otpStore: OtpStore,
    private readonly loginRateLimiter: LoginRateLimiter,
    @Inject(SMS_PROVIDER) private readonly smsProvider: SmsProvider,
  ) {}

  // ── Login ───────────────────────────────────────────────────────────────

  async login(
    email: string,
    password: string,
    meta: { device?: string; ip?: string },
    audience?: AppAudience,
  ): Promise<{ session: AuthSessionData; tokens: IssuedTokens }> {
    if (await this.loginRateLimiter.hit(email)) {
      throw new BadRequestException({
        code: "auth.rate_limited",
        title: "Too many login attempts",
        detail: "Please wait before trying again.",
      });
    }

    const user = await this.authRepository.findUserByEmail(TENANT_SLUG, email);
    const invalidCredentialsError = new UnauthorizedException({
      code: "auth.invalid_credentials",
      title: "Invalid email or password",
    });

    // ENUMERATION RESISTANCE (Phase-7 Wave 2 security hardening batch A, item 4 —
    // closes P0 followups M-5, "inactive-account enumeration"): ALWAYS perform a
    // full-cost argon2id verification — against the real stored hash when a matching
    // user with a set password exists, otherwise against a fixed, non-secret dummy hash
    // (argon2-params.ts) — so response TIMING never reveals whether the account exists.
    // A soft-deleted user is already indistinguishable from "no such user" here: the
    // Prisma soft-delete extension (prisma/soft-delete.extension.ts) makes
    // findUserByEmail's findFirst() return null for a deleted row automatically.
    const hashToVerify = user?.passwordHash ? user.passwordHash : DUMMY_PASSWORD_HASH;
    const passwordValid = await argon2.verify(hashToVerify, password).catch(() => false);

    // Unknown account, OTP-only account (no password set), wrong password, and
    // inactive/disabled account ALL produce the exact same generic error — never
    // reveal which condition applied (M-5).
    if (!user || !user.passwordHash || !passwordValid || user.status !== "active") {
      throw invalidCredentialsError;
    }

    // App/role boundary gate — enforced BEFORE this counts as a successful login
    // (no rate-limit reset, no last-login bump for a wrong-app attempt). The password
    // was already verified above, so surfacing a specific "wrong app" 403 here leaks
    // nothing an attacker doesn't already have (valid credentials).
    const { roleKeys } = await this.authRepository.getRbacProfile(user.id);
    this.assertAudienceAllowed(roleKeys, audience);

    // These three are mutually independent — the rate-limit reset, the last-login
    // bump and the tenant lookup neither read nor write each other's state — so they
    // run concurrently instead of as three sequential network round trips. Ordering
    // was never load-bearing: on the previous sequential path a tenant miss below
    // already threw *after* the reset and the bump had been applied, and that is
    // still exactly what happens here.
    const [, , tenant] = await Promise.all([
      this.loginRateLimiter.reset(email),
      this.authRepository.updateLastLoginAt(user.id),
      this.authRepository.getTenantBySlug(TENANT_SLUG),
    ]);
    if (!tenant) {
      throw new UnauthorizedException({ code: "auth.tenant_not_found", title: "Tenant not found" });
    }

    const tokens = await this.issueNewSession(user.id, tenant.id, meta, roleKeys);
    const userSummary = this.toUserSummary(user);

    return { session: { user: userSummary, csrfToken: tokens.csrfToken }, tokens };
  }

  // ── Credential-only check (T28, docs/plans/phase-9-completion.md) ────────

  /**
   * Verifies email+password WITHOUT issuing a session — used by the 2FA login gate
   * (AuthController.login() / TwoFactorController's login-verify endpoint) to check
   * credentials before deciding whether a TOTP/backup code step is required. Mirrors
   * `login()`'s enumeration-resistant argon2 comparison exactly (SAME rate limiter,
   * SAME dummy-hash fallback) but stops short of touching sessions/rate-limiter-reset —
   * `login()` (called AFTER this, once any 2FA step passes) is the single source of
   * truth for actually issuing a session, so this method is purely additive and does
   * not change `login()`'s existing behavior/signature (zero risk to existing callers).
   */
  async verifyCredentialsOnly(email: string, password: string): Promise<{ id: string; twoFaEnabled: boolean } | null> {
    if (await this.loginRateLimiter.hit(email)) {
      throw new BadRequestException({
        code: "auth.rate_limited",
        title: "Too many login attempts",
        detail: "Please wait before trying again.",
      });
    }

    const user = await this.authRepository.findUserByEmail(TENANT_SLUG, email);
    const hashToVerify = user?.passwordHash ? user.passwordHash : DUMMY_PASSWORD_HASH;
    const passwordValid = await argon2.verify(hashToVerify, password).catch(() => false);

    if (!user || !user.passwordHash || !passwordValid || user.status !== "active") {
      return null; // enumeration-resistant — identical to login()'s invalidCredentialsError condition.
    }

    return { id: user.id, twoFaEnabled: user.twoFaEnabled };
  }

  // ── Refresh (rotating, single-use, reuse-detection) ──────────────────────

  async refresh(
    presentedRefreshToken: string | undefined,
    // Accepted for call-site symmetry with login/verifyOtp (AuthController passes the
    // same requestMeta() shape uniformly); not yet persisted on rotation — the session
    // row tracks only its current refreshHash/expiresAt, not a device/ip history. Revisit
    // if a future "active sessions" UI needs per-rotation device/ip auditing.
    _meta: { device?: string; ip?: string },
  ): Promise<{ session: AuthSessionData; tokens: IssuedTokens }> {
    const unauthorized = new UnauthorizedException({
      code: "auth.invalid_refresh_token",
      title: "Invalid or expired refresh token",
    });

    if (!presentedRefreshToken) {
      throw unauthorized;
    }

    let claims: { sub: string; sid: string };
    try {
      claims = await this.tokenService.verifyRefreshToken(presentedRefreshToken);
    } catch {
      throw unauthorized;
    }

    const session = await this.authRepository.findSessionById(claims.sid);
    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw unauthorized;
    }

    const presentedHash = this.tokenService.hashRefreshToken(presentedRefreshToken);

    if (presentedHash !== session.refreshHash) {
      // REUSE DETECTED: a stale (already-rotated) refresh token was replayed. Revoke
      // the entire session family immediately — the legitimate holder of the CURRENT
      // token will simply get a 401 on their next refresh and must re-authenticate,
      // which is the correct fail-safe response to a suspected token leak.
      await this.authRepository.revokeSession(session.id);
      this.logger.warn(`Refresh token reuse detected for session ${session.id}, session revoked.`);
      throw new ConflictException({
        code: "auth.refresh_reuse_detected",
        title: "Refresh token reuse detected",
        detail: "This session has been revoked for security. Please log in again.",
      });
    }

    const user = await this.authRepository.findUserById(claims.sub);
    if (!user || user.status !== "active") {
      await this.authRepository.revokeSession(session.id);
      throw unauthorized;
    }

    const tenant = await this.authRepository.getTenantBySlug(TENANT_SLUG);
    if (!tenant) {
      throw unauthorized;
    }

    // Rotate: issue new access+refresh, update the SAME session row's refreshHash.
    const accessToken = await this.tokenService.signAccessToken({
      userId: user.id,
      tenantId: tenant.id,
      roles: (await this.authRepository.getRbacProfile(user.id)).roleKeys,
    });
    const refreshToken = await this.tokenService.signRefreshToken({ userId: user.id, sessionId: session.id });
    const refreshHash = this.tokenService.hashRefreshToken(refreshToken);
    const expiresAt = this.refreshExpiryDate();

    await this.authRepository.rotateSessionRefreshHash(session.id, refreshHash, expiresAt);

    const csrfToken = generateCsrfToken();
    const userSummary = this.toUserSummary(user);

    return {
      session: { user: userSummary, csrfToken },
      tokens: { accessToken, refreshToken, csrfToken },
    };
  }

  // ── Logout ────────────────────────────────────────────────────────────────

  async logout(presentedRefreshToken: string | undefined): Promise<void> {
    if (!presentedRefreshToken) return;
    try {
      const claims = await this.tokenService.verifyRefreshToken(presentedRefreshToken);
      await this.authRepository.revokeSession(claims.sid);
    } catch {
      // Already-invalid/expired token on logout is not an error — the end state
      // (no valid session) is what logout wants anyway.
    }
  }

  // ── OTP ───────────────────────────────────────────────────────────────────

  async requestOtp(phone: string): Promise<OtpRequestData> {
    if (await this.otpStore.isRateLimited(phone)) {
      throw new BadRequestException({
        code: "auth.rate_limited",
        title: "OTP already requested",
        detail: "Please wait before requesting another OTP.",
      });
    }

    const { code, expiresInSeconds } = await this.otpStore.issue(phone);
    await this.otpStore.markRequested(phone);

    const { delivered } = await this.smsProvider.sendOtp({ phone, code });

    return { phone, expiresInSeconds, delivered };
  }

  async verifyOtp(
    phone: string,
    code: string,
    meta: { device?: string; ip?: string },
    audience?: AppAudience,
  ): Promise<{ session: AuthSessionData; tokens: IssuedTokens }> {
    const valid = await this.otpStore.verify(phone, code);
    if (!valid) {
      throw new UnauthorizedException({
        code: "auth.invalid_otp",
        title: "Invalid or expired OTP",
      });
    }

    const tenant = await this.authRepository.getTenantBySlug(TENANT_SLUG);
    if (!tenant) {
      throw new UnauthorizedException({ code: "auth.tenant_not_found", title: "Tenant not found" });
    }

    let user = await this.authRepository.findUserByPhone(TENANT_SLUG, phone);
    if (!user) {
      user = await this.authRepository.createUserFromPhone(tenant.id, phone);
      await this.authRepository.assignDefaultRole(user.id, tenant.id, "student");
    }

    // ENUMERATION RESISTANCE (Phase-7 Wave 2 security hardening batch A, item 4 —
    // closes P0 followups M-5): an inactive/disabled account gets the exact SAME
    // generic "invalid OTP" error as a genuinely wrong/expired code — never reveal
    // that the phone number belongs to a real, but disabled, account.
    if (user.status !== "active") {
      throw new UnauthorizedException({
        code: "auth.invalid_otp",
        title: "Invalid or expired OTP",
      });
    }

    const { roleKeys } = await this.authRepository.getRbacProfile(user.id);

    // OTP is a STUDENT self-service path, and only that.
    //
    // The gate here used to be `assertAudienceAllowed(roleKeys, audience)` with a comment
    // claiming it rejected staff. It did the opposite: that helper's non-LMS branch is
    // `roleKeys.some(r => r !== "student")`, which a staff account satisfies — so it
    // ADMITTED them — and `audience` is optional, so a caller that simply omitted the
    // header skipped the check altogether. The result was a full CRM session for any
    // staff member with a phone number on file: no password, and no TOTP step, because
    // POST /auth/login's 2FA gate lives on the password route and this one never
    // consulted `two_fa_enabled`. A ported or swapped SIM was enough to reduce a
    // 2FA-protected admin account to one factor.
    //
    // Checking the ROLE rather than the requested audience is what makes this closed: it
    // does not depend on the client telling the truth about which app it is.
    const isStudentOnly = roleKeys.length > 0 && roleKeys.every((role) => role === LMS_ROLE);
    if (!isStudentOnly) {
      throw new ForbiddenException({
        code: "auth.otp_not_available",
        title: "Sign in with your password",
        detail: "One-time-code sign-in is for student accounts. Staff sign in with an email and password.",
      });
    }

    // Belt and braces: a student who has enrolled in 2FA must still complete it. OTP must
    // not become the way around a second factor for anyone.
    if (user.twoFaEnabled) {
      throw new UnauthorizedException({
        code: "auth.2fa_required",
        title: "Two-factor authentication required",
        detail: "This account has two-factor authentication enabled. Sign in with your password, then your code.",
      });
    }

    // Still enforced, so an LMS-audience request from a non-student is refused with the
    // "this is the student portal" wording rather than the generic OTP message.
    this.assertAudienceAllowed(roleKeys, audience);

    await this.authRepository.updateLastLoginAt(user.id);

    const tokens = await this.issueNewSession(user.id, tenant.id, meta, roleKeys);
    const userSummary = this.toUserSummary(user);

    return { session: { user: userSummary, csrfToken: tokens.csrfToken }, tokens };
  }

  // ── Me ────────────────────────────────────────────────────────────────────

  async getMe(userId: string, tenantId: string): Promise<MeResponse> {
    const user = await this.authRepository.findUserById(userId);
    if (!user) {
      throw new UnauthorizedException({ code: "auth.unauthenticated", title: "User not found" });
    }
    const { roleKeys, permissions } = await this.authRepository.getRbacProfile(userId);

    return {
      user: this.toUserSummary(user),
      tenantId,
      roles: roleKeys,
      permissions,
    };
  }

  // ── Shared helpers ────────────────────────────────────────────────────────

  /**
   * Enforces the app/role boundary (see @repo/types AppAudienceSchema). No-op when
   * `audience` is absent (legacy server-to-server / test callers) — those are still
   * fully gated by per-endpoint RBAC; only the app-boundary convenience gate is skipped.
   * When present, a mismatch throws 403 `auth.audience_forbidden`.
   */
  private assertAudienceAllowed(roleKeys: string[], audience: AppAudience | undefined): void {
    if (!audience) return;
    const isStudent = roleKeys.includes(LMS_ROLE);
    const allowed = audience === "lms" ? isStudent : roleKeys.some((r) => r !== LMS_ROLE);
    if (allowed) return;

    throw new ForbiddenException(
      audience === "lms"
        ? {
            code: "auth.audience_forbidden",
            title: "This is the student portal",
            detail: "This account isn't a student account. Staff should sign in from the admin dashboard.",
          }
        : {
            code: "auth.audience_forbidden",
            title: "This is the staff dashboard",
            detail: "This account isn't a staff account. Students should sign in from the student portal.",
          },
    );
  }

  private async issueNewSession(
    userId: string,
    tenantId: string,
    meta: { device?: string; ip?: string },
    roleKeys: string[],
  ): Promise<IssuedTokens> {
    // The refresh JWT embeds the session id, so we must create the session row first to
    // obtain that id, then sign the token, then store its hash back onto the same row.
    // The placeholder hash below can never validate a real refresh (sha256 hex digests
    // are 64 chars; this sentinel is shorter) and is overwritten in the same request
    // before any response is sent, so there is no window where a guessable value works.
    const session = await this.authRepository.createSession({
      tenantId,
      userId,
      refreshHash: "unset",
      expiresAt: this.refreshExpiryDate(),
      device: meta.device,
      ip: meta.ip,
    });

    const accessToken = await this.tokenService.signAccessToken({ userId, tenantId, roles: roleKeys });
    const refreshToken = await this.tokenService.signRefreshToken({ userId, sessionId: session.id });
    const refreshHash = this.tokenService.hashRefreshToken(refreshToken);

    await this.authRepository.rotateSessionRefreshHash(session.id, refreshHash, this.refreshExpiryDate());

    return { accessToken, refreshToken, csrfToken: generateCsrfToken() };
  }

  private refreshExpiryDate(): Date {
    return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7d, matches JWT_REFRESH_TTL default.
  }

  /**
   * First-login / self-service password change (lifecycle-redesign P3). AUTHENTICATED:
   * the caller proves the CURRENT password (the system-issued temporary one on first
   * login, or any current password later), then sets a new one. On success the
   * `must_change_password` gate is cleared and ALL of the user's sessions are revoked
   * (mirrors the password-reset posture — a credential change should not leave any old
   * session alive), so the client re-authenticates with the new password and lands in
   * the LMS ungated.
   *
   * A wrong current password, a missing/blank stored hash, or an inactive account all
   * return the SAME 422 — never disclose which. A dummy-hash verify pads the timing when
   * there is no real hash to compare, matching login()'s constant-time posture.
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<ChangePasswordResponse> {
    const user = await this.authRepository.findUserById(userId);
    const hashToVerify = user?.passwordHash ? user.passwordHash : DUMMY_PASSWORD_HASH;
    const currentValid = await argon2.verify(hashToVerify, currentPassword).catch(() => false);

    if (!user || !user.passwordHash || !currentValid || user.status === "deactivated" || user.status === "suspended") {
      throw new UnprocessableEntityException({
        code: "auth.current_password_invalid",
        title: "Current password is incorrect",
        detail: "The current password you entered does not match our records.",
      });
    }

    if (newPassword === currentPassword) {
      throw new UnprocessableEntityException({
        code: "auth.password_unchanged",
        title: "Choose a different password",
        detail: "Your new password must be different from your current password.",
      });
    }

    const passwordHash = await argon2.hash(newPassword, ARGON2_HASH_OPTIONS);
    await this.authRepository.setPasswordAndClearMustChange(userId, passwordHash);
    await this.authRepository.revokeAllSessionsForUser(userId);

    return { changed: true };
  }

  private toUserSummary(user: {
    id: string;
    email: string;
    phone: string | null;
    name: string;
    avatar: string | null;
    status: string;
    // Optional so narrowed fetches that never set a temp password (staff/OTP paths)
    // don't have to select it — absent means "no forced change" (lifecycle-redesign P3).
    mustChangePassword?: boolean;
  }): UserSummary {
    return {
      id: user.id,
      email: user.email,
      phone: user.phone,
      name: user.name,
      avatar: user.avatar,
      status: user.status as UserSummary["status"],
      mustChangePassword: user.mustChangePassword ?? false,
    };
  }
}
