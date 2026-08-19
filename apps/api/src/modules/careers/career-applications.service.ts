// apps/api/src/modules/careers/career-applications.service.ts
//
// The public apply path and the CRM review queue. Spec: docs/specs/careers-hiring.md,
// ADR-0066.
//
// ── SECURITY POSTURE (public writes) ────────────────────────────────────────────────
// Inherited wholesale from ContentIntakeService, which owned this surface before careers
// became its own module — same class of anonymous, UGC-bearing public write:
//   - captcha-gated (CaptchaProvider) + per-IP rate-limited, enforced in the controller.
//   - free text SANITIZED at write time (strip-HTML + trim + truncate). This is anonymous
//     untrusted input, so the write-time strip is the primary control, not a render-sink
//     assumption (P2 M-4).
//   - `resumeStorageKey` is pinned to `careers/{tenantId}/` before it is ever stored, so an
//     applicant cannot point us at another object in the bucket and have the CRM mint a
//     signed URL for it (Wave 6 M3).
//   - Raw IP is never stored anywhere on this path.
//
// ── ORDERING RULE FOR EVERY DECISION ────────────────────────────────────────────────
// Persist the decision FIRST, mail SECOND, and never let the mail fail the decision. A
// reviewer's call is a fact about our process; the email is our attempt to tell someone
// about it. Losing the second must not lose the first.
//
// The ONE exception is `offer`: the offer letter is read out of storage BEFORE the status
// is written, because an offer with no attachable letter is not a decision worth recording
// — see `offer()`.

import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type {
  CareerApplicationDetail,
  CareerApplicationStatus,
  CareerApplicationSummary,
  HoldCareerApplicationRequest,
  ListCareerApplicationsQuery,
  OfferCareerApplicationRequest,
  OfferLetterUploadUrlRequest,
  PublicCareerResumeUploadUrlRequest,
  PublicCareerResumeUploadUrlResponse,
  RejectCareerApplicationRequest,
  ResendAcknowledgementResponse,
  ShortlistCareerApplicationRequest,
  SignedUploadResponse,
  SubmitCareerApplicationRequest,
} from "@repo/types";
import { S3StorageProvider } from "../storage/providers/storage/s3-storage.provider";
import { CAPTCHA_PROVIDER, type CaptchaProvider } from "../captcha/providers/captcha/captcha-provider.interface";
import { PublicBookingRateLimiter } from "../leads/lib/public-booking-rate-limiter";
import { STORAGE_PROVIDER, type StorageProvider } from "../storage/providers/storage/storage-provider.interface";
import { CareerApplicationsRepository, type CareerApplicationRow } from "./career-applications.repository";
import { JobOpeningsService, toPublicJobOpeningDto } from "./job-openings.service";
import { CareersNotificationService, type CandidateRef } from "./careers-notification.service";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { requireScopeContext } from "../auth/lib/scope-context";
import { TENANT_SLUG } from "../content/content.util";

/** Sanitize anonymous free-text input: strip HTML tags, trim, truncate (P2 M-4 precedent). */
function sanitize(s: string | undefined | null, maxLen = 2000): string | undefined {
  if (!s) return undefined;
  return s.replace(/<[^>]*>/g, "").trim().slice(0, maxLen);
}

/**
 * Ceiling on an offer letter read into memory for attaching. Matches the upload DTO's own
 * 10 MB limit — the two must agree, or staff could upload a file the send path then refuses.
 */
const OFFER_LETTER_MAX_BYTES = 10_485_760;

/**
 * Which statuses each verb is willing to act on. Encoded once, here, because every one of
 * these is enforced inside the UPDATE's WHERE (see the repository) and a second reviewer
 * must be told their click did nothing rather than silently re-mailing the candidate.
 *
 * Note what is ALLOWED: any non-terminal state can be held, shortlisted, offered or
 * rejected, and a shortlisted candidate can go on to be offered — that is the normal path.
 * What is refused is re-deciding something already decided: an offer or a rejection has
 * been emailed to a person and is not a state to bounce out of by clicking a different
 * button. Undoing one is a conversation, not a UI affordance.
 */
