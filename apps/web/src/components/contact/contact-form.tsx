"use client";

/**
 * ContactForm — /contact page form (T32, docs/plans/phase-9-completion.md).
 *
 * Replaces the previous mailto:/wa.me link-only contact page with a real,
 * zod-validated, captcha-gated submission to `client.public.contact.submit`.
 *
 * States: idle/submitting/success/error, all handled inline. a11y: labelled
 * fields, inline errors via role="alert", honeypot field for bot traps.
 */

import { useEffect, useId, useState, type FormEvent } from "react";
import { PHONE_INPUT_PROPS, PHONE_PLACEHOLDER, toLocalPhoneDigits } from "@repo/ui";
import { TurnstileWidget } from "../captcha/turnstile-widget";
import { useCaptchaToken } from "../../hooks/use-captcha-token";
import { useContactForm } from "../../hooks/use-contact-form";

const inputClass = [
  "h-11 w-full rounded-md border border-border bg-card px-3 text-sm text-fg placeholder:text-fg-subtle",
  "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
].join(" ");

const TOS_VERSION =
  typeof process !== "undefined"
    ? (process.env.NEXT_PUBLIC_TOS_VERSION ?? "v1.0")
    : "v1.0";

/** Mirrors SubmitContactRequestSchema's `message: z.string().max(5000)`. */
const MESSAGE_MAX = 5000;

/** Human labels for the error summary — covers fields with no inline error slot. */
const FIELD_LABELS: Record<string, string> = {
  name: "Full name",
  email: "Email",
  phone: "Phone",
  subject: "Subject",
  message: "Message",
  consent: "Consent",
  captchaToken: "Verification",
  form: "Form",
};

