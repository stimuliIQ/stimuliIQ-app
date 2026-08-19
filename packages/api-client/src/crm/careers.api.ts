// Typed careers SDK (CRM) — job openings and the application review queue.
// Spec: docs/specs/careers-hiring.md, ADR-0066.
// Exposed on the SDK as `client.crm.careers.openings.*` / `client.crm.careers.applications.*`.
// The public apply flow lives on `client.public.careers.*`.
//
// NOTE THERE IS NO `updateStatus()`. A career application's status is never set directly —
// it is the residue of one of four review verbs, each with its own endpoint and its own
// candidate email (or, for `hold`, deliberately none). See careers.schemas.ts's file header
// for why a dropdown was the wrong control for an action that mails a real person.

import type {
  CareerApplicationDetail,
  CareerApplicationSummary,
  CreateJobOpeningRequest,
  HoldCareerApplicationRequest,
  JobOpening,
  ListCareerApplicationsQuery,
  ListJobOpeningsQuery,
  OfferCareerApplicationRequest,
  OfferLetterUploadUrlRequest,
  RejectCareerApplicationRequest,
  ResendAcknowledgementResponse,
  ShortlistCareerApplicationRequest,
  SignedUploadResponse,
  UpdateJobOpeningRequest,
} from "@repo/types";
import type { ApiClient } from "../http/client.js";
import { toQueryString } from "../http/query.js";

export class JobOpeningsApi {
  constructor(private readonly client: ApiClient) {}

  /** GET /api/v1/crm/job-openings — includes per-opening applicant counts and `isLive`. */
  async list(query: ListJobOpeningsQuery) {
    return this.client.requestPaginated<JobOpening>("GET", `/api/v1/crm/job-openings${toQueryString(query)}`);
  }

  async get(id: string): Promise<JobOpening> {
    return this.client.request<JobOpening>("GET", `/api/v1/crm/job-openings/${id}`);
  }

  /** POST /api/v1/crm/job-openings. Omit `slug` to have it derived from the title. */
  async create(body: CreateJobOpeningRequest): Promise<JobOpening> {
    return this.client.request<JobOpening>("POST", "/api/v1/crm/job-openings", { body });
  }

  async update(id: string, body: UpdateJobOpeningRequest): Promise<JobOpening> {
    return this.client.request<JobOpening>("PATCH", `/api/v1/crm/job-openings/${id}`, { body });
  }

  /**
   * DELETE /api/v1/crm/job-openings/:id — soft delete.
   *
   * Closing (`update(id, { status: "closed" })`) is almost always what is actually wanted:
   * it keeps the advert's applications attached to a named role and lets it be re-published
   * next hiring round. Delete is for an advert posted by mistake.
   */
  async remove(id: string): Promise<{ deleted: true }> {
    return this.client.request<{ deleted: true }>("DELETE", `/api/v1/crm/job-openings/${id}`);
  }
}

export class CareerApplicationsApi {
  constructor(private readonly client: ApiClient) {}

  /** GET /api/v1/crm/career-applications */
  async list(query: ListCareerApplicationsQuery) {
    return this.client.requestPaginated<CareerApplicationSummary>(
      "GET",
      `/api/v1/crm/career-applications${toQueryString(query)}`,
    );
  }

  /** GET /api/v1/crm/career-applications/:id — includes signed resume + offer-letter URLs. */
  async get(id: string): Promise<CareerApplicationDetail> {
    return this.client.request<CareerApplicationDetail>("GET", `/api/v1/crm/career-applications/${id}`);
  }

  // ── The four review verbs ──────────────────────────────────────────────────

  /** Park a candidate. The one verb that sends NO email. */
  async hold(id: string, body: HoldCareerApplicationRequest = {}): Promise<CareerApplicationDetail> {
    return this.client.request<CareerApplicationDetail>("POST", `/api/v1/crm/career-applications/${id}/hold`, { body });
  }

  /** Move to a further round. Emails the candidate the round name and what to expect. */
  async shortlist(id: string, body: ShortlistCareerApplicationRequest): Promise<CareerApplicationDetail> {
    return this.client.request<CareerApplicationDetail>("POST", `/api/v1/crm/career-applications/${id}/shortlist`, {
      body,
    });
  }

  /**
   * Offer the role. Emails the candidate with the uploaded offer letter ATTACHED.
   * Upload the letter first via `getOfferLetterUploadUrl()` + a PUT, then pass the key here.
   *
   * The letter is read out of storage BEFORE the status changes, so an unreadable file
   * fails the whole action and leaves the application untouched — the candidate is never
   * marked offered without having been sent something.
   */
  async offer(id: string, body: OfferCareerApplicationRequest): Promise<CareerApplicationDetail> {
    return this.client.request<CareerApplicationDetail>("POST", `/api/v1/crm/career-applications/${id}/offer`, { body });
  }

  /** Decline. Emails the candidate; `internalNotes` is stored and never sent to them. */
  async reject(id: string, body: RejectCareerApplicationRequest = {}): Promise<CareerApplicationDetail> {
    return this.client.request<CareerApplicationDetail>("POST", `/api/v1/crm/career-applications/${id}/reject`, {
      body,
    });
  }

  // ── Supporting actions ─────────────────────────────────────────────────────

  /** POST .../offer-letter-upload-url — signed PUT URL under offer-letters/{tenantId}/... */
  async getOfferLetterUploadUrl(id: string, body: OfferLetterUploadUrlRequest): Promise<SignedUploadResponse> {
    return this.client.request<SignedUploadResponse>(
      "POST",
      `/api/v1/crm/career-applications/${id}/offer-letter-upload-url`,
      { body },
    );
  }

  /**
   * Re-send the "thanks for applying" mail. Only does anything when the automatic one never
   * went out (`acknowledgedAt` is null) — a second click cannot spam the candidate.
   */
  async resendAcknowledgement(id: string): Promise<ResendAcknowledgementResponse> {
    return this.client.request<ResendAcknowledgementResponse>(
      "POST",
      `/api/v1/crm/career-applications/${id}/resend-acknowledgement`,
    );
  }

  /** Soft delete — spam, a duplicate, or a candidate's erasure request. */
  async remove(id: string): Promise<{ deleted: true }> {
    return this.client.request<{ deleted: true }>("DELETE", `/api/v1/crm/career-applications/${id}`);
  }
}

/** Nested namespace → `client.crm.careers.openings` / `.applications`. */
export class CareersApi {
  readonly openings: JobOpeningsApi;
  readonly applications: CareerApplicationsApi;

  constructor(client: ApiClient) {
    this.openings = new JobOpeningsApi(client);
    this.applications = new CareerApplicationsApi(client);
  }
}
