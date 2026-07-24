"use client";

/**
 * useCareerApply — I/O + state for the careers apply form (T32,
 * docs/plans/phase-9-completion.md).
 *
 * Validates against `SubmitCareerApplicationRequestSchema` (@repo/types) before
 * calling `client.public.careers.apply()`. Captcha-gated (Turnstile; "noop" in dev).
 *
 * Resume upload uses the PUBLIC, captcha-gated, rate-limited
 * `client.public.careers.getResumeUploadUrl()` (POST /public/careers/resume-upload-url)
 * — unlike `client.learning.storage.getUploadUrl()`, this does NOT require a session,
 * so it works for anonymous site visitors applying to a role.
 */

import { useCallback, useRef, useState } from "react";
import { SubmitCareerApplicationRequestSchema, ResumeContentTypeSchema } from "@repo/types";
import { apiClient } from "../lib/api-client";

export interface CareerApplyInput {
  name: string;
  email: string;
  phone: string;
  role: string;
  resumeStorageKey: string;
  coverLetter: string;
  captchaToken: string;
}

type SubmitState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

export interface UseCareerApplyReturn {
  state: SubmitState;
  fieldErrors: Record<string, string>;
  submit: (input: CareerApplyInput) => Promise<void>;
  reset: () => void;
  /** Signed-URL request for FileUpload's `requestUploadUrl` prop. Requires a solved captcha token. */
  requestResumeUploadUrl: (file: File, captchaToken: string) => Promise<{ url: string; storageKey: string }>;
}

export function useCareerApply(): UseCareerApplyReturn {
  const [state, setState] = useState<SubmitState>({ kind: "idle" });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const submittingRef = useRef(false);

  const requestResumeUploadUrl = useCallback(async (file: File, captchaToken: string) => {
    // Wave 6 M3: the resume upload endpoint only accepts an allow-listed set of document
    // MIME types (PDF/DOC/DOCX). Enforce that here so a non-document upload fails with a
    // friendly message before we hit the API (which would 422 on the same allow-list).
    const contentType = ResumeContentTypeSchema.safeParse(file.type);
    if (!contentType.success) {
      throw new Error("Please upload your resume as a PDF, DOC, or DOCX file.");
    }
    const signed = await apiClient.public.careers.getResumeUploadUrl({
      contentType: contentType.data,
      fileName: file.name,
      sizeBytes: file.size,
      captchaToken: captchaToken || "noop",
    });
    return { url: signed.uploadUrl, storageKey: signed.storageKey };
  }, []);

  const submit = useCallback(async (input: CareerApplyInput) => {
    const parsed = SubmitCareerApplicationRequestSchema.safeParse({
      name: input.name.trim(),
      email: input.email.trim(),
      phone: input.phone.trim() || undefined,
      role: input.role,
      resumeStorageKey: input.resumeStorageKey,
      coverLetter: input.coverLetter.trim() || undefined,
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
      const result = await apiClient.public.careers.apply(parsed.data);
      setState({
        kind: "success",
        message: result.message ?? "Application received! We'll review it and reach out.",
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

  return { state, fieldErrors, submit, reset, requestResumeUploadUrl };
}
