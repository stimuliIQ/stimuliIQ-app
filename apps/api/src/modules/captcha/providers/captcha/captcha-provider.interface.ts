// apps/api/src/modules/captcha/providers/captcha/captcha-provider.interface.ts
//
// Vendor-swappable captcha/bot-protection provider interface (CLAUDE.md §3.7,
// docs/04-trd-architecture.md §2.10, docs/plans/phase-5.md §3 task #3).
//
// Public write endpoints (leads, bookings, register, coupon-validate, enroll)
// depend ONLY on this interface via the CAPTCHA_PROVIDER DI token. Swapping
// hCaptcha → Cloudflare Turnstile (or any future provider) means changing one
// env var and one adapter — every consumer is unaffected.
//
// ─── SECURITY CONTRACT ───────────────────────────────────────────────────────
//
// 1. verify() is the ONLY method. It takes the client-supplied captcha token
//    (from the browser widget) and the optional remote IP, and returns
//    { success: boolean; errorCodes?: string[] }.
//
// 2. FAIL CLOSED — the adapter whose verify() is called must NEVER silently
//    pass when unconfigured in production:
//      a) If CAPTCHA_SECRET_KEY is absent in production, the factory MUST NOT
//         bind the Noop (silently-passing) adapter. Instead it binds a
//         FailClosedCaptchaProvider whose verify() returns { success: false }
//         and logs a boot warning. The request chain then returns 422.
//      b) The TurnstileCaptchaProvider validates CAPTCHA_SECRET_KEY lazily
//         (at call time, not at construction) and returns { success: false }
//         if the key is absent when called.
//
// 3. The CAPTCHA_SECRET_KEY is SERVER-ONLY. It MUST NEVER appear in:
//      - any return value of verify()
//      - any log line (not even at debug level)
//      - any error message thrown or returned
//      - the client bundle (that is the CAPTCHA_SITE_KEY's job — it's public)
//
// 4. The constructor MUST NOT throw when keys are absent (lazy validation;
//    ADR-0023, DEFECT-1 lesson). The app boots with CAPTCHA_PROVIDER=noop and
//    no captcha keys configured.
//
// 5. errorCodes is an allow-listed set from the provider (e.g. Turnstile returns
//    strings like "missing-input-secret", "invalid-input-response"). Never log
//    the raw errorCodes in prod — they can leak internal config state.
//    (They are safe to return to the caller for structured error handling; the
//    caller is responsible for not leaking them further to the client.)
//
// References:
//   docs/plans/phase-5.md §3 task #3, §5, §6 Risk #4, §7
//   docs/04-trd-architecture.md §2.10 (provider table), §2.12

// ─────────────────────────────────────────────────────────────────────────────
// Input / output shapes
// ─────────────────────────────────────────────────────────────────────────────

export interface CaptchaVerifyResult {
  /**
   * Whether the captcha challenge was solved successfully.
   *
   * true  → the token is valid; allow the request.
   * false → the token is invalid, expired, or absent; reject the request (422).
   *
   * SECURITY: this is the ONLY value that should influence the authz decision.
   * Never trust the raw provider response beyond what is normalised here.
   */
  success: boolean;

  /**
   * Provider-specific error codes when success=false.
   *
   * Cloudflare Turnstile examples:
   *   "missing-input-secret"  — secret key absent (should never happen if fail-closed)
   *   "invalid-input-secret"  — secret key is malformed
   *   "missing-input-response" — client did not supply a token
   *   "invalid-input-response" — token is invalid or expired
   *   "timeout-or-duplicate"  — token already used or timed out
   *
   * These are safe to propagate to the service layer for structured logging
   * (at warn level, never debug, never including the secret) but MUST NOT be
   * forwarded verbatim to the HTTP response (use a generic 422 body instead).
   */
  errorCodes?: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider interface
// ─────────────────────────────────────────────────────────────────────────────

export interface CaptchaProvider {
  /**
   * Verifies a captcha token supplied by the browser widget.
   *
   * Called server-side on every public write endpoint before any DB work.
   *
   * @param token     The captcha response token from the client (from the
   *                  widget's callback or a hidden `cf-turnstile-response`
   *                  field). This is the SHORT-LIVED, single-use token
   *                  produced by the browser widget.
   * @param remoteIp  The end-user's IP address (optional; recommended for
   *                  Turnstile's server-side risk scoring). Never trust
   *                  X-Forwarded-For headers directly — only use the value
   *                  already resolved by the trust-proxy middleware.
   *
   * @returns { success, errorCodes? }
   *
   * FAIL CLOSED: implementations MUST return { success: false } (not throw)
   * when credentials are absent or the provider is unreachable. The service
   * layer maps success=false → HTTP 422 Unprocessable Entity with a generic
   * message; the errorCodes are logged at warn level only.
   *
   * The constructor MUST NOT throw. This method may throw only on unexpected
   * programming errors (e.g. the fetch library itself panics), in which case
   * the service layer catches and maps to 503.
   */
  verify(token: string, remoteIp?: string): Promise<CaptchaVerifyResult>;
}

// ─────────────────────────────────────────────────────────────────────────────
// DI token
// ─────────────────────────────────────────────────────────────────────────────

/**
 * NestJS DI injection token for the CaptchaProvider.
 *
 * Public write modules (leads, bookings, registration, enroll funnel) import
 * CaptchaProviderModule and inject this token — NEVER import
 * TurnstileCaptchaProvider or any concrete class from a feature module.
 *
 * CaptchaProviderModule binds this token to the adapter selected by the
 * CAPTCHA_PROVIDER env variable (with fail-closed production logic).
 *
 * Usage in a public write module:
 *
 *   // public-leads.module.ts
 *   import { CaptchaProviderModule }
 *     from '../captcha/providers/captcha/captcha-provider.module';
 *
 *   @Module({ imports: [CaptchaProviderModule, ...], ... })
 *   export class PublicLeadsModule {}
 *
 *   // public-leads.service.ts
 *   import { Inject } from '@nestjs/common';
 *   import { CAPTCHA_PROVIDER, CaptchaProvider }
 *     from '../captcha/providers/captcha/captcha-provider.interface';
 *
 *   @Injectable()
 *   export class PublicLeadsService {
 *     constructor(
 *       @Inject(CAPTCHA_PROVIDER) private readonly captcha: CaptchaProvider,
 *     ) {}
 *
 *     async createLead(dto: PublicLeadCaptureDto, ip?: string): Promise<void> {
 *       const { success } = await this.captcha.verify(dto.captchaToken, ip);
 *       if (!success) throw new UnprocessableEntityException('Captcha verification failed');
 *       // ... proceed with DB write
 *     }
 *   }
 *
 * Test wiring (unit tests — bind Noop directly):
 *
 *   const noop = new NoopCaptchaProvider();
 *   const module = await Test.createTestingModule({
 *     providers: [
 *       PublicLeadsService,
 *       { provide: CAPTCHA_PROVIDER, useValue: noop },
 *     ],
 *   }).compile();
 */
export const CAPTCHA_PROVIDER = Symbol("CAPTCHA_PROVIDER");
