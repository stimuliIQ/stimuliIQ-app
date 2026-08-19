"use client";

/**
 * CareerApplyForm — inline application form shown when a visitor clicks "Apply"
 * on an open role (T32, docs/plans/phase-9-completion.md). Replaces the previous
 * `mailto:`/contact-page-redirect placeholder with a real, zod-validated,
 * captcha-gated submission to `client.public.careers.apply`.
 *
 * Resume upload uses the `FileUpload` primitive (@repo/ui) wired to
 * `useCareerApply().requestResumeUploadUrl`, which calls the PUBLIC
 * `client.public.careers.getResumeUploadUrl()` endpoint (captcha + rate-limited,
 * no session required) — see that hook for details.
 */

import { useId, useState, type FormEvent } from "react";
import { FileUpload, PHONE_INPUT_PROPS, PHONE_PLACEHOLDER, toLocalPhoneDigits } from "@repo/ui";
import { TurnstileWidget } from "../captcha/turnstile-widget";
import { useCaptchaToken } from "../../hooks/use-captcha-token";
import { useCareerApply } from "../../hooks/use-career-apply";

const inputClass = [
  "h-11 w-full rounded-md border border-border bg-bg px-3 text-sm text-fg placeholder:text-fg-subtle",
  "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
].join(" ");

export interface CareerApplyFormProps {
  role: string;
  onClose?: () => void;
}

export function CareerApplyForm({ role, onClose }: CareerApplyFormProps) {
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
    if (!resumeStorageKey) return;
    await submit({
      name,
      email,
      phone,
      role,
      resumeStorageKey,
      coverLetter,
      captchaToken: captchaToken ?? "noop",
    });
  }

  if (isSuccess) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="rounded-lg border border-success/30 bg-success/10 p-6 text-center"
        data-testid="career-apply-success"
      >
        <p className="font-semibold text-success">
          {state.kind === "success" ? state.message : "Application received!"}
        </p>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="mt-3 text-sm font-medium text-brand-500 underline hover:text-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Close
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5"
      data-testid={`career-apply-form-${role}`}
      aria-label={`Apply for ${role}`}
      noValidate
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={nameId} className="mb-1.5 block text-sm font-medium text-fg">
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
          <label htmlFor={emailId} className="mb-1.5 block text-sm font-medium text-fg">
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
        <label htmlFor={phoneId} className="mb-1.5 block text-sm font-medium text-fg">
          Phone <span className="text-fg-subtle text-xs">(optional)</span>
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
        <span className="mb-1.5 block text-sm font-medium text-fg">
          Resume <span aria-hidden="true" className="text-danger">*</span>
        </span>
        <FileUpload
          requestUploadUrl={(file) => requestResumeUploadUrl(file, captchaToken ?? "noop")}
          onUploaded={(storageKey) => setResumeStorageKey(storageKey)}
          onRemoved={() => setResumeStorageKey(null)}
          acceptedTypes={["application/pdf"]}
          maxBytes={5 * 1024 * 1024}
          label="Upload your resume (PDF)"
          data-testid="career-resume-upload"
        />
        {fieldErrors.resumeStorageKey ? (
          <p role="alert" className="mt-1.5 text-xs text-danger">{fieldErrors.resumeStorageKey}</p>
        ) : null}
      </div>

      <div>
        <label htmlFor={coverId} className="mb-1.5 block text-sm font-medium text-fg">
          Cover letter <span className="text-fg-subtle text-xs">(optional)</span>
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

      <TurnstileWidget
        onToken={setToken}
        onExpire={resetToken}
        onError={resetToken}
        data-testid="career-apply-captcha"
      />

      {state.kind === "error" ? (
        <p role="alert" className="text-sm text-danger" data-testid="career-apply-error">
          {state.message}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          // hasCaptcha gates the button for the same reason as the onboarding form: without it,
          // submitting before the challenge resolves posts the literal "noop" fallback, which is
          // just an invalid token in production.
          disabled={isSubmitting || !hasCaptcha || !resumeStorageKey || name.trim().length === 0 || email.trim().length === 0}
          className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-brand-500 px-6 text-sm font-semibold text-white transition-colors hover:bg-brand-600 active:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          data-testid="career-apply-submit"
        >
          {isSubmitting ? "Submitting…" : "Submit Application"}
        </button>
        {onClose ? (
          <button
            type="button"
            onClick={() => {
              reset();
              onClose();
            }}
            className="text-sm font-medium text-fg-muted underline hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}

CareerApplyForm.displayName = "CareerApplyForm";
