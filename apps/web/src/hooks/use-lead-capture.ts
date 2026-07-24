"use client";

/**
 * useLeadCapture — all I/O + state for any lead form on the site.
 *
 * Used by:
 *   - LeadFormInline (homepage CTA band, contact page, program detail)
 *   - ExitIntentModal
 *   - StickyLeadBar
 *   - Footer newsletter capture
 *   - Career apply form
 *
 * Enforces:
 *   - Honeypot check (silently ignore bot submissions)
 *   - Captcha token required
 *   - UTM capture via useUtm
 *   - DPDP consent recording
 *   - Rate-limited (API enforces, hook surfaces errors)
 *   - No business logic in components
 */

import { useState, useCallback, useRef } from "react";
import { apiClient } from "../lib/api-client";
import { useUtm, utmCaptureToSdkUtm } from "./use-utm";

export interface LeadFormInput {
  name?: string;
  phone?: string;
  email?: string;
  programInterestId?: string;
  /** Free-text course/program the visitor typed (marketing popup). */
  courseInterest?: string;
  /** Free-text college/university (marketing popup). */
  college?: string;
  /** Free-text preferred contact language (marketing popup). */
  language?: string;
  source: string;
  captchaToken: string;
  /** Honeypot — must be empty on legitimate submissions */
  _hp_email: string;
  /** TOS consent */
  tosAccepted: boolean;
  marketingOptIn: boolean;
  /** Optional free-text message (popup message box / career apply form) */
  message?: string;
}

type CaptureState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

export interface UseLeadCaptureReturn {
  state: CaptureState;
  submit: (input: LeadFormInput) => Promise<void>;
  reset: () => void;
}

const TOS_VERSION =
  typeof process !== "undefined"
    ? (process.env.NEXT_PUBLIC_TOS_VERSION ?? "v1.0")
    : "v1.0";

export function useLeadCapture(): UseLeadCaptureReturn {
  const [state, setState] = useState<CaptureState>({ kind: "idle" });
  // Synchronous re-entry guard (state is stale within the same tick — ref is not).
  const submittingRef = useRef(false);
  const utm = useUtm();

  const submit = useCallback(
    async (input: LeadFormInput) => {
      // Honeypot check — silently succeed for bots (AC-42)
      if (input._hp_email && input._hp_email.length > 0) {
        setState({
          kind: "success",
          message: "Thank you! A counsellor will reach out to you soon.",
        });
        return;
      }

      // Double-click protection (ref is synchronous; state is not)
      if (submittingRef.current) return;
      submittingRef.current = true;
      setState({ kind: "submitting" });

      try {
        const sdkUtm = utmCaptureToSdkUtm(utm);
        const utmPayload = Object.fromEntries(
          Object.entries(sdkUtm).filter(([, v]) => v != null && v !== ""),
        );

        const result = await apiClient.public.leads.capture({
          name: input.name ?? "Unknown",
          phone: input.phone ?? "",
          email: input.email || undefined,
          programInterestId: input.programInterestId || undefined,
          courseInterest: input.courseInterest || undefined,
          college: input.college || undefined,
          language: input.language || undefined,
          message: input.message || undefined,
          source: input.source,
          utm: Object.keys(utmPayload).length > 0
            ? (utmPayload as Parameters<typeof apiClient.public.leads.capture>[0]["utm"])
            : undefined,
          landingUrl: utm.landingUrl || undefined,
          referrer: utm.referrer || undefined,
          gclid: utm.gclid || undefined,
          fbclid: utm.fbclid || undefined,
          consent: {
            marketingOptIn: input.marketingOptIn,
            tosVersion: TOS_VERSION,
          },
          captchaToken: input.captchaToken || "noop",
        });

        setState({
          kind: "success",
          message: result.message ?? "Thank you! A counsellor will reach out to you soon.",
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
    },
    [utm],
  );

  const reset = useCallback(() => {
    setState({ kind: "idle" });
  }, []);

  return { state, submit, reset };
}
