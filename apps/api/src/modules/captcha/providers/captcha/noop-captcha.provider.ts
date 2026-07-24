// apps/api/src/modules/captcha/providers/captcha/noop-captcha.provider.ts
//
// Test / sandbox double for CaptchaProvider. Used in unit tests, integration
// tests, and local dev environments where no real captcha vendor is configured.
// Selected automatically when CAPTCHA_PROVIDER=noop or unset in non-production.
//
// This class is NEVER bound in production when CAPTCHA_SECRET_KEY is present.
// When CAPTCHA_PROVIDER=noop and NODE_ENV=production, the factory binds
// FailClosedCaptchaProvider instead (see captcha-provider.module.ts).
//
// ─── BEHAVIOUR ───────────────────────────────────────────────────────────────
//
//   verify(token, remoteIp?):
//     Always returns { success: true } without any network call.
//     This makes ALL captcha-gated endpoints pass during local dev + CI.
//     NO network call is made. This is correct and intentional — the captcha
//     challenge widget is not rendered in test mode.
//
// ─── SECURITY NOTE ───────────────────────────────────────────────────────────
//
//   This provider MUST NEVER be used in production with real user traffic.
//   The CaptchaProviderModule factory enforces this: in production
//   (NODE_ENV=production or APP_ENV=production) with no CAPTCHA_SECRET_KEY,
//   the factory binds FailClosedCaptchaProvider, not NoopCaptchaProvider.
//
//   For test wiring:
//     const noop = new NoopCaptchaProvider();
//     const module = await Test.createTestingModule({
//       providers: [
//         MyPublicService,
//         { provide: CAPTCHA_PROVIDER, useValue: noop },
//       ],
//     }).compile();

import { Injectable, Logger } from "@nestjs/common";
import type { CaptchaProvider, CaptchaVerifyResult } from "./captcha-provider.interface";

@Injectable()
export class NoopCaptchaProvider implements CaptchaProvider {
  private readonly logger = new Logger(NoopCaptchaProvider.name);

  constructor() {
    this.logger.warn(
      "[NoopCaptchaProvider] Running with the no-op/test captcha provider. " +
        "ALL captcha tokens are accepted unconditionally (no network call). " +
        "Do NOT use this in production. Set CAPTCHA_PROVIDER=turnstile with " +
        "CAPTCHA_SECRET_KEY for staging/prod.",
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async verify(_token: string, _remoteIp?: string): Promise<CaptchaVerifyResult> {
    // Always succeeds — no network, no SDK, deterministic.
    return { success: true };
  }
}
