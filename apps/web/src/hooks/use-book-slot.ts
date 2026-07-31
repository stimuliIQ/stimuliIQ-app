"use client";

/**
 * useBookSlot — all I/O + state for the Book-Free-Slot multi-step funnel.
 *
 * Steps:
 *   0: Program selection
 *   1: Date/time slot selection
 *   2: Personal details (name, phone, email, consent)
 *   3: Confirm + submit
 *
 * Enforces:
 *   - Honeypot check (never call API if _hp_email is non-empty)
 *   - Captcha token required (fail-closed: "noop" in dev, real token in prod)
 *   - UTM params captured via useUtm
 *   - DPDP consent: tosAccepted + marketingOptIn
 *   - Idempotent (no retry creates double booking — the API handles this)
 *   - double-click-safe: isSubmitting flag disables re-entry
 *   - No business logic in components — this hook owns all I/O
 *
 * Does NOT send WhatsApp/email (P6 responsibility — the API enqueues the event).
 */

import { useState, useCallback, useRef } from "react";
import { z } from "zod";
import { PHONE_LOCAL_LENGTH, PHONE_LENGTH_MESSAGE, toE164Phone } from "@repo/ui";
import { apiClient } from "../lib/api-client";
import { useUtm, utmCaptureToSdkUtm } from "./use-utm";
import type { PublicBookingResponse } from "@repo/types";

// ---------------------------------------------------------------------------
// Form field schemas (zod — validation at boundary, CLAUDE.md §3.2)
// ---------------------------------------------------------------------------

export const ProgramStepSchema = z.object({
  programId: z.string().min(1, "Please select a program").optional(),
  programLabel: z.string().optional(),
});

export const SlotStepSchema = z.object({
  slotAt: z.string().min(1, "Please select a date and time"),
});

export const DetailsStepSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  // The field itself only accepts digits and caps at 10 — this is the guard for
  // an incomplete number.
  phone: z.string().regex(new RegExp(`^\\d{${PHONE_LOCAL_LENGTH}}$`), PHONE_LENGTH_MESSAGE),
  email: z.string().email("Valid email required").max(254).optional().or(z.literal("")),
  tosAccepted: z.literal(true, { errorMap: () => ({ message: "You must accept the Terms of Service" }) }),
  marketingOptIn: z.boolean(),
});

// ---------------------------------------------------------------------------
// State types
// ---------------------------------------------------------------------------

export interface BookSlotFormData {
  programId?: string;
  programLabel?: string;
  slotAt?: string;
  name: string;
  phone: string;
  email: string;
  tosAccepted: boolean;
  marketingOptIn: boolean;
  captchaToken: string;
  /** Honeypot — must stay empty for legitimate submissions */
  _hp_email: string;
}

export type BookSlotStep = 0 | 1 | 2 | 3;

type SubmitState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; result: PublicBookingResponse }
  | { kind: "error"; message: string };

export interface UseBookSlotReturn {
  formData: BookSlotFormData;
  setFormData: (data: Partial<BookSlotFormData>) => void;
  currentStep: BookSlotStep;
  stepErrors: Record<string, string>;
  submitState: SubmitState;
  goNext: () => void;
  goBack: () => void;
  submit: () => Promise<void>;
  reset: () => void;
}

const INITIAL_FORM: BookSlotFormData = {
  programId: undefined,
  programLabel: undefined,
  slotAt: undefined,
  name: "",
  phone: "",
  email: "",
  tosAccepted: false,
  marketingOptIn: false,
  captchaToken: "",
  _hp_email: "",
};

