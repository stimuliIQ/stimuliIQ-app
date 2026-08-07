// Typed onboarding-form SDK (public) — the anonymous half of stimuliiq.com/onboarding.
// CRM authoring + submission review live on `client.crm.onboarding.*`.
//
// The form's questions come from the server (`getForm()`), never from the client bundle —
// staff author them in the CRM, so the page renders whatever this returns.

import type {
  OnboardingUploadUrlRequest,
  PublicOnboardingForm,
  SignedUploadResponse,
  SubmitOnboardingRequest,
  SubmitOnboardingResponse,
} from "@repo/types";
import type { ApiClient } from "../http/client.js";

export class PublicOnboardingApi {
  constructor(private readonly client: ApiClient) {}

  /**
   * GET /api/v1/public/onboarding/form — the live question set plus the choices for any
   * `program`-typed field. No captcha (it is the page's own configuration; gating it would
   * mean solving a challenge before seeing a single question); still rate-limited per IP.
   */
  async getForm(): Promise<PublicOnboardingForm> {
    return this.client.request<PublicOnboardingForm>("GET", "/api/v1/public/onboarding/form");
  }

  /**
   * POST /api/v1/public/onboarding/upload-url — captcha-gated, rate-limited. Mints a signed
   * PUT scoped to `onboarding/{tenantId}/...` for ONE file answer (the payment receipt).
   * Call this FIRST, PUT the file to `uploadUrl`, then send the returned `storageKey` as
   * that field's answer in `submit()`.
   */
  async getUploadUrl(body: OnboardingUploadUrlRequest): Promise<SignedUploadResponse> {
    return this.client.request<SignedUploadResponse>("POST", "/api/v1/public/onboarding/upload-url", { body });
  }

  /**
   * POST /api/v1/public/onboarding/submit — captcha-gated, rate-limited.
   *
   * Per-field problems come back as a 422 `ApiError` whose `problem.errors[]` entries have
   * `path: "answers.<fieldKey>"`, so the form can render each message under its own
   * question rather than as one banner.
   */
  async submit(body: SubmitOnboardingRequest): Promise<SubmitOnboardingResponse> {
    return this.client.request<SubmitOnboardingResponse>("POST", "/api/v1/public/onboarding/submit", { body });
  }
}
