"use client";

/**
 * useOnboardingForm — I/O + state for the student onboarding form
 * (stimuliiq.com/onboarding, rendered by app/onboarding/page.tsx).
 *
 * The whole point of this hook is that the QUESTIONS ARE NOT IN THIS BUNDLE. Staff author
 * them in the CRM, so the page fetches the field list at runtime and renders whatever it
 * gets. That inverts the usual shape of a form hook:
 *
 *   - No `zodResolver` over a fixed object, because there is no fixed object. Validation
 *     runs through `buildOnboardingAnswerIssues` (@repo/types) against the fetched field
 *     list — the SAME function the API runs, so inline errors and the server's 422 agree
 *     by construction rather than by two people remembering to update two validators.
 *   - Answers live in one `Record<fieldKey, value>` rather than named state variables.
 *   - Server-side field errors arrive as problem-details `errors[]` with
 *     `path: "answers.<fieldKey>"`, and are unpacked back onto the same keys.
 *
 * File answers (the payment receipt) upload FIRST via a captcha-gated signed PUT; only the
 * returned opaque `storageKey` is ever submitted — the browser never learns a bucket URL.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  buildOnboardingAnswerIssues,
  OnboardingUploadUrlRequestSchema,
  type OnboardingAnswerValue,
  type PublicOnboardingField,
  type PublicOnboardingForm,
} from "@repo/types";
import { ApiError } from "@repo/api-client";
import { apiClient } from "../lib/api-client";

export type OnboardingAnswers = Record<string, OnboardingAnswerValue | undefined>;

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; form: PublicOnboardingForm }
  | { kind: "error"; message: string };

type SubmitState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

export interface UseOnboardingFormReturn {
  load: LoadState;
  submitState: SubmitState;
  answers: OnboardingAnswers;
  fieldErrors: Record<string, string>;
  setAnswer: (key: string, value: OnboardingAnswerValue | undefined) => void;
  submit: (captchaToken: string) => Promise<void>;
  reload: () => void;
  /** Signed-URL request for the FileUpload primitive, bound to one `file` field. */
  requestUploadUrl: (field: PublicOnboardingField, file: File, captchaToken: string) => Promise<{ url: string; storageKey: string }>;
}

const GENERIC_SUBMIT_ERROR = "Something went wrong while submitting. Please try again.";

export function useOnboardingForm(): UseOnboardingFormReturn {
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [submitState, setSubmitState] = useState<SubmitState>({ kind: "idle" });
  const [answers, setAnswers] = useState<OnboardingAnswers>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [reloadNonce, setReloadNonce] = useState(0);
  const submittingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setLoad({ kind: "loading" });
    apiClient.public.onboarding
      .getForm()
      .then((form) => {
        if (cancelled) return;
        setLoad({ kind: "ready", form });
      })
      .catch(() => {
        if (cancelled) return;
        setLoad({ kind: "error", message: "We couldn't load the form just now. Please refresh and try again." });
      });
    return () => {
      cancelled = true;
    };
  }, [reloadNonce]);

  const reload = useCallback(() => setReloadNonce((n) => n + 1), []);

  const setAnswer = useCallback((key: string, value: OnboardingAnswerValue | undefined) => {
    setAnswers((current) => ({ ...current, [key]: value }));
    // Clear this field's error as soon as it is touched: leaving a stale "required"
    // message under a question the student has now answered reads as a broken form.
    setFieldErrors((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }, []);

  const requestUploadUrl = useCallback(async (field: PublicOnboardingField, file: File, captchaToken: string) => {
    // Validate against the same schema the endpoint enforces, so an oversized or
    // unsupported file fails immediately with a readable message instead of a 422.
    const parsed = OnboardingUploadUrlRequestSchema.safeParse({
      fieldKey: field.key,
      contentType: file.type,
      fileName: file.name,
      sizeBytes: file.size,
      captchaToken: captchaToken || "noop",
    });
    if (!parsed.success) {
      throw new Error("Please upload a JPG, PNG, WEBP, HEIC or PDF file under 10 MB.");
    }
    const signed = await apiClient.public.onboarding.getUploadUrl(parsed.data);
    return { url: signed.uploadUrl, storageKey: signed.storageKey };
  }, []);

  const submit = useCallback(
    async (captchaToken: string) => {
      if (load.kind !== "ready" || submittingRef.current) return;

      const issues = buildOnboardingAnswerIssues(load.form.fields, answers);
      if (issues.length > 0) {
        setFieldErrors(Object.fromEntries(issues.map((issue) => [issue.key, issue.message])));
        setSubmitState({ kind: "error", message: "Please check the highlighted questions." });
        return;
      }

      submittingRef.current = true;
      setFieldErrors({});
      setSubmitState({ kind: "submitting" });
      try {
        // Undefined answers are dropped rather than sent as nulls: the wire schema accepts
        // string | boolean | number, and an absent optional answer is exactly "not sent".
        const payload = Object.fromEntries(
          Object.entries(answers).filter((entry): entry is [string, OnboardingAnswerValue] => entry[1] !== undefined),
        );
        const result = await apiClient.public.onboarding.submit({ answers: payload, captchaToken: captchaToken || "noop" });
        setSubmitState({ kind: "success", message: result.message });
      } catch (err) {
        if (err instanceof ApiError) {
          // Unpack `answers.<fieldKey>` paths back onto the keys the form renders by.
          const serverFieldErrors: Record<string, string> = {};
          for (const entry of err.problem.errors ?? []) {
            const key = entry.path.startsWith("answers.") ? entry.path.slice("answers.".length) : entry.path;
            serverFieldErrors[key] = entry.message;
          }
          if (Object.keys(serverFieldErrors).length > 0) {
            setFieldErrors(serverFieldErrors);
            setSubmitState({ kind: "error", message: "Please check the highlighted questions." });
          } else {
            setSubmitState({ kind: "error", message: err.problem.detail ?? err.problem.title });
          }
        } else {
          setSubmitState({ kind: "error", message: GENERIC_SUBMIT_ERROR });
        }
      } finally {
        submittingRef.current = false;
      }
    },
    [answers, load],
  );

  return { load, submitState, answers, fieldErrors, setAnswer, submit, reload, requestUploadUrl };
}
