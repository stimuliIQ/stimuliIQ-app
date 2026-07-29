"use client";

/**
 * NewsletterBand — full-width dark newsletter section rendered above the
 * footer (black & white redesign; replaces the compact "Stay updated" form
 * that previously sat inside MarketingFooter's newsletterSlot).
 *
 * Layout (per the reference): rounded black panel with a faint tile grid;
 * left — headline + benefit checklist; right — "Subscribe our newsletter"
 * label and a solid white capsule (mail icon + borderless input + embedded
 * dark Subscribe pill). The capsule is opaque so the tile grid never shows
 * through the field.
 *
 * Submission reuses the exact same machinery as the compact form
 * (useNewsletterSignup + interaction-only Turnstile captcha) — only the shell
 * differs. The widget must NOT be wrapped in `display:none`: Turnstile cannot
 * run its challenge in a hidden container, so no token is ever minted and the
 * server fail-closes ("invalid-input-response"). `appearance="interaction-only"`
 * is the supported way to keep it invisible unless interaction is required.
 *
 * a11y: section landmark, labelled input, success/error via role=status/alert,
 * ≥44px controls, white-on-black text kept ≥4.5:1.
 */
import { useEffect, useState, type FormEvent } from "react";
import { TurnstileWidget } from "../captcha/turnstile-widget";
import { useCaptchaToken } from "../../hooks/use-captcha-token";
import { useNewsletterSignup } from "../../hooks/use-newsletter-signup";

const BENEFITS = [
  "Weekly career guidance sessions from our mentors.",
  "Early access to new programs and batches.",
  "Exclusive scholarships and student offers.",
];

/** Faint tile grid over the black panel (pure CSS — no image request). */
const GRID_BG: React.CSSProperties = {
  backgroundImage:
    "linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)",
  backgroundSize: "96px 96px",
};

function CheckCircleIcon() {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-6 w-6"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12 2.5 2.5 4.5-5" />
    </svg>
  );
}

export function NewsletterBand() {
  const [email, setEmail] = useState("");
  // Stable, deterministic ids — there is exactly one NewsletterBand per page, so a constant
  // id is collision-safe and, unlike useId(), can never differ between the server and client
  // render (a useId() counter drift anywhere earlier in the tree previously produced a
  // hydration mismatch on this label's htmlFor).
  const emailId = "newsletter-band-email";
  const errorId = "newsletter-band-error";
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

  return (
    <section
      aria-label="Newsletter signup"
      data-testid="newsletter-band"
      className="mx-auto max-w-screen-xl px-4 py-16 md:px-6"
    >
      <div
        style={GRID_BG}
        className="grid grid-cols-1 items-center gap-10 rounded-3xl bg-brand-500 px-8 py-12 md:px-14 md:py-16 lg:grid-cols-2 lg:gap-16"
      >
        {/* Left: headline + benefits */}
        <div>
          <h2 className="font-display text-3xl font-bold leading-tight tracking-tight text-white md:text-4xl">
            Stay updated on the latest
            <br className="hidden md:block" /> courses and exclusive offers.
          </h2>
          <ul role="list" className="mt-8 flex flex-col gap-4">
            {BENEFITS.map((benefit) => (
              <li key={benefit} className="flex items-center gap-3 text-white">
                <span aria-hidden="true" className="shrink-0 text-white/90">
                  <CheckCircleIcon />
                </span>
                <span className="text-base">{benefit}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Right: form */}
        <div>
          <p className="text-lg font-semibold text-white">Subscribe our newsletter</p>

          {isSuccess ? (
            <div
              role="status"
              aria-live="polite"
              className="mt-5 flex items-center gap-3 rounded-2xl bg-white/10 p-5 text-white"
              data-testid="newsletter-band-success"
            >
              <span aria-hidden="true">
                <CheckCircleIcon />
              </span>
              <p className="text-sm">
                Subscribed! Watch your inbox for career tips.{" "}
                <button
                  type="button"
                  onClick={() => {
                    reset();
                    setEmail("");
                    resetToken();
                  }}
                  className="font-semibold underline underline-offset-4 hover:text-white/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:rounded"
                >
                  Subscribe another email
                </button>
              </p>
            </div>
          ) : (
            <form
              onSubmit={handleSubmit}
              noValidate
              className="mt-5 flex flex-col gap-4"
              data-testid="newsletter-band-form"
            >
              <label htmlFor={emailId} className="sr-only">
                Email address
              </label>
              {/* Solid white capsule: icon + borderless input + embedded pill
                  button. Opaque so the panel's tile grid never bleeds through. */}
              <div className="flex items-center gap-2 rounded-full bg-white p-2 pl-5 shadow-lg transition-shadow focus-within:ring-2 focus-within:ring-white/80 focus-within:ring-offset-2 focus-within:ring-offset-brand-500">
                <svg
                  aria-hidden="true"
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-5 w-5 shrink-0 text-fg-subtle"
                >
                  <rect x="3" y="5" width="18" height="14" rx="2" />
                  <path d="m3 7 9 6 9-6" />
                </svg>
                <input
                  id={emailId}
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter your email"
                  aria-invalid={Boolean(errorMessage) || undefined}
                  aria-describedby={errorMessage ? errorId : undefined}
                  disabled={isSubmitting}
                  className="h-11 w-full min-w-0 flex-1 bg-transparent text-sm text-fg placeholder:text-fg-subtle focus:outline-none disabled:opacity-50"
                  data-testid="newsletter-band-email"
                />
                <button
                  type="submit"
                  disabled={isSubmitting || email.trim().length === 0}
                  className="group inline-flex h-11 shrink-0 items-center gap-2 rounded-full bg-brand-500 px-5 text-sm font-semibold uppercase tracking-[0.1em] text-white transition-colors hover:bg-brand-600 active:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 sm:px-6"
                  data-testid="newsletter-band-submit"
                >
                  {isSubmitting ? "Subscribing…" : "Subscribe"}
                  <span
                    aria-hidden="true"
                    className="transition-transform duration-fast group-hover:translate-x-0.5"
                  >
                    &rarr;
                  </span>
                </button>
              </div>
              {errorMessage ? (
                <p id={errorId} role="alert" className="text-sm text-white">
                  {errorMessage}
                </p>
              ) : (
                <p className="text-xs text-white/60">
                  Career tips + program updates. Unsubscribe anytime.
                </p>
              )}
              <TurnstileWidget
                key={captchaEpoch}
                appearance="interaction-only"
                onToken={setToken}
                onExpire={resetToken}
                onError={resetToken}
                data-testid="newsletter-band-captcha"
              />
            </form>
          )}
        </div>
      </div>
    </section>
  );
}

NewsletterBand.displayName = "NewsletterBand";
