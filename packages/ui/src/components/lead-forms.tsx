"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { cn } from "../lib/cn";
import {
  PHONE_INPUT_PROPS,
  PHONE_PLACEHOLDER,
  isCompleteLocalPhone,
  toLocalPhoneDigits,
} from "../lib/phone";

/**
 * LeadFormInline / ExitIntentModal / StickyLeadBar
 * Per docs/01-prd-website.md §7.7 ("Lead forms everywhere: inline, sticky bar,
 * exit-intent modal → CRM lead with UTM capture").
 *
 * Design contract (applies to all three):
 *
 * 1. HONEYPOT: A visually-hidden `aria-hidden` trap field is always present (submitted to
 *    the caller as `_hp_email`; DOM name is `_hp_field` so browser autofill never fills it).
 *    The field is `tabIndex={-1}`, positioned off-screen, and `autoComplete="off"`.
 *    Bots filling all fields will populate this field; the server rejects submissions
 *    where it is non-empty. It is intentionally NOT in `values` — the caller receives
 *    the raw `FormData` / value map and must check `_hp_email === ""` server-side.
 *
 * 2. CAPTCHA SLOT: A `captchaSlot` prop receives the Turnstile/hCaptcha widget rendered
 *    by the APP (not this component). The app mounts the vendor widget as a child,
 *    typically `<Turnstile siteKey={...} onSuccess={setToken} />`. This component
 *    renders the slot in the form layout. No vendor SDK is imported here.
 *
 * 3. CONTROLLED FIELDS: All fields are controlled (value + onChange pattern). The
 *    primitive emits a plain JS object (not a FormData), the app owns submission.
 *
 * 4. SUBMISSION: The caller provides `onSubmit(values: LeadFormValues)` — the primitive
 *    renders a loading state while `isSubmitting` is true; success/error states are
 *    rendered via `successSlot` / `errorMessage`.
 *
 * 5. UTM: UTM params are passed as `utmParams` — the caller reads them from
 *    `useSearchParams()` (Next.js) and forwards here; they are included in values.
 *
 * a11y:
 * - Labeled inputs (Label + Input or `aria-label`).
 * - Error messages: `role="alert"`.
 * - Spinner on submit: `aria-busy`.
 * - ExitIntentModal: Radix Dialog — focus-trapped, Escape-closes, returns focus.
 * - StickyLeadBar: announces form via `aria-label`.
 * - Honeypot: `aria-hidden="true"`, `tabIndex={-1}`, off-screen via `sr-only`-like class.
 *
 * SSR-safety: `"use client"` — ExitIntentModal needs useEffect for the exit-intent
 * listener; IntersectionObserver for StickyLeadBar.
 *
 * Usage (inline):
 *   <LeadFormInline
 *     heading="Talk to a counsellor"
 *     fields={["name", "phone", "email", "program"]}
 *     programOptions={programs}
 *     captchaSlot={<Turnstile siteKey={...} onSuccess={setToken} />}
 *     onSubmit={async (values) => await submitLead(values)}
 *   />
 *
 * Usage (exit-intent):
 *   <ExitIntentModal
 *     open={showModal}
 *     onOpenChange={setShowModal}
 *     heading="Don't miss out!"
 *     captchaSlot={<Turnstile ... />}
 *     onSubmit={...}
 *   />
 *
 * Usage (sticky bar):
 *   <StickyLeadBar
 *     label="Get a callback"
 *     placeholder="Your phone number"
 *     captchaSlot={<Turnstile ... />}
 *     onSubmit={...}
 *   />
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LeadFormField =
  | "name"
  | "phone"
  | "email"
  | "program"
  | "message"
  | "course"
  | "college"
  | "language";

export interface LeadFormValues {
  name?: string;
  phone?: string;
  email?: string;
  program?: string;
  message?: string;
  /** Free-text course/program the visitor typed (marketing popup). */
  course?: string;
  /** Free-text college/university. */
  college?: string;
  /** Free-text preferred contact language. */
  language?: string;
  /** Always empty on legitimate submissions; non-empty = bot. */
  _hp_email: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
}

export interface UtmParams {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
}

export interface ProgramOption {
  value: string;
  label: string;
}

// ---------------------------------------------------------------------------
// Honeypot field — always aria-hidden, tabIndex=-1, off-screen
// ---------------------------------------------------------------------------

interface HoneypotFieldProps {
  value: string;
  onChange: (v: string) => void;
}

