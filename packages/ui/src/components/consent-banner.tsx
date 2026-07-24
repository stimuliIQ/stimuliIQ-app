"use client";

import * as React from "react";

import { cn } from "../lib/cn";

/**
 * ConsentBanner — DPDP (India Digital Personal Data Protection Act) cookie/analytics
 * consent banner. Per docs/01-prd-website.md §7.1/§8/§17 and docs/07-design-system.md §5.
 *
 * Behaviour:
 * - Hidden when consent has already been recorded (persisted to localStorage).
 * - On "Accept": calls `onAccept` and stores "consent:accepted" in localStorage.
 * - On "Reject": calls `onReject` and stores "consent:rejected" in localStorage.
 * - The app gates analytics loading on the `onAccept` callback — this component
 *   is purely presentational and emits no tracking itself.
 * - Key: `CONSENT_STORAGE_KEY` — exported so the app can read the same key to
 *   determine whether to load analytics (e.g. in the root layout useEffect).
 *
 * SSR-safety:
 * - localStorage is accessed only in useEffect (client-only).
 * - Initial render: banner is hidden (`shown = false`) to avoid flicker.
 * - A `suppressHydrationWarning` on the wrapper prevents React hydration mismatch.
 *
 * a11y:
 * - `role="dialog"` + `aria-label` per ARIA best-practice for cookie banners.
 * - Focus-management: on show, focuses the "Accept" button (primary action).
 * - All interactive elements ≥44px.
 *
 * Usage:
 *   <ConsentBanner
 *     onAccept={() => loadAnalytics()}
 *     onReject={() => { /* user rejected, do not load analytics *\/ }}
 *     policyHref="/privacy"
 *   />
 */

export const CONSENT_STORAGE_KEY = "stimuliiq:consent" as const;
export type ConsentChoice = "accepted" | "rejected";

export interface ConsentBannerProps {
  /** Called when the user clicks "Accept all". Gate analytics loading here. */
  onAccept?: () => void;
  /** Called when the user clicks "Reject". Do not load analytics. */
  onReject?: () => void;
  /** Optional link to the full privacy/cookie policy. */
  policyHref?: string;
  /** Override the description text. */
  description?: string;
  /** Test hook; defaults to "consent-banner". */
  "data-testid"?: string;
}

/** Read the stored consent choice from localStorage (SSR-safe — returns null on server). */
export function readStoredConsent(): ConsentChoice | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(CONSENT_STORAGE_KEY);
    if (v === "accepted" || v === "rejected") return v;
  } catch {
    // localStorage blocked (private mode, etc.)
  }
  return null;
}

export function ConsentBanner({
  onAccept,
  onReject,
  policyHref,
  description,
  "data-testid": testId,
}: ConsentBannerProps): React.JSX.Element | null {
  const [visible, setVisible] = React.useState(false);
  const acceptRef = React.useRef<HTMLButtonElement>(null);

  // Check localStorage on mount (client-only)
  React.useEffect(() => {
    const stored = readStoredConsent();
    if (!stored) {
      setVisible(true);
    }
  }, []);

  // Focus the accept button when the banner appears
  React.useEffect(() => {
    if (visible) {
      acceptRef.current?.focus();
    }
  }, [visible]);

  function handleAccept() {
    try {
      window.localStorage.setItem(CONSENT_STORAGE_KEY, "accepted");
    } catch { /* storage blocked */ }
    setVisible(false);
    onAccept?.();
  }

  function handleReject() {
    try {
      window.localStorage.setItem(CONSENT_STORAGE_KEY, "rejected");
    } catch { /* storage blocked */ }
    setVisible(false);
    onReject?.();
  }

  if (!visible) return null;

  return (
    <div
      // suppressHydrationWarning: visibility is determined client-side from localStorage
      suppressHydrationWarning
      data-testid={testId ?? "consent-banner"}
      role="dialog"
      aria-label="Cookie and privacy consent"
      aria-modal="false"
      className={cn(
        "fixed bottom-0 inset-x-0 z-50 border-t border-border bg-card/98 shadow-md backdrop-blur-sm",
        "px-4 py-4 sm:px-6",
      )}
    >
      <div className="mx-auto flex max-w-screen-xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        {/* Description */}
        <p className="text-sm text-fg-muted leading-relaxed max-w-2xl">
          {description ??
            "We use cookies and similar technologies to improve your experience, measure performance, and personalise content. By clicking \"Accept\", you consent to our use of analytics cookies as described in our"}
          {policyHref ? (
            <>
              {" "}
              <a
                href={policyHref}
                className="font-medium text-brand-500 underline underline-offset-2 hover:text-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Privacy Policy
              </a>
              .
            </>
          ) : "."}
        </p>

        {/* Buttons */}
        <div className="flex shrink-0 items-center gap-3">
          <button
            type="button"
            onClick={handleReject}
            className={cn(
              "flex min-h-[44px] items-center rounded-md border border-border px-5 text-sm font-medium text-fg",
              "transition-colors hover:bg-surface",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            )}
          >
            Reject
          </button>
          <button
            ref={acceptRef}
            type="button"
            onClick={handleAccept}
            className={cn(
              "flex min-h-[44px] items-center rounded-md bg-brand-500 px-5 text-sm font-semibold text-white",
              "transition-colors hover:bg-brand-600 active:bg-brand-700",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            )}
          >
            Accept all
          </button>
        </div>
      </div>
    </div>
  );
}

ConsentBanner.displayName = "ConsentBanner";
