// apps/api/src/modules/onboarding/onboarding.service.ts
//
// Business logic for the student onboarding form (stimuliiq.com/onboarding) — the
// in-product replacement for the Google Form students filled after paying.
//
// The distinguishing property of this module: THE FORM'S SHAPE IS DATA. Staff author every
// question from the CRM, so there is no fixed DTO a submission can be validated against.
// That pushes three responsibilities into this file that a normal CRUD service would not
// have, and each one is a place where a shortcut would quietly break something:
//
//   1. VALIDATION IS RESOLVED AGAINST THE LIVE FIELD SET. `submit()` loads the active
//      fields and runs `buildOnboardingAnswerIssues` (@repo/types) — the SAME function the
//      browser runs for inline errors, so the two can never drift. The checks that need
//      server authority (a real program id; a storage key that belongs to this tenant) are
//      layered on top here, because the browser has no standing to assert either.
//
//   2. ANSWERS ARE FROZEN INTO A SNAPSHOT. Each answer is stored with the label and type it
//      was asked under. Staff renaming "College Name" → "Institution" next year must not
//      retroactively relabel answers already collected, and deleting a question must not
//      orphan its answers. The CRM detail view renders straight off that snapshot.
//
//   3. IDENTITY COLUMNS ARE DERIVED, NOT DECLARED. Whichever fields carry
//      `identityRole: name|email|phone` populate the denormalised columns the CRM list
//      shows and searches. That is why the role is a per-field setting and not hardcoded
//      to keys named "name"/"email" — staff can replace the question feeding a column
//      without the column going blank.
//
// SECURITY POSTURE — the public half mirrors content-intake.service.ts exactly (ADR-0019,
// the established convention for anonymous public writes in this codebase):
//   - Captcha-gated + per-IP rate-limited (enforced in the controller, before this runs).
//   - Raw IP is NEVER stored — only SHA-256(ip), matching Lead/ContactSubmission (DPDP).
//   - Free text is sanitised at write time: this is anonymous, untrusted input, so the
//     write-time strip is the primary control, not a render-sink-only posture.
//   - A submitted `file` storage key is pinned to `onboarding/{tenantId}/` before it is
//     trusted, so an anonymous submitter cannot make the CRM later mint a signed download
//     URL for some other tenant's object (the exact hole Wave-6 M3 closed for resumes).
//   - CRM reads/writes are `onboarding.*` permission-gated at scope=all.

