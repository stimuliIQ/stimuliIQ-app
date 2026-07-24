// apps/api/src/modules/captcha/providers/captcha/turnstile-captcha.provider.ts
//
// Cloudflare Turnstile adapter for CaptchaProvider.
//
// Cloudflare Turnstile is a privacy-friendly, free CAPTCHA alternative that
// pairs well with Cloudflare Pages hosting. Server-side verification is a
// plain HTTPS POST to Cloudflare's siteverify endpoint — NO SDK required.
// This adapter uses global `fetch` (available in Node ≥ 18) so zero new
// production dependencies are introduced.
//
// ─── HOW TURNSTILE SERVER-SIDE VERIFICATION WORKS ────────────────────────────
//
//   POST https://challenges.cloudflare.com/turnstile/v0/siteverify
//   Content-Type: application/x-www-form-urlencoded
//
//   Body parameters:
//     secret    — the SERVER-ONLY secret key (CAPTCHA_SECRET_KEY env var)
//     response  — the token from the client widget (cf-turnstile-response field)
//     remoteip  — (optional) end-user IP; improves Turnstile's risk scoring
//
//   Response JSON shape (Cloudflare Turnstile v0):
//     { success: boolean; error-codes?: string[]; challenge_ts?: string;
//       hostname?: string; ... }
//
//   Reference: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
//
// ─── SECURITY CONTRACT ────────────────────────────────────────────────────────
//
// 1. CAPTCHA_SECRET_KEY is consumed ONLY inside this adapter. It MUST NEVER
//    appear in any return value, log line, error message, or thrown string.
//    The key is read once at verify() call time from the validated env.
//
// 2. FAIL CLOSED:
//      - If CAPTCHA_SECRET_KEY is absent at call time → return { success: false }.
//      - If the network request fails (DNS, timeout, TLS error) → return
//        { success: false } with errorCodes: ["network-error"]. Never silently
//        pass on network failure. Log the error class (not the body) at warn.
//      - If the Cloudflare response cannot be parsed → { success: false }.
//      - If Cloudflare explicitly returns { success: false } → propagate
//        { success: false, errorCodes }.
//
// 3. The constructor MUST NOT throw (lazy validation — ADR-0023, DEFECT-1
//    lesson). validateEnv() is called at verify() time, not at construction.
//
// 4. CAPTCHA_SITE_KEY (the public key) is NOT consumed here — it is forwarded
//    to the client by the public env config (apps/web) so the browser widget
//    can render. Never confuse site key (public) with secret key (server-only).
//
// References:
//   docs/plans/phase-5.md §3 task #3, §5, §6 Risk #4, §7
//   https://developers.cloudflare.com/turnstile/get-started/server-side-validation/

import { Injectable, Logger } from "@nestjs/common";
import { validateEnv } from "../../../../config/env";
import type { CaptchaProvider, CaptchaVerifyResult } from "./captcha-provider.interface";

/** Cloudflare Turnstile siteverify endpoint (stable v0 URL). */
const TURNSTILE_SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Timeout for the Turnstile siteverify HTTP request in milliseconds. */
const TURNSTILE_REQUEST_TIMEOUT_MS = 5_000;

/**
 * Shape of the Cloudflare Turnstile siteverify JSON response.
 * Only the fields we consume are typed; extras are ignored.
 */
interface TurnstileSiteverifyResponse {
  success: boolean;
  "error-codes"?: string[];
}

@Injectable()
export class TurnstileCaptchaProvider implements CaptchaProvider {
  private readonly logger = new Logger(TurnstileCaptchaProvider.name);

  constructor() {
    // Intentionally empty — lazy credential validation (DEFECT-1 / ADR-0023).
    // Do NOT call validateEnv() here; the app must boot cleanly without captcha keys.
    this.logger.log(
      "[TurnstileCaptchaProvider] Turnstile adapter constructed. " +
        "CAPTCHA_SECRET_KEY will be validated at verify() call time.",
    );
  }

  async verify(token: string, remoteIp?: string): Promise<CaptchaVerifyResult> {
    // ── 1. Lazy credential resolution ────────────────────────────────────────
    //
    // Read the secret key from the validated env at call time (not at construction).
    // If the key is absent, fail closed immediately — no network call, no leak.
    const env = validateEnv();
    const secretKey = env.CAPTCHA_SECRET_KEY;

    if (!secretKey) {
      this.logger.warn(
        "[TurnstileCaptchaProvider] verify() called but CAPTCHA_SECRET_KEY is not set. " +
          "Returning { success: false } (fail-closed). " +
          "Set CAPTCHA_SECRET_KEY to enable Turnstile verification.",
      );
      return { success: false, errorCodes: ["missing-input-secret"] };
    }

    // ── 2. Build the siteverify request body ─────────────────────────────────
    //
    // SECURITY: secretKey is only placed in the request body (server-to-server).
    // It MUST NOT be logged, returned, or included in any error message.
    const body = new URLSearchParams({
      secret: secretKey,   // SERVER-ONLY: never log this
      response: token,
    });

    if (remoteIp) {
      body.set("remoteip", remoteIp);
    }

    // ── 3. Send siteverify request with a timeout ─────────────────────────────
    let raw: TurnstileSiteverifyResponse;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        TURNSTILE_REQUEST_TIMEOUT_MS,
      );

      let response: Response;
      try {
        response = await fetch(TURNSTILE_SITEVERIFY_URL, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: body.toString(),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!response.ok) {
        // HTTP-level failure (4xx/5xx from Cloudflare) — fail closed.
        this.logger.warn(
          `[TurnstileCaptchaProvider] Turnstile siteverify returned HTTP ${response.status}. ` +
            "Failing closed.",
        );
        return { success: false, errorCodes: ["network-error"] };
      }

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      raw = await response.json() as TurnstileSiteverifyResponse;
    } catch (err: unknown) {
      // Network error, timeout, or JSON parse failure — fail closed.
      const errMsg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `[TurnstileCaptchaProvider] Turnstile siteverify failed: ${errMsg}. Failing closed.`,
      );
      return { success: false, errorCodes: ["network-error"] };
    }

    // ── 4. Normalise the response ─────────────────────────────────────────────
    //
    // Map Cloudflare's `error-codes` (hyphenated key) to our camelCase shape.
    // Never log the raw response — it may contain the hostname or other metadata
    // that reveals internal infrastructure.
    return {
      success: raw.success === true,
      errorCodes: raw["error-codes"],
    };
  }
}
