// Certificates SDK — Phase 4, Wave 2
// (docs/plans/phase-4.md task #2).
//
// Namespace: client.learning.certificates.*
//
// Endpoints covered:
//   CRM (ops/faculty, assigned/all-scope):
//     GET  /crm/certificates/eligibility               → listEligibility()
//     GET  /crm/certificates/eligibility-batches       → listEligibilityBatches()
//     GET  /crm/certificates/eligibility/:enrollmentId → getEligibility()
//     GET  /crm/certificate-templates                  → listTemplates()
//     POST /crm/certificates                           → issue()
//     POST /crm/certificates/:enrollmentId/recommend   → recommend()
//     GET  /crm/certificates/:id                       → getCrm()
//     PATCH /crm/certificates/:id/revoke               → revoke() [instant, audited]
//     POST /crm/certificates/:enrollmentId/reissue     → reissue()
//
//   LMS (student, own-scope):
//     GET  /me/certificates                            → listMine()
//     GET  /me/certificates/:id                        → getMine()
//     GET  /me/certificates/:id/download               → getDownloadUrl()
//
//   PUBLIC (no auth):
//     GET  /verify/:certUid                            → verify()
//
// SECURITY GUARANTEES:
//   1. verify() is unauthenticated (no CSRF, no cookieAuth).
//   2. verify() response is MINIMAL: { valid, status, program, issuedAt, holderName } ONLY.
//      The VerifyResult type makes it impossible to add banned fields (compile-time assertion).
//   3. getDownloadUrl() returns a short-lived signed URL (NEVER a raw bucket URL).
//   4. Revocation is instant — the next verify() call reflects it immediately.
//   5. issue() runs the eligibility engine server-side (422 NOT_ELIGIBLE with reasons on failure).

import type {
  EligibilityResult,
  EligibilityListItem,
  EligibilityBatchSummary,
  IssueCertificateRequest,
  RecommendCertificateRequest,
  RevokeCertificateRequest,
  ReissueCertificateRequest,
  CertificateListItem,
  CertificateDetail,
  CertificateDownloadResponse,
  CertificateCrmDetail,
  VerifyResult,
  CertificateTemplateSummary,
  CertificateTemplateDetail,
  CreateCertificateTemplateRequest,
  UpdateCertificateTemplateRequest,
  BulkIssueCertificatesRequest,
  BulkIssueCertificatesResponse,
  ListCertificatesQuery,
  ListEligibilityQuery,
  ListEligibilityBatchesQuery,
} from "@repo/types";
import type { ApiClient } from "../http/client.js";
import { toQueryString } from "../http/query.js";

export class CertificatesApi {
  constructor(private readonly client: ApiClient) {}

  // ─── CRM eligibility ─────────────────────────────────────────────────────

  /**
   * GET /api/v1/crm/certificates/eligibility
   * Eligibility list — which enrollments have cleared which gates.
   * Permission: certificates.view (scope: assigned|all).
   */
  async listEligibility(query?: Partial<ListEligibilityQuery>) {
    return this.client.requestPaginated<EligibilityListItem>(
      "GET",
      `/api/v1/crm/certificates/eligibility${toQueryString(query ?? {})}`,
    );
  }

  /**
   * GET /api/v1/crm/certificates/eligibility-batches
   * Batch-first landing view of CRM ▸ Certificates — one row per cohort with
   * cheap headline counts, which the UI drills into via
   * `listEligibility({ batchId })`. `search` matches batch/program name here.
   * Permission: certificates.view (scope: assigned|all).
   */
  async listEligibilityBatches(query?: Partial<ListEligibilityBatchesQuery>) {
    return this.client.requestPaginated<EligibilityBatchSummary>(
      "GET",
      `/api/v1/crm/certificates/eligibility-batches${toQueryString(query ?? {})}`,
    );
  }

  /**
   * GET /api/v1/crm/certificates/eligibility/:enrollmentId
   * Eligibility detail for one enrollment.
   * Permission: certificates.view (scope: assigned|all).
   */
  async getEligibility(enrollmentId: string): Promise<EligibilityResult> {
    return this.client.request<EligibilityResult>(
      "GET",
      `/api/v1/crm/certificates/eligibility/${enrollmentId}`,
    );
  }

