"use client";

/**
 * EnrollRegisterStep — Step 0 of the enrollment funnel.
 *
 * Collects: name, email, phone, OTP (6-digit), password, TOS consent, captcha.
 * Also renders an OTP request button (→ POST /auth/otp/request).
 *
 * a11y:
 *   - All fields have labels
 *   - OTP field has aria-describedby for instructions
 *   - Errors are role="alert"
 *   - Honeypot field is aria-hidden + tabIndex=-1 + off-screen (AC-42)
 *
 * Security:
 *   - Honeypot present (AC-42)
 *   - Captcha required (TurnstileWidget → captchaToken field)
 *   - No secrets, no money math
 */

import { useId, useState } from "react";
import {
  PHONE_INPUT_PROPS,
  PHONE_PLACEHOLDER,
  isCompleteLocalPhone,
  toLocalPhoneDigits,
} from "@repo/ui";
import type { RegisterFormData } from "../../../../hooks/use-enroll-funnel";
import { TurnstileWidget } from "../../../../components/captcha/turnstile-widget";

const TOS_VERSION =
  typeof process !== "undefined"
    ? (process.env.NEXT_PUBLIC_TOS_VERSION ?? "v1.0")
    : "v1.0";

interface EnrollRegisterStepProps {
  data: RegisterFormData;
  onChange: (data: Partial<RegisterFormData>) => void;
  errors: Record<string, string>;
  onRequestOtp: (phone: string) => Promise<void>;
  isLoading: boolean;
  globalError?: string;
}

const inputClass = [
  "h-11 w-full rounded-md border border-border bg-card px-3 text-sm text-fg placeholder:text-fg-subtle",
  "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
].join(" ");

