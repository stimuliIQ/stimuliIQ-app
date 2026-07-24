// Typed auth SDK methods — the ONLY way frontend code talks to the auth
// routes (CLAUDE.md §3.2: "frontends must never hand-write fetches").
// Every request/response shape is imported from @repo/types, never
// redeclared here.

import type {
  LoginRequest,
  OtpRequestRequest,
  OtpVerifyRequest,
  AuthSessionData,
  OtpRequestData,
  LogoutData,
  MeResponse,
  RequestPasswordResetRequest,
  RequestPasswordResetResponse,
  ConfirmPasswordResetRequest,
  ConfirmPasswordResetResponse,
  ChangePasswordRequest,
  ChangePasswordResponse,
} from "@repo/types";
import type { ApiClient } from "../http/client.js";
import { TwoFactorApi } from "./two-factor.api.js";

export class AuthApi {
  /** Phase-9-completion gap #8 — `client.auth.twoFactor.*` (own-scope 2FA enrol/verify/disable/status + login-verify). */
  readonly twoFactor: TwoFactorApi;

  constructor(private readonly client: ApiClient) {
    this.twoFactor = new TwoFactorApi(client);
  }

  /** POST /api/v1/auth/login — sets auth + CSRF cookies; returns the user summary + CSRF token. */
  async login(body: LoginRequest): Promise<AuthSessionData> {
    const data = await this.client.request<AuthSessionData>("POST", "/api/v1/auth/login", {
      body,
      skipAuthRefresh: true,
    });
    this.client.setCsrfToken(data.csrfToken);
    return data;
  }

  /**
   * POST /api/v1/auth/refresh — rotates the refresh token via the httpOnly
   * cookie. Body is intentionally empty (see RefreshRequestSchema). This is
   * the method the app-level `onUnauthorized` hook (see ApiClientConfig)
   * should call on a 401 before retrying the original request.
   */
  async refresh(): Promise<AuthSessionData> {
    const data = await this.client.request<AuthSessionData>("POST", "/api/v1/auth/refresh", {
      body: {},
      skipAuthRefresh: true,
    });
    this.client.setCsrfToken(data.csrfToken);
    return data;
  }

  /** POST /api/v1/auth/logout — revokes the session and clears cookies. */
  async logout(): Promise<LogoutData> {
    return this.client.request<LogoutData>("POST", "/api/v1/auth/logout", { body: {}, skipAuthRefresh: true });
  }

  /** POST /api/v1/auth/otp/request — issues a 6-digit OTP (send is stubbed behind SmsProvider in Phase 0). */
  async otpRequest(body: OtpRequestRequest): Promise<OtpRequestData> {
    return this.client.request<OtpRequestData>("POST", "/api/v1/auth/otp/request", { body, skipAuthRefresh: true });
  }

  /** POST /api/v1/auth/otp/verify — verifies the OTP; sets auth + CSRF cookies on success. */
  async otpVerify(body: OtpVerifyRequest): Promise<AuthSessionData> {
    const data = await this.client.request<AuthSessionData>("POST", "/api/v1/auth/otp/verify", {
      body,
      skipAuthRefresh: true,
    });
    this.client.setCsrfToken(data.csrfToken);
    return data;
  }

  /** GET /api/v1/me — current user + tenant + roles + flattened permission grants. */
  async getMe(): Promise<MeResponse> {
    return this.client.request<MeResponse>("GET", "/api/v1/me");
  }

  /**
   * POST /api/v1/auth/password-reset/request (B9, Phase 9 Completion)
   * UNAUTHENTICATED. Always returns 200 with a generic message — never reveals
   * whether the email exists (enumeration-resistant).
   */
  async requestPasswordReset(body: RequestPasswordResetRequest): Promise<RequestPasswordResetResponse> {
    return this.client.request<RequestPasswordResetResponse>("POST", "/api/v1/auth/password-reset/request", {
      body,
      skipAuthRefresh: true,
    });
  }

  /**
   * POST /api/v1/auth/password-reset/confirm (B9, Phase 9 Completion)
   * UNAUTHENTICATED. `token` is the single-use, short-TTL token from the reset
   * email link. 422 TOKEN_INVALID_OR_EXPIRED on replay/expiry/tamper.
   */
  async confirmPasswordReset(body: ConfirmPasswordResetRequest): Promise<ConfirmPasswordResetResponse> {
    return this.client.request<ConfirmPasswordResetResponse>("POST", "/api/v1/auth/password-reset/confirm", {
      body,
      skipAuthRefresh: true,
    });
  }

  /**
   * POST /api/v1/auth/change-password (lifecycle-redesign P3 — first-login flow).
   * AUTHENTICATED: sends the current (temporary) password + a new one. On success the
   * server revokes ALL sessions and clears cookies, so the caller must route to /login
   * afterwards. `skipAuthRefresh` because a 401/expired here should not trigger the
   * silent-refresh seam — the credential is being changed out from under the session.
   */
  async changePassword(body: ChangePasswordRequest): Promise<ChangePasswordResponse> {
    return this.client.request<ChangePasswordResponse>("POST", "/api/v1/auth/change-password", {
      body,
      skipAuthRefresh: true,
    });
  }
}
