// apps/api/src/modules/captcha/providers/captcha/replay-tolerant-captcha.provider.ts
//
// A CaptchaProvider DECORATOR that makes one solved challenge cover one form
// submission, even when that submission takes more than one HTTP call.
//
// ─── THE DEFECT THIS FIXES ────────────────────────────────────────────────────
//
// A Turnstile token is SINGLE-USE: Cloudflare redeems it on the first
// /siteverify call and answers `timeout-or-duplicate` to every later one. Two of
// our public forms spend one token on two captcha-gated endpoints:
//
//   /onboarding  → POST public/onboarding/upload-url   (mint the signed PUT for
//                     the payment receipt)  ... then ...
//                  POST public/onboarding/submit
//   /careers     → POST public/careers/resume-upload-url ... then ...
//                  POST public/careers/apply
//
// So any student who attached a file burned the token on the upload and could
// then NEVER submit. The widget still read "Success!" — it has no idea its token
// was spent — and the form said "Please complete the captcha challenge and try
// again", which the visitor cannot act on: pressing Submit again resends the
// same dead token. A permanent dead end on the form every paying student fills
// in, visible in production as repeated `timeout-or-duplicate` warnings.
//
// ─── THE FIX ──────────────────────────────────────────────────────────────────
//
// Remember, briefly, that a given token ALREADY verified successfully, and let
// the same token pass again within that window without re-asking Cloudflare.
// Deliberately done HERE, wrapping the adapter behind the existing
// CAPTCHA_PROVIDER token, rather than in each service: every consumer
// (onboarding, careers, leads, bookings, referrals, funnel) gets it unchanged,
// and the vendor adapters stay pure vendor calls.
//
// The alternative — resetting the browser widget after every consuming call —
// was rejected: it races the Submit button (a reset mints the next token
// asynchronously, so there is a window with no token at all) and it degrades
// as soon as a form has more than one file question, which onboarding's
// CRM-authored field list can grow at any time with no deploy.
//
// ─── WHY THIS IS SAFE ─────────────────────────────────────────────────────────
//
// It trades "exactly once" for "once per short window, from one IP", which is
// what the control was actually protecting:
//
//   * Only SUCCESSFUL verifications are remembered. A token Cloudflare rejects
//     is never cached, so this can never turn a failure into a pass.
//   * The cache entry is BOUND TO THE IP that first presented the token, so a
//     token farmed on one host is worthless on another — the replay window is
//     open only to the visitor who actually solved the challenge.
//   * The window is minutes, not hours: long enough to pick a file, upload it
//     and press Submit; too short for a solved token to be worth harvesting.
//   * The real anti-flood control is untouched — every one of these endpoints
//     is ALSO per-IP rate limited (5 requests / 60s, PublicBookingRateLimiter),
//     which is what actually bounds abuse. The captcha proves "a human", not
//     "a human, precisely once".
//
// FAIL OPEN ON REDIS ERROR, deliberately, and note this is NOT the usual call:
// the fail-closed rule elsewhere (auth rate limiters) exists because losing
// Redis there would REMOVE a control. Here a Redis outage only costs us the
// memo — we fall straight through to the real Cloudflare verify, which is the
// stricter path. Failing closed would mean a Redis blip rejects captchas that
// Cloudflare would have accepted.

import { Injectable, Logger } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { CaptchaProvider, CaptchaVerifyResult } from "./captcha-provider.interface";
import type { RedisService } from "../../../../redis/redis.service";

/**
 * How long one solved challenge keeps covering further calls from the same IP.
 *
 * Sized against the slowest realistic path through /onboarding: read the
 * questions, pick a payment receipt off the phone, wait out the upload on a
 * weak mobile connection, then submit. Ten minutes covers that comfortably
 * while staying well inside Turnstile's own ~5-minute issuance freshness for
 * the FIRST call.
 */
const VERIFIED_TTL_SECONDS = 10 * 60;

/** Namespaced so it is obvious in redis-cli and cannot collide with rate-limit keys. */
function verifiedKey(tokenHash: string): string {
  return `captcha:verified:${tokenHash}`;
}

/**
 * Only the SHA-256 of the token is ever stored — never the token itself. Same
 * discipline as password-reset-store.ts and the OTP store: a Redis dump must
 * not hand anyone a replayable credential.
 */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

@Injectable()
export class ReplayTolerantCaptchaProvider implements CaptchaProvider {
  private readonly logger = new Logger(ReplayTolerantCaptchaProvider.name);

  constructor(
    private readonly inner: CaptchaProvider,
    private readonly redis: RedisService,
  ) {}

  async verify(token: string, remoteIp?: string): Promise<CaptchaVerifyResult> {
    // An absent token can never be "already verified" — and caching under the
    // empty string would let one solve cover every token-less request.
    if (!token) {
      return this.inner.verify(token, remoteIp);
    }

    const key = verifiedKey(hashToken(token));
    // The IP is part of the VALUE, not the key: we must be able to tell "this
    // token was verified, but by somebody else" apart from "not verified yet".
    const boundIp = remoteIp ?? "";

    try {
      const seen = await this.redis.client.get(key);
      if (seen !== null && seen === boundIp) {
        return { success: true };
      }
      if (seen !== null) {
        // Same token, different IP — do NOT honour the memo. Fall through to
        // Cloudflare, which will reject it as a duplicate. That is the correct
        // answer: this is exactly the replay the single-use rule guards against.
        this.logger.warn("[Captcha] A verified token was re-presented from a different IP, not honouring the memo.");
      }
    } catch (err) {
      // See the file header: fall through to the real verify, never reject here.
      this.logger.error(`[Captcha] Redis unavailable for the verified-token memo, verifying upstream: ${String(err)}`);
      return this.inner.verify(token, remoteIp);
    }

    const result = await this.inner.verify(token, remoteIp);
    if (result.success) {
      try {
        await this.redis.client.set(key, boundIp, "EX", VERIFIED_TTL_SECONDS);
      } catch (err) {
        // The verification itself SUCCEEDED — the caller must be let through.
        // Losing the memo only means the visitor's next call re-verifies (and,
        // for a spent token, fails). Never turn a cache write into a rejection.
        this.logger.error(`[Captcha] Could not record a verified token. The next call will re-verify: ${String(err)}`);
      }
    }
    return result;
  }
}
