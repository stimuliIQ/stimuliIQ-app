// Typed two-factor-auth (TOTP) SDK — Phase-9-completion gap #8. Promotes the stopgap
// `apps/crm/src/lib/two-factor-api.ts` hand-rolled fetch client to a real SDK method,
// matching every other resource API in this codebase (CLAUDE.md §3.2: "frontends must
// never hand-write fetches"). Exposed as `client.auth.twoFactor.*`.
//
// Endpoints covered (own-scope, JwtAuthGuard + `twofa.manage` permission unless noted):
//   GET  /api/v1/auth/2fa/status        → status()
//   POST /api/v1/auth/2fa/enroll        → enroll()
//   POST /api/v1/auth/2fa/enroll/verify → verifyEnroll()
//   POST /api/v1/auth/2fa/disable       → disable()
//   POST /api/v1/auth/2fa/login-verify  → loginVerify() — UNAUTHENTICATED, second step
//                                          of a 2FA login (mirrors AuthApi.login()).
//   POST /api/v1/auth/2fa/recovery/request → requestRecovery() — UNAUTHENTICATED
//   POST /api/v1/auth/2fa/recovery/confirm → confirmRecovery() — UNAUTHENTICATED

import type {
  TotpStatusResponse,
  TotpEnrollResponse,
  TotpVerifyEnrollRequest,
  TotpVerifyEnrollResponse,
  TotpDisableRequest,
  TwoFactorLoginVerifyRequest,
  TwoFactorRecoveryRequest,
  TwoFactorRecoveryRequestResponse,
  TwoFactorRecoveryConfirm,
  TwoFactorRecoveryConfirmResponse,
  AuthSessionData,
} from "@repo/types";
import type { ApiClient } from "../http/client.js";

export class TwoFactorApi {
  constructor(private readonly client: ApiClient) {}

  /** GET /api/v1/auth/2fa/status — the authenticated user's own 2FA enrolment status. */
  async status(): Promise<TotpStatusResponse> {
    return this.client.request<TotpStatusResponse>("GET", "/api/v1/auth/2fa/status");
  }

  /** POST /api/v1/auth/2fa/enroll — issues a new TOTP secret + otpauth URL (QR code). Not yet enabled. */
  async enroll(): Promise<TotpEnrollResponse> {
    return this.client.request<TotpEnrollResponse>("POST", "/api/v1/auth/2fa/enroll", { body: {} });
  }

  /** POST /api/v1/auth/2fa/enroll/verify — confirms the first TOTP code, enables 2FA, returns one-time backup codes. */
  async verifyEnroll(body: TotpVerifyEnrollRequest): Promise<TotpVerifyEnrollResponse> {
    return this.client.request<TotpVerifyEnrollResponse>("POST", "/api/v1/auth/2fa/enroll/verify", { body });
  }

  /** POST /api/v1/auth/2fa/disable — requires a current TOTP or backup code. */
  async disable(body: TotpDisableRequest): Promise<{ disabled: true }> {
    return this.client.request<{ disabled: true }>("POST", "/api/v1/auth/2fa/disable", { body });
  }

  /**
   * POST /api/v1/auth/2fa/login-verify — the second step of a 2FA login.
   * UNAUTHENTICATED (no session exists yet — same posture as `client.auth.login()`).
   * Sets auth + CSRF cookies on success.
   */
  async loginVerify(body: TwoFactorLoginVerifyRequest): Promise<AuthSessionData> {
    const data = await this.client.request<AuthSessionData>("POST", "/api/v1/auth/2fa/login-verify", {
      body,
      skipAuthRefresh: true,
    });
    this.client.setCsrfToken(data.csrfToken);
    return data;
  }

  /**
   * POST /api/v1/auth/2fa/recovery/request — mails a single-use recovery code to a user
   * who has lost their authenticator. UNAUTHENTICATED.
   *
   * ALWAYS resolves with the same generic message — never treat a success here as proof
   * that the account exists, that the password was right, or that 2FA was enrolled.
   */
  async requestRecovery(body: TwoFactorRecoveryRequest): Promise<TwoFactorRecoveryRequestResponse> {
    return this.client.request<TwoFactorRecoveryRequestResponse>("POST", "/api/v1/auth/2fa/recovery/request", {
      body,
      skipAuthRefresh: true,
    });
  }

  /**
   * POST /api/v1/auth/2fa/recovery/confirm — consumes the emailed code and turns 2FA
   * OFF. UNAUTHENTICATED, and deliberately does NOT establish a session: the caller
   * signs in with their password afterwards and re-enrols.
   */
  async confirmRecovery(body: TwoFactorRecoveryConfirm): Promise<TwoFactorRecoveryConfirmResponse> {
    return this.client.request<TwoFactorRecoveryConfirmResponse>("POST", "/api/v1/auth/2fa/recovery/confirm", {
      body,
      skipAuthRefresh: true,
    });
  }
}
