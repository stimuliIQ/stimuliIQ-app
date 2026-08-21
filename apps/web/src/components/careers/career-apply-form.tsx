"use client";

/**
 * CareerApplyForm — the application form, shown inside the apply modal on /careers/<slug>.
 *
 * ── THE CAPTCHA MUST BE SOLVED BEFORE THE RESUME UPLOADS ────────────────────────────
 * This is the ordering bug that broke every live application, and the reason the widget is
 * rendered FIRST rather than last.
 *
 * Applying spends ONE Turnstile token on TWO captcha-gated calls: minting the signed PUT
 * for the resume, then submitting. The form previously put the challenge at the bottom,
 * under the file field, so the natural top-to-bottom fill order picked the resume while
 * `captchaToken` was still undefined — and the upload call went out with the literal string
 * `"noop"`, which is a dev-only fallback that production Turnstile rejects outright. The
 * visitor got "Please complete the captcha challenge and try again" ON THE RESUME STEP,
 * pointing at a control below the error, and solving it afterwards did not help because the
 * upload had already failed.
 *
 * So: the challenge sits at the top, the file field is DISABLED until it resolves and says
 * why, and `requestResumeUploadUrl` refuses outright rather than sending `"noop"` — a
 * request that cannot succeed should not be made, and its failure should not be phrased as
 * the visitor's mistake.
 *
 * (The server side of the same problem — one token, two calls — is already handled by
 * ReplayTolerantCaptchaProvider, which lets the second call reuse the first's verification.
 * That fix is what makes solving the challenge once sufficient; this one makes sure it is
 * solved before the first call rather than after it.)
 */

import { useId, useState, type FormEvent } from "react";
import { CheckCircleIcon, ShieldCheckIcon } from "./icons";
import { FileUpload, PHONE_INPUT_PROPS, PHONE_PLACEHOLDER, toLocalPhoneDigits } from "@repo/ui";
import { TurnstileWidget } from "../captcha/turnstile-widget";
import { useCaptchaToken } from "../../hooks/use-captcha-token";
import { useCareerApply } from "../../hooks/use-career-apply";

const inputClass = [
  "h-11 w-full rounded-lg border border-border bg-bg px-3 text-sm text-fg placeholder:text-fg-subtle",
  "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
].join(" ");

const labelClass = "mb-1.5 block text-sm font-medium text-fg";

export interface CareerApplyFormProps {
  /** The CRM opening this form applies to (ADR-0066). */
  jobOpeningId?: string;
  /** The opening's title, shown to the candidate and snapshotted onto the application. */
  role: string;
  onClose?: () => void;
  /** Rendered after a successful submit, so a modal can offer "Done" instead of "Cancel". */
  onSubmitted?: () => void;
}

