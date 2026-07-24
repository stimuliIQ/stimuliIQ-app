// Typed career-application SDK (public) — Phase 9 Completion, T14/T32. Resume upload
// goes through the existing StorageProvider signed-upload flow (`learning.storage.getUploadUrl`
// with purpose 'career_resume' per backend-builder extension) BEFORE calling apply() with the
// resulting storageKey. Admin list/review lives on `client.crm.content.careers`.

import type {
  PublicCareerResumeUploadUrlRequest,
  PublicCareerResumeUploadUrlResponse,
  SubmitCareerApplicationRequest,
  SubmitCareerApplicationResponse,
} from "@repo/types";
import type { ApiClient } from "../http/client.js";

export class PublicCareersApi {
  constructor(private readonly client: ApiClient) {}

  /**
   * POST /api/v1/public/careers/resume-upload-url — captcha-gated, rate-limited.
   * Mints a signed PUT URL scoped to careers/{tenantId}/... for an ANONYMOUS
   * applicant's resume (no session/JWT required — unlike
   * `client.learning.storage.getUploadUrl()`, which is authenticated). Call this
   * FIRST, PUT the file to `uploadUrl`, then pass the returned `storageKey` as
   * `resumeStorageKey` to `apply()`.
   */
  async getResumeUploadUrl(body: PublicCareerResumeUploadUrlRequest): Promise<PublicCareerResumeUploadUrlResponse> {
    return this.client.request<PublicCareerResumeUploadUrlResponse>(
      "POST",
      "/api/v1/public/careers/resume-upload-url",
      { body },
    );
  }

  /** POST /api/v1/public/careers/apply — captcha-gated. `resumeStorageKey` from a prior signed upload. */
  async apply(body: SubmitCareerApplicationRequest): Promise<SubmitCareerApplicationResponse> {
    return this.client.request<SubmitCareerApplicationResponse>("POST", "/api/v1/public/careers/apply", { body });
  }
}