import { ForbiddenException, Inject, Injectable, Logger, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { createHash } from "node:crypto";
import type {
  ApproveOnboardingSubmissionRequest,
  ApproveOnboardingSubmissionResponse,
  ListOnboardingSubmissionsQuery,
  OnboardingAnswer,
  OnboardingAnswerValue,
  OnboardingApprovableBatch,
  OnboardingSubmissionDetail,
  OnboardingSubmissionSummary,
  OnboardingUploadUrlRequest,
  OnboardingValidatableField,
  PublicOnboardingForm,
  RejectOnboardingSubmissionRequest,
  SignedUploadResponse,
  SubmitOnboardingRequest,
  SubmitOnboardingResponse,
  UpdateOnboardingSubmissionRequest,
} from "@repo/types";
import { buildOnboardingAnswerIssues } from "@repo/types";
import { PaginatedResult } from "../../common/dto/paginated-result";
import { requireScopeContext } from "../auth/lib/scope-context";
import { CAPTCHA_PROVIDER, type CaptchaProvider } from "../captcha/providers/captcha/captcha-provider.interface";
import { PublicBookingRateLimiter } from "../leads/lib/public-booking-rate-limiter";
import { STORAGE_PROVIDER, type StorageProvider } from "../storage/providers/storage/storage-provider.interface";
import { S3StorageProvider } from "../storage/providers/storage/s3-storage.provider";
import { OnboardingRepository, type OnboardingFieldRow, type OnboardingSubmissionRow } from "./onboarding.repository";
import { OnboardingActivationService } from "./onboarding-activation.service";
import { ONBOARDING_STORAGE_NAMESPACE, toPublicField, toValidatableField, readOptions } from "./onboarding.util";

const TENANT_SLUG = "stimuliiq"; // Single-tenant (mirrors content.util.ts / public-catalog.service.ts).

/** SHA-256 of the client IP — the raw address is never persisted (DPDP). */
function hashIp(ip: string | null | undefined): string {
  return createHash("sha256").update(ip ?? "unknown").digest("hex");
}

/** Strip HTML, trim, truncate. Anonymous free text — same treatment as contact/careers. */
function sanitize(value: string, maxLen = 2000): string {
  return value.replace(/<[^>]*>/g, "").trim().slice(0, maxLen);
}

@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(
    private readonly repository: OnboardingRepository,
    @Inject(CAPTCHA_PROVIDER) private readonly captchaProvider: CaptchaProvider,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    private readonly rateLimiter: PublicBookingRateLimiter,
    private readonly activation: OnboardingActivationService,
  ) {}

  // ── Shared guards ────────────────────────────────────────────────────────

  async resolveTenantId(): Promise<string> {
    const tenantId = await this.repository.getTenantIdBySlug(TENANT_SLUG);
    if (!tenantId) throw new NotFoundException({ code: "onboarding.tenant_not_found", title: "Tenant not found" });
    return tenantId;
  }

  /**
   * Onboarding submissions are a single company-wide intake queue, not branch-partitioned
   * data — a student filling a public form has no branch to be scoped by. So a narrowed
   * data-scope has nothing coherent to resolve to, and we fail closed rather than silently
   * widening it (same call as content/colleges/partners).
   */
  private assertAllScope(): void {
    const scope = requireScopeContext();
    if (scope.scope !== "all") {
      throw new ForbiddenException({
        code: "onboarding.scope_unresolvable",
        title: "Scope not supported",
        detail: `The "${scope.scope}" data-scope is not resolvable for onboarding submissions.`,
      });
    }
  }

  async verifyCaptcha(token: string, ip: string | undefined): Promise<void> {
    const result = await this.captchaProvider.verify(token, ip);
    if (!result.success) {
      this.logger.warn(`[Onboarding] Captcha verification failed — codes: ${result.errorCodes?.join(",")}`);
      throw new UnprocessableEntityException({
        code: "onboarding.captcha_invalid",
        title: "Captcha verification failed",
        detail: "Please complete the captcha challenge and try again.",
      });
    }
  }

  async checkRateLimit(ip: string): Promise<void> {
    const limited = await this.rateLimiter.hit(ip);
    if (limited) {
      throw new UnprocessableEntityException({
        code: "onboarding.rate_limited",
        title: "Too many requests",
        detail: "Please try again in a minute.",
      });
    }
  }

  // ── Public: render the form ──────────────────────────────────────────────

  /**
   * `GET /public/onboarding/form` — the live question set plus the program choices.
   *
   * Programs are fetched only when a `program`-typed field actually exists, so a form
   * without one does not pay for a catalog query on every anonymous page load.
   */
  async getPublicForm(): Promise<PublicOnboardingForm> {
    const tenantId = await this.resolveTenantId();
    const fields = await this.repository.listFields(tenantId, { active: true });
    const needsPrograms = fields.some((field) => field.type === "program");
    const programs = needsPrograms ? await this.repository.listSelectablePrograms(tenantId) : [];
    return { fields: fields.map(toPublicField), programs };
  }

  // ── Public: upload a file answer ─────────────────────────────────────────

  /**
   * `POST /public/onboarding/upload-url` — a short-lived signed PUT for one file answer
   * (the payment-receipt screenshot, and any file question staff add later).
   *
   * `fieldKey` is checked against a real, active `file` field rather than accepted on
   * faith: without that check this is an anonymous "mint me a signed write URL into the
   * company bucket" primitive, which is a different and much worse thing than "upload the
   * receipt this form is asking you for".
   *
   * Fail-closed: if StorageProvider throws (unconfigured credentials), it propagates as a
   * 503 — never a raw or unsigned fallback URL.
   */
  async getUploadUrl(body: OnboardingUploadUrlRequest): Promise<SignedUploadResponse> {
    const tenantId = await this.resolveTenantId();
    const field = await this.repository.findFieldByKey(tenantId, body.fieldKey);
    if (!field || !field.active || field.type !== "file") {
      throw new UnprocessableEntityException({
        code: "onboarding.invalid_upload_field",
        title: "Unknown upload field",
        detail: "This form is not asking for a file under that name. Please reload the page and try again.",
      });
    }

    const { randomUUID } = await import("node:crypto");
    const key = S3StorageProvider.buildKey({
      namespace: ONBOARDING_STORAGE_NAMESPACE,
      tenantId,
      uniqueId: randomUUID(),
      filename: body.fileName,
    });
    const result = await this.storage.getSignedUploadUrl({
      key,
      contentType: body.contentType,
      maxBytes: body.sizeBytes,
      ttlSeconds: 900, // ≤15 min, same ceiling as every other upload-url endpoint.
    });
    return {
      storageKey: result.storageKey,
      uploadUrl: result.url,
      expiresAt: result.expiresAt.toISOString(),
      additionalHeaders: result.requiredHeaders,
      maxSizeBytes: body.sizeBytes,
    };
  }

  // ── Public: submit ───────────────────────────────────────────────────────

  /**
   * `POST /public/onboarding/submit`.
   *
   * Validation order matters: shape rules first (so a student sees every field error at
   * once rather than one per round-trip), then the two server-authoritative checks.
   */
  async submit(dto: SubmitOnboardingRequest, ip: string | undefined): Promise<SubmitOnboardingResponse> {
    const tenantId = await this.resolveTenantId();
    const fields = await this.repository.listFields(tenantId, { active: true });

    if (fields.length === 0) {
      // Nothing is being asked, so there is nothing to accept. Surfacing this rather than
      // silently writing an empty submission makes a misconfigured form obvious at once.
      throw new UnprocessableEntityException({
        code: "onboarding.form_unavailable",
        title: "Form unavailable",
        detail: "The onboarding form is not accepting responses right now. Please contact us.",
      });
    }

    const validatable: OnboardingValidatableField[] = fields.map(toValidatableField);
    const issues = buildOnboardingAnswerIssues(validatable, dto.answers);

    // Server-authoritative checks the browser cannot make for itself.
    const programField = fields.find((field) => field.type === "program");
    let program: { id: string; title: string } | null = null;
    if (programField) {
      const answered = dto.answers[programField.key];
      if (typeof answered === "string" && answered.trim().length > 0) {
        program = await this.repository.findProgramById(tenantId, answered.trim());
        if (!program) {
          issues.push({ key: programField.key, message: "Choose a program from the list." });
        }
      }
    }

    // A `file` answer is only ever a storage key this API minted, into THIS tenant's
    // namespace. Anything else is either a stale key from another tenant or a fabricated
    // one, and both would end up as a signed download URL in the CRM if trusted here.
    const requiredPrefix = `${ONBOARDING_STORAGE_NAMESPACE}/${tenantId}/`;
    for (const field of fields) {
      if (field.type !== "file") continue;
      const answered = dto.answers[field.key];
      if (typeof answered !== "string" || answered.length === 0) continue;
      if (!answered.startsWith(requiredPrefix)) {
        issues.push({ key: field.key, message: "Please re-upload this file and try again." });
      }
    }

    if (issues.length > 0) {
      throw new UnprocessableEntityException({
        code: "onboarding.validation_error",
        title: "Please check your answers",
        detail: issues.map((issue) => issue.message).join(" "),
        // `errors[]` — the SAME field-error channel ZodValidationPipe uses, and the only
        // one the global exception filter forwards (http-exception.filter.ts). Paths are
        // `answers.<fieldKey>` so the form can render each message under its own question.
        errors: issues.map((issue) => ({ path: `answers.${issue.key}`, message: issue.message })),
      });
    }

    const answers = this.buildAnswerSnapshot(fields, dto.answers, program);
    const identity = this.deriveIdentity(fields, dto.answers);

    const created = await this.repository.createSubmission(tenantId, {
      fullName: identity.fullName,
      email: identity.email,
      phone: identity.phone,
      programId: program?.id ?? null,
      answers: answers as unknown as import("@prisma/client").Prisma.InputJsonValue,
      ipHash: hashIp(ip),
    });

    return {
      id: created.id,
      message: "Thanks! Your onboarding details have been received. Our team will be in touch shortly.",
    };
  }

  /**
   * Freezes the answers into the self-describing snapshot the CRM renders from.
   *
   * `value` is always the DISPLAY form: a program's title rather than its uuid, the
   * original filename rather than the object key (which is carried separately in
   * `storageKey` and never shown). A staff member reading a submission should not have to
   * decode identifiers to understand what the student said.
   */
  private buildAnswerSnapshot(
    fields: readonly OnboardingFieldRow[],
    answers: Readonly<Record<string, OnboardingAnswerValue | undefined>>,
    program: { id: string; title: string } | null,
  ): OnboardingAnswer[] {
    return fields.map((field) => {
      const raw = answers[field.key];
      const base = { fieldId: field.id, key: field.key, label: field.label, type: field.type };

      if (field.type === "file") {
        const storageKey = typeof raw === "string" && raw.length > 0 ? raw : null;
        return { ...base, value: storageKey ? fileNameFromKey(storageKey) : null, storageKey };
      }
      if (field.type === "program") {
        return { ...base, value: program?.title ?? null, storageKey: null };
      }
      if (field.type === "checkbox") {
        return { ...base, value: raw === true ? "Yes" : "No", storageKey: null };
      }
      if (raw === undefined || raw === null || raw === "") {
        return { ...base, value: null, storageKey: null };
      }
      return { ...base, value: sanitize(String(raw), 5000), storageKey: null };
    });
  }

  /**
   * Projects the identity columns out of the answers, using whichever fields staff flagged.
   * Phone is normalised to E.164 on the way in so it matches how every other phone in the
   * product is stored (the form collects 10 local digits — see @repo/ui's phone rule).
   */
  private deriveIdentity(
    fields: readonly OnboardingFieldRow[],
    answers: Readonly<Record<string, OnboardingAnswerValue | undefined>>,
  ): { fullName: string | null; email: string | null; phone: string | null } {
    const pick = (role: "name" | "email" | "phone"): string | null => {
      const field = fields.find((candidate) => candidate.identityRole === role);
      if (!field) return null;
      const raw = answers[field.key];
      if (typeof raw !== "string" || raw.trim().length === 0) return null;
      const value = sanitize(raw, 200);
      if (role !== "phone") return value || null;
      const digits = value.replace(/\D/g, "").slice(-10);
      return digits.length === 10 ? `+91${digits}` : value || null;
    };
    return { fullName: pick("name"), email: pick("email")?.toLowerCase() ?? null, phone: pick("phone") };
  }

  // ── CRM: submissions ─────────────────────────────────────────────────────

  async listSubmissions(tenantId: string, query: ListOnboardingSubmissionsQuery): Promise<PaginatedResult<OnboardingSubmissionSummary>> {
    this.assertAllScope();
    const { rows, total } = await this.repository.listSubmissions({
      tenantId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.programId ? { programId: query.programId } : {}),
      ...(query.search ? { search: query.search } : {}),
      page: query.page,
      pageSize: query.pageSize,
    });
    return new PaginatedResult(rows.map(toSubmissionSummary), {
      page: query.page,
      pageSize: query.pageSize,
      total,
      hasMore: query.page * query.pageSize < total,
    });
  }

  /**
   * Detail view. Signed download URLs for file answers are minted here, per request, and
   * never persisted — the storage key stays server-side, exactly as the career-application
   * resume contract does. A signing failure degrades to "no link" rather than failing the
   * whole read: staff still need to see the text answers.
   */
  async getSubmissionById(tenantId: string, id: string): Promise<OnboardingSubmissionDetail> {
    this.assertAllScope();
    const row = await this.repository.findSubmissionById(tenantId, id);
    if (!row) throw new NotFoundException({ code: "onboarding.not_found", title: "Submission not found" });

    const answers = readAnswers(row.answers);
    const attachmentUrls: Record<string, string> = {};
    for (const answer of answers) {
      if (!answer.storageKey) continue;
      try {
        const signed = await this.storage.getSignedDownloadUrl({ key: answer.storageKey });
        attachmentUrls[answer.storageKey] = signed.url;
      } catch (err) {
        this.logger.warn(`[Onboarding] Failed to mint download URL for an attachment (non-fatal): ${String(err)}`);
      }
    }

    return {
      ...toSubmissionSummary(row),
      answers,
      reviewNotes: row.reviewNotes,
      reviewedByName: row.reviewedBy?.name ?? null,
      attachmentUrls,
    };
  }

  /**
   * Triage — reject/hold and notes. Staff never edit a student's answers: the submission is
   * the record of what was actually sent, and an editable record is not evidence.
   *
   * Approving is NOT here (the DTO excludes it): approval creates a student, enrols them
   * and emails their login, so it needs a batch and lives on its own endpoint where those
   * consequences are explicit rather than a side effect of a status write.
   */
  async updateSubmission(
    tenantId: string,
    id: string,
    body: UpdateOnboardingSubmissionRequest,
    actorId: string,
  ): Promise<OnboardingSubmissionDetail> {
    this.assertAllScope();
    const existing = await this.repository.findSubmissionById(tenantId, id);
    if (!existing) throw new NotFoundException({ code: "onboarding.not_found", title: "Submission not found" });

    // An approved submission has an enrolled student behind it. Letting it be flipped back
    // to rejected/hold would leave the chip disagreeing with reality — the student stays
    // enrolled either way. Undoing an approval is an un-enrolment, a different operation
    // with its own screen.
    if (existing.status === "approved" && body.status !== undefined) {
      throw new UnprocessableEntityException({
        code: "onboarding.already_approved",
        title: "This submission is already approved",
        detail:
          "The student has been enrolled, so the decision can't be changed here. Withdraw their enrollment under Students if you need to reverse it.",
      });
    }

    await this.repository.updateSubmission(id, {
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.reviewNotes !== undefined ? { reviewNotes: body.reviewNotes === null ? null : sanitize(body.reviewNotes, 2000) } : {}),
      // Stamped on any triage action, so "who decided this and when" is answerable from the
      // row itself without reading audit_logs.
      reviewedById: actorId,
      reviewedAt: new Date(),
    });
    return this.getSubmissionById(tenantId, id);
  }

  /**
   * `POST /crm/onboarding/submissions/:id/approve` — the decision that activates a student.
   *
   * Idempotent by construction: `studentProfileId` is set only by a successful activation,
   * so a double-click or a retried request finds it already set and refuses rather than
   * enrolling the same person twice and re-sending their credentials.
   *
   * Ordering matters. Activation runs FIRST and the status flips only after it succeeds —
   * so a failure (bad batch, email already belongs to staff) leaves the submission exactly
   * as it was, still actionable, instead of marked approved with no student behind it.
   */
  async approveSubmission(
    tenantId: string,
    id: string,
    body: ApproveOnboardingSubmissionRequest,
    actorId: string,
  ): Promise<ApproveOnboardingSubmissionResponse> {
    this.assertAllScope();
    const existing = await this.repository.findSubmissionById(tenantId, id);
    if (!existing) throw new NotFoundException({ code: "onboarding.not_found", title: "Submission not found" });

    if (existing.studentProfileId) {
      throw new UnprocessableEntityException({
        code: "onboarding.already_approved",
        title: "Already approved",
        detail: "This submission has already been approved and the student is enrolled.",
      });
    }

    const activation = await this.activation.activate({
      tenantId,
      batchId: body.batchId,
      fullName: existing.fullName,
      email: existing.email,
      phone: existing.phone,
      programId: existing.programId,
      // The college answer has no denormalised column (it is not an identity field), so it
      // is read back out of the frozen snapshot — the same place the CRM renders it from.
      college: findAnswerValue(existing.answers, ["college_name", "college", "institution"]),
    });

    await this.repository.updateSubmission(id, {
      status: "approved",
      studentProfileId: activation.studentProfileId,
      ...(body.reviewNotes !== undefined ? { reviewNotes: body.reviewNotes === null ? null : sanitize(body.reviewNotes, 2000) } : {}),
      reviewedById: actorId,
      reviewedAt: new Date(),
    });

    return { submission: await this.getSubmissionById(tenantId, id), activation };
  }

  /**
   * `GET /crm/onboarding/submissions/:id/batches` — what the approve dialog offers.
   *
   * Empty when the submission carries no program (the form may not ask for one) — the CRM
   * then tells the reviewer to create a batch rather than showing an empty dropdown with no
   * explanation.
   */
  async listApprovableBatches(tenantId: string, id: string): Promise<OnboardingApprovableBatch[]> {
    this.assertAllScope();
    const existing = await this.repository.findSubmissionById(tenantId, id);
    if (!existing) throw new NotFoundException({ code: "onboarding.not_found", title: "Submission not found" });
    if (!existing.programId) return [];
    const rows = await this.repository.listApprovableBatches(tenantId, existing.programId);
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      startDate: row.startDate ? row.startDate.toISOString() : null,
      status: row.status,
    }));
  }

  /** `POST /crm/onboarding/submissions/:id/reject` — thin wrapper so the CRM has a verb. */
  async rejectSubmission(
    tenantId: string,
    id: string,
    body: RejectOnboardingSubmissionRequest,
    actorId: string,
  ): Promise<OnboardingSubmissionDetail> {
    return this.updateSubmission(tenantId, id, { status: "rejected", ...body }, actorId);
  }

  async deleteSubmission(tenantId: string, id: string): Promise<void> {
    this.assertAllScope();
    const existing = await this.repository.findSubmissionById(tenantId, id);
    if (!existing) throw new NotFoundException({ code: "onboarding.not_found", title: "Submission not found" });
    await this.repository.softDeleteSubmission(id);
  }
}

