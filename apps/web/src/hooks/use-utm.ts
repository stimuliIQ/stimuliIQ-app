"use client";

/**
 * useUtm — captures UTM params + Google/Meta click IDs + landing URL + referrer.
 *
 * Reads from the current URL's search params (via window.location) and document.referrer.
 * Called once at form mount; the caller passes the resulting object to the SDK.
 *
 * Captured params:
 *   - utm_source, utm_medium, utm_campaign, utm_content, utm_term
 *   - gclid  (Google Click ID — Google Ads attribution)
 *   - fbclid (Facebook Click ID — Meta Ads attribution)
 *   - landingUrl: full window.href at time of capture
 *   - referrer: document.referrer at time of capture
 *
 * No business logic — pure URL parsing. No state; returns a stable memoised object.
 *
 * Usage:
 *   const utm = useUtm();
 *   // utm.utmSource, utm.utmMedium, utm.landingUrl, etc.
 *   await apiClient.public.leads.capture({ ...fields, ...utm, ... });
 */

import { useMemo } from "react";

export interface UtmCapture {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  gclid?: string;
  fbclid?: string;
  landingUrl?: string;
  referrer?: string;
}

/**
 * Pure UTM parser — reads from a URLSearchParams instance.
 * Exported for unit testing without DOM.
 */
export function parseUtmFromSearch(search: URLSearchParams, landingUrl?: string, referrer?: string): UtmCapture {
  const str = (key: string): string | undefined => {
    const v = search.get(key);
    return v && v.length > 0 ? v : undefined;
  };

  return {
    utmSource: str("utm_source"),
    utmMedium: str("utm_medium"),
    utmCampaign: str("utm_campaign"),
    utmContent: str("utm_content"),
    utmTerm: str("utm_term"),
    gclid: str("gclid"),
    fbclid: str("fbclid"),
    landingUrl,
    referrer: referrer && referrer.length > 0 ? referrer : undefined,
  };
}

/**
 * Converts UtmCapture to the UTM object shape expected by the lead/booking SDK.
 * The `utm` field on PublicLeadCaptureDto is a `LeadUtmSchema` ({source, medium, campaign, content, term}).
 */
export function utmCaptureToSdkUtm(
  capture: UtmCapture,
): Record<string, string | undefined> {
  return {
    source: capture.utmSource,
    medium: capture.utmMedium,
    campaign: capture.utmCampaign,
    content: capture.utmContent,
    term: capture.utmTerm,
  };
}

/**
 * Hook: reads UTM params from the current window location (client-side only).
 * Returns a stable object (memoiseed on mount — values do not change after mount).
 */
export function useUtm(): UtmCapture {
  return useMemo(() => {
    if (typeof window === "undefined") return {};

    const search = new URLSearchParams(window.location.search);
    const landingUrl = window.location.href;
    const referrer = document.referrer;

    return parseUtmFromSearch(search, landingUrl, referrer);
  }, []); // [] = capture once on mount
}
