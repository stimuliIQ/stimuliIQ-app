// apps/api/src/modules/auth/auth.controller.ts
//
// HTTP boundary only (docs/04-trd-architecture.md §2.1: "controller — validates DTO,
// maps to service, returns DTO"). No business logic, no Prisma — every method is a thin
// translation between Express req/res (cookies) and AuthService calls. Validation is via
// the global ZodValidationPipe against schemas re-exported from @repo/types (dto/index.ts).

import { Body, Controller, HttpCode, Post, Req, Res, UnauthorizedException, UseGuards, UsePipes } from "@nestjs/common";
import type { Request, Response } from "express";
import type { AuthSessionData, ChangePasswordResponse, LogoutData, OtpRequestData } from "@repo/types";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { AuthService } from "./auth.service";
import {
  LoginRequestSchema,
  type LoginRequest,
  RefreshRequestSchema,
  LogoutRequestSchema,
  OtpRequestRequestSchema,
  type OtpRequestRequest,
  OtpVerifyRequestSchema,
  type OtpVerifyRequest,
  ChangePasswordRequestSchema,
  type ChangePasswordRequest,
} from "./dto";
import { setAuthCookies, clearAuthCookies, readAudienceHeader, resolveRefreshTokenCookie } from "./lib/cookies";
import { AuthIpRateLimitGuard } from "./guards/auth-ip-rate-limit.guard";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { CurrentUser } from "./decorators/current-user.decorator";
import type { RequestUser } from "./lib/request-user";
import { SkipPasswordGate } from "./decorators/skip-password-gate.decorator";

function requestMeta(req: Request): { device?: string; ip?: string } {
  return { device: req.header("user-agent"), ip: req.ip };
}

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("login")
  @HttpCode(200)
  @UseGuards(AuthIpRateLimitGuard)
  @UsePipes(new ZodValidationPipe(LoginRequestSchema))
  async login(@Body() body: LoginRequest, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<AuthSessionData> {
    // T28 (2FA, docs/plans/phase-9-completion.md): gate admin login server-side when
    // 2FA is enrolled — a session is NEVER issued for a 2FA-enrolled user from this
    // route; the client must complete POST /auth/2fa/login-verify instead. Password is
    // verified here FIRST (enumeration-resistant, identical comparison to login()
    // itself) so a wrong password always yields the SAME generic "invalid_credentials"
    // regardless of whether the account has 2FA enrolled — only a CORRECT password
    // reveals the 2FA requirement.
    const check = await this.authService.verifyCredentialsOnly(body.email, body.password);
    if (!check) {
      throw new UnauthorizedException({ code: "auth.invalid_credentials", title: "Invalid email or password" });
    }
    if (check.twoFaEnabled) {
      throw new UnauthorizedException({
        code: "auth.2fa_required",
        title: "Two-factor authentication required",
        detail: "Submit your TOTP or backup code via POST /auth/2fa/login-verify.",
      });
    }

    const { session, tokens } = await this.authService.login(body.email, body.password, requestMeta(req), body.audience);
    // Audience-scoped cookie slot (cookies.ts header) — a CRM login and an LMS login
    // can now coexist in the same browser without overwriting each other's session.
    setAuthCookies(res, tokens, body.audience);
    return session;
  }

  @Post("refresh")
  @HttpCode(200)
  // T5/R6 (docs/plans/phase-9-completion.md): refresh does a DB lookup + rotates the
  // refresh token on every call — previously only login + otp were IP-rate-limited,
  // leaving /auth/refresh as an unthrottled DB-hitting endpoint any client could hammer.
  @UseGuards(AuthIpRateLimitGuard)
  // Refresh reads the refresh-token cookie, not the access token — it doesn't run
  // JwtAuthGuard, so `req.user` here is whatever AuditContextMiddleware could resolve
  // from a still-present (possibly stale) access_token cookie, which may or may not
  // exist. Exempted anyway as a no-op safety net: a `mustChangePassword: true` session
  // must always be able to refresh (gap-closing pass).
  @SkipPasswordGate()
  @UsePipes(new ZodValidationPipe(RefreshRequestSchema))
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<AuthSessionData> {
    // Read the refresh token from the requesting app's cookie slot (X-App-Audience
    // header; legacy fallback for header-less callers) and re-set the SAME slot.
    const { token: presented, audience } = resolveRefreshTokenCookie(
      req.cookies as Record<string, string> | undefined,
      readAudienceHeader(req),
    );
    const { session, tokens } = await this.authService.refresh(presented, requestMeta(req));
    setAuthCookies(res, tokens, audience);
    return session;
  }

  @Post("logout")
  @HttpCode(200)
  // A `mustChangePassword: true` session must always be able to end its own session
  // (gap-closing pass).
  @SkipPasswordGate()
  @UsePipes(new ZodValidationPipe(LogoutRequestSchema))
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<LogoutData> {
    // Revoke + clear ONLY the requesting app's session slot — signing out of the CRM
    // must not sign the same browser out of the LMS (and vice-versa).
    const { token: presented, audience } = resolveRefreshTokenCookie(
      req.cookies as Record<string, string> | undefined,
      readAudienceHeader(req),
    );
    await this.authService.logout(presented);
    clearAuthCookies(res, audience);
    return { loggedOut: true };
  }

  @Post("otp/request")
  @HttpCode(200)
  @UseGuards(AuthIpRateLimitGuard)
  @UsePipes(new ZodValidationPipe(OtpRequestRequestSchema))
  async requestOtp(@Body() body: OtpRequestRequest): Promise<OtpRequestData> {
    return this.authService.requestOtp(body.phone);
  }

  @Post("otp/verify")
  @HttpCode(200)
  @UseGuards(AuthIpRateLimitGuard)
  @UsePipes(new ZodValidationPipe(OtpVerifyRequestSchema))
  async verifyOtp(
    @Body() body: OtpVerifyRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSessionData> {
    const { session, tokens } = await this.authService.verifyOtp(body.phone, body.code, requestMeta(req), body.audience);
    setAuthCookies(res, tokens, body.audience);
    return session;
  }

  /**
   * POST /auth/change-password (lifecycle-redesign P3 — first-login flow).
   * AUTHENTICATED (JwtAuthGuard) + CSRF-protected like any other session-bearing POST.
   * On success the service revokes ALL of the user's sessions, so we clear this session's
   * cookies too — the client then re-logs-in with the new password and, with the
   * `must_change_password` gate now cleared, is admitted to the LMS.
   */
  @Post("change-password")
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  // This IS the route that clears the gate — a `mustChangePassword: true` session must
  // be able to call it (gap-closing pass; see MustChangePasswordGuard).
  @SkipPasswordGate()
  @UsePipes(new ZodValidationPipe(ChangePasswordRequestSchema))
  async changePassword(
    @Body() body: ChangePasswordRequest,
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ChangePasswordResponse> {
    const result = await this.authService.changePassword(user.id, body.currentPassword, body.newPassword);
    clearAuthCookies(res, readAudienceHeader(req));
    return result;
  }
}
