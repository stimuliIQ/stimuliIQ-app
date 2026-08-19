// apps/api/src/modules/auth/two-factor-recovery.controller.ts
//
// HTTP boundary only (CLAUDE.md §3.3). UNAUTHENTICATED — no session exists for either
// route (the caller is, by definition, someone who cannot complete a login). Follows the
// codebase convention for public endpoints: a SEPARATE controller class with no
// JwtAuthGuard, rather than a decorator on a guarded one (see PasswordResetController /
// TwoFactorLoginController). CSRF-excluded in app.module.ts for the same reason those
// two are — there is no browser session cookie to protect yet.
//
// SECURITY: both routes carry the IP-dimension limiter on top of the per-email limiter
// inside the service. `request` is a mail-bomb + enumeration surface and `confirm` is a
// code-guessing surface, so a single source hammering either — across many different
// email addresses, which the per-email bucket would never see — is throttled here.

import { Body, Controller, HttpCode, Post, Req, UseGuards, UsePipes } from "@nestjs/common";
import type { Request } from "express";
import {
  TwoFactorRecoveryRequestSchema,
  type TwoFactorRecoveryRequest,
  type TwoFactorRecoveryRequestResponse,
  TwoFactorRecoveryConfirmSchema,
  type TwoFactorRecoveryConfirm,
  type TwoFactorRecoveryConfirmResponse,
} from "@repo/types";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { AuthIpRateLimitGuard } from "./guards/auth-ip-rate-limit.guard";
import { TwoFactorRecoveryService } from "./two-factor-recovery.service";
import { SkipPasswordGate } from "./decorators/skip-password-gate.decorator";

// @SkipPasswordGate(): both routes authenticate from the BODY (email + password), never
// from `req.user`. The global MustChangePasswordGuard reads `req.user` on every route
// though, so a leftover session cookie for a `mustChangePassword: true` account 403'd the
// whole recovery flow — the same defect as PasswordResetController (see its header).
@Controller("auth/2fa/recovery")
@UseGuards(AuthIpRateLimitGuard)
@SkipPasswordGate()
export class TwoFactorRecoveryController {
  constructor(private readonly service: TwoFactorRecoveryService) {}

  @Post("request")
  @HttpCode(200)
  @UsePipes(new ZodValidationPipe(TwoFactorRecoveryRequestSchema))
  async request(@Body() body: TwoFactorRecoveryRequest): Promise<TwoFactorRecoveryRequestResponse> {
    return this.service.request(body.email, body.password, body.audience);
  }

  @Post("confirm")
  @HttpCode(200)
  @UsePipes(new ZodValidationPipe(TwoFactorRecoveryConfirmSchema))
  async confirm(
    @Body() body: TwoFactorRecoveryConfirm,
    @Req() req: Request,
  ): Promise<TwoFactorRecoveryConfirmResponse> {
    return this.service.confirm(body.email, body.password, body.code, { ip: req.ip });
  }
}
