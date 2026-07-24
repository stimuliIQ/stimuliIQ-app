"use client";

/**
 * Step 2 — Personal details (name, phone, email, consent, captcha).
 *
 * a11y:
 *   - All fields have associated <label> elements.
 *   - Error messages are announced via role="alert".
 *   - Captcha widget is rendered in its own slot (TurnstileWidget).
 *   - Honeypot field is aria-hidden + tabIndex={-1} + off-screen.
 *
 * Security:
 *   - Honeypot field (AC-42): if populated, submission is silently rejected.
 *   - Captcha token: required on submit. TurnstileWidget calls onToken when solved.
 *   - TOS acceptance: form will not submit if tosAccepted is false (AC step 2).
 */

import { useId } from "react";
import type { BookSlotFormData } from "../../../hooks/use-book-slot";
import { TurnstileWidget } from "../../../components/captcha/turnstile-widget";

interface DetailsStepProps {
  formData: BookSlotFormData;
  onChange: (data: Partial<BookSlotFormData>) => void;
  errors: Record<string, string>;
}

const inputClass = [
  "h-11 w-full rounded-md border border-border bg-card px-3 text-sm text-fg placeholder:text-fg-subtle",
  "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
].join(" ");

const TOS_VERSION =
  typeof process !== "undefined"
    ? (process.env.NEXT_PUBLIC_TOS_VERSION ?? "v1.0")
    : "v1.0";

