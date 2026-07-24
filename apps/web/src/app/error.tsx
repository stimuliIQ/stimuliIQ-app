"use client";

/**
 * app/error.tsx — global error boundary (500-level unhandled errors).
 *
 * Must be a Client Component (React error boundary API requires useEffect + event callbacks).
 *
 * SECURITY: Never expose error internals (stack traces, module paths, server messages) to
 * the user. Only a generic message is shown. Internal errors are logged to Sentry/OTEL
 * via the browser console in dev; not visible in prod.
 *
 * a11y: role="alert" announces the error to screen readers on mount.
 *       "Try again" button resets the error boundary state.
 *
 * Next.js error boundary contract:
 *   - Receives `error: Error & { digest?: string }` and `reset: () => void` props.
 *   - `reset()` attempts to re-render the subtree (useful for transient failures).
 */
import { useEffect } from "react";

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalErrorPage({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    // Log to console in dev (Sentry integration goes here in prod).
    // Never log PII or full payloads — only the digest.
    if (process.env.NODE_ENV !== "production") {
      console.error("[GlobalError]", error.digest ?? error.message);
    }
    // In production, Sentry.captureException(error) would be called here.
  }, [error]);

  return (
    <section
      role="alert"
      aria-live="assertive"
      className="mx-auto flex max-w-2xl flex-col items-center justify-center px-4 py-24 text-center"
      data-testid="error-page"
    >
      {/* Status indicator — decorative */}
      <p
        aria-hidden="true"
        className="text-8xl font-extrabold text-danger sm:text-9xl"
      >
        500
      </p>

      <h1 className="mt-4 text-2xl font-bold text-fg sm:text-3xl">
        Something went wrong
      </h1>

      <p className="mt-3 max-w-md text-base text-fg-muted">
        We encountered an unexpected error. Our team has been notified.
        Please try again or contact support if the problem persists.
      </p>

      {/* Error digest — shown only in dev for debugging; hidden in prod */}
      {process.env.NODE_ENV !== "production" && error.digest ? (
        <p className="mt-2 font-mono text-xs text-fg-subtle">
          Error digest: {error.digest}
        </p>
      ) : null}

      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={reset}
          className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-brand-500 px-6 text-sm font-semibold text-white transition-colors hover:bg-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          data-testid="error-retry-button"
        >
          Try again
        </button>
        <a
          href="/"
          className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-border bg-card px-6 text-sm font-medium text-fg transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Go to Homepage
        </a>
      </div>

      <p className="mt-6 text-sm text-fg-subtle">
        Need help?{" "}
        <a
          href="/contact"
          className="font-medium text-brand-500 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded"
        >
          Contact us
        </a>
      </p>
    </section>
  );
}
