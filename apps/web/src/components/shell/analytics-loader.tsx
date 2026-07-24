"use client";

/**
 * AnalyticsLoader — consent-gated analytics client component.
 *
 * INVARIANT (AC-34 / DPDP):
 *   - This component ONLY renders analytics tags when `enabled === true`.
 *   - `enabled` is set to true ONLY after ConsentBanner.onAccept fires.
 *   - On first render (before consent is resolved), `enabled` is false → no scripts.
 *   - On subsequent page loads, readStoredConsent() is checked in SiteShell before
 *     this component renders → still no scripts before consent is confirmed.
 *
 * Provider selection (NEXT_PUBLIC_* env vars — public, client-safe):
 *   - NEXT_PUBLIC_ANALYTICS_GTM_ID          → GoogleTagManager (preferred when set)
 *   - NEXT_PUBLIC_ANALYTICS_MEASUREMENT_ID  → GoogleAnalytics (fallback)
 *   - Neither set                           → no scripts (Noop)
 *
 * No secrets touch this component. GA4/GTM ids are inherently public.
 *
 * The @next/third-parties package provides lazy, defer-safe loaders that
 * integrate with Next.js's Script component (strategy="afterInteractive").
 */
import * as React from "react";

// @next/third-parties — pre-installed per the task brief.
// Dynamic import to ensure zero analytics code in the initial bundle.
import dynamic from "next/dynamic";

const GoogleTagManagerDynamic = dynamic(
  () => import("@next/third-parties/google").then((m) => ({ default: m.GoogleTagManager })),
  { ssr: false },
);

const GoogleAnalyticsDynamic = dynamic(
  () => import("@next/third-parties/google").then((m) => ({ default: m.GoogleAnalytics })),
  { ssr: false },
);

// ---------------------------------------------------------------------------
// Env (NEXT_PUBLIC_* — safe to read at runtime on the client)
// ---------------------------------------------------------------------------

const GTM_ID = process.env.NEXT_PUBLIC_ANALYTICS_GTM_ID;
const GA_ID = process.env.NEXT_PUBLIC_ANALYTICS_MEASUREMENT_ID;

// ---------------------------------------------------------------------------
// AnalyticsLoader
// ---------------------------------------------------------------------------

interface AnalyticsLoaderProps {
  /** Set to true only after the visitor has explicitly accepted the consent banner. */
  enabled: boolean;
}

export function AnalyticsLoader({ enabled }: AnalyticsLoaderProps): React.JSX.Element | null {
  // Render nothing until consent is given (AC-34 invariant).
  if (!enabled) return null;

  // GTM takes precedence (it manages GA4 + other tags).
  if (GTM_ID) {
    return <GoogleTagManagerDynamic gtmId={GTM_ID} />;
  }

  // Fallback: direct GA4 without GTM.
  if (GA_ID) {
    return <GoogleAnalyticsDynamic gaId={GA_ID} />;
  }

  // No analytics configured (Noop) — render nothing.
  return null;
}
