"use client";

/**
 * TimedLeadPopupConnected — the site-wide "book a slot" lead popup.
 *
 * Opens automatically ~4 seconds after the first page load of a session
 * (within the 3–5s window), captures Name / Phone / optional Message, and
 * creates a CRM lead via the existing public capture endpoint
 * (source = "web-timed-popup"). Replaces the old exit-intent modal so only
 * one lead popup competes for attention.
 *
 * A sessionStorage guard ensures it fires at most once per browser session.
 *
 * a11y: reuses ExitIntentModal (Radix Dialog) — focus-trapped, Escape-closes,
 *       returns focus to the previously-focused element on close.
 */

import { useEffect, useState } from "react";
import { ExitIntentModal } from "@repo/ui";
import type { LeadFormValues } from "@repo/ui";
import { TurnstileWidget } from "../captcha/turnstile-widget";
import { useLeadCapture } from "../../hooks/use-lead-capture";
import { useCaptchaToken } from "../../hooks/use-captcha-token";

/** Once-per-session guard so the popup doesn't re-open on client navigation. */
const SESSION_KEY = "stimuliiq_timed_popup_shown";

/** Delay before the popup opens (ms). Kept inside the 3–5s window. */
const OPEN_DELAY_MS = 4000;

/** Country code shown as a fixed prefix on the phone field (India-first). */
const PHONE_PREFIX = "+91";

/** Normalise a user-typed local number to E.164 with the +91 country code. */
function toE164(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  // Already includes the country code (12 digits like 91XXXXXXXXXX).
  if (digits.startsWith("91") && digits.length > 10) return `+${digits}`;
  return `${PHONE_PREFIX}${digits}`;
}

export function TimedLeadPopupConnected(): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const { state, submit, reset } = useLeadCapture();
  const { token: captchaToken, setToken, resetToken } = useCaptchaToken();

  // Open once, ~4s after mount, guarded per session.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (sessionStorage.getItem(SESSION_KEY)) return;

    const timeoutId = setTimeout(() => {
      setIsOpen(true);
      sessionStorage.setItem(SESSION_KEY, "1");
    }, OPEN_DELAY_MS);

    return () => clearTimeout(timeoutId);
  }, []);

  // Auto-close shortly after a successful submission.
  useEffect(() => {
    if (state.kind === "success") {
      const t = setTimeout(() => setIsOpen(false), 2500);
      return () => clearTimeout(t);
    }
  }, [state.kind]);

  async function handleSubmit(values: LeadFormValues) {
    await submit({
      name: values.name,
      phone: toE164(values.phone ?? ""),
      message: values.message,
      source: "web-timed-popup",
      captchaToken: captchaToken ?? "noop",
      _hp_email: values._hp_email,
      tosAccepted: true, // implicit consent — minimal callback form (same as exit-intent)
      marketingOptIn: false,
    });
  }

  function handleOpenChange(open: boolean) {
    if (!open) {
      reset();
      resetToken();
    }
    setIsOpen(open);
  }

  const successSlot =
    state.kind === "success" ? (
      <div role="status" aria-live="polite" className="py-4 text-center">
        <p className="font-semibold text-success">{state.message}</p>
      </div>
    ) : undefined;

  return (
    <ExitIntentModal
      open={isOpen}
      onOpenChange={handleOpenChange}
      heading="Have Questions?"
      subheading="Share your number — we'll call you back."
      imageSlot={
        <div className="relative h-full rounded-r-xl bg-gradient-to-b from-emerald-400 via-emerald-500 to-emerald-700">
          {/* Portrait crop of the counsellor artwork (derived from
              images/scholarship/contact-person.png). The image box is anchored
              to the panel's bottom and taller than the panel, so her head pops
              out above the card while the sides stay flush with the panel. */}
          <img
            src="/images/popup/counsellor.png"
            alt=""
            loading="lazy"
            className="pointer-events-none absolute bottom-0 left-0 h-[calc(100%+4rem)] w-full rounded-br-xl object-cover object-top"
          />
        </div>
      }
      fields={["name", "phone", "message"]}
      phonePrefix={PHONE_PREFIX}
      captchaSlot={
        <TurnstileWidget
          onToken={setToken}
          onExpire={resetToken}
          onError={resetToken}
          data-testid="timed-popup-captcha"
        />
      }
      onSubmit={handleSubmit}
      submitLabel="Submit"
      isSubmitting={state.kind === "submitting"}
      successSlot={successSlot}
      errorMessage={state.kind === "error" ? state.message : undefined}
      data-testid="timed-lead-popup"
    />
  );
}

TimedLeadPopupConnected.displayName = "TimedLeadPopupConnected";
