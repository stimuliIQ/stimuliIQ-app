"use client";

/**
 * StickyLeadBarConnected — wires StickyLeadBar from @repo/ui to useLeadCapture.
 *
 * Invisible Turnstile mode: the captchaSlot renders a hidden TurnstileWidget
 * that auto-fires onToken when the page loads (invisible challenge).
 * The bar uses phone-only form so we use a minimal captcha approach.
 */

import { StickyLeadBar } from "@repo/ui";
import type { LeadFormValues } from "@repo/ui";
import { TurnstileWidget } from "../captcha/turnstile-widget";
import { useLeadCapture } from "../../hooks/use-lead-capture";
import { useCaptchaToken } from "../../hooks/use-captcha-token";

export interface StickyLeadBarConnectedProps {
  source?: string;
  label?: string;
  /** Program the visitor is looking at — recorded on the lead so the CRM shows which course the callback is about. */
  programInterestId?: string;
  position?: "top" | "bottom";
  className?: string;
}

export function StickyLeadBarConnected({
  source = "web-sticky-bar",
  label = "Get a free counselling call",
  programInterestId,
  position = "bottom",
  className,
}: StickyLeadBarConnectedProps) {
  const { state, submit, reset } = useLeadCapture();
  const { token: captchaToken, setToken, resetToken } = useCaptchaToken();

  async function handleSubmit(values: LeadFormValues) {
    await submit({
      phone: values.phone,
      programInterestId,
      source,
      captchaToken: captchaToken ?? "noop",
      _hp_email: values._hp_email,
      tosAccepted: true, // sticky bar has implicit minimal consent
      marketingOptIn: false,
    });
  }

  const successSlot =
    state.kind === "success" ? (
      <div
        role="status"
        aria-live="polite"
        className="flex items-center justify-between gap-4"
      >
        <p className="text-sm font-medium text-success">{state.message}</p>
        <button
          type="button"
          onClick={reset}
          className="text-sm text-fg-muted underline hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Dismiss
        </button>
      </div>
    ) : undefined;

  return (
    <StickyLeadBar
      label={label}
      placeholder="Your phone number"
      submitLabel="Call Me"
      captchaSlot={
        // Hidden Turnstile — auto-fires token without user interaction
        <TurnstileWidget
          onToken={setToken}
          onExpire={resetToken}
          onError={resetToken}
          data-testid="sticky-bar-captcha"
        />
      }
      onSubmit={handleSubmit}
      isSubmitting={state.kind === "submitting"}
      errorMessage={state.kind === "error" ? state.message : undefined}
      successSlot={successSlot}
      position={position}
      className={className}
      data-testid="sticky-lead-bar"
    />
  );
}

StickyLeadBarConnected.displayName = "StickyLeadBarConnected";