  /**
   * GET /api/v1/crm/certificate-templates
   * Available seeded templates for ops to select at issuance.
   * Permission: certificates.view.
   */
  async listTemplates() {
    return this.client.requestPaginated<CertificateTemplateSummary>(
      "GET",
      "/api/v1/crm/certificate-templates",
    );
  }

  /**
   * GET /api/v1/crm/certificate-templates/:id
   * Full template row incl. the CRM designer's saved field layout.
   * Permission: certificates.view.
   */
  async getTemplate(id: string): Promise<CertificateTemplateDetail> {
    return this.client.request<CertificateTemplateDetail>("GET", `/api/v1/crm/certificate-templates/${id}`);
  }

  /**
   * POST /api/v1/crm/certificate-templates
   * Create a certificate template (design/fields/layout). AUDITED.
   * Permission: certificates.issue.
   */
  async createTemplate(
    body: CreateCertificateTemplateRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<CertificateTemplateDetail> {
    return this.client.request<CertificateTemplateDetail>("POST", "/api/v1/crm/certificate-templates", {
      body,
      idempotencyKey,
    });
  }

  /**
   * PATCH /api/v1/crm/certificate-templates/:id
   * Update a template — the CRM designer's "Save layout" action sends { layout } only.
   * AUDITED. Permission: certificates.issue.
   */
  async updateTemplate(
    id: string,
    body: UpdateCertificateTemplateRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<CertificateTemplateDetail> {
    return this.client.request<CertificateTemplateDetail>("PATCH", `/api/v1/crm/certificate-templates/${id}`, {
      body,
      idempotencyKey,
    });
  }

  // ─── CRM issuance / revoke ───────────────────────────────────────────────

  /**
   * POST /api/v1/crm/certificates
   *
   * Issue a certificate for an eligible enrollment.
   * Server runs eligibility engine → generates cert_uid (HMAC-signed) → renders PDF
   * → stores via StorageProvider → inserts certificates row. Writes audit log.
   *
   * Errors:
   *   - 422 NOT_ELIGIBLE (with reasons.completionPassed/requiredAssessmentsPassed/finalProjectApproved)
   *   - 409 CERTIFICATE_ALREADY_EXISTS (valid cert exists)
   *   - 409 CERTIFICATE_REVOKED_REISSUE (revoked cert exists — use reissue() instead)
   *
   * Permission: certificates.issue (scope: all|branch).
   */
  async issue(
    body: IssueCertificateRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<CertificateCrmDetail> {
    return this.client.request<CertificateCrmDetail>("POST", "/api/v1/crm/certificates", {
      body,
      idempotencyKey,
    });
  }

  /**
   * POST /api/v1/crm/certificates/bulk
   *
   * Issue certificates for a list of eligible enrollments in ONE audited call —
   * replaces the CRM bulk-issue dialog's former client-side per-row loop. One row
   * failing (NOT_ELIGIBLE, already issued, etc.) does not abort the others; check
   * `results[i].success`/`errorCode` per row.
   *
   * Permission: certificates.issue (scope: all|branch).
   */
  async bulkIssue(
    body: BulkIssueCertificatesRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<BulkIssueCertificatesResponse> {
    return this.client.request<BulkIssueCertificatesResponse>("POST", "/api/v1/crm/certificates/bulk", {
      body,
      idempotencyKey,
    });
  }

  /**
   * POST /api/v1/crm/certificates/:enrollmentId/recommend
   *
   * Faculty recommends an enrollment for issuance (flag only — no cert row created).
   * The recommendation timestamp appears in the eligibility list.
   * Permission: certificates.recommend (scope: assigned).
   */
  async recommend(
    enrollmentId: string,
    body: RecommendCertificateRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<EligibilityResult> {
    return this.client.request<EligibilityResult>(
      "POST",
      `/api/v1/crm/certificates/${enrollmentId}/recommend`,
      { body, idempotencyKey },
    );
  }

  /**
   * GET /api/v1/crm/certificates/:id
   * Certificate detail for ops/faculty view (includes enrollment + student info).
   * Permission: certificates.view (scope: assigned|all).
   */
  async getCrm(id: string): Promise<CertificateCrmDetail> {
    return this.client.request<CertificateCrmDetail>("GET", `/api/v1/crm/certificates/${id}`);
  }

  /**
   * PATCH /api/v1/crm/certificates/:id/revoke
   *
   * Revoke a valid certificate. INSTANT — the next verify() call reflects revoked status.
   * Writes audit log entry (revoked_at, revoked_by, revoked_reason).
   * Error: 409 ALREADY_REVOKED.
   *
   * Permission: certificates.revoke (scope: all).
   */
  async revoke(
    id: string,
    body: RevokeCertificateRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<CertificateCrmDetail> {
    return this.client.request<CertificateCrmDetail>(
      "PATCH",
      `/api/v1/crm/certificates/${id}/revoke`,
      { body, idempotencyKey },
    );
  }

  /**
   * POST /api/v1/crm/certificates/:enrollmentId/reissue
   *
   * Reissue a revoked certificate. Old row is soft-deleted; new cert_uid + PDF created.
   * OLD cert_uid is invalidated (verify() returns 404 for the old uid).
   * Writes audit log entry.
   *
   * Permission: certificates.issue (scope: all|branch).
   */
  async reissue(
    enrollmentId: string,
    body: ReissueCertificateRequest,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<CertificateCrmDetail> {
    return this.client.request<CertificateCrmDetail>(
      "POST",
      `/api/v1/crm/certificates/${enrollmentId}/reissue`,
      { body, idempotencyKey },
    );
  }

  // ─── LMS / student (own-scope) ───────────────────────────────────────────

  /**
   * GET /api/v1/me/certificates
   * Student's own certificates (list).
   * Permission: certificates.view (scope: own).
   */
  async listMine(query?: Partial<ListCertificatesQuery>) {
    return this.client.requestPaginated<CertificateListItem>(
      "GET",
      `/api/v1/me/certificates${toQueryString(query ?? {})}`,
    );
  }

  /**
   * GET /api/v1/me/certificates/:id
   * Own certificate detail. IDOR→404 for another student's cert.
   * Permission: certificates.view (scope: own).
   */
  async getMine(id: string): Promise<CertificateDetail> {
    return this.client.request<CertificateDetail>("GET", `/api/v1/me/certificates/${id}`);
  }

  /**
   * GET /api/v1/me/certificates/:id/download
   *
   * Returns a short-lived signed GET URL for the certificate PDF (NOT a raw bucket URL).
   * Errors:
   *   - 410 CERTIFICATE_REVOKED (AC-F5)
   *   - 404 if certificate not yet issued or doesn't belong to student (AC-F2/F3/F4)
   *
   * NOTE: Re-call this endpoint to get a fresh URL — do NOT cache the signed URL.
   * Permission: certificates.view (scope: own).
   */
  async getDownloadUrl(id: string): Promise<CertificateDownloadResponse> {
    return this.client.request<CertificateDownloadResponse>(
      "GET",
      `/api/v1/me/certificates/${id}/download`,
    );
  }

  // ─── PUBLIC verify (no auth) ─────────────────────────────────────────────

  /**
   * GET /api/v1/verify/:certUid
   *
   * PUBLIC certificate verification — no authentication required.
   *
   * The server RECOMPUTES the cert_uid HMAC signature before any DB lookup.
   * A fabricated or tampered cert_uid fails before the DB is queried (AC-H3/H4).
   *
   * Response is MINIMAL:
   *   - valid=true  → { valid: true, status: 'valid', program, issuedAt, holderName }
   *   - revoked     → { valid: 'revoked', status: 'revoked', program, issuedAt, holderName }
   *   - invalid/not-found → 404 (ApiError)
   *
   * NO internal IDs, NO email, NO phone (AC-H7).
   * Rate-limited by IP (429 + Retry-After — AC-H6).
   *
   * Permission: certificates.verify (public, no permission check needed).
   */
  async verify(certUid: string): Promise<VerifyResult> {
    return this.client.request<VerifyResult>("GET", `/api/v1/verify/${encodeURIComponent(certUid)}`);
  }

  /**
   * GET /api/v1/verify/:certUid/download — PUBLIC, UNAUTHENTICATED.
   *
   * Mints a short-lived signed URL for the certificate PDF (the "Download certificate"
   * button on the public verification page). Holding a valid signed cert_uid is the
   * authorisation; a revoked certificate is 410 Gone, a tampered uid is 404.
   *
   * Rate-limited by IP (429 + Retry-After), same as verify().
   */
  async downloadPublic(certUid: string): Promise<CertificateDownloadResponse> {
    return this.client.request<CertificateDownloadResponse>(
      "GET",
      `/api/v1/verify/${encodeURIComponent(certUid)}/download`,
    );
  }
}