function HoneypotField({ value, onChange }: HoneypotFieldProps): React.JSX.Element {
  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        left: "-9999px",
        width: "1px",
        height: "1px",
        overflow: "hidden",
        opacity: 0,
        pointerEvents: "none",
      }}
    >
      {/* Do not label this field — its purpose is to catch bots.
          type="text" + a name WITHOUT an "email"/"name"/"phone" token: browser
          autofill heuristics match those tokens and would fill the honeypot for
          real users, silently discarding their submission. Bots fill every
          input regardless, so the trap still works. The submitted DTO field is
          still `_hp_email` — only the DOM attributes are de-autofilled. */}
      <input
        type="text"
        name="_hp_field"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared form field styles
// ---------------------------------------------------------------------------

const inputClass = cn(
  "h-11 w-full rounded-md border border-border bg-card px-3 text-sm text-fg placeholder:text-fg-subtle",
  "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
);

// ---------------------------------------------------------------------------
// LeadFormCore — reused by all three variants
// ---------------------------------------------------------------------------

interface LeadFormCoreProps {
  heading?: string;
  subheading?: string;
  fields?: LeadFormField[];
  programOptions?: ProgramOption[];
  captchaSlot?: React.ReactNode;
  onSubmit?: (values: LeadFormValues) => void | Promise<void>;
  submitLabel?: string;
  isSubmitting?: boolean;
  successSlot?: React.ReactNode;
  errorMessage?: string;
  utmParams?: UtmParams;
  layout?: "column" | "row";
  /** Optional fixed country-code prefix shown before the phone input, e.g. "+91". */
  phonePrefix?: string;
  /**
   * Optional extra content rendered after the submit button, still inside the
   * form and the card's own background/padding (e.g. TOS/marketing consent
   * checkboxes) — keeps it on the guaranteed-light card surface instead of
   * whatever background the caller's section happens to use.
   */
  footerSlot?: React.ReactNode;
  className?: string;
}

