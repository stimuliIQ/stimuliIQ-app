"use client";

/**
 * NewsletterSignupForm — footer newsletter opt-in (T32, docs/plans/phase-9-completion.md).
 *
 * Renders into `MarketingFooter`'s `newsletterSlot`. Compact single-field form:
 * email + interaction-only Turnstile captcha + submit. Success/error states are
 * announced via `role="status"`/`role="alert"`. The widget must NOT sit inside
 * `display:none` — Turnstile cannot run its challenge in a hidden container, so
 * no token is minted and the server fail-closes ("invalid-input-response").
 */

import { useEffect, useId, useState, type FormEvent } from "react";
import { TurnstileWidget } from "../captcha/turnstile-widget";
import { useCaptchaToken } from "../../hooks/use-captcha-token";
import { useNewsletterSignup } from "../../hooks/use-newsletter-signup";

export function NewsletterSignupForm() {
  const [email, setEmail] = useState("");
  const emailId = useId();
  const errorId = useId();
  const { state, fieldError, submit, reset } = useNewsletterSignup();
  const { token: captchaToken, setToken, resetToken } = useCaptchaToken();
  // Turnstile tokens are single-use: after a failed submit the token is already
  // consumed server-side, so remount the widget (key bump) to mint a fresh one
  // before the visitor retries.
  const [captchaEpoch, setCaptchaEpoch] = useState(0);

  const isSubmitting = state.kind === "submitting";
  const isSuccess = state.kind === "success";
  const errorMessage = fieldError ?? (state.kind === "error" ? state.message : undefined);

  useEffect(() => {
    if (state.kind === "error") {
      resetToken();
      setCaptchaEpoch((n) => n + 1);
    }
  }, [state.kind, resetToken]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await submit({ email, captchaToken });
  }

  if (isSuccess) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-2 text-sm"
        data-testid="newsletter-signup-success"
      >
        <span aria-hidden="true" className="text-success">✓</span>
        <p className="text-fg-muted">
          Subscribed! Watch your inbox for career tips.{" "}
          <button
            type="button"
            onClick={() => {
              reset();
              setEmail("");
              resetToken();
            }}
            className="text-brand-500 underline hover:text-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Subscribe another email
          </button>
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-2"
      data-testid="newsletter-signup-form"
      noValidate
    >
      <label htmlFor={emailId} className="sr-only">
        Email address
      </label>
      <div className="flex gap-2">
        <input
          id={emailId}
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          aria-invalid={Boolean(errorMessage) || undefined}
          aria-describedby={errorMessage ? errorId : undefined}
          disabled={isSubmitting}
          className="h-10 w-full min-w-0 rounded-md border border-border bg-bg px-3 text-sm text-fg placeholder:text-fg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-50"
          data-testid="newsletter-email-input"
        />
        <button
          type="submit"
          disabled={isSubmitting || email.trim().length === 0}
          className="h-10 shrink-0 rounded-md bg-brand-500 px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-600 active:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          data-testid="newsletter-submit"
        >
          {isSubmitting ? "Subscribing…" : "Subscribe"}
        </button>
      </div>
      {errorMessage ? (
        <p id={errorId} role="alert" className="text-xs text-danger">
          {errorMessage}
        </p>
      ) : (
        <p className="text-xs text-fg-subtle">
          Career tips + program updates. Unsubscribe anytime.
        </p>
      )}
      <TurnstileWidget
        key={captchaEpoch}
        appearance="interaction-only"
        onToken={setToken}
        onExpire={resetToken}
        onError={resetToken}
        data-testid="newsletter-captcha"
      />
    </form>
  );
}

NewsletterSignupForm.displayName = "NewsletterSignupForm";
