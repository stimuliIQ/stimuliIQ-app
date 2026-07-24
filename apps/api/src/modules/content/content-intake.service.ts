// apps/api/src/modules/content/content-intake.service.ts
//
// Business logic for the PUBLIC content-intake surface (docs/plans/phase-9-completion.md
// T22/T32): newsletter subscribe/unsubscribe, contact form, career application. Mirrors
// public-funnel.service.ts's security posture EXACTLY (same module, same P-3/P-5/P-6
// precedent), since these are the SAME class of anonymous, UGC-bearing public write:
//   - Every public write is captcha-gated (CaptchaProvider) + rate-limited (per-IP).
//   - Consent is SERVER-COMPUTED (timestamp + ip_hash); never trusted from the client.
//   - Raw IP is NEVER stored — only SHA-256(ip) (DPDP compliance, mirrors AC-37).
//   - Free-text fields (message/coverLetter/subject) are SANITIZED at write time
//     (strip-HTML + trim + truncate) — UNLIKE the CRM-authored content types in this same
//     module (blog/testimonials/etc, ADR-0045 "sanitize at render sink"), this is
//     ANONYMOUS, UNTRUSTED input with no render-sink-only posture assumed safe; the
//     defense-in-depth write-time strip is the primary control here, matching
//     public-funnel.service.ts's own `sanitize()` helper precedent for the exact same
//     reason (P2 M-4).
//   - Admin (CRM) reads/status-updates are content.view/content.edit gated, scope=all.