const DECIDABLE_FROM: readonly CareerApplicationStatus[] = ["new", "on_hold", "shortlisted"];

@Injectable()
export class CareerApplicationsService {
  private readonly logger = new Logger(CareerApplicationsService.name);

  constructor(
    private readonly repository: CareerApplicationsRepository,
    private readonly openings: JobOpeningsService,
    private readonly notifications: CareersNotificationService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Inject(CAPTCHA_PROVIDER) private readonly captchaProvider: CaptchaProvider,
    private readonly rateLimiter: PublicBookingRateLimiter,
  ) {}

  // ── Anonymous-write gates (called by the public controller BEFORE any work) ──
  //
  // Identical in posture to ContentIntakeService's pair, which guarded this surface before
  // careers became its own module: same captcha provider, same per-IP fixed-window limiter
  // (ADR-0019), same 422 shape. Kept as service methods rather than a guard so the ORDER is
  // explicit and readable at the call site — captcha first, then rate limit, then work.

  async verifyCaptcha(token: string, ip: string | undefined): Promise<void> {
    const result = await this.captchaProvider.verify(token, ip);
    if (!result.success) {
      this.logger.warn(`[Careers] Captcha verification failed — codes: ${result.errorCodes?.join(",")}`);
      throw new UnprocessableEntityException({
        code: "careers.captcha_invalid",
        title: "Captcha verification failed",
        detail: "Please complete the captcha challenge and try again.",
      });
    }
  }

  async checkRateLimit(ip: string): Promise<void> {
    const limited = await this.rateLimiter.hit(ip);
    if (limited) {
      throw new UnprocessableEntityException({
        code: "careers.rate_limited",
        title: "Too many requests",
        detail: "Please try again in a minute.",
      });
    }
  }

  private assertAllScope(): void {
    const scope = requireScopeContext();
    if (scope.scope !== "all") {
      throw new ForbiddenException({
        code: "careers.scope_unresolvable",
        title: "Scope not supported",
        detail: `The "${scope.scope}" data-scope is not resolvable for career applications.`,
      });
    }
  }

  private async resolveTenantId(): Promise<string> {
    const tenantId = await this.repository.getTenantIdBySlug(TENANT_SLUG);
    if (!tenantId) throw new NotFoundException({ code: "careers.tenant_not_found", title: "Tenant not found" });
    return tenantId;
  }

  // ── Public: resume upload + apply ─────────────────────────────────────────

