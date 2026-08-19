// Typed careers SDK (public) — the open roles and the apply flow.
// Spec: docs/specs/careers-hiring.md, ADR-0066.
//
// APPLYING IS A THREE-CALL SEQUENCE, in this order:
//   1. getResumeUploadUrl() → a short-lived signed PUT URL + the server-assigned storageKey
//   2. PUT the file directly to that URL — never proxied through the API server
//   3. apply() with the returned `resumeStorageKey`
// Steps 1 and 3 are both captcha-gated and per-IP rate-limited.
//
// Admin review lives on `client.crm.careers.*`.

import type {
  ListPublicJobOpeningsQuery,
  PublicCareerResumeUploadUrlRequest,
  PublicCareerResumeUploadUrlResponse,
  PublicJobOpening,
  SubmitCareerApplicationRequest,
  SubmitCareerApplicationResponse,
} from "@repo/types";
import type { ApiClient } from "../http/client.js";
import { toQueryString } from "../http/query.js";

export class PublicCareersApi {
  constructor(private readonly client: ApiClient) {}

  /**
   * GET /api/v1/public/careers/openings — the live roles.
   *
   * "Live" means published AND not past its closing date, decided server-side; a lapsed
   * opening disappears on its own without anybody having to close it. Unauthenticated and
   * uncaptcha'd — this is published marketing content, like /public/programs.
   */
  async listOpenings(query: ListPublicJobOpeningsQuery = { limit: 30 }): Promise<PublicJobOpening[]> {
    return this.client.request<PublicJobOpening[]>(
      "GET",
      `/api/v1/public/careers/openings${toQueryString(query)}`,
    );
  }

  /**
   * POST /api/v1/public/careers/resume-upload-url — captcha-gated, rate-limited.
   * Mints a signed PUT URL scoped to careers/{tenantId}/... for an ANONYMOUS applicant's
   * resume (no session/JWT required — unlike `client.learning.storage.getUploadUrl()`,
   * which is authenticated). Call this FIRST, PUT the file to `uploadUrl`, then pass the
   * returned `storageKey` as `resumeStorageKey` to `apply()`.
   */
  async getResumeUploadUrl(body: PublicCareerResumeUploadUrlRequest): Promise<PublicCareerResumeUploadUrlResponse> {
    return this.client.request<PublicCareerResumeUploadUrlResponse>(
      "POST",
      "/api/v1/public/careers/resume-upload-url",
      { body },
    );
  }

  /**
   * POST /api/v1/public/careers/apply — captcha-gated. `resumeStorageKey` comes from a
   * prior `getResumeUploadUrl()` + PUT.
   *
   * `jobOpeningId` is optional and forgiving by design: if the role closed between the page
   * loading and the form submitting, the application is still recorded (against its role
   * title) rather than rejected. The candidate is acknowledged by email either way.
   */
  async apply(body: SubmitCareerApplicationRequest): Promise<SubmitCareerApplicationResponse> {
    return this.client.request<SubmitCareerApplicationResponse>("POST", "/api/v1/public/careers/apply", { body });
  }
}
