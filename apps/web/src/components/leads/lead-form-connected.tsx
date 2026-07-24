"use client";

/**
 * LeadFormConnected — wires LeadFormInline from @repo/ui to useLeadCapture hook.
 *
 * Handles:
 *   - UTM capture (via useLeadCapture → useUtm)
 *   - Captcha (TurnstileWidget in the captchaSlot prop)
 *   - DPDP consent (marketingOptIn + tosAccepted)
 *   - Submit → POST /public/leads
 *   - Success/error/loading states
 *   - Toast on submit (via role="status" announcement)
 *
 * Security:
 *   - Honeypot: LeadFormCore always renders _hp_email (aria-hidden, off-screen)
 *   - Captcha: TurnstileWidget provides real token in prod; "noop" in dev
 *   - No business logic in this component
 *
 * Usage:
 *   <LeadFormConnected
 *     source="web-homepage-cta"
 *     heading="Talk to a counsellor"
 *     programInterestId={programId}
 *   />
 */

import { useState } from "react";
import { LeadFormInline } from "@repo/ui";
import type { LeadFormValues } from "@repo/ui";
import { TurnstileWidget } from "../captcha/turnstile-widget";
import { useLeadCapture } from "../../hooks/use-lead-capture";
import { useCaptchaToken } from "../../hooks/use-captcha-token";

const TOS_VERSION =
  typeof process !== "undefined"
    ? (process.env.NEXT_PUBLIC_TOS_VERSION ?? "v1.0")
    : "v1.0";

export interface LeadFormConnectedProps {
  source: string;
  heading?: string;
  subheading?: string;
  programInterestId?: string;
  fields?: ("name" | "phone" | "email" | "program" | "message")[];
  programOptions?: { value: string; label: string }[];
  submitLabel?: string;
  className?: string;
  "data-testid"?: string;
}

export function LeadFormConnected({
  source,
  heading = "Talk to a counsellor",
  subheading = "Get a free callback from our mentors within 24 hours.",
  programInterestId,
  fields = ["name", "phone", "email"],
  programOptions,
  submitLabel = "Get a Callback",
  className,
  "data-testid": testId,
}: LeadFormConnectedProps) {
  const { state, submit, reset } = useLeadCapture();
  const { token: captchaToken, setToken, resetToken } = useCaptchaToken();
  // TOS checkbox (required) — internal state as LeadFormInline doesn't have a TOS checkbox
  const [tosAccepted, setTosAccepted] = useState(false);
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [tosError, setTosError] = useState<string | undefined>(undefined);

  const isSubmitting = state.kind === "submitting";

  async function handleSubmit(values: LeadFormValues) {
    // Validate TOS acceptance
    if (!tosAccepted) {
      setTosError("You must accept the Terms of Service to continue");
      return;
    }
    setTosError(undefined);

    await submit({
      name: values.name,
      phone: values.phone,
      email: values.email,
      programInterestId: values.program || programInterestId,
      source,
      captchaToken: captchaToken ?? "noop",
      _hp_email: values._hp_email,
      tosAccepted,
      marketingOptIn,
    });
  }

  // Success slot
  const successSlot =
    state.kind === "success" ? (
      <div
        role="status"
        aria-live="polite"
        className="flex flex-col items-center gap-3 py-4 text-center"
        data-testid="lead-form-success"
      >
        <span aria-hidden="true" className="text-4xl">✓</span>
        <p className="font-semibold text-success">{state.message}</p>
        <button
          type="button"
          onClick={reset}
          className="mt-2 text-sm text-brand-500 underline hover:text-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Submit another enquiry
        </button>
      </div>
    ) : undefined;

  const errorMessage = state.kind === "error" ? state.message : undefined;

  // TOS + marketing consent — rendered via `footerSlot` so it stays inside
  // LeadFormInline's own white card (guaranteed-light background) instead of
  // sitting on whatever the caller's section background happens to be (e.g.
  // the green CTA band), where `text-fg-muted`/`text-brand-500` would be
  // nearly invisible.
  const consentSlot = (
    <div className="flex flex-col gap-2 text-sm">
      <label className="flex cursor-pointer items-start gap-2">
        <input
          type="checkbox"
          checked={tosAccepted}
          onChange={(e) => {
            setTosAccepted(e.target.checked);
            if (e.target.checked) setTosError(undefined);
          }}
          className="mt-0.5 h-4 w-4 accent-brand-500"
          aria-describedby={tosError ? "lead-tos-error" : undefined}
          data-testid="lead-tos-checkbox"
        />
        <span className="text-fg-muted">
          I agree to the{" "}
          <a href="/terms" className="text-brand-500 underline">Terms of Service</a>{" "}
          and{" "}
          <a href="/privacy" className="text-brand-500 underline">Privacy Policy</a>
          {" "}({TOS_VERSION}) <span aria-hidden="true" className="text-danger">*</span>
        </span>
      </label>
      {tosError ? (
        <p id="lead-tos-error" role="alert" className="text-xs text-danger">
          {tosError}
        </p>
      ) : null}

      <label className="flex cursor-pointer items-start gap-2">
        <input
          type="checkbox"
          checked={marketingOptIn}
          onChange={(e) => setMarketingOptIn(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-brand-500"
          data-testid="lead-marketing-checkbox"
        />
        <span className="text-fg-muted">
          I consent to receive marketing communications via WhatsApp, email, and SMS.
        </span>
      </label>
    </div>
  );

  return (
    <div className={className} data-testid={testId ?? "lead-form-connected"}>
      <LeadFormInline
        heading={heading}
        subheading={subheading}
        fields={fields}
        programOptions={programOptions}
        captchaSlot={
          <TurnstileWidget
            onToken={setToken}
            onExpire={resetToken}
            onError={resetToken}
            data-testid="lead-form-captcha"
          />
        }
        onSubmit={handleSubmit}
        submitLabel={submitLabel}
        isSubmitting={isSubmitting}
        successSlot={successSlot}
        errorMessage={tosError ?? errorMessage}
        footerSlot={consentSlot}
      />
    </div>
  );
}

LeadFormConnected.displayName = "LeadFormConnected";