  /**
   * POST /api/v1/public/careers/resume-upload-url
   *
   * Mints a short-lived signed PUT URL scoped to careers/{tenantId}/... for an ANONYMOUS
   * applicant's resume — the public counterpart to the authenticated POST /storage/upload-url
   * that students and faculty use. Captcha verification + rate limiting run in the controller
   * BEFORE this is reached.
   *
   * Fail-closed: a StorageProvider throw (unconfigured credentials on the real adapter)
   * propagates as a 503 through the global exception filter, never a raw/unsigned URL.
   */
  async getResumeUploadUrl(dto: PublicCareerResumeUploadUrlRequest): Promise<PublicCareerResumeUploadUrlResponse> {
    const tenantId = await this.resolveTenantId();
    const key = S3StorageProvider.buildKey({
      namespace: "careers",
      tenantId,
      uniqueId: randomUUID(),
      filename: dto.fileName,
    });

    const result = await this.storage.getSignedUploadUrl({
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

  /**
   * POST /api/v1/public/careers/apply
   *
   * Stores the application, then sends the acknowledgement. The send is best-effort and
   * deliberately awaited rather than fired and forgotten: the response tells the candidate
   * to expect an email, and `acknowledgedAt` is how the CRM later shows whether one was
   * actually sent. A failure logs, leaves the column null, and still returns success —
   * losing an application because our mailer is down would be the far worse outcome.
   */
  async submit(dto: SubmitCareerApplicationRequest): Promise<{ id: string; message: string }> {
    const tenantId = await this.resolveTenantId();

    // SECURITY (Wave 6 M3): the schema already forces a `careers/` prefix; pin it to THIS
    // tenant's namespace so an anonymous applicant cannot submit a key pointing at another
    // tenant's object, which the CRM detail view would later sign a download URL for.
    const requiredPrefix = `careers/${tenantId}/`;
    if (!dto.resumeStorageKey.startsWith(requiredPrefix)) {
      throw new UnprocessableEntityException({
        code: "careers.invalid_resume_key",
        title: "Invalid resume reference",
        detail: "The resume upload reference is not valid. Please re-upload your resume and try again.",
      });
    }

    // Link the application to the opening only if that opening is genuinely live. A stale
    // page pointing at a closed role still yields an application (recorded against its role
    // snapshot) — see SubmitCareerApplicationRequestSchema on why we do not 404 the candidate.
    let jobOpeningId: string | null = null;
    let roleTitle = sanitize(dto.role, 200) ?? dto.role;
    if (dto.jobOpeningId) {
      const opening = await this.openings.findLiveOpeningForApply(tenantId, dto.jobOpeningId);
      if (opening) {
        jobOpeningId = opening.id;
        // Trust the SERVER's title over the client's when the opening resolves: the role
        // snapshot is what every later email addresses the candidate about, and a tampered
        // `role` would otherwise put attacker-chosen text in our outgoing mail.
        roleTitle = opening.title;
      } else {
        this.logger.warn(
          `[Careers] Application submitted against a non-live opening (${dto.jobOpeningId}); recording it unlinked.`,
        );
      }
    }

    const created = await this.repository.create(tenantId, {
      jobOpeningId,
      name: sanitize(dto.name, 200) ?? dto.name,
      email: dto.email,
      phone: dto.phone ?? null,
      role: roleTitle,
      resumeStorageKey: dto.resumeStorageKey,
      coverLetter: dto.coverLetter ? (sanitize(dto.coverLetter, 4000) ?? dto.coverLetter) : null,
    });

    const sent = await this.notifications.sendAcknowledgement({
      name: sanitize(dto.name, 200) ?? dto.name,
      email: dto.email,
      role: roleTitle,
    });
    if (sent) {
      await this.repository.markAcknowledged(created.id, new Date());
    }

    return {
      id: created.id,
      message: "Application received — thanks for applying! We've emailed you a confirmation.",
    };
  }

  // ── CRM: reads ────────────────────────────────────────────────────────────

  async list(tenantId: string, query: ListCareerApplicationsQuery): Promise<PaginatedResult<CareerApplicationSummary>> {
    this.assertAllScope();
    const { rows, total } = await this.repository.list({
      tenantId,
      status: query.status,
      jobOpeningId: query.jobOpeningId,
      role: query.role,
      search: query.search,
      page: query.page,
      pageSize: query.pageSize,
    });
    return new PaginatedResult(rows.map(toSummary), {
      page: query.page,
      pageSize: query.pageSize,
      total,
      hasMore: query.page * query.pageSize < total,
    });
  }

  async getById(tenantId: string, id: string): Promise<CareerApplicationDetail> {
    this.assertAllScope();
    const row = await this.requireApplication(tenantId, id);

    // Signed download URLs are minted server-side, on demand, and never cached — the
    // StorageProvider contract. A failure to mint one is non-fatal: the reviewer should
    // still see the application, just without a working download button.
    const [resumeDownloadUrl, offerLetterDownloadUrl] = await Promise.all([
      this.trySignDownload(row.resumeStorageKey, `resume-${row.name}.pdf`),
      row.offerLetterStorageKey
        ? this.trySignDownload(row.offerLetterStorageKey, row.offerLetterFileName ?? "offer-letter.pdf")
        : Promise.resolve(null),
    ]);

    const opening = row.jobOpening && !row.jobOpening.deletedAt ? toPublicJobOpeningDto(row.jobOpening) : null;

    return {
      ...toSummary(row),
      coverLetter: row.coverLetter,
      resumeDownloadUrl,
      offerLetterDownloadUrl,
      offerLetterFileName: row.offerLetterFileName,
      internalNotes: row.internalNotes,
      nextRoundName: row.nextRoundName,
      nextRoundDetails: row.nextRoundDetails,
      jobOpening: opening,
    };
  }

  private async trySignDownload(key: string, downloadFilename: string): Promise<string | null> {
    try {
      const signed = await this.storage.getSignedDownloadUrl({ key, downloadFilename });
      return signed.url;
    } catch (err) {
      this.logger.warn(`[Careers] Failed to mint a signed download URL (non-fatal): ${String(err)}`);
      return null;
    }
  }

  private async requireApplication(tenantId: string, id: string): Promise<CareerApplicationRow> {
    const row = await this.repository.findById(tenantId, id);
    if (!row) throw new NotFoundException({ code: "careers.application_not_found", title: "Career application not found" });
    return row;
  }

  /**
   * Turns `updateMany`'s affected-row count into the reviewer-facing outcome.
   *
   * Zero rows means the status was not one this verb accepts — in practice, somebody else
   * decided this application while the drawer was open. Saying so plainly is the whole
   * point: the alternative is a second identical email to the candidate.
   */
  private assertDecisionApplied(count: number, current: CareerApplicationStatus): void {
    if (count > 0) return;
    throw new UnprocessableEntityException({
      code: "careers.already_decided",
      title: "This application has already been decided",
      detail:
        current === "selected" || current === "rejected"
          ? `This application is already marked "${current}" and the candidate has been emailed. Reopening a decided application is a conversation to have with the candidate, not a status change.`
          : "Somebody else updated this application. Reload it and try again.",
    });
  }

  // ── CRM: the four review verbs ────────────────────────────────────────────

  /**
   * Hold — park the candidate. The ONLY verb that sends no email; see the notification
   * service's file header for why "you are on hold" is a message not worth sending.
   */
  async hold(tenantId: string, id: string, userId: string, body: HoldCareerApplicationRequest): Promise<CareerApplicationDetail> {
    this.assertAllScope();
    const existing = await this.requireApplication(tenantId, id);
    const count = await this.repository.applyDecision(id, [...DECIDABLE_FROM], {
      status: "on_hold",
      decidedAt: new Date(),
      decidedByUserId: userId,
      ...(body.internalNotes !== undefined ? { internalNotes: sanitize(body.internalNotes) ?? null } : {}),
    });
    this.assertDecisionApplied(count, existing.status as CareerApplicationStatus);
    return this.getById(tenantId, id);
  }

  /** Shortlist — move to a further round and tell the candidate what to expect. */
  async shortlist(
    tenantId: string,
    id: string,
    userId: string,
    body: ShortlistCareerApplicationRequest,
  ): Promise<CareerApplicationDetail> {
    this.assertAllScope();
    const existing = await this.requireApplication(tenantId, id);

    const roundName = sanitize(body.roundName, 120) ?? body.roundName;
    const details = sanitize(body.details, 2000) ?? body.details;

    const count = await this.repository.applyDecision(id, [...DECIDABLE_FROM], {
      status: "shortlisted",
      decidedAt: new Date(),
      decidedByUserId: userId,
      nextRoundName: roundName,
      nextRoundDetails: details,
      ...(body.internalNotes !== undefined ? { internalNotes: sanitize(body.internalNotes) ?? null } : {}),
    });
    this.assertDecisionApplied(count, existing.status as CareerApplicationStatus);

    await this.notifications.sendNextRound(toCandidateRef(existing), roundName, details);
    return this.getById(tenantId, id);
  }

  /**
   * Offer — the only verb that touches storage.
   *
   * ORDER MATTERS HERE, and it is the reverse of the other three. The offer letter is read
   * out of the bucket BEFORE the status is written, so that a missing, oversized or
   * unreadable file fails the whole action while it is still safely undone. Recording
   * "selected" first and discovering afterwards that there is nothing to attach would leave
   * a candidate marked as offered who has been sent nothing, which is the one failure this
   * flow must not produce.
   */
  async offer(
    tenantId: string,
    id: string,
    userId: string,
    body: OfferCareerApplicationRequest,
  ): Promise<CareerApplicationDetail> {
    this.assertAllScope();
    const existing = await this.requireApplication(tenantId, id);

    // Pin the key to this tenant, exactly as the public apply path pins resume keys — the
    // upload endpoint issues `offer-letters/{tenantId}/...` and nothing else is acceptable.
    const requiredPrefix = `offer-letters/${tenantId}/`;
    if (!body.offerLetterStorageKey.startsWith(requiredPrefix)) {
      throw new UnprocessableEntityException({
        code: "careers.invalid_offer_letter_key",
        title: "Invalid offer letter reference",
        detail: "That offer letter reference is not valid. Re-upload the letter and try again.",
      });
    }

    let letterBytes: Buffer;
    try {
      const object = await this.storage.getObject({
        key: body.offerLetterStorageKey,
        maxBytes: OFFER_LETTER_MAX_BYTES,
      });
      letterBytes = object.body;
    } catch (err) {
      this.logger.error(`[Careers] Could not read offer letter ${body.offerLetterStorageKey}: ${String(err)}`);
      throw new UnprocessableEntityException({
        code: "careers.offer_letter_unreadable",
        title: "The offer letter could not be read",
        detail:
          "We could not fetch the uploaded offer letter, so nothing has been sent and the application is unchanged. Please re-upload the letter and try again.",
      });
    }

    // Server-composed, never the uploader's filename: this string lands in a stranger's
    // inbox as the attachment name, and a candidate-visible filename should read like a
    // document rather than like our storage layout.
    const attachmentName = buildOfferLetterFilename(existing.name, existing.role);

    const count = await this.repository.applyDecision(id, [...DECIDABLE_FROM], {
      status: "selected",
      decidedAt: new Date(),
      decidedByUserId: userId,
      offerLetterStorageKey: body.offerLetterStorageKey,
      offerLetterFileName: attachmentName,
      ...(body.internalNotes !== undefined ? { internalNotes: sanitize(body.internalNotes) ?? null } : {}),
    });
    this.assertDecisionApplied(count, existing.status as CareerApplicationStatus);

    await this.notifications.sendOffer(
      toCandidateRef(existing),
      { filename: attachmentName, content: letterBytes, contentType: "application/pdf" },
      body.message ? (sanitize(body.message) ?? null) : null,
    );

    return this.getById(tenantId, id);
  }

  /** Reject — email a plain decline. `internalNotes` is stored and never sent. */
  async reject(
    tenantId: string,
    id: string,
    userId: string,
    body: RejectCareerApplicationRequest,
  ): Promise<CareerApplicationDetail> {
    this.assertAllScope();
    const existing = await this.requireApplication(tenantId, id);

    const count = await this.repository.applyDecision(id, [...DECIDABLE_FROM], {
      status: "rejected",
      decidedAt: new Date(),
      decidedByUserId: userId,
      ...(body.internalNotes !== undefined ? { internalNotes: sanitize(body.internalNotes) ?? null } : {}),
    });
    this.assertDecisionApplied(count, existing.status as CareerApplicationStatus);

    await this.notifications.sendRejection(toCandidateRef(existing));
    return this.getById(tenantId, id);
  }

  // ── CRM: supporting actions ───────────────────────────────────────────────

  /**
   * Mints a signed PUT URL for a staff-uploaded offer letter, under its OWN
   * `offer-letters/` namespace rather than `careers/` — see OfferLetterStorageKeySchema.
   * Scoped to the application so an upload cannot be staged without one.
   */
  async getOfferLetterUploadUrl(
    tenantId: string,
    id: string,
    dto: OfferLetterUploadUrlRequest,
  ): Promise<SignedUploadResponse> {
    this.assertAllScope();
    await this.requireApplication(tenantId, id);

    const key = S3StorageProvider.buildKey({
      namespace: "offer-letters",
      tenantId,
      uniqueId: randomUUID(),
      filename: dto.fileName,
    });

    const result = await this.storage.getSignedUploadUrl({
      key,
      contentType: dto.contentType,
      maxBytes: dto.sizeBytes,
      ttlSeconds: 900,
    });

    return {
      storageKey: result.storageKey,
      uploadUrl: result.url,
      expiresAt: result.expiresAt.toISOString(),
      additionalHeaders: result.requiredHeaders,
      maxSizeBytes: dto.sizeBytes,
    };
  }

  /**
   * Re-send the acknowledgement for an application whose original send failed.
   *
   * Refuses when `acknowledgedAt` is already set. That is not politeness — it is the only
   * thing standing between a reviewer clicking twice and a candidate getting the same
   * "thanks for applying" mail repeatedly.
   */
  async resendAcknowledgement(tenantId: string, id: string): Promise<ResendAcknowledgementResponse> {
    this.assertAllScope();
    const row = await this.requireApplication(tenantId, id);

    if (row.acknowledgedAt) {
      return { sent: false, acknowledgedAt: row.acknowledgedAt.toISOString() };
    }

    const sent = await this.notifications.sendAcknowledgement(toCandidateRef(row));
    if (!sent) return { sent: false, acknowledgedAt: null };

    const at = new Date();
    await this.repository.markAcknowledged(id, at);
    return { sent: true, acknowledgedAt: at.toISOString() };
  }

  /** Soft-deletes an application (spam, duplicates, or a candidate's erasure request). */
  async softDelete(tenantId: string, id: string): Promise<void> {
    this.assertAllScope();
    await this.requireApplication(tenantId, id);
    await this.repository.softDelete(id);
  }
}

// ── Mapping ─────────────────────────────────────────────────────────────────

function toSummary(row: CareerApplicationRow): CareerApplicationSummary {
  const opening = row.jobOpening && !row.jobOpening.deletedAt ? row.jobOpening : null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    jobOpeningId: opening ? opening.id : null,
    role: row.role,
    jobOpeningTitle: opening ? opening.title : null,
    // `status` is app-boundary-constrained on every write path (zod + the verb endpoints),
    // never DB-constrained — cast at this one read-mapping choke point.
    status: row.status as CareerApplicationStatus,
    acknowledgedAt: row.acknowledgedAt ? row.acknowledgedAt.toISOString() : null,
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    decidedByName: row.decidedBy?.name ?? null,
    hasOfferLetter: Boolean(row.offerLetterStorageKey),
    createdAt: row.createdAt.toISOString(),
  };
}

function toCandidateRef(row: CareerApplicationRow): CandidateRef {
  return { name: row.name, email: row.email, role: row.role };
}

/**
 * "Offer-Letter-Priya-Sharma-Senior-Counsellor.pdf" — recognisable in a downloads folder a
 * year later. Stripped to characters that survive every mail client and filesystem.
 */
function buildOfferLetterFilename(candidateName: string, role: string): string {
  const clean = (s: string) =>
    s
      .normalize("NFKD")
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);
  const parts = ["Offer-Letter", clean(candidateName), clean(role)].filter(Boolean);
  return `${parts.join("-")}.pdf`;
}