export function EnrollRegisterStep({
  data,
  onChange,
  errors,
  onRequestOtp,
  isLoading: _isLoading,
  globalError,
}: EnrollRegisterStepProps) {
  const nameId = useId();
  const emailId = useId();
  const phoneId = useId();
  const otpId = useId();
  const passwordId = useId();
  const tosId = useId();
  const marketingId = useId();

  const [otpSent, setOtpSent] = useState(false);
  const [sendingOtp, setSendingOtp] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // The OTP is bound to the number, so it can only be requested once the full
  // 10 digits are in — a partial number would mint a code for the wrong phone.
  const canRequestOtp = isCompleteLocalPhone(data.phone);

  async function handleRequestOtp() {
    if (!canRequestOtp) return;
    setSendingOtp(true);
    await onRequestOtp(data.phone);
    setSendingOtp(false);
    setOtpSent(true);
  }

  return (
    <div className="flex flex-col gap-4" data-testid="enroll-register-step">
      <p className="text-sm text-fg-muted">
        Create your account to proceed with enrollment. Already have an account?{" "}
        <a href="/account" className="text-brand-500 underline hover:text-brand-600">
          Log in
        </a>
      </p>

      {/* Honeypot (AC-42) */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          left: "-9999px",
          width: "1px",
          height: "1px",
          overflow: "hidden",
          opacity: 0,
          pointerEvents: "none",
        }}
      >
        {/* type="text" + non-email-token name: browser autofill matches "email"
            in name/type and would fill the honeypot for real users, silently
            discarding their submission. Bots fill every input regardless. */}
        <input
          type="text"
          name="_hp_field"
          value={data._hp_email}
          onChange={(e) => onChange({ _hp_email: e.target.value })}
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          data-testid="honeypot-field"
        />
      </div>

      {/* Global error */}
      {globalError ? (
        <div
          role="alert"
          className="rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger"
          data-testid="register-global-error"
        >
          {globalError}
        </div>
      ) : null}

      {/* Name */}
      <div>
        <label htmlFor={nameId} className="mb-1.5 block text-sm font-medium text-fg">
          Full name <span aria-hidden="true" className="text-danger">*</span>
        </label>
        <input
          id={nameId}
          type="text"
          autoComplete="name"
          value={data.name}
          onChange={(e) => onChange({ name: e.target.value })}
          aria-required="true"
          aria-invalid={!!errors.name}
          aria-describedby={errors.name ? `${nameId}-error` : undefined}
          className={[inputClass, errors.name ? "border-danger" : ""].join(" ")}
          placeholder="Your full name"
          data-testid="register-name"
        />
        {errors.name ? (
          <p id={`${nameId}-error`} role="alert" className="mt-1.5 text-xs text-danger">
            {errors.name}
          </p>
        ) : null}
      </div>

      {/* Email */}
      <div>
        <label htmlFor={emailId} className="mb-1.5 block text-sm font-medium text-fg">
          Email address <span aria-hidden="true" className="text-danger">*</span>
        </label>
        <input
          id={emailId}
          type="email"
          autoComplete="email"
          value={data.email}
          onChange={(e) => onChange({ email: e.target.value })}
          aria-required="true"
          aria-invalid={!!errors.email}
          aria-describedby={errors.email ? `${emailId}-error` : undefined}
          className={[inputClass, errors.email ? "border-danger" : ""].join(" ")}
          placeholder="you@example.com"
          data-testid="register-email"
        />
        {errors.email ? (
          <p id={`${emailId}-error`} role="alert" className="mt-1.5 text-xs text-danger">
            {errors.email}
          </p>
        ) : null}
      </div>

      {/* Phone + OTP request */}
      <div>
        <label htmlFor={phoneId} className="mb-1.5 block text-sm font-medium text-fg">
          Phone number <span aria-hidden="true" className="text-danger">*</span>
        </label>
        <div className="flex gap-2">
          <input
            {...PHONE_INPUT_PROPS}
            id={phoneId}
            value={data.phone}
            onChange={(e) => onChange({ phone: toLocalPhoneDigits(e.target.value) })}
            aria-required="true"
            aria-invalid={!!errors.phone}
            aria-describedby={errors.phone ? `${phoneId}-error` : undefined}
            className={[inputClass, "flex-1", errors.phone ? "border-danger" : ""].join(" ")}
            placeholder={PHONE_PLACEHOLDER}
            data-testid="register-phone"
          />
          <button
            type="button"
            onClick={handleRequestOtp}
            disabled={sendingOtp || !canRequestOtp}
            aria-label={otpSent ? "Resend OTP" : "Send OTP to phone"}
            className="shrink-0 flex min-h-[44px] items-center rounded-md border border-border px-4 text-sm font-medium text-fg transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="send-otp-btn"
          >
            {sendingOtp ? "Sending…" : otpSent ? "Resend OTP" : "Send OTP"}
          </button>
        </div>
        {errors.phone ? (
          <p id={`${phoneId}-error`} role="alert" className="mt-1.5 text-xs text-danger">
            {errors.phone}
          </p>
        ) : null}
        {otpSent ? (
          <p role="status" aria-live="polite" className="mt-1.5 text-xs text-success">
            OTP sent to {data.phone}. Check your SMS.
          </p>
        ) : null}
      </div>

      {/* OTP */}
      <div>
        <label htmlFor={otpId} className="mb-1.5 block text-sm font-medium text-fg">
          OTP <span aria-hidden="true" className="text-danger">*</span>
        </label>
        <input
          id={otpId}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={data.otpCode}
          onChange={(e) => onChange({ otpCode: e.target.value.replace(/\D/g, "").slice(0, 6) })}
          aria-required="true"
          aria-invalid={!!errors.otpCode}
          aria-describedby={`${otpId}-hint${errors.otpCode ? ` ${otpId}-error` : ""}`}
          className={[inputClass, errors.otpCode ? "border-danger" : ""].join(" ")}
          placeholder="6-digit OTP"
          data-testid="register-otp"
        />
        <p id={`${otpId}-hint`} className="mt-1 text-xs text-fg-subtle">
          Enter the 6-digit code sent to your phone.
        </p>
        {errors.otpCode ? (
          <p id={`${otpId}-error`} role="alert" className="mt-1 text-xs text-danger">
            {errors.otpCode}
          </p>
        ) : null}
      </div>

      {/* Password */}
      <div>
        <label htmlFor={passwordId} className="mb-1.5 block text-sm font-medium text-fg">
          Password <span aria-hidden="true" className="text-danger">*</span>
        </label>
        <div className="relative">
          <input
            id={passwordId}
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            value={data.password}
            onChange={(e) => onChange({ password: e.target.value })}
            aria-required="true"
            aria-invalid={!!errors.password}
            aria-describedby={`${passwordId}-hint${errors.password ? ` ${passwordId}-error` : ""}`}
            className={[inputClass, "pr-10", errors.password ? "border-danger" : ""].join(" ")}
            placeholder="Min 10 characters"
            data-testid="register-password"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            tabIndex={-1}
            data-testid="register-password-toggle"
            aria-label={showPassword ? "Hide password" : "Show password"}
            aria-pressed={showPassword}
            className="absolute inset-y-0 right-0 flex items-center px-3 text-fg-muted transition-colors hover:text-fg focus-visible:text-fg focus-visible:outline-none"
          >
            {showPassword ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                <line x1="2" x2="22" y1="2" y2="22" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </button>
        </div>
        <p id={`${passwordId}-hint`} className="mt-1 text-xs text-fg-subtle">
          At least 10 characters, including a letter and a digit.
        </p>
        {errors.password ? (
          <p id={`${passwordId}-error`} role="alert" className="mt-1 text-xs text-danger">
            {errors.password}
          </p>
        ) : null}
      </div>

      {/* Captcha */}
      <div>
        <TurnstileWidget
          onToken={(token) => onChange({ captchaToken: token })}
          onExpire={() => onChange({ captchaToken: "" })}
          onError={() => onChange({ captchaToken: "" })}
          data-testid="register-captcha"
        />
        {errors.captchaToken ? (
          <p role="alert" className="mt-1.5 text-xs text-danger">
            {errors.captchaToken}
          </p>
        ) : null}
      </div>

      {/* Consent */}
      <fieldset className="flex flex-col gap-3 rounded-lg border border-border bg-surface/50 p-4">
        <legend className="text-sm font-medium text-fg">Consent</legend>

        <label htmlFor={tosId} className="flex cursor-pointer items-start gap-3 text-sm">
          <input
            id={tosId}
            type="checkbox"
            checked={data.tosAccepted}
            onChange={(e) => onChange({ tosAccepted: e.target.checked })}
            aria-required="true"
            aria-invalid={!!errors.tosAccepted}
            className="mt-0.5 h-4 w-4 cursor-pointer accent-brand-500"
            data-testid="register-tos"
          />
          <span className="text-fg-muted">
            I agree to the{" "}
            <a href="/terms" className="text-brand-500 underline">Terms of Service</a>{" "}
            and{" "}
            <a href="/privacy" className="text-brand-500 underline">Privacy Policy</a>
            {" "}({TOS_VERSION})
            <span aria-hidden="true" className="ml-1 text-danger">*</span>
          </span>
        </label>
        {errors.tosAccepted ? (
          <p role="alert" className="text-xs text-danger">{errors.tosAccepted}</p>
        ) : null}

        <label htmlFor={marketingId} className="flex cursor-pointer items-start gap-3 text-sm">
          <input
            id={marketingId}
            type="checkbox"
            checked={data.marketingOptIn}
            onChange={(e) => onChange({ marketingOptIn: e.target.checked })}
            className="mt-0.5 h-4 w-4 cursor-pointer accent-brand-500"
            data-testid="register-marketing"
          />
          <span className="text-fg-muted">
            I consent to receive marketing communications via WhatsApp, email, and SMS.
          </span>
        </label>
      </fieldset>
    </div>
  );
}
