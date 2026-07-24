// apps/api/src/modules/captcha/providers/captcha/fail-closed-captcha.provider.ts
//
// Fail-closed sentinel provider — bound when the app is running in production
// but CAPTCHA_SECRET_KEY is not configured.
//
// Purpose: prevent a misconfigured production environment from silently
// accepting all captcha tokens (which would be the effect of using the Noop
// in production). Instead, this adapter returns { success: false } for every
// verify() call and logs a boot-time warning so the operator knows to
// configure the key.
//
// This is NOT a Noop (which always returns success=true). It is the inverse:
// every request that reaches a captcha-gated endpoint will be rejected (422)
// until the real CAPTCHA_SECRET_KEY is supplied and the app reboots.
//
// ─── WHEN THIS IS BOUND ──────────────────────────────────────────────────────
//
//   NODE_ENV=production (or APP_ENV=production) AND CAPTCHA_SECRET_KEY is
//   absent. The factory in captcha-provider.module.ts handles this logic.
//
// ─── OPERATOR REMEDIATION ────────────────────────────────────────────────────
//
//   1. Obtain a Turnstile secret key from the Cloudflare dashboard
//      (dash.cloudflare.com → Turnstile → your site → Secret Key).
//   2. Set CAPTCHA_SECRET_KEY in the deployment environment.
//   3. Redeploy / restart the application.
//   4. Set CAPTCHA_PROVIDER=turnstile.

import { Injectable, Logger } from "@nestjs/common";
import type { CaptchaProvider, CaptchaVerifyResult } from "./captcha-provider.interface";

@Injectable()
export class FailClosedCaptchaProvider implements CaptchaProvider {
  private readonly logger = new Logger(FailClosedCaptchaProvider.name);

  constructor() {
    this.logger.error(
      "[FailClosedCaptchaProvider] PRODUCTION MISCONFIGURATION: " +
        "CAPTCHA_SECRET_KEY is not set but NODE_ENV/APP_ENV is production. " +
        "All captcha-gated public writes will be REJECTED (HTTP 422) until " +
        "CAPTCHA_SECRET_KEY is configured and the application is restarted. " +
        "To fix: set CAPTCHA_PROVIDER=turnstile and CAPTCHA_SECRET_KEY in " +
        "your production environment variables, then redeploy.",
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async verify(_token: string, _remoteIp?: string): Promise<CaptchaVerifyResult> {
    // Fail closed: always deny. No network call, no logging of the token.
    return {
      success: false,
      errorCodes: ["captcha-provider-not-configured"],
    };
  }
}
