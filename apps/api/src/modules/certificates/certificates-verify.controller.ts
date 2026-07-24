// apps/api/src/modules/certificates/certificates-verify.controller.ts
//
// PUBLIC, UNAUTHENTICATED certificate verification endpoint.
// Route: GET /api/v1/verify/:certUid
//
// DESIGN (matches PublicBookingsController pattern in apps/api/src/modules/leads/bookings.controller.ts):
//   - SEPARATE controller class with NO @UseGuards() — the only existing precedent for an
//     unguarded route is a SEPARATE controller with no guards at all.
//   - GET is CSRF-safe (no state mutation) so no CSRF exclusion is needed in app.module.ts.
//   - Rate-limited per IP via VerifyRateLimiter (Redis fixed-window, mirrors PublicBookingRateLimiter).
//   - Cache-Control: no-store set explicitly (AC-G2: revocation must be reflected immediately).
//   - No JwtAuthGuard — passes the AC-H8 check (unauthenticated requests succeed).
//
// SECURITY INVARIANTS (AC-H):
//   AC-H1: valid cert → 200 { valid: true, status:'valid', program, issuedAt, holderName }
//   AC-H2: revoked cert → 200 { valid: 'revoked', status:'revoked', ... }
//   AC-H3: fabricated cert_uid (bad signature) → 404 BEFORE DB lookup
//   AC-H4: tampered cert_uid (one char flipped) → 404 BEFORE DB lookup
//   AC-H5: validly-signed but nonexistent cert_uid → 404
//   AC-H6: > threshold requests/min from same IP → 429 with Retry-After header
//   AC-H7: response has ONLY { valid, status, program, issuedAt, holderName } — no other fields
//   AC-H8: no auth required (no guards on this controller)
//
// DO NOT add @UseGuards() to this class or any of its methods.
// DO NOT return any PII beyond holderName (email, phone, studentId, enrollmentId are BANNED).

import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Ip,
  Param,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import type { CertificateDownloadResponse, VerifyResult } from "@repo/types";
import { CertificatesService } from "./certificates.service";
import { VerifyRateLimiter } from "./lib/verify-rate-limiter";

@Controller("verify")
export class CertificatesVerifyController {
  constructor(
    private readonly service: CertificatesService,
    private readonly rateLimiter: VerifyRateLimiter,
  ) {}

  /**
   * GET /api/v1/verify/:certUid
   *
   * Public certificate verification. No authentication required (AC-H8).
   * Rate-limited per IP (AC-H6). Cache-Control: no-store (AC-G2).
   *
   * Steps:
   *   1. Rate-limit check (per IP).
   *   2. Delegate to service.verifyCertificate(certUid):
   *      a. verifyCertUid() recomputes HMAC — 404 if signature invalid (AC-H3/H4).
   *      b. DB lookup by cert_uid — 404 if not found (AC-H5).
   *      c. Returns { valid, status, program, issuedAt, holderName } ONLY.
   *   3. Set Cache-Control: no-store so revocation is always reflected.
   */
  @Get(":certUid")
  async verify(
    @Ip() ip: string,
    @Param("certUid") certUid: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<VerifyResult> {
    // Step 1: Rate limit (AC-H6)
    const limited = await this.rateLimiter.hit(ip);
    if (limited) {
      // AC-H6: emit the standards-compliant Retry-After HTTP header (seconds) so clients
      // and proxies can back off — not only the value in the detail string (M-1 fix).
      res.setHeader("Retry-After", String(this.rateLimiter.retryAfterSeconds));
      throw new HttpException(
        {
          code: "RATE_LIMIT_EXCEEDED",
          title: "Too many requests",
          detail: `Rate limit exceeded. Please retry after ${this.rateLimiter.retryAfterSeconds} seconds.`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Step 2: Set Cache-Control: no-store (AC-G2 — revocation must be instant)
    res.setHeader("Cache-Control", "no-store");

    // Reject obviously malformed cert_uid early (no DB round-trip, no PII risk)
    if (typeof certUid !== "string" || certUid.length === 0 || certUid.length > 2048) {
      throw new HttpException(
        { code: "CERTIFICATE_NOT_FOUND", title: "Certificate not found or invalid." },
        HttpStatus.NOT_FOUND,
      );
    }

    // Step 3: Delegate to service (signature check + DB lookup + minimal payload)
    // NotFoundException from service → 404 (handled by global exception filter)
    return this.service.verifyCertificate(certUid);
  }

  /**
   * GET /api/v1/verify/:certUid/download
   *
   * Mints a SHORT-LIVED signed URL for the certificate PDF — the "Download certificate"
   * button on the public verification page.
   *
   * Unauthenticated, like the verify route above: holding a valid HMAC-signed cert_uid IS
   * the authorisation, and the PDF discloses nothing the verify response doesn't already
   * (holder name, programme, issue date). Same per-IP rate limit; a tampered uid 404s
   * before any DB access; a REVOKED certificate is 410 Gone, never downloadable.
   */
  @Get(":certUid/download")
  async download(
    @Ip() ip: string,
    @Param("certUid") certUid: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CertificateDownloadResponse> {
    const limited = await this.rateLimiter.hit(ip);
    if (limited) {
      res.setHeader("Retry-After", String(this.rateLimiter.retryAfterSeconds));
      throw new HttpException(
        {
          code: "RATE_LIMIT_EXCEEDED",
          title: "Too many requests",
          detail: `Rate limit exceeded. Please retry after ${this.rateLimiter.retryAfterSeconds} seconds.`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // The signed URL is short-lived and revocation must take effect immediately.
    res.setHeader("Cache-Control", "no-store");

    if (typeof certUid !== "string" || certUid.length === 0 || certUid.length > 2048) {
      throw new HttpException(
        { code: "CERTIFICATE_NOT_FOUND", title: "Certificate not found or invalid." },
        HttpStatus.NOT_FOUND,
      );
    }

    return this.service.downloadPublicCertificate(certUid);
  }
}
