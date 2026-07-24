// error.tsx — Next.js Error Boundary for the verify route.
// Catches rendering or unexpected runtime errors in the page segment.
// Must be a Client Component (Next.js requirement for error.tsx).
//
// Design: never exposes internal error details to the public
// (this is a PUBLIC page). Shows the same "not found" style
// rather than technical error info.
// (CLAUDE.md §4 DoD: "Loading / empty / error states implemented for every async UI")
//
// Icon: inline SVG (ShieldAlert shape) — no direct lucide-react import in apps/web.

"use client";

import { useEffect } from "react";
import { Button } from "@repo/ui";

// Inline ShieldAlert SVG — same visual as the verify-panel invalid state.
// Using inline SVG avoids adding lucide-react as a direct dependency of apps/web.
function ShieldAlertIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </svg>
  );
}

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function VerifyError({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    // Log to observability (Sentry/OTel) without exposing to the user.
    console.error("[verify-error]", error.digest ?? error.message);
  }, [error]);

  return (
    <main
      id="main-content"
      className="mx-auto flex max-w-xl flex-col items-center px-4 py-12 sm:py-16"
      data-testid="verify-error"
    >
      <header className="mb-10 text-center">
        <p className="mb-2 text-sm font-medium uppercase tracking-widest text-fg-subtle">
          stimuliiq
        </p>
        <h1 className="text-2xl font-semibold text-fg sm:text-3xl">
          Certificate Verification
        </h1>
      </header>

      <div
        className="flex w-full max-w-sm flex-col items-center gap-4 rounded-2xl border border-warning/30 bg-warning/10 px-8 py-6 text-center"
        role="alert"
        aria-live="assertive"
      >
        {/* ShieldAlert icon — distinct shape, not color-only (a11y) */}
        <ShieldAlertIcon className="size-12 text-warning" />
        <p className="text-lg font-semibold text-warning" data-testid="verify-error-heading">
          Verification Unavailable
        </p>
        <p className="text-sm text-fg-muted">
          We were unable to process this verification request. Please try again.
        </p>
        <Button
          variant="secondary"
          size="sm"
          onClick={reset}
          className="mt-2"
          data-testid="verify-error-retry"
        >
          Try again
        </Button>
      </div>
    </main>
  );
}