function LeadFormCore({
  heading,
  subheading,
  fields = ["name", "phone", "email"],
  programOptions,
  captchaSlot,
  onSubmit,
  submitLabel = "Get a Callback",
  isSubmitting = false,
  successSlot,
  errorMessage,
  utmParams,
  layout = "column",
  phonePrefix,
  footerSlot,
  className,
}: LeadFormCoreProps): React.JSX.Element {
  const [values, setValues] = React.useState<Omit<LeadFormValues, "_hp_email">>({
    name: "",
    phone: "",
    email: "",
    program: "",
    message: "",
    course: "",
    college: "",
    language: "",
    ...utmParams,
  });
  const [honeypot, setHoneypot] = React.useState("");
  // Several lead forms can be mounted on one page (inline CTA band + popup) —
  // ids must be per-instance or labels/autofill bind to the wrong form.
  const uid = React.useId();
  const fieldId = (field: string) => `lf-${field}-${uid}`;

  const set = (key: keyof typeof values) => (val: string) => {
    setValues((prev) => ({ ...prev, [key]: val }));
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await onSubmit?.({ ...values, _hp_email: honeypot });
  }

  // The submit button stays disabled until every REQUIRED rendered field has a
  // usable value, so it never reads as actionable on an empty form. Optional
  // fields (program/message/course/college/language) are ignored. The caller
  // still validates on submit — this is presentation, not enforcement.
  const requiredFieldsFilled = fields.every((field) => {
    switch (field) {
      case "name":
        return (values.name ?? "").trim().length > 0;
      case "phone":
        return isCompleteLocalPhone(values.phone);
      case "email":
        return (values.email ?? "").trim().length > 0;
      default:
        return true;
    }
  });

  if (successSlot) {
    return <div>{successSlot}</div>;
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className={cn("flex flex-col gap-4", className)}
    >
      {/* Honeypot — always present, always aria-hidden */}
      <HoneypotField value={honeypot} onChange={setHoneypot} />

      {heading ? (
        <div>
          <h3 className="text-lg font-semibold text-fg">{heading}</h3>
          {subheading ? <p className="mt-1 text-sm text-fg-muted">{subheading}</p> : null}
        </div>
      ) : null}

      <div className={cn(layout === "row" ? "flex flex-wrap gap-3" : "flex flex-col gap-3")}>
        {/* Fields render in the order the caller lists them in `fields`. */}
        {fields.map((field) => {
          const wrapClass = layout === "row" ? "flex-1 min-w-[140px]" : undefined;
          switch (field) {
            case "name":
              return (
                <div key="name" className={wrapClass}>
                  <label className="sr-only" htmlFor={fieldId("name")}>Full name</label>
                  <input
                    id={fieldId("name")}
                    type="text"
                    name="name"
                    autoComplete="name"
                    placeholder="Your name"
                    value={values.name ?? ""}
                    onChange={(e) => set("name")(e.target.value)}
                    required
                    className={inputClass}
                  />
                </div>
              );
            case "phone":
              return (
                <div key="phone" className={wrapClass}>
                  <label className="sr-only" htmlFor={fieldId("phone")}>Phone number</label>
                  {phonePrefix ? (
                    <div className="flex items-stretch gap-2">
                      <span
                        aria-hidden="true"
                        className="flex h-11 shrink-0 items-center rounded-md border border-border bg-surface px-3 text-sm text-fg-muted"
                      >
                        {phonePrefix}
                      </span>
                      <input
                        {...PHONE_INPUT_PROPS}
                        id={fieldId("phone")}
                        name="phone"
                        placeholder={PHONE_PLACEHOLDER}
                        value={values.phone ?? ""}
                        onChange={(e) => set("phone")(toLocalPhoneDigits(e.target.value))}
                        required
                        className={cn(inputClass, "flex-1")}
                      />
                    </div>
                  ) : (
                    <input
                      {...PHONE_INPUT_PROPS}
                      id={fieldId("phone")}
                      name="phone"
                      placeholder={PHONE_PLACEHOLDER}
                      value={values.phone ?? ""}
                      onChange={(e) => set("phone")(toLocalPhoneDigits(e.target.value))}
                      required
                      className={inputClass}
                    />
                  )}
                </div>
              );
            case "email":
              return (
                <div key="email" className={wrapClass}>
                  <label className="sr-only" htmlFor={fieldId("email")}>Email address</label>
                  <input
                    id={fieldId("email")}
                    type="email"
                    name="email"
                    autoComplete="email"
                    placeholder="Email address"
                    value={values.email ?? ""}
                    onChange={(e) => set("email")(e.target.value)}
                    required
                    className={inputClass}
                  />
                </div>
              );
            case "program":
              return programOptions ? (
                <div key="program" className={wrapClass}>
                  <label className="sr-only" htmlFor={fieldId("program")}>Program of interest</label>
                  <select
                    id={fieldId("program")}
                    name="program"
                    value={values.program ?? ""}
                    onChange={(e) => set("program")(e.target.value)}
                    className={cn(inputClass, "cursor-pointer")}
                  >
                    <option value="">Select a program</option>
                    {programOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
              ) : null;
            case "course":
              return (
                <div key="course" className={wrapClass}>
                  <label className="sr-only" htmlFor={fieldId("course")}>Course</label>
                  <input
                    id={fieldId("course")}
                    type="text"
                    name="course"
                    placeholder="e.g. Full Stack Web Development"
                    value={values.course ?? ""}
                    onChange={(e) => set("course")(e.target.value)}
                    className={inputClass}
                  />
                </div>
              );
            case "college":
              return (
                <div key="college" className={wrapClass}>
                  <label className="sr-only" htmlFor={fieldId("college")}>College or university</label>
                  <input
                    id={fieldId("college")}
                    type="text"
                    name="college"
                    autoComplete="organization"
                    placeholder="e.g. IIT Bombay"
                    value={values.college ?? ""}
                    onChange={(e) => set("college")(e.target.value)}
                    className={inputClass}
                  />
                </div>
              );
            case "language":
              return (
                <div key="language" className={wrapClass}>
                  <label className="sr-only" htmlFor={fieldId("language")}>Preferred language</label>
                  <input
                    id={fieldId("language")}
                    type="text"
                    name="language"
                    placeholder="e.g. English, Hindi, Tamil"
                    value={values.language ?? ""}
                    onChange={(e) => set("language")(e.target.value)}
                    className={inputClass}
                  />
                </div>
              );
            case "message":
              return (
                <div key="message" className={layout === "row" ? "flex-1 min-w-[200px]" : undefined}>
                  <label className="sr-only" htmlFor={fieldId("message")}>Message</label>
                  <textarea
                    id={fieldId("message")}
                    name="message"
                    placeholder="Your message (optional)"
                    rows={3}
                    value={values.message ?? ""}
                    onChange={(e) => set("message")(e.target.value)}
                    className={cn(inputClass, "h-auto py-2.5 resize-none")}
                  />
                </div>
              );
            default:
              return null;
          }
        })}
      </div>

      {/* Captcha widget slot — vendor widget mounted by the app */}
      {captchaSlot ? (
        <div>{captchaSlot}</div>
      ) : null}

      {/* Error */}
      {errorMessage ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={isSubmitting || !requiredFieldsFilled}
        aria-busy={isSubmitting}
        aria-disabled={isSubmitting || !requiredFieldsFilled}
        className={cn(
          "flex min-h-[44px] w-full items-center justify-center rounded-md bg-brand-500 px-5 text-sm font-semibold text-white",
          "transition-colors hover:bg-brand-600 active:bg-brand-700",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          "disabled:pointer-events-none disabled:opacity-50",
          layout === "row" && "w-auto min-w-[120px]",
        )}
      >
        {isSubmitting ? (
          <>
            <svg aria-hidden="true" className="mr-2 size-4 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
            </svg>
            Sending…
          </>
        ) : submitLabel}
      </button>

      {footerSlot}
    </form>
  );
}

// ---------------------------------------------------------------------------
// LeadFormInline (public component)
// ---------------------------------------------------------------------------

export interface LeadFormInlineProps extends LeadFormCoreProps {
  "data-testid"?: string;
}

export function LeadFormInline({
  "data-testid": testId,
  className,
  ...props
}: LeadFormInlineProps): React.JSX.Element {
  return (
    <div
      data-testid={testId ?? "lead-form-inline"}
      className={cn("rounded-xl border border-border bg-card p-6 shadow-sm", className)}
    >
      <LeadFormCore {...props} />
    </div>
  );
}
LeadFormInline.displayName = "LeadFormInline";

// ---------------------------------------------------------------------------
// ExitIntentModal (public component)
// ---------------------------------------------------------------------------

export interface ExitIntentModalProps extends LeadFormCoreProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Optional decorative side panel (illustration/photo + caption) rendered to
   * the right of the form on `sm+` screens; hidden on mobile so the form stays
   * usable. Purely visual — mark any image inside with an empty `alt`.
   */
  imageSlot?: React.ReactNode;
  "data-testid"?: string;
}

export function ExitIntentModal({
  open,
  onOpenChange,
  heading = "Wait, before you go!",
  subheading = "Talk to a counsellor and find the right program for you.",
  imageSlot,
  "data-testid": testId,
  className,
  ...props
}: ExitIntentModalProps): React.JSX.Element {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-fg/40 data-[state=open]:animate-in data-[state=open]:fade-in data-[state=closed]:animate-out data-[state=closed]:fade-out" />
        <DialogPrimitive.Content
          data-testid={testId ?? "exit-intent-modal"}
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2",
            "rounded-xl border border-border bg-card shadow-md",
            // No overflow-hidden with an imageSlot — the side panel's artwork
            // may break out above the card (pop-out effect); the slot rounds
            // and clips its own background instead.
            // With an imageSlot the card carries a photo panel alongside the form, so it
            // needs more room than the plain max-w-md form-only dialog. 3xl (768px) keeps
            // the form column at its previous width while the photo panel grows.
            imageSlot ? "p-0 sm:max-w-3xl" : "p-6",
            "data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:zoom-in-95",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:zoom-out-95",
            "focus-visible:outline-none",
            className,
          )}
        >
          <DialogPrimitive.Title className="sr-only">{heading}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">{subheading}</DialogPrimitive.Description>

          {imageSlot ? (
            <DialogPrimitive.Close
              aria-label="Close dialog"
              className={cn(
                "absolute right-3 top-3 z-10 rounded-md p-1.5 text-fg-subtle transition-colors hover:bg-surface hover:text-fg",
                // ≥sm the button sits ON TOP of the imageSlot photo — a translucent dark
                // chip keeps the icon legible on any imagery (the previous white-on-
                // transparent styling vanished against light photos).
                "sm:bg-fg/45 sm:text-white sm:hover:bg-fg/65 sm:hover:text-white",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
            >
              <X className="size-4" aria-hidden="true" />
            </DialogPrimitive.Close>
          ) : null}

          <div className={cn(imageSlot && "flex items-stretch")}>
            <div className={cn(imageSlot && "min-w-0 flex-1 p-6")}>
              <div className={cn("mb-4 flex items-start justify-between gap-4", imageSlot && "pr-6 sm:pr-0")}>
                <div>
                  <h2 className="text-lg font-semibold text-fg">{heading}</h2>
                  {subheading ? <p className="mt-1 text-sm text-fg-muted">{subheading}</p> : null}
                </div>
                {imageSlot ? null : (
                  <DialogPrimitive.Close
                    aria-label="Close dialog"
                    className={cn(
                      "shrink-0 rounded-md p-1.5 text-fg-subtle transition-colors hover:bg-surface hover:text-fg",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    )}
                  >
                    <X className="size-4" aria-hidden="true" />
                  </DialogPrimitive.Close>
                )}
              </div>

              <LeadFormCore {...props} heading={undefined} subheading={undefined} />
            </div>

            {/*
              Photo panel width steps up at md rather than jumping straight to w-96:
              between sm and md the dialog is capped by the VIEWPORT (max-w-3xl exceeds
              it), so a 384px panel there would squeeze the form column to ~256px. At md+
              the dialog reaches its full 768px and the wider panel is free.
            */}
            {imageSlot ? (
              <div aria-hidden="true" className="hidden w-80 shrink-0 self-stretch sm:block md:w-96">
                {imageSlot}
              </div>
            ) : null}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
ExitIntentModal.displayName = "ExitIntentModal";

// ---------------------------------------------------------------------------
// StickyLeadBar (public component) — slim top/bottom bar variant
// ---------------------------------------------------------------------------

export interface StickyLeadBarProps {
  label?: string;
  placeholder?: string;
  submitLabel?: string;
  captchaSlot?: React.ReactNode;
  onSubmit?: (values: LeadFormValues) => void | Promise<void>;
  isSubmitting?: boolean;
  errorMessage?: string;
  successSlot?: React.ReactNode;
  position?: "top" | "bottom";
  className?: string;
  "data-testid"?: string;
}

export function StickyLeadBar({
  label = "Get a free counselling call",
  placeholder = PHONE_PLACEHOLDER,
  submitLabel = "Call Me",
  captchaSlot,
  onSubmit,
  isSubmitting = false,
  errorMessage,
  successSlot,
  position = "bottom",
  className,
  "data-testid": testId,
}: StickyLeadBarProps): React.JSX.Element {
  const [phone, setPhone] = React.useState("");
  const [honeypot, setHoneypot] = React.useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await onSubmit?.({
      phone,
      _hp_email: honeypot,
    });
  }

  if (successSlot) {
    return (
      <div
        data-testid={testId ?? "sticky-lead-bar"}
        className={cn(
          "fixed inset-x-0 z-30 border-border bg-card/95 backdrop-blur-sm px-4 py-3",
          position === "top" ? "top-0 border-b" : "bottom-0 border-t",
          className,
        )}
      >
        {/* Centred, not left-aligned: the confirmation replaces a full-width bar,
            so an unconstrained slot would strand the message against the left
            edge on desktop. Same max-width as the form below it. */}
        <div className="mx-auto flex max-w-screen-sm items-center justify-center">
          {successSlot}
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid={testId ?? "sticky-lead-bar"}
      aria-label={label}
      className={cn(
        "fixed inset-x-0 z-30 border-border bg-card/95 backdrop-blur-sm px-4 py-3",
        position === "top" ? "top-0 border-b" : "bottom-0 border-t",
        className,
      )}
    >
      <form
        onSubmit={handleSubmit}
        noValidate
        className="mx-auto flex max-w-screen-sm flex-col gap-2 sm:flex-row sm:items-center"
      >
        {/* Honeypot */}
        <HoneypotField value={honeypot} onChange={setHoneypot} />

        {label ? (
          <span className="shrink-0 text-sm font-medium text-fg hidden sm:inline">{label}</span>
        ) : null}

        <label className="sr-only" htmlFor="sticky-lead-phone">Phone number</label>
        <input
          {...PHONE_INPUT_PROPS}
          id="sticky-lead-phone"
          name="phone"
          placeholder={placeholder}
          value={phone}
          onChange={(e) => setPhone(toLocalPhoneDigits(e.target.value))}
          required
          className={cn(inputClass, "flex-1")}
        />

        {/* Captcha slot — rendered inline (may be hidden widget, e.g. invisible Turnstile) */}
        {captchaSlot ? <div className="shrink-0">{captchaSlot}</div> : null}

        {errorMessage ? (
          <p role="alert" className="text-xs text-danger sm:hidden">
            {errorMessage}
          </p>
        ) : null}

        <button
          type="submit"
          // "Call Me" is pointless without a complete number to call.
          disabled={isSubmitting || !isCompleteLocalPhone(phone)}
          aria-busy={isSubmitting}
          aria-disabled={isSubmitting || !isCompleteLocalPhone(phone)}
          className={cn(
            "shrink-0 flex min-h-[44px] items-center rounded-md bg-brand-500 px-5 text-sm font-semibold text-white",
            "transition-colors hover:bg-brand-600 active:bg-brand-700",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            "disabled:pointer-events-none disabled:opacity-50",
          )}
        >
          {isSubmitting ? "…" : submitLabel}
        </button>
      </form>
    </div>
  );
}
StickyLeadBar.displayName = "StickyLeadBar";
