"use client";

/**
 * StickyLeadBarConnected — wires StickyLeadBar from @repo/ui to useLeadCapture.
 *
 * Invisible Turnstile mode: the captchaSlot renders a hidden TurnstileWidget
 * that auto-fires onToken when the page loads (invisible challenge).
 * The bar uses phone-only form so we use a minimal captcha approach.
 *
 * Lifecycle: the bar shows its callback form until the visitor submits a number. On success
 * it shows the confirmation briefly and then RETIRES for the rest of the session — it never
 * returns to the form. Asking again for a number we already hold is the one thing this bar
 * must not do, so both the auto-dismiss timer and the "Dismiss" button retire it.
 */

import { useCallback, useEffect, useState } from "react";
import { StickyLeadBar, PHONE_PLACEHOLDER, toE164Phone } from "@repo/ui";
import type { LeadFormValues } from "@repo/ui";
import { TurnstileWidget } from "../captcha/turnstile-widget";
import { useLeadCapture } from "../../hooks/use-lead-capture";
import { useCaptchaToken } from "../../hooks/use-captcha-token";

/** How long the "we'll call you" confirmation stays up before the bar retires itself. */
const SUCCESS_AUTO_DISMISS_MS = 3000;

/**
 * Marks that this visitor has already given us their number, so the bar does not come back
 * on client navigation or reload. Session-scoped (not local) for the same reason as the
 * timed popup and exit-intent guards: a new visit is a new conversation.
 *
 * Deliberately NOT keyed by program. The visitor has handed over a phone number and is
 * waiting for a call — re-asking for it on the next course page is the same pestering,
 * and submitting again would just create a duplicate lead on the same phone.
 */
const SESSION_KEY = "stimuliiq_sticky_bar_submitted";

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
  const { state, submit } = useLeadCapture();
  const { token: captchaToken, setToken, resetToken } = useCaptchaToken();
  const [retired, setRetired] = useState(false);

  const retire = useCallback(() => {
    setRetired(true);
    // Wrapped: Safari in private mode throws on sessionStorage writes, and losing the
    // cross-navigation guard must not take the dismissal itself down with it.
    try {
      sessionStorage.setItem(SESSION_KEY, "1");
    } catch {
      /* non-persistent dismissal is still better than none */
    }
  }, []);

  // Re-hide after a client navigation or reload within the same session. Runs in an effect
  // rather than as lazy state so the server and the first client render agree — the brief
  // flash this costs an already-submitted visitor is preferable to a hydration mismatch.
  useEffect(() => {
    try {
      if (sessionStorage.getItem(SESSION_KEY)) setRetired(true);
    } catch {
      /* storage unavailable — the bar simply shows again, as it did before */
    }
  }, []);

  // A successful submission RETIRES the bar; it does not reset it. Resetting returned the
  // state to idle, which re-rendered the empty callback form seconds after the visitor had
  // just filled it in — the bar asking for a number it had already been given.
  useEffect(() => {
    if (state.kind !== "success") return;
    const timeoutId = setTimeout(() => {
      retire();
      resetToken();
    }, SUCCESS_AUTO_DISMISS_MS);
    return () => clearTimeout(timeoutId);
  }, [state.kind, retire, resetToken]);

  async function handleSubmit(values: LeadFormValues) {
    await submit({
      // 10 local digits in the field → E.164 on the wire, matching how every
      // other surface (imports, timed popup) stores a number.
      phone: toE164Phone(values.phone),
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
        className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-center"
      >
        <p className="text-sm font-medium text-success">{state.message}</p>
        <button
          type="button"
          // Retires the bar rather than resetting it — clicking "Dismiss" used to bring the
          // callback form straight back, the same defect as the auto-dismiss path.
          onClick={retire}
          className="text-sm text-fg-muted underline hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Dismiss
        </button>
      </div>
    ) : undefined;

  // Retired for the rest of the session — the visitor is already waiting for a call.
  if (retired) return null;

  return (
    <StickyLeadBar
      label={label}
      placeholder={PHONE_PLACEHOLDER}
      submitLabel="Call Me"
      captchaSlot={
        // interaction-only: invisible unless Cloudflare requires the visitor to
        // interact; the token still auto-mints on load.
        <TurnstileWidget
          appearance="interaction-only"
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
