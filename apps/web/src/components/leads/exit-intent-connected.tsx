"use client";

/**
 * ExitIntentConnected — wires ExitIntentModal from @repo/ui to useLeadCapture.
 *
 * Listens for the mouse leaving the viewport (mouseleave on document) and
 * opens the modal after a 3-second delay on the first visit (sessionStorage
 * guards ensure it only fires once per session).
 *
 * a11y: ExitIntentModal uses Radix Dialog — focus-trapped, Escape-closes,
 *       returns focus to trigger on close.
 */

import { useEffect, useState } from "react";
import { ExitIntentModal } from "@repo/ui";
import type { LeadFormValues } from "@repo/ui";
import { TurnstileWidget } from "../captcha/turnstile-widget";
import { useLeadCapture } from "../../hooks/use-lead-capture";
import { useCaptchaToken } from "../../hooks/use-captcha-token";

const SESSION_KEY = "stimuliiq_exit_intent_shown";

export function ExitIntentConnected() {
  const [isOpen, setIsOpen] = useState(false);
  const { state, submit, reset } = useLeadCapture();
  const { token: captchaToken, setToken, resetToken } = useCaptchaToken();

  // Exit-intent detection (mouseleave on document)
  useEffect(() => {
    // Don't show if already shown this session
    if (sessionStorage.getItem(SESSION_KEY)) return;

    let timeoutId: ReturnType<typeof setTimeout>;

    function handleMouseLeave(e: MouseEvent) {
      // Only trigger if mouse leaves through the top of the viewport
      if (e.clientY <= 10) {
        timeoutId = setTimeout(() => {
          setIsOpen(true);
          sessionStorage.setItem(SESSION_KEY, "1");
        }, 500);
      }
    }

    // Only attach after 3 seconds on page (avoid immediate triggers)
    const attachTimeout = setTimeout(() => {
      document.addEventListener("mouseleave", handleMouseLeave);
    }, 3000);

    return () => {
      clearTimeout(attachTimeout);
      clearTimeout(timeoutId);
      document.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, []);

  // Auto-close after success
  useEffect(() => {
    if (state.kind === "success") {
      const t = setTimeout(() => setIsOpen(false), 2500);
      return () => clearTimeout(t);
    }
  }, [state.kind]);

  async function handleSubmit(values: LeadFormValues) {
    await submit({
      name: values.name,
      phone: values.phone,
      email: values.email,
      source: "web-exit-intent",
      captchaToken: captchaToken ?? "noop",
      _hp_email: values._hp_email,
      tosAccepted: true, // exit-intent modal has implicit consent (minimal form)
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
      heading="Wait — before you go!"
      subheading="Get a free callback from a mentor and find the right program for you."
      fields={["name", "phone"]}
      captchaSlot={
        <TurnstileWidget
          onToken={setToken}
          onExpire={resetToken}
          onError={resetToken}
          data-testid="exit-intent-captcha"
        />
      }
      onSubmit={handleSubmit}
      submitLabel="Call Me Back"
      isSubmitting={state.kind === "submitting"}
      successSlot={successSlot}
      errorMessage={state.kind === "error" ? state.message : undefined}
      data-testid="exit-intent-modal"
    />
  );
}

ExitIntentConnected.displayName = "ExitIntentConnected";
