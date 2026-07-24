// apps/api/src/modules/auth/password-reset.controller.ts
//
// HTTP boundary only (CLAUDE.md §3.3). UNAUTHENTICATED (T28 / B9,
// docs/plans/phase-9-completion.md) — no session exists yet for either endpoint. NO
// @UseGuards(JwtAuthGuard) (codebase convention: public endpoints use a separate
// controller class with no guards, not a decorator). CSRF-excluded in app.module.ts
// (same posture as public/register — no browser session/CSRF cookie exists yet).

import { Body, Controller, HttpCode, Post, UseGuards, UsePipes } from "@nestjs/common";
import {
  RequestPasswordResetRequestSchema,
  type RequestPasswordResetRequest,
  type RequestPasswordResetResponse,
  ConfirmPasswordResetRequestSchema,
  type ConfirmPasswordResetRequest,
  type ConfirmPasswordResetResponse,
} from "@repo/types";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { PasswordResetService } from "./password-reset.service";
import { AuthIpRateLimitGuard } from "./guards/auth-ip-rate-limit.guard";

// SECURITY (Wave 6 L1): both routes are UNAUTHENTICATED. `request` is an email-enumeration
// / mail-bomb surface and `confirm` is a token-guessing surface — the IP-dimension limiter
// (fail-closed, per-handler bucket: auth:ip-rl:request:<ip> / auth:ip-rl:confirm:<ip>)
// throttles a single source hammering either regardless of which email/token it targets.
@Controller("auth/password-reset")
@UseGuards(AuthIpRateLimitGuard)
export class PasswordResetController {
  constructor(private readonly service: PasswordResetService) {}

  @Post("request")
  @HttpCode(200)
  @UsePipes(new ZodValidationPipe(RequestPasswordResetRequestSchema))
  async request(@Body() body: RequestPasswordResetRequest): Promise<RequestPasswordResetResponse> {
    return this.service.request(body.email, body.audience);
  }

  @Post("confirm")
  @HttpCode(200)
  @UsePipes(new ZodValidationPipe(ConfirmPasswordResetRequestSchema))
  async confirm(@Body() body: ConfirmPasswordResetRequest): Promise<ConfirmPasswordResetResponse> {
    return this.service.confirm(body.token, body.newPassword);
  }
}
