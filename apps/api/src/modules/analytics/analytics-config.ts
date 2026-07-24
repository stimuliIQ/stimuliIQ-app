// apps/api/src/modules/analytics/analytics-config.ts
//
// Analytics configuration seam — Phase 5, Task #3
//
// This is NOT a heavy provider: there is NO vendor SDK, NO server-side tracking
// call, and NO DI token required here. Analytics (GA4 / GTM) is entirely a
// client-side concern in the `apps/web` Next.js application. The actual script
// loading is done in Wave 5 by the frontend-builder, and MUST be CONSENT-GATED
// (loaded only after the visitor accepts the DPDP consent banner).
//
// This module's sole responsibility is to resolve the PUBLIC analytics
// configuration from validated env vars so that:
//   1. The backend can optionally expose these PUBLIC values to the frontend
//      (e.g. via a /api/v1/public/config endpoint, or via Next.js public env).
//   2. The analytics config type is shared across the monorepo via @repo/types
//      (see packages/types/src/public/analytics.schemas.ts).
//   3. The KEY invariant is documented and enforced here: analytics config
//      contains ONLY PUBLIC values (measurement IDs, GTM container IDs) —
//      there is NO secret involved in GA4/GTM loading, and this module must
//      NEVER introduce a secret for analytics.
//
// ─── CONSENT / DPDP INVARIANT (the critical rule) ──────────────────────────
//
// Analytics MUST ONLY load AFTER the visitor has explicitly accepted the
// DPDP consent banner (docs/specs/phase-5-website.md). The ConsentBanner
// in `apps/web` must gate the loading of any GA4/GTM scripts behind its
// onAccept callback. This module does NOT enforce the consent gate
// (it cannot — it's server-side config); the enforcement lives entirely in:
//   - `apps/web/components/ConsentBanner` (the gating UI)
//   - The analytics script loader (loaded only in ConsentBanner.onAccept)
//
// This module documents the invariant so it is visible at the seam boundary.
//
// ─── NO SECRETS ─────────────────────────────────────────────────────────────
//
// GA4 Measurement ID (G-XXXXXXXXXX) is PUBLIC — safe to embed in the client
// bundle and in Next.js NEXT_PUBLIC_* env vars.
// GTM Container ID (GTM-XXXXXXX) is PUBLIC — same.
// NEITHER of these is a secret credential. No backend signing, no HMAC, no
// private key is involved in GA4/GTM analytics loading.
//
// References:
//   docs/plans/phase-5.md §3 task #3, §7 (analytics env keys)
//   docs/specs/phase-5-website.md (DPDP consent + analytics-gate)
//   packages/types/src/public/analytics.schemas.ts (shared AnalyticsConfig type)

import { validateEnv } from "../../config/env";

// ─────────────────────────────────────────────────────────────────────────────
// Re-export the shared type from @repo/types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The resolved analytics configuration shape (public values only).
 *
 * This is a structural copy of the AnalyticsConfig type from @repo/types
 * to avoid a circular import at the infra layer. The canonical zod schema
 * and type are defined in packages/types/src/public/analytics.schemas.ts.
 *
 * Fields:
 *   provider      — "noop" | "ga4". When "noop", the frontend skips loading
 *                   any analytics script. When "ga4", the frontend loads
 *                   GA4 (and optionally GTM) ONLY after DPDP consent.
 *   measurementId — GA4 Measurement ID (G-XXXXXXXXXX). PUBLIC. Only present
 *                   when provider="ga4". Never a secret.
 *   gtmId         — GTM Container ID (GTM-XXXXXXX). PUBLIC. Optional.
 *                   Present when GTM is the tag deployment vehicle for GA4.
 *   enabled       — true when provider != "noop" AND the required public ID
 *                   is configured. Convenience flag for the frontend.
 *
 * CONSENT INVARIANT: even when enabled=true, the frontend MUST NOT load
 * any analytics scripts until after DPDP consent is accepted by the visitor.
 */
export interface AnalyticsConfig {
  provider: "noop" | "ga4";
  measurementId?: string;
  gtmId?: string;
  enabled: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Config resolver
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolves the analytics configuration from the validated environment.
 *
 * Returns a Noop-default when ANALYTICS_PROVIDER is unset or "noop", or when
 * the required public ID (ANALYTICS_MEASUREMENT_ID) is missing for GA4.
 *
 * This function is safe to call at any point after validateEnv() has run.
 * It reads ONLY public env vars (ANALYTICS_PROVIDER, ANALYTICS_MEASUREMENT_ID,
 * ANALYTICS_GTM_ID) — there is NO secret involved.
 *
 * The result can be:
 *   - Returned from a /api/v1/public/config endpoint (safe — all values public).
 *   - Passed to the Next.js frontend via NEXT_PUBLIC_* vars in deployment.
 *   - Logged freely (no secrets).
 *
 * CONSENT INVARIANT: the caller (frontend) MUST gate actual script loading
 * behind DPDP consent acceptance. This function only resolves config; it does
 * not enforce consent (that is a client-side responsibility).
 *
 * @example
 *   // In a public config endpoint:
 *   const analyticsConfig = resolveAnalyticsConfig();
 *   return { captchaSiteKey: env.CAPTCHA_SITE_KEY, analytics: analyticsConfig };
 */
export function resolveAnalyticsConfig(): AnalyticsConfig {
  const env = validateEnv();
  const provider = env.ANALYTICS_PROVIDER ?? "noop";

  if (provider === "noop") {
    return { provider: "noop", enabled: false };
  }

  // GA4 requires a Measurement ID to be useful.
  const measurementId = env.ANALYTICS_MEASUREMENT_ID;
  if (!measurementId) {
    // No measurement ID → Noop fallback (cannot initialise GA4 without it).
    return { provider: "noop", enabled: false };
  }

  return {
    provider: "ga4",
    measurementId,
    gtmId: env.ANALYTICS_GTM_ID,
    enabled: true,
  };
}

/**
 * The default/disabled analytics config.
 * Useful as a safe fallback in tests and as the initial state in the frontend
 * ConsentBanner (before consent is granted and the config is fetched).
 *
 * CONSENT INVARIANT: the frontend should start with this config and only
 * switch to the real config AFTER the visitor accepts the consent banner.
 */
export const ANALYTICS_CONFIG_NOOP: AnalyticsConfig = {
  provider: "noop",
  enabled: false,
} as const;
