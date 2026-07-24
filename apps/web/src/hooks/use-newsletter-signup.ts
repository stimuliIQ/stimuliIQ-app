"use client";

/**
 * useNewsletterSignup — I/O + state for the footer newsletter signup form.
 *
 * Validates against `SubscribeNewsletterRequestSchema` (@repo/types — shared FE+BE
 * boundary, CLAUDE.md §3.2) before calling `client.public.newsletter.subscribe()`.
 * Captcha-gated (Turnstile; "noop" in dev). No business logic in the component —
 * this hook owns all I/O + validation.
 */

import { useCallback, useRef, useState } from "react";
import { SubscribeNewsletterRequestSchema } from "@repo/types";
import { apiClient } from "../lib/api-client";

const TOS_VERSION =
  typeof process !== "undefined"
    ? (process.env.NEXT_PUBLIC_TOS_VERSION ?? "v1.0")
    : "v1.0";

type SubscribeState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success" }
  | { kind: "error"; message: string };

export interface UseNewsletterSignupReturn {
  state: SubscribeState;
  fieldError: string | undefined;
  submit: (input: { email: string; captchaToken: string }) => Promise<void>;
  reset: () => void;
}

export function useNewsletterSignup(): UseNewsletterSignupReturn {
  const [state, setState] = useState<SubscribeState>({ kind: "idle" });
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);
  const submittingRef = useRef(false);

  const submit = useCallback(async (input: { email: string; captchaToken: string }) => {
    const parsed = SubscribeNewsletterRequestSchema.safeParse({
      email: input.email.trim(),
      consent: { marketingOptIn: true, tosVersion: TOS_VERSION },
      captchaToken: input.captchaToken || "noop",
    });

    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? "Enter a valid email address");
      return;
    }
    setFieldError(undefined);

    if (submittingRef.current) return;
    submittingRef.current = true;
    setState({ kind: "submitting" });

    try {
      await apiClient.public.newsletter.subscribe(parsed.data);
      setState({ kind: "success" });
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
    setFieldError(undefined);
  }, []);

  return { state, fieldError, submit, reset };
}