export function DetailsStep({ formData, onChange, errors }: DetailsStepProps) {
  const nameId = useId();
  const phoneId = useId();
  const emailId = useId();
  const tosId = useId();
  const marketingId = useId();

  return (
    <div className="flex flex-col gap-4" data-testid="book-slot-step-details">
      {/* Honeypot — aria-hidden, tabIndex=-1, display:none (AC-42).
          MUST use display:none (not off-screen positioning): browsers and password
          managers treat an off-screen-but-rendered input as a real, fillable field and
          autofill it — that silently tripped the honeypot for real users and dropped
          their booking. display:none fields are skipped by autofill, while still present
          in the DOM for basic bots (which fill every input regardless of CSS). */}
      <div aria-hidden="true" style={{ display: "none" }}>
        {/* type="text" + non-email-token name: browser autofill matches "email"
            in name/type and would fill the honeypot for real users, silently
            discarding their submission. Bots fill every input regardless.

            Password managers (1Password/LastPass/Bitwarden) and Chrome autofill
            IGNORE autoComplete="off" and fill off-screen text inputs anyway — that
            silently tripped the honeypot for real users and dropped their booking.
            The data-*ignore attributes below are the documented opt-out signals for
            each manager; data-form-type="other" + name="off" suppress Chrome. The
            real bot gate is the required server-verified Turnstile captcha. */}
        <input
          type="text"
          name="_hp_field"
          value={formData._hp_email}
          onChange={(e) => onChange({ _hp_email: e.target.value })}
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          data-testid="honeypot-field"
          data-lpignore="true"
          data-1p-ignore=""
          data-bwignore=""
          data-form-type="other"
        />
      </div>

      {/* Name */}
      <div>
        <label htmlFor={nameId} className="mb-1.5 block text-sm font-medium text-fg">
          Full name <span aria-hidden="true" className="text-danger">*</span>
        </label>
        <input
          id={nameId}
          type="text"
          autoComplete="name"
          value={formData.name}
          onChange={(e) => onChange({ name: e.target.value })}
          aria-required="true"
          aria-invalid={!!errors.name}
          aria-describedby={errors.name ? `${nameId}-error` : undefined}
          className={[inputClass, errors.name ? "border-danger" : ""].join(" ")}
          placeholder="Your full name"
          data-testid="field-name"
        />
        {errors.name ? (
          <p id={`${nameId}-error`} role="alert" className="mt-1.5 text-xs text-danger">
            {errors.name}
          </p>
        ) : null}
      </div>

      {/* Phone */}
      <div>
        <label htmlFor={phoneId} className="mb-1.5 block text-sm font-medium text-fg">
          Phone number <span aria-hidden="true" className="text-danger">*</span>
        </label>
        <input
          id={phoneId}
          type="tel"
          autoComplete="tel"
          value={formData.phone}
          onChange={(e) => onChange({ phone: e.target.value })}
          aria-required="true"
          aria-invalid={!!errors.phone}
          aria-describedby={errors.phone ? `${phoneId}-error` : undefined}
          className={[inputClass, errors.phone ? "border-danger" : ""].join(" ")}
          placeholder="+91 98765 43210"
          data-testid="field-phone"
        />
        {errors.phone ? (
          <p id={`${phoneId}-error`} role="alert" className="mt-1.5 text-xs text-danger">
            {errors.phone}
          </p>
        ) : null}
      </div>

      {/* Email (optional) */}
      <div>
        <label htmlFor={emailId} className="mb-1.5 block text-sm font-medium text-fg">
          Email address
          <span className="ml-1 text-fg-subtle text-xs">(optional)</span>
        </label>
        <input
          id={emailId}
          type="email"
          autoComplete="email"
          value={formData.email}
          onChange={(e) => onChange({ email: e.target.value })}
          aria-invalid={!!errors.email}
          aria-describedby={errors.email ? `${emailId}-error` : undefined}
          className={[inputClass, errors.email ? "border-danger" : ""].join(" ")}
          placeholder="you@example.com"
          data-testid="field-email"
        />
        {errors.email ? (
          <p id={`${emailId}-error`} role="alert" className="mt-1.5 text-xs text-danger">
            {errors.email}
          </p>
        ) : null}
      </div>

      {/* Captcha widget */}
      <div>
        <TurnstileWidget
          onToken={(token) => onChange({ captchaToken: token })}
          onExpire={() => onChange({ captchaToken: "" })}
          onError={() => onChange({ captchaToken: "" })}
          data-testid="book-slot-captcha"
        />
        {errors.captcha ? (
          <p role="alert" className="mt-1.5 text-xs text-danger">
            {errors.captcha}
          </p>
        ) : null}
      </div>

      {/* Consent checkboxes (AC-37, DPDP spec) */}
      <fieldset className="flex flex-col gap-3 rounded-lg border border-border bg-surface/50 p-4">
        <legend className="text-sm font-medium text-fg">Consent</legend>

        {/* TOS — mandatory */}
        <label
          htmlFor={tosId}
          className="flex cursor-pointer items-start gap-3 text-sm text-fg"
        >
          <input
            id={tosId}
            type="checkbox"
            checked={formData.tosAccepted}
            onChange={(e) => onChange({ tosAccepted: e.target.checked })}
            aria-required="true"
            aria-invalid={!!errors.tosAccepted}
            aria-describedby={errors.tosAccepted ? `${tosId}-error` : undefined}
            className="mt-0.5 h-4 w-4 cursor-pointer rounded border-border accent-brand-500"
            data-testid="field-tos"
          />
          <span>
            I agree to the{" "}
            <a href="/terms" className="underline text-brand-500 hover:text-brand-600">
              Terms of Service
            </a>{" "}
            and{" "}
            <a href="/privacy" className="underline text-brand-500 hover:text-brand-600">
              Privacy Policy
            </a>
            {" "}(TOS {TOS_VERSION})
            <span aria-hidden="true" className="ml-1 text-danger">*</span>
          </span>
        </label>
        {errors.tosAccepted ? (
          <p id={`${tosId}-error`} role="alert" className="text-xs text-danger">
            {errors.tosAccepted}
          </p>
        ) : null}

        {/* Marketing opt-in — optional */}
        <label
          htmlFor={marketingId}
          className="flex cursor-pointer items-start gap-3 text-sm text-fg-muted"
        >
          <input
            id={marketingId}
            type="checkbox"
            checked={formData.marketingOptIn}
            onChange={(e) => onChange({ marketingOptIn: e.target.checked })}
            className="mt-0.5 h-4 w-4 cursor-pointer rounded border-border accent-brand-500"
            data-testid="field-marketing"
          />
          <span>
            I consent to receive marketing communications (programs, offers, updates) via
            WhatsApp, email, and SMS. You can unsubscribe at any time.
          </span>
        </label>
      </fieldset>
    </div>
  );
}
