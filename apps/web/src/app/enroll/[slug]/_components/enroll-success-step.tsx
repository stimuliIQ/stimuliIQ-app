"use client";

/**
 * EnrollSuccessStep — Step 3: Enrollment success + LMS handoff.
 *
 * Displays the success state and redirects to the LMS (AC-23).
 * The lmsRedirectUrl is server-derived from the verify response.
 *
 * Also shows a "Go to LMS" CTA in case the redirect is delayed or blocked.
 */

import { useEffect } from "react";
import type { PublicVerifyPaymentResponse } from "@repo/types";

interface EnrollSuccessStepProps {
  result: PublicVerifyPaymentResponse;
}

export function EnrollSuccessStep({ result }: EnrollSuccessStepProps) {
  // Auto-redirect to LMS after 3 seconds (AC-23)
  useEffect(() => {
    const timeout = setTimeout(() => {
      window.location.href = result.lmsRedirectUrl;
    }, 3000);
    return () => clearTimeout(timeout);
  }, [result.lmsRedirectUrl]);

  return (
    <div
      data-testid="enroll-success-step"
      role="status"
      aria-live="polite"
      className="flex flex-col items-center gap-6 py-8 text-center"
    >
      <div
        aria-hidden="true"
        className="flex size-20 items-center justify-center rounded-full bg-success/20 text-4xl"
      >
        ✓
      </div>

      <div>
        <h2 className="text-2xl font-bold text-fg">Payment Successful!</h2>
        <p className="mt-2 text-fg-muted">
          {result.message || "Welcome! Your enrollment is now active."}
        </p>
        <p className="mt-1 text-sm text-fg-subtle">
          Enrollment ID: <code className="font-mono">{result.enrollmentId}</code>
        </p>
      </div>

      <p className="text-sm text-fg-muted">
        Redirecting you to the LMS in a few seconds…
      </p>

      {/* Manual CTA in case auto-redirect is blocked */}
      <a
        href={result.lmsRedirectUrl}
        className="flex min-h-[44px] items-center rounded-md bg-brand-500 px-8 text-base font-semibold text-white transition-colors hover:bg-brand-600 active:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        data-testid="go-to-lms-btn"
      >
        Go to LMS Now
      </a>

      <p className="text-xs text-fg-subtle">
        A receipt will be emailed to you shortly (notification coming in P6).
        Welcome to Stimuli IQ!
      </p>
    </div>
  );
}
