"use client";

/**
 * useContactForm — I/O + state for the /contact page form (T32,
 * docs/plans/phase-9-completion.md).
 *
 * Validates against `SubmitContactRequestSchema` (@repo/types) before calling
 * `client.public.contact.submit()`. Captcha-gated (Turnstile; "noop" in dev).
 * No business logic in the component — this hook owns all I/O + validation.
 */

import { useCallback, useRef, useState } from "react";
import { SubmitContactRequestSchema } from "@repo/types";
import { apiClient } from "../lib/api-client";

const TOS_VERSION =
  typeof process !== "undefined"
    ? (process.env.NEXT_PUBLIC_TOS_VERSION ?? "v1.0")
    : "v1.0";

export interface ContactFormInput {
  name: string;
  email: string;
  phone: string;
  subject: string;
  message: string;
  marketingOptIn: boolean;
  captchaToken: string;
}

type SubmitState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

export interface UseContactFormReturn {
  state: SubmitState;
  fieldErrors: Record<string, string>;
  submit: (input: ContactFormInput) => Promise<void>;
  reset: () => void;
}

export function useContactForm(): UseContactFormReturn {
  const [state, setState] = useState<SubmitState>({ kind: "idle" });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const submittingRef = useRef(false);

  const submit = useCallback(async (input: ContactFormInput) => {
    const parsed = SubmitContactRequestSchema.safeParse({
      name: input.name.trim(),
      email: input.email.trim(),
      phone: input.phone.trim() || undefined,
      subject: input.subject.trim() || undefined,
      message: input.message.trim(),
      consent: { marketingOptIn: input.marketingOptIn, tosVersion: TOS_VERSION },
      captchaToken: input.captchaToken || "noop",
    });

    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        errors[String(issue.path[0] ?? "form")] = issue.message;
      }
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});

    if (submittingRef.current) return;
    submittingRef.current = true;
    setState({ kind: "submitting" });

    try {
      const result = await apiClient.public.contact.submit(parsed.data);
      setState({
        kind: "success",
        message: result.message ?? "Thanks! Our team will get back to you shortly.",
      });
    } catch (err: unknown) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : "Something went wrong. Please try again.";
      setState({ kind: "error", message });
    } finally {
      submittingRef.current = false;
    }
  }, []);

  const reset = useCallback(() => {
    setState({ kind: "idle" });
    setFieldErrors({});
  }, []);

  return { state, fieldErrors, submit, reset };
}
