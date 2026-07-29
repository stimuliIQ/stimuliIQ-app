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
        <div className="relative h-full overflow-hidden rounded-r-xl">
          {/* call-person.jpg — opaque landscape photo (caller on the RIGHT of the
              frame, white studio background), unlike the previous transparent
              counsellor.png cutout: no gradient underlay or head-overhang tricks
              needed. object-position keeps the crop on the caller when the
              portrait panel slices the landscape frame. */}
          <img
            src="/images/popup/call-person.jpg"
            alt=""
            loading="lazy"
            className="pointer-events-none absolute inset-0 h-full w-full object-cover object-[65%_30%]"
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