// ---------------------------------------------------------------------------
// TOS version — read from env (client-side public var or fallback)
// ---------------------------------------------------------------------------
const TOS_VERSION =
  typeof process !== "undefined"
    ? (process.env.NEXT_PUBLIC_TOS_VERSION ?? "v1.0")
    : "v1.0";

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useBookSlot(): UseBookSlotReturn {
  const [formData, setFormDataState] = useState<BookSlotFormData>(INITIAL_FORM);
  const [currentStep, setCurrentStep] = useState<BookSlotStep>(0);
  const [stepErrors, setStepErrors] = useState<Record<string, string>>({});
  const [submitState, setSubmitState] = useState<SubmitState>({ kind: "idle" });
  // Synchronous re-entry guard: state does NOT update between two calls in the same
  // tick (stale closure), so a ref is required to make double-click truly safe.
  const submittingRef = useRef(false);
  const utm = useUtm();

  const setFormData = useCallback((data: Partial<BookSlotFormData>) => {
    setFormDataState((prev) => ({ ...prev, ...data }));
    // Clear field-level errors for changed fields
    const changedKeys = Object.keys(data);
    setStepErrors((prev) => {
      const next = { ...prev };
      for (const k of changedKeys) delete next[k];
      return next;
    });
  }, []);

  // ---------------------------------------------------------------------------
  // Step validation
  // ---------------------------------------------------------------------------

  function validateStep(step: BookSlotStep): Record<string, string> {
    const errors: Record<string, string> = {};

    if (step === 0) {
      // Program step: optional — allow proceeding without a program
      // (AC spec: bookings.programId is optional)
    }

    if (step === 1) {
      const result = SlotStepSchema.safeParse({ slotAt: formData.slotAt });
      if (!result.success) {
        for (const issue of result.error.issues) {
          const key = String(issue.path[0] ?? "slotAt");
          errors[key] = issue.message;
        }
      }
    }

    if (step === 2) {
      const result = DetailsStepSchema.safeParse({
        name: formData.name,
        phone: formData.phone,
        email: formData.email || undefined,
        tosAccepted: formData.tosAccepted || undefined,
        marketingOptIn: formData.marketingOptIn,
      });
      if (!result.success) {
        for (const issue of result.error.issues) {
          const key = String(issue.path[0] ?? "field");
          errors[key] = issue.message;
        }
      }

      // Captcha token required (will be "noop" in dev, real token in prod)
      if (!formData.captchaToken || formData.captchaToken.length === 0) {
        errors.captcha = "Please complete the captcha challenge";
      }
    }

    return errors;
  }

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  const goNext = useCallback(() => {
    const errors = validateStep(currentStep);
    if (Object.keys(errors).length > 0) {
      setStepErrors(errors);
      return;
    }
    setStepErrors({});
    setCurrentStep((prev) => Math.min(prev + 1, 3) as BookSlotStep);
    // (react-hooks/exhaustive-deps is not registered in this app's flat config.)
  }, [currentStep, formData]);

  const goBack = useCallback(() => {
    setStepErrors({});
    setCurrentStep((prev) => Math.max(prev - 1, 0) as BookSlotStep);
  }, []);

  // ---------------------------------------------------------------------------
  // Submit
  // ---------------------------------------------------------------------------

  const submit = useCallback(async () => {
    // Honeypot check — reject bots silently (AC-42)
    if (formData._hp_email && formData._hp_email.length > 0) {
      setSubmitState({ kind: "success", result: { bookingId: "", slotAt: formData.slotAt ?? "", status: "requested", message: "Thank you! We'll be in touch soon." } });
      return;
    }

    // Double-click protection (ref is synchronous; state is not — see submittingRef)
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitState({ kind: "submitting" });

    try {
      const sdkUtm = utmCaptureToSdkUtm(utm);

      // Build UTM object (only include keys that have values)
      const utmPayload = Object.fromEntries(
        Object.entries(sdkUtm).filter(([, v]) => v != null && v !== ""),
      );

      const result = await apiClient.public.bookings.create({
        name: formData.name,
        // 10 local digits in the field → E.164 on the wire, so booking dedupe by
        // phone matches leads/students created anywhere else.
        phone: toE164Phone(formData.phone),
        email: formData.email || undefined,
        programId: formData.programId || undefined,
        slotAt: formData.slotAt!,
        source: "web-book-slot",
        utm: Object.keys(utmPayload).length > 0 ? utmPayload as Parameters<typeof apiClient.public.bookings.create>[0]["utm"] : undefined,
        // P5 extension fields (backend consumes these via the extended booking schema)
        ...(formData.captchaToken ? { captchaToken: formData.captchaToken } : {}),
        ...(formData.tosAccepted
          ? {
              consent: {
                marketingOptIn: formData.marketingOptIn,
                tosVersion: TOS_VERSION,
              },
            }
          : {}),
      } as Parameters<typeof apiClient.public.bookings.create>[0]);

      setSubmitState({ kind: "success", result });
    } catch (err: unknown) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : "Something went wrong. Please try again.";
      setSubmitState({ kind: "error", message });
    } finally {
      submittingRef.current = false;
    }
  }, [formData, utm]);

  const reset = useCallback(() => {
    setFormDataState(INITIAL_FORM);
    setCurrentStep(0);
    setStepErrors({});
    setSubmitState({ kind: "idle" });
  }, []);

  return {
    formData,
    setFormData,
    currentStep,
    stepErrors,
    submitState,
    goNext,
    goBack,
    submit,
    reset,
  };
}