/** Reads the stored snapshot back. Defensive: a malformed blob renders as no answers rather
 *  than throwing, so one bad row can never take down the whole submissions screen. */
function readAnswers(value: unknown): OnboardingAnswer[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is OnboardingAnswer => Boolean(entry) && typeof entry === "object" && "key" in entry);
}

function toSubmissionSummary(row: OnboardingSubmissionRow): OnboardingSubmissionSummary {
  return {
    id: row.id,
    fullName: row.fullName,
    email: row.email,
    phone: row.phone,
    programId: row.programId,
    programTitle: row.program?.title ?? null,
    status: row.status,
    hasAttachment: readAnswers(row.answers).some((answer) => Boolean(answer.storageKey)),
    studentProfileId: row.studentProfileId,
    reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Reads a non-identity answer back out of the frozen snapshot by trying a few likely keys.
 *
 * Only `name`/`email`/`phone` have denormalised columns (they earn them by backing CRM list
 * columns); everything else lives in `answers`. Since the question set is staff-authored,
 * the key for "college" is a convention rather than a guarantee — hence a candidate list
 * and a null-safe miss rather than an assumption that would throw on a renamed form.
 */
function findAnswerValue(answers: unknown, candidateKeys: readonly string[]): string | null {
  const parsed = readAnswers(answers);
  for (const key of candidateKeys) {
    const match = parsed.find((answer) => answer.key === key);
    if (match?.value && match.value.trim().length > 0) return match.value.trim();
  }
  return null;
}

/** `onboarding/{tenant}/{uuid}-my receipt.png` → `my receipt.png`. */
function fileNameFromKey(key: string): string {
  const last = key.split("/").pop() ?? key;
  const dashed = last.indexOf("-");
  return dashed >= 0 ? last.slice(dashed + 1) : last;
}

// Re-exported so the admin service and the specs share one definition of "what counts as
// an options array" without reaching into the util module directly.
export { readOptions };