export function CareerApplyForm({ jobOpeningId, role, onClose, onSubmitted }: CareerApplyFormProps) {
  const nameId = useId();
  const emailId = useId();
  const phoneId = useId();
  const coverId = useId();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [coverLetter, setCoverLetter] = useState("");
  const [resumeStorageKey, setResumeStorageKey] = useState<string | null>(null);

  const { state, fieldErrors, submit, reset, requestResumeUploadUrl } = useCareerApply();
  const { token: captchaToken, setToken, resetToken, hasToken: hasCaptcha } = useCaptchaToken();

  const isSubmitting = state.kind === "submitting";
  const isSuccess = state.kind === "success";

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!resumeStorageKey || !captchaToken) return;
    await submit({
      name,
      email,
      phone,
      jobOpeningId,
      role,
      resumeStorageKey,
      coverLetter,
      captchaToken,
    });
    onSubmitted?.();
  }

  if (isSuccess) {
    return (
      <div role="status" aria-live="polite" className="py-6 text-center" data-testid="career-apply-success">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-success/10">
          <CheckCircleIcon className="size-6 text-success" />
        </div>
        <p className="mt-4 text-lg font-semibold text-fg">
          {state.kind === "success" ? state.message : "Application received"}
        </p>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-fg-muted">
          We have emailed you a confirmation. Someone from our team reads every application, and you will hear from us
          either way.
        </p>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="mt-6 inline-flex min-h-[44px] items-center justify-center rounded-lg bg-brand-500 px-6 text-sm font-semibold text-white transition-colors hover:bg-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            Done
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-5"
      data-testid={`career-apply-form-${role}`}
      aria-label={`Apply for ${role}`}
      noValidate
    >
      {/*
        FIRST, not last — see the file header. Everything below stays inert until this
        resolves, because the resume upload cannot succeed without it.
      */}
      <div className="rounded-lg border border-border bg-surface p-4">
        <div className="mb-3 flex items-center gap-2">
          <ShieldCheckIcon className="size-4 text-brand-500" />
          <p className="text-sm font-medium text-fg">
            {hasCaptcha ? "Verified — you can continue" : "Quick check first"}
          </p>
        </div>
        {!hasCaptcha ? (
          <p className="mb-3 text-xs leading-relaxed text-fg-muted">
            Confirm you are human before uploading your resume. It takes a second and keeps spam out of our hiring
            queue.
          </p>
        ) : null}
        <TurnstileWidget
          onToken={setToken}
          onExpire={resetToken}
          onError={resetToken}
          data-testid="career-apply-captcha"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={nameId} className={labelClass}>
            Full name <span aria-hidden="true" className="text-danger">*</span>
          </label>
          <input
            id={nameId}
            type="text"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={Boolean(fieldErrors.name) || undefined}
            className={inputClass}
            data-testid="career-field-name"
          />
          {fieldErrors.name ? (
            <p role="alert" className="mt-1.5 text-xs text-danger">{fieldErrors.name}</p>
          ) : null}
        </div>
        <div>
          <label htmlFor={emailId} className={labelClass}>
            Email <span aria-hidden="true" className="text-danger">*</span>
          </label>
          <input
            id={emailId}
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={Boolean(fieldErrors.email) || undefined}
            className={inputClass}
            data-testid="career-field-email"
          />
          {fieldErrors.email ? (
            <p role="alert" className="mt-1.5 text-xs text-danger">{fieldErrors.email}</p>
          ) : null}
        </div>
      </div>

      <div>
        <label htmlFor={phoneId} className={labelClass}>
          Phone <span className="text-xs text-fg-subtle">(optional)</span>
        </label>
        <input
          {...PHONE_INPUT_PROPS}
          id={phoneId}
          value={phone}
          onChange={(e) => setPhone(toLocalPhoneDigits(e.target.value))}
          aria-invalid={Boolean(fieldErrors.phone) || undefined}
          aria-describedby={fieldErrors.phone ? `${phoneId}-error` : undefined}
          className={inputClass}
          placeholder={PHONE_PLACEHOLDER}
          data-testid="career-field-phone"
        />
        {fieldErrors.phone ? (
          <p id={`${phoneId}-error`} role="alert" className="mt-1.5 text-xs text-danger">{fieldErrors.phone}</p>
        ) : null}
      </div>

      <div>
        <span className={labelClass}>
          Resume <span aria-hidden="true" className="text-danger">*</span>
        </span>
        <FileUpload
          // `captchaToken` is passed, never `?? "noop"`. The hook throws a readable error if
          // it is somehow missing, rather than sending a token production always rejects.
          requestUploadUrl={(file) => requestResumeUploadUrl(file, captchaToken)}
          onUploaded={(storageKey) => setResumeStorageKey(storageKey)}
          onRemoved={() => setResumeStorageKey(null)}
          acceptedTypes={["application/pdf"]}
          maxBytes={5 * 1024 * 1024}
          disabled={!hasCaptcha}
          label="Upload your resume (PDF)"
          data-testid="career-resume-upload"
        />
        {!hasCaptcha ? (
          <p className="mt-1.5 text-xs text-fg-subtle">Complete the check above to attach your resume.</p>
        ) : null}
        {fieldErrors.resumeStorageKey ? (
          <p role="alert" className="mt-1.5 text-xs text-danger">{fieldErrors.resumeStorageKey}</p>
        ) : null}
      </div>

      <div>
        <label htmlFor={coverId} className={labelClass}>
          Cover letter <span className="text-xs text-fg-subtle">(optional)</span>
        </label>
        <textarea
          id={coverId}
          rows={4}
          value={coverLetter}
          onChange={(e) => setCoverLetter(e.target.value)}
          className={[inputClass, "h-auto resize-y py-2"].join(" ")}
          placeholder="Tell us why you're a great fit..."
          data-testid="career-field-cover-letter"
        />
      </div>

      {state.kind === "error" ? (
        <p role="alert" className="rounded-lg bg-danger/10 p-3 text-sm text-danger" data-testid="career-apply-error">
          {state.message}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={
            isSubmitting ||
            !hasCaptcha ||
            !resumeStorageKey ||
            name.trim().length === 0 ||
            email.trim().length === 0
          }
          className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-lg bg-brand-500 px-6 text-sm font-semibold text-white transition-colors hover:bg-brand-600 active:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          data-testid="career-apply-submit"
        >
          {isSubmitting ? "Submitting…" : "Submit application"}
        </button>
        {onClose ? (
          <button
            type="button"
            onClick={() => {
              reset();
              onClose();
            }}
            className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-border px-5 text-sm font-medium text-fg-muted transition-colors hover:bg-surface hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}

CareerApplyForm.displayName = "CareerApplyForm";