import { ForbiddenException, Inject, Injectable, Logger, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type {
  CareerApplicationDetail,
  CareerApplicationStatus,
  CareerApplicationSummary,
  ContactSubmission,
  ContactSubmissionStatus,
  ListCareerApplicationsQuery,
  ListContactSubmissionsQuery,
  ListNewsletterSubscriptionsQuery,
  NewsletterSubscription,
  PublicCareerResumeUploadUrlRequest,
  PublicCareerResumeUploadUrlResponse,
  SubmitCareerApplicationRequest,
  SubmitContactRequest,
  SubscribeNewsletterRequest,
  UpdateCareerApplicationStatusRequest,
  UpdateContactSubmissionStatusRequest,
} from "@repo/types";
import { S3StorageProvider, type BuildKeyOptions } from "../storage/providers/storage/s3-storage.provider";
import {
  ContentIntakeRepository,
  type CareerApplicationRow,
  type ContactSubmissionRow,
  type NewsletterSubscriptionRow,
} from "./content-intake.repository";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { requireScopeContext } from "../auth/lib/scope-context";
import { CAPTCHA_PROVIDER, type CaptchaProvider } from "../captcha/providers/captcha/captcha-provider.interface";
import { PublicBookingRateLimiter } from "../leads/lib/public-booking-rate-limiter";
import { STORAGE_PROVIDER, type StorageProvider } from "../storage/providers/storage/storage-provider.interface";
import { validateEnv } from "../../config/env";
import { TENANT_SLUG } from "./content.util";

/** SHA-256 hash of a client IP — NEVER store the raw IP (DPDP compliance). */
function hashIp(ip: string | null | undefined): string {
  if (!ip) return createHash("sha256").update("unknown").digest("hex");
  return createHash("sha256").update(ip).digest("hex");
}

/** Sanitize anonymous free-text input: strip HTML tags, trim, truncate (P2 M-4 precedent). */
function sanitize(s: string | undefined, maxLen = 2000): string | undefined {
  if (!s) return undefined;
  return s.replace(/<[^>]*>/g, "").trim().slice(0, maxLen);
}

const UNSUBSCRIBE_TOKEN_VERSION = "v1";

@Injectable()
export class ContentIntakeService {
  private readonly logger = new Logger(ContentIntakeService.name);

  constructor(
    private readonly repository: ContentIntakeRepository,
    @Inject(CAPTCHA_PROVIDER) private readonly captchaProvider: CaptchaProvider,
    @Inject(STORAGE_PROVIDER) private readonly storageProvider: StorageProvider,
    private readonly rateLimiter: PublicBookingRateLimiter,
  ) {}

  private async resolveTenantId(): Promise<string> {
    const tenantId = await this.repository.getTenantIdBySlug(TENANT_SLUG);
    if (!tenantId) throw new NotFoundException({ code: "content.tenant_not_found", title: "Tenant not found" });
    return tenantId;
  }

  private assertAllScope(): void {
    const scope = requireScopeContext();
    if (scope.scope !== "all") {
      throw new ForbiddenException({ code: "content.scope_unresolvable", title: "Scope not supported", detail: `The "${scope.scope}" data-scope is not resolvable for content intake.` });
    }
  }

  async verifyCaptcha(token: string, ip: string | undefined): Promise<void> {
    const result = await this.captchaProvider.verify(token, ip);
    if (!result.success) {
      this.logger.warn(`[ContentIntake] Captcha verification failed — codes: ${result.errorCodes?.join(",")}`);
      throw new UnprocessableEntityException({ code: "content.captcha_invalid", title: "Captcha verification failed", detail: "Please complete the captcha challenge and try again." });
    }
  }

  async checkRateLimit(ip: string, errorCode: string): Promise<void> {
    const limited = await this.rateLimiter.hit(ip);
    if (limited) {
      throw new UnprocessableEntityException({ code: errorCode, title: "Too many requests", detail: "Please try again in a minute." });
    }
  }

  // ── Newsletter (public) ──────────────────────────────────────────────────

  async subscribeNewsletter(dto: SubscribeNewsletterRequest, ip: string | undefined): Promise<{ subscribed: true }> {
    const tenantId = await this.resolveTenantId();
    const consent = { marketing_opt_in: dto.consent.marketingOptIn, tos_version: dto.consent.tosVersion, timestamp: new Date().toISOString(), ip_hash: hashIp(ip) };
    await this.repository.subscribeNewsletter(tenantId, { email: dto.email, consent });
    // Mirror into a campaignable CRM Lead (source="newsletter") so the subscriber shows up in
    // the Leads pipeline AND can be reached by the Campaigns engine. Best-effort: a failure to
    // create the lead must NOT fail the subscribe (the newsletter row is the source of truth for
    // the confirmation/unsubscribe flow).
    try {
      await this.repository.upsertNewsletterLead(tenantId, { email: dto.email, consent });
    } catch (err) {
      this.logger.warn(`[ContentIntake] Failed to mirror newsletter signup into a CRM lead (non-fatal): ${String(err)}`);
    }
    return { subscribed: true };
  }

  /** Signs a subscription-scoped unsubscribe token (HMAC-SHA256, mirrors notifications.service.ts's token shape). */
  private signUnsubscribeToken(subscriptionId: string): string {
    const secret = validateEnv().NOTIFICATION_SIGNING_SECRET ?? "dev-notification-signing-secret-00000000000000000000000000000000";
    const payload = `${UNSUBSCRIBE_TOKEN_VERSION}:${subscriptionId}`;
    const hmac = createHmac("sha256", secret).update(payload).digest("hex");
    return Buffer.from(`${payload}:${hmac}`).toString("base64url");
  }

  private verifyUnsubscribeToken(token: string): string | null {
    try {
      const decoded = Buffer.from(token, "base64url").toString("utf8");
      const parts = decoded.split(":");
      if (parts.length !== 3) return null;
      const [version, subscriptionId, providedHmac] = parts as [string, string, string];
      if (version !== UNSUBSCRIBE_TOKEN_VERSION) return null;
      const secret = validateEnv().NOTIFICATION_SIGNING_SECRET ?? "dev-notification-signing-secret-00000000000000000000000000000000";
      const expected = createHmac("sha256", secret).update(`${version}:${subscriptionId}`).digest("hex");
      const expectedBuf = Buffer.from(expected, "hex");
      const providedBuf = Buffer.from(providedHmac, "hex");
      if (expectedBuf.length !== providedBuf.length || !timingSafeEqual(expectedBuf, providedBuf)) return null;
      return subscriptionId;
    } catch {
      return null;
    }
  }

  async unsubscribeNewsletter(token: string): Promise<{ message: string }> {
    const subscriptionId = this.verifyUnsubscribeToken(token);
    if (!subscriptionId) {
      throw new UnprocessableEntityException({ code: "content.invalid_token", title: "Invalid or tampered unsubscribe token" });
    }
    const row = await this.repository.findNewsletterSubscriptionById(subscriptionId);
    if (!row || row.deletedAt) {
      // Idempotent success — avoids revealing subscription existence to a forged-but-valid-shape token.
      return { message: "You have been unsubscribed." };
    }
    await this.repository.unsubscribeNewsletter(subscriptionId);
    return { message: "You have been unsubscribed." };
  }

  /** Test/CRM helper — mints the unsubscribe URL for a given subscription id (embedded in the confirmation email). */
  buildUnsubscribeToken(subscriptionId: string): string {
    return this.signUnsubscribeToken(subscriptionId);
  }

  async listNewsletterSubscriptions(tenantId: string, query: ListNewsletterSubscriptionsQuery): Promise<PaginatedResult<NewsletterSubscription>> {
    this.assertAllScope();
    const { rows, total } = await this.repository.listNewsletterSubscriptions({ tenantId, status: query.status, search: query.search, page: query.page, pageSize: query.pageSize });
    return new PaginatedResult(rows.map(toNewsletterDto), { page: query.page, pageSize: query.pageSize, total, hasMore: query.page * query.pageSize < total });
  }

  // ── Contact (public + admin) ─────────────────────────────────────────────

  async submitContact(dto: SubmitContactRequest, ip: string | undefined): Promise<{ id: string; message: string }> {
    const tenantId = await this.resolveTenantId();
    const consent = { marketing_opt_in: dto.consent.marketingOptIn, tos_version: dto.consent.tosVersion, timestamp: new Date().toISOString(), ip_hash: hashIp(ip) };
    const created = await this.repository.createContactSubmission(tenantId, {
      name: sanitize(dto.name, 200) ?? dto.name,
      email: dto.email,
      phone: dto.phone ?? null,
      subject: dto.subject ? (sanitize(dto.subject, 200) ?? dto.subject) : null,
      message: sanitize(dto.message, 5000) ?? dto.message,
      consent,
    });
    return { id: created.id, message: "Thanks for reaching out — we'll get back to you shortly." };
  }

  async listContactSubmissions(tenantId: string, query: ListContactSubmissionsQuery): Promise<PaginatedResult<ContactSubmission>> {
    this.assertAllScope();
    const { rows, total } = await this.repository.listContactSubmissions({ tenantId, status: query.status, search: query.search, page: query.page, pageSize: query.pageSize });
    return new PaginatedResult(rows.map(toContactDto), { page: query.page, pageSize: query.pageSize, total, hasMore: query.page * query.pageSize < total });
  }

  async updateContactSubmissionStatus(tenantId: string, id: string, body: UpdateContactSubmissionStatusRequest): Promise<ContactSubmission> {
    this.assertAllScope();
    const existing = await this.repository.findContactSubmissionById(tenantId, id);
    if (!existing) throw new NotFoundException({ code: "content.not_found", title: "Contact submission not found" });
    await this.repository.updateContactSubmissionStatus(id, body.status);
    const updated = await this.repository.findContactSubmissionById(tenantId, id);
    if (!updated) throw new NotFoundException({ code: "content.not_found", title: "Contact submission not found after update" });
    return toContactDto(updated);
  }

  // ── Careers (public + admin) ─────────────────────────────────────────────

  /**
   * POST /api/v1/public/careers/resume-upload-url (Phase-9-completion gap #3).
   *
   * Mints a short-lived signed PUT URL scoped to careers/{tenantId}/... for an
   * ANONYMOUS applicant's resume — the public counterpart to the authenticated
   * POST /storage/upload-url (JwtAuthGuard) that students/faculty use. Captcha
   * verification + rate limiting are enforced by the controller BEFORE this is
   * called (same posture as every other anonymous write in this module).
   *
   * Fail-closed: StorageProvider throws (real S3/R2 adapter, unconfigured
   * credentials) → propagates as 503 via the global exception filter (never a
   * raw/unsigned fallback URL). The Noop adapter returns a deterministic fake
   * URL for tests/local dev.
   */
  async getCareerResumeUploadUrl(dto: PublicCareerResumeUploadUrlRequest): Promise<PublicCareerResumeUploadUrlResponse> {
    const tenantId = await this.resolveTenantId();
    const { randomUUID } = await import("node:crypto");
    const buildKeyOpts: BuildKeyOptions = {
      namespace: "careers",
      tenantId,
      uniqueId: randomUUID(),
      filename: dto.fileName,
    };
    const key = S3StorageProvider.buildKey(buildKeyOpts);

    const result = await this.storageProvider.getSignedUploadUrl({
      key,
      contentType: dto.contentType,
      maxBytes: dto.sizeBytes,
      ttlSeconds: 900, // 15 min — same ceiling as the authenticated upload-url endpoint.
    });

    return {
      storageKey: result.storageKey,
      uploadUrl: result.url,
      expiresAt: result.expiresAt.toISOString(),
      additionalHeaders: result.requiredHeaders,
      maxSizeBytes: dto.sizeBytes,
    };
  }

  async submitCareerApplication(dto: SubmitCareerApplicationRequest): Promise<{ id: string; message: string }> {
    const tenantId = await this.resolveTenantId();

    // SECURITY (Wave 6 M3): the schema already forces a `careers/` prefix; here we pin it
    // to THIS tenant's namespace so an anonymous applicant can't submit a key pointing at
    // another tenant's resume object (which the CRM detail view would later sign a
    // download URL for). buildKey() issues exactly `careers/{tenantId}/...`.
    const requiredPrefix = `careers/${tenantId}/`;
    if (!dto.resumeStorageKey.startsWith(requiredPrefix)) {
      throw new UnprocessableEntityException({
        code: "content.invalid_resume_key",
        title: "Invalid resume reference",
        detail: "The resume upload reference is not valid. Please re-upload your resume and try again.",
      });
    }

    const created = await this.repository.createCareerApplication(tenantId, {
      name: sanitize(dto.name, 200) ?? dto.name,
      email: dto.email,
      phone: dto.phone ?? null,
      role: sanitize(dto.role, 200) ?? dto.role,
      resumeStorageKey: dto.resumeStorageKey,
      coverLetter: dto.coverLetter ? (sanitize(dto.coverLetter, 4000) ?? dto.coverLetter) : null,
    });
    return { id: created.id, message: "Application received — thanks for applying!" };
  }

  async listCareerApplications(tenantId: string, query: ListCareerApplicationsQuery): Promise<PaginatedResult<CareerApplicationSummary>> {
    this.assertAllScope();
    const { rows, total } = await this.repository.listCareerApplications({ tenantId, status: query.status, role: query.role, search: query.search, page: query.page, pageSize: query.pageSize });
    return new PaginatedResult(rows.map(toCareerSummary), { page: query.page, pageSize: query.pageSize, total, hasMore: query.page * query.pageSize < total });
  }

  async getCareerApplicationById(tenantId: string, id: string): Promise<CareerApplicationDetail> {
    this.assertAllScope();
    const row = await this.repository.findCareerApplicationById(tenantId, id);
    if (!row) throw new NotFoundException({ code: "content.not_found", title: "Career application not found" });
    // Signed download URL minted server-side, on demand — NEVER a raw storage key (matches
    // StorageProvider's documented contract).
    let resumeDownloadUrl: string | null = null;
    try {
      const signed = await this.storageProvider.getSignedDownloadUrl({ key: row.resumeStorageKey });
      resumeDownloadUrl = signed.url;
    } catch (err) {
      this.logger.warn(`[ContentIntake] Failed to mint resume download URL (non-fatal): ${String(err)}`);
    }
    return { ...toCareerSummary(row), coverLetter: row.coverLetter, resumeDownloadUrl };
  }

  async updateCareerApplicationStatus(tenantId: string, id: string, body: UpdateCareerApplicationStatusRequest): Promise<CareerApplicationSummary> {
    this.assertAllScope();
    const existing = await this.repository.findCareerApplicationById(tenantId, id);
    if (!existing) throw new NotFoundException({ code: "content.not_found", title: "Career application not found" });
    await this.repository.updateCareerApplicationStatus(id, body.status);
    const updated = await this.repository.findCareerApplicationById(tenantId, id);
    if (!updated) throw new NotFoundException({ code: "content.not_found", title: "Career application not found after update" });
    return toCareerSummary(updated);
  }
}

function toNewsletterDto(row: NewsletterSubscriptionRow): NewsletterSubscription {
  return { id: row.id, email: row.email, status: row.status, unsubscribedAt: row.unsubscribedAt ? row.unsubscribedAt.toISOString() : null, createdAt: row.createdAt.toISOString() };
}

function toContactDto(row: ContactSubmissionRow): ContactSubmission {
  // `status` is app-boundary-constrained (zod enum on every write path — see repository
  // file header), never DB-constrained — safe to cast at this one read-mapping choke point.
  return { id: row.id, name: row.name, email: row.email, phone: row.phone, subject: row.subject, message: row.message, status: row.status as ContactSubmissionStatus, createdAt: row.createdAt.toISOString() };
}

function toCareerSummary(row: CareerApplicationRow): CareerApplicationSummary {
  return { id: row.id, name: row.name, email: row.email, phone: row.phone, role: row.role, status: row.status as CareerApplicationStatus, createdAt: row.createdAt.toISOString() };
}
