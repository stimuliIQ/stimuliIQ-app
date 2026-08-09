"use client";

/**
 * OnboardingForm — the student-facing onboarding form served at
 * stimuliiq.com/onboarding (and stimuliiq.com/onboarding).
 *
 * Every question on this page is a row staff authored in the CRM; this component fetches
 * them and renders whatever it is given. Nothing here knows that "Payment Receipt" or
 * "College Name" exist, which is exactly what lets staff add, rename, reorder or remove a
 * question without a deploy.
 *
 * Structure mirrors the Google Form it replaces — a coloured header strip, a title card,
 * then one card per question — so the students already used to that form recognise it.
 */

import { useState } from "react";
// Contact details are code-owned (lib/contact.ts is the single source of truth) — the
// Google Form hardcoded a different number in its own header; this keeps the one number
// the rest of the site shows.
import { PHONE_HREF, WHATSAPP_DISPLAY } from "../../lib/contact";
import { TurnstileWidget } from "../captcha/turnstile-widget";
import { useCaptchaToken } from "../../hooks/use-captcha-token";
import { useOnboardingForm } from "../../hooks/use-onboarding-form";
import { OnboardingQuestion } from "./onboarding-question";

export function OnboardingForm() {
  const { load, submitState, answers, fieldErrors, setAnswer, submit, reload, requestUploadUrl } = useOnboardingForm();
  const { token: captchaToken, setToken, resetToken } = useCaptchaToken();
  // Remounts every question so uploaded files and radio selections reset together —
  // clearing only `answers` would leave a FileUpload still showing an attached receipt.
  const [formNonce, setFormNonce] = useState(0);

  const isSubmitting = submitState.kind === "submitting";

  if (submitState.kind === "success") {
    return (
      <div
        role="status"
        aria-live="polite"
        className="rounded-lg border border-border bg-card p-8 text-center shadow-sm"
        data-testid="onboarding-success"
      >
        <h2 className="text-xl font-semibold text-fg">Thank you!</h2>
        <p className="mt-2 text-base text-fg-muted">{submitState.message}</p>
        <p className="mt-6 text-sm text-fg-subtle">
          Questions? Call or text us at{" "}
          <a href={`tel:${PHONE_HREF}`} className="font-medium text-brand-500 underline">
            {WHATSAPP_DISPLAY}
          </a>
          .
        </p>
      </div>
    );
  }

  if (load.kind === "loading") {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center shadow-sm" data-testid="onboarding-loading">
        <p className="text-base text-fg-muted">Loading the form…</p>
      </div>
    );
  }

  if (load.kind === "error") {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center shadow-sm" data-testid="onboarding-load-error">
        <p className="text-base text-fg">{load.message}</p>
        <button
          type="button"
          onClick={reload}
          className="mt-4 inline-flex min-h-[44px] items-center rounded-md bg-brand-500 px-6 text-sm font-semibold text-white hover:bg-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Try again
        </button>
      </div>
    );
  }

  const { fields, programs } = load.form;

  // A form with no questions is a misconfiguration, not an empty state to submit into.
  if (fields.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center shadow-sm" data-testid="onboarding-empty">
        <p className="text-base text-fg">This form isn&apos;t accepting responses right now.</p>
        <p className="mt-2 text-sm text-fg-muted">
          Please call or text us at{" "}
          <a href={`tel:${PHONE_HREF}`} className="font-medium text-brand-500 underline">
            {WHATSAPP_DISPLAY}
          </a>
          .
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit(captchaToken ?? "noop");
      }}
      className="flex flex-col gap-4"
      aria-label="Student onboarding form"
      data-testid="onboarding-form"
      noValidate
    >
      {/* Title card — the accent strip sits on the wrapper so it reads as one sheet. */}
      <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <div className="h-2.5 bg-brand-500" aria-hidden="true" />
        <div className="p-5 sm:p-6">
          <h1 className="font-display text-3xl font-semibold text-fg">Onboarding Form</h1>
          <p className="mt-3 text-base text-fg-muted">
            Congratulations on joining us. Fill in your details below so we can set up your
            enrolment and add you to the right batch.
          </p>
          <p className="mt-3 text-base text-fg-muted">
            For any doubts or queries, call or text us at{" "}
            <a href={`tel:${PHONE_HREF}`} className="font-medium text-brand-500 underline">
              {WHATSAPP_DISPLAY}
            </a>
            .
          </p>
          <p className="mt-4 border-t border-border pt-4 text-sm text-danger">* Indicates required question</p>
        </div>
      </section>

      {fields.map((field) => (
        <OnboardingQuestion
          key={`${field.key}-${formNonce}`}
          field={field}
          value={answers[field.key]}
          onChange={(value) => setAnswer(field.key, value)}
          {...(fieldErrors[field.key] ? { error: fieldErrors[field.key] } : {})}
          programs={programs}
          disabled={isSubmitting}
          requestUploadUrl={(file) => requestUploadUrl(field, file, captchaToken ?? "noop")}
        />
      ))}

      <div className="rounded-lg border border-border bg-card p-5 shadow-sm sm:p-6">
        <TurnstileWidget onToken={setToken} onExpire={resetToken} onError={resetToken} data-testid="onboarding-captcha" />

        {submitState.kind === "error" ? (
          <p role="alert" className="mt-4 text-sm text-danger" data-testid="onboarding-submit-error">
            {submitState.message}
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-brand-500 px-8 text-sm font-semibold text-white transition-colors hover:bg-brand-600 active:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            data-testid="onboarding-submit"
          >
            {isSubmitting ? "Submitting…" : "Submit"}
          </button>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => {
              for (const field of fields) setAnswer(field.key, undefined);
              setFormNonce((n) => n + 1);
            }}
            className="text-sm font-medium text-brand-500 underline hover:text-brand-600 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="onboarding-clear"
          >
            Clear form
          </button>
        </div>
      </div>

      <p className="pb-4 text-center text-xs text-fg-subtle">
        Never submit passwords through this form. Your details are used only to process your enrolment.
      </p>
    </form>
  );
}

OnboardingForm.displayName = "OnboardingForm";