export function ContactForm() {
  const nameId = useId();
  const emailId = useId();
  const phoneId = useId();
  const subjectId = useId();
  const messageId = useId();
  const marketingId = useId();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [honeypot, setHoneypot] = useState("");

  const { state, fieldErrors, submit, reset } = useContactForm();
  const { token: captchaToken, setToken, resetToken } = useCaptchaToken();

  // Belt-and-suspenders: if the browser's autofill populated the hidden honeypot during
  // initial load, clear it so a legitimate user is never silently treated as a bot.
  useEffect(() => {
    setHoneypot("");
  }, []);

  const isSubmitting = state.kind === "submitting";
  const isSuccess = state.kind === "success";
  // Required fields per SubmitContactRequestSchema — phone/subject are optional.
  // Presentation-only gate; the hook still validates on submit.
  const canSubmit =
    name.trim().length > 0 && email.trim().length > 0 && message.trim().length > 0;

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (honeypot.length > 0) {
      // Silently succeed for bots.
      return;
    }
    await submit({
      name,
      email,
      phone,
      subject,
      message,
      marketingOptIn,
      captchaToken: captchaToken ?? "noop",
    });
  }

  if (isSuccess) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="rounded-xl border border-success/30 bg-success/10 p-8 text-center"
        data-testid="contact-form-success"
      >
        <div
          aria-hidden="true"
          className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-success/20 text-2xl"
        >
          ✓
        </div>
        <p className="font-semibold text-success">
          {state.kind === "success" ? state.message : "Message sent!"}
        </p>
        <button
          type="button"
          onClick={() => {
            reset();
            setName("");
            setEmail("");
            setPhone("");
            setSubject("");
            setMessage("");
            resetToken();
          }}
          className="mt-4 text-sm font-medium text-brand-500 underline hover:text-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Send another message
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-4 rounded-xl border border-border bg-card p-6"
      data-testid="contact-form"
      noValidate
    >
      {/* Honeypot — bot trap. MUST NOT be a name the browser's autofill recognises:
          the old `_hp_company` mapped to the "organization" autofill category, so Chrome
          autofill filled this hidden field when the user autofilled their name/email,
          which silently tripped the trap and blocked real submissions. A neutral name +
          password-manager ignore hints keep autofill out while fill-everything bots still
          trip it. */}
      <div aria-hidden="true" style={{ position: "absolute", left: "-9999px", width: 1, height: 1, overflow: "hidden" }}>
        <input
          type="text"
          name="hp_field"
          tabIndex={-1}
          autoComplete="off"
          data-lpignore="true"
          data-1p-ignore="true"
          data-form-type="other"
          value={honeypot}
          onChange={(e) => setHoneypot(e.target.value)}
          data-testid="contact-honeypot"
        />
      </div>

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
          aria-describedby={fieldErrors.name ? `${nameId}-error` : undefined}
          className={inputClass}
          data-testid="contact-field-name"
        />
        {fieldErrors.name ? (
          <p id={`${nameId}-error`} role="alert" className="mt-1.5 text-xs text-danger">
            {fieldErrors.name}
          </p>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
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
            aria-describedby={fieldErrors.email ? `${emailId}-error` : undefined}
            className={inputClass}
            data-testid="contact-field-email"
          />
          {fieldErrors.email ? (
            <p id={`${emailId}-error`} role="alert" className="mt-1.5 text-xs text-danger">
              {fieldErrors.email}
            </p>
          ) : null}
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
            data-testid="contact-field-phone"
          />
          {fieldErrors.phone ? (
            <p id={`${phoneId}-error`} role="alert" className="mt-1.5 text-xs text-danger">
              {fieldErrors.phone}
            </p>
          ) : null}
        </div>
      </div>

      <div>
        <label htmlFor={subjectId} className="mb-1.5 block text-sm font-medium text-fg">
          Subject <span className="text-fg-subtle text-xs">(optional)</span>
        </label>
        <input
          id={subjectId}
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          className={inputClass}
          placeholder="What can we help with?"
          data-testid="contact-field-subject"
        />
      </div>

      <div>
        <label htmlFor={messageId} className="mb-1.5 block text-sm font-medium text-fg">
          Message <span aria-hidden="true" className="text-danger">*</span>
        </label>
        <textarea
          id={messageId}
          rows={5}
          value={message}
          maxLength={MESSAGE_MAX}
          onChange={(e) => setMessage(e.target.value)}
          aria-invalid={Boolean(fieldErrors.message) || undefined}
          aria-describedby={fieldErrors.message ? `${messageId}-error` : undefined}
          className={[inputClass, "h-auto resize-y py-2"].join(" ")}
          placeholder="Tell us how we can help..."
          data-testid="contact-field-message"
        />
        <div className="mt-1.5 flex items-start justify-between gap-2">
          {fieldErrors.message ? (
            <p id={`${messageId}-error`} role="alert" className="text-xs text-danger">
              {fieldErrors.message}
            </p>
          ) : (
            <span />
          )}
          <span
            className={[
              "shrink-0 text-xs tabular-nums",
              message.length >= MESSAGE_MAX ? "text-danger" : "text-fg-subtle",
            ].join(" ")}
            data-testid="contact-message-counter"
          >
            {message.length.toLocaleString()}/{MESSAGE_MAX.toLocaleString()}
          </span>
        </div>
      </div>

      <label htmlFor={marketingId} className="flex cursor-pointer items-start gap-2 text-sm text-fg-muted">
        <input
          id={marketingId}
          type="checkbox"
          checked={marketingOptIn}
          onChange={(e) => setMarketingOptIn(e.target.checked)}
          className="mt-0.5 h-4 w-4 cursor-pointer rounded border-border accent-brand-500"
          data-testid="contact-field-marketing"
        />
        <span>
          I consent to receive marketing communications via WhatsApp, email, and SMS
          (TOS {TOS_VERSION}).
        </span>
      </label>

      <TurnstileWidget
        onToken={setToken}
        onExpire={resetToken}
        onError={resetToken}
        data-testid="contact-captcha"
      />

      {state.kind === "error" ? (
        <p role="alert" className="text-sm text-danger" data-testid="contact-form-error">
          {state.message}
        </p>
      ) : null}

      {/* Validation summary — guarantees a failed submit is never a silent no-op,
          including for fields without an inline error slot (subject/consent/captcha). */}
      {Object.keys(fieldErrors).length > 0 ? (
        <div
          role="alert"
          className="rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger"
          data-testid="contact-form-validation-summary"
        >
          <p className="font-medium">Please fix the following before sending:</p>
          <ul className="mt-1 list-disc pl-5">
            {Object.entries(fieldErrors).map(([field, message]) => (
              <li key={field}>
                <span className="font-medium">{FIELD_LABELS[field] ?? field}:</span> {message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <button
        type="submit"
        disabled={isSubmitting || !canSubmit}
        aria-disabled={isSubmitting || !canSubmit}
        className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-brand-500 px-6 text-sm font-semibold text-white transition-colors hover:bg-brand-600 active:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        data-testid="contact-submit"
      >
        {isSubmitting ? "Sending…" : "Send Message"}
      </button>
    </form>
  );
}

ContactForm.displayName = "ContactForm";
