// apps/api/src/modules/auth/two-factor.controller.ts
//
// HTTP boundary only (CLAUDE.md §3.3). Two controller classes:
//   TwoFactorController     — own-scope enrol/verify/disable/status (/auth/2fa/*),
//     JwtAuthGuard + PermissionsGuard (twofa.manage, own scope — every role holds this,
//     per prisma/seed.ts's P9 grants).
//   TwoFactorLoginController — UNAUTHENTICATED (/auth/2fa/login-verify), the second step
//     of the two-step login flow for 2FA-enrolled accounts (see auth.controller.ts's
//     login() gate). Rate-limited via the SAME AuthIpRateLimitGuard bucket pattern as
//     /auth/login.

import { Body, Controller, Get, HttpCode, Post, Req, Res, UnauthorizedException, UseGuards, UseInterceptors, UsePipes } from "@nestjs/common";
import type { Request, Response } from "express";
import type { AuthSessionData } from "@repo/types";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { PermissionsGuard } from "./guards/permissions.guard";
import { ScopeInterceptor } from "./interceptors/scope.interceptor";
import { RequirePermission } from "./decorators/require-permission.decorator";
import { CurrentUser } from "./decorators/current-user.decorator";
import type { RequestUser } from "./lib/request-user";
import { AuthIpRateLimitGuard } from "./guards/auth-ip-rate-limit.guard";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { AuthService } from "./auth.service";
import { TwoFactorService } from "./two-factor.service";
import { setAuthCookies } from "./lib/cookies";
import {
  TotpVerifyEnrollRequestSchema,
  type TotpVerifyEnrollRequest,
  type TotpVerifyEnrollResponse,
  TotpDisableRequestSchema,
  type TotpDisableRequest,
  type TotpEnrollResponse,
  type TotpStatusResponse,
  TwoFactorLoginVerifyRequestSchema,
  type TwoFactorLoginVerifyRequest,
} from "./dto/two-factor.schemas";

function requestMeta(req: Request): { device?: string; ip?: string } {
  return { device: req.header("user-agent"), ip: req.ip };
}

@Controller("auth/2fa")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ScopeInterceptor)
export class TwoFactorController {
  constructor(private readonly twoFactor: TwoFactorService) {}

  @Get("status")
  @RequirePermission("twofa.manage")
  async status(@CurrentUser() user: RequestUser): Promise<TotpStatusResponse> {
    return this.twoFactor.status(user.id);
  }

  @Post("enroll")
  @HttpCode(200)
  @RequirePermission("twofa.manage")
  async enroll(@CurrentUser() user: RequestUser): Promise<TotpEnrollResponse> {
    return this.twoFactor.enroll(user.id);
  }

  @Post("enroll/verify")
  @HttpCode(200)
  @RequirePermission("twofa.manage")
  async verifyEnroll(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(TotpVerifyEnrollRequestSchema)) body: TotpVerifyEnrollRequest,
  ): Promise<TotpVerifyEnrollResponse> {
    return this.twoFactor.verifyEnroll(user.id, body.code);
  }

  @Post("disable")
  @HttpCode(200)
  @RequirePermission("twofa.manage")
  async disable(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(TotpDisableRequestSchema)) body: TotpDisableRequest,
  ): Promise<{ disabled: true }> {
    return this.twoFactor.disable(user.id, body.code);
  }
}

/**
 * UNAUTHENTICATED — no @UseGuards(JwtAuthGuard) (codebase convention: public endpoints
 * use a SEPARATE controller class with no guards, not a decorator — matches
 * commerce.controller.ts's WebhookController / content-intake.controller.ts's
 * PublicContentIntakeController precedent). Credentials are re-verified inside this
 * request (AuthService.verifyCredentialsOnly + AuthService.login) — no session exists
 * yet, so ScopeInterceptor/PermissionsGuard do not apply here.
 */
@Controller("auth/2fa")
export class TwoFactorLoginController {
  constructor(
    private readonly authService: AuthService,
    private readonly twoFactor: TwoFactorService,
  ) {}

  @Post("login-verify")
  @HttpCode(200)
  @UseGuards(AuthIpRateLimitGuard)
  @UsePipes(new ZodValidationPipe(TwoFactorLoginVerifyRequestSchema))
  async loginVerify(
    @Body() body: TwoFactorLoginVerifyRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSessionData> {
    const check = await this.authService.verifyCredentialsOnly(body.email, body.password);
    if (!check) {
      throw new UnauthorizedException({ code: "auth.invalid_credentials", title: "Invalid email or password" });
    }
    if (!check.twoFaEnabled) {
      throw new UnauthorizedException({
        code: "auth.2fa_not_enabled",
        title: "Two-factor authentication is not enabled for this account",
        detail: "Use POST /auth/login instead.",
      });
    }

    const codeValid = await this.twoFactor.verifyCode(check.id, body.code);
    if (!codeValid) {
      throw new UnauthorizedException({ code: "TOTP_CODE_INVALID", title: "Invalid two-factor code" });
    }

    const { session, tokens } = await this.authService.login(body.email, body.password, requestMeta(req), body.audience);
    setAuthCookies(res, tokens, body.audience);
    return session;
  }
}
