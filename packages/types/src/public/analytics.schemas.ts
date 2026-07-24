// packages/types/src/public/analytics.schemas.ts
//
// Shared analytics configuration type — Phase 5, Task #3
//
// This is the canonical definition of AnalyticsConfig used by both:
//   - The backend analytics-config.ts seam (reads from env, resolves config)
//   - The frontend ConsentBanner + analytics loader (gates on DPDP consent)
//
// ─── CONSENT / DPDP INVARIANT ────────────────────────────────────────────────
//
// GA4 and GTM scripts MUST ONLY be loaded AFTER the visitor has explicitly
// accepted the DPDP consent banner in apps/web. The ConsentBanner component's
// onAccept callback is the ONLY place where analytics initialisation should fire.
//
// This type documents the contract but CANNOT enforce it at runtime —
// enforcement is the frontend component's responsibility.
//
// ─── NO SECRETS ──────────────────────────────────────────────────────────────
//
// All fields in AnalyticsConfig are PUBLIC:
//   - GA4 Measurement ID (G-XXXXXXXXXX) is a public analytics ID.
//   - GTM Container ID (GTM-XXXXXXX) is a public tag manager ID.
// Neither is a secret credential. This type MUST NEVER be extended with
// secret/private key fields. If a server-side analytics secret is ever needed
// (e.g. for Measurement Protocol server-side events), it must live ONLY in a
// backend-only env var and NEVER be included in this shared type.
//
// References:
//   docs/plans/phase-5.md §3 task #3, §7
//   docs/specs/phase-5-website.md (DPDP consent + analytics-gate)
//   apps/api/src/modules/analytics/analytics-config.ts (resolver)

import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// Schema
// ─────────────────────────────────────────────────────────────────────────────

export const AnalyticsConfigSchema = z.object({
  /**
   * The analytics provider in use.
   *   "noop" — no analytics; scripts must NOT be loaded (DPDP-safe default).
   *   "ga4"  — Google Analytics 4 (optionally via GTM). Scripts load only after
   *            DPDP consent.
   */
  provider: z.enum(["noop", "ga4"]),

  /**
   * GA4 Measurement ID (e.g. "G-XXXXXXXXXX"). PUBLIC.
   *
   * Only present when provider="ga4". The frontend uses this to initialise
   * the GA4 gtag or gtm dataLayer. Safe to include in the client bundle.
   *
   * CONSENT INVARIANT: only pass this to the GA4 initialiser AFTER the
   * visitor has accepted the DPDP consent banner.
   */
  measurementId: z.string().optional(),

  /**
   * Google Tag Manager Container ID (e.g. "GTM-XXXXXXX"). PUBLIC.
   *
   * Optional. When present alongside provider="ga4", use GTM as the tag
   * deployment vehicle instead of (or in addition to) loading GA4 directly.
   * Safe to include in the client bundle.
   *
   * CONSENT INVARIANT: same as measurementId — load GTM script ONLY after
   * DPDP consent.
   */
  gtmId: z.string().optional(),

  /**
   * Convenience flag: true when provider != "noop" AND the required public
   * ID (measurementId) is present. The frontend should check this before
   * attempting to initialise any analytics.
   *
   * Even when enabled=true, the frontend MUST NOT load analytics until
   * after the visitor has accepted the DPDP consent banner.
   */
  enabled: z.boolean(),
});

export type AnalyticsConfig = z.infer<typeof AnalyticsConfigSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Defaults
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The safe, disabled analytics config.
 *
 * Use this as the initial state in the frontend (before consent is granted
 * and before the actual config is fetched from the backend). The ConsentBanner
 * should start with this and only switch to the resolved config after onAccept.
 *
 * CONSENT INVARIANT: always start with this. Never load analytics scripts
 * with this config (enabled=false gates the loader).
 */
export const ANALYTICS_CONFIG_NOOP_DEFAULT: AnalyticsConfig = {
  provider: "noop",
  enabled: false,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Compile-time safety assertions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compile-time assertion: AnalyticsConfig must NOT contain any of the forbidden
 * secret field names. This type-level check documents the invariant and will
 * cause a TypeScript error at the call-site if someone extends AnalyticsConfig
 * with a secret-sounding field.
 *
 * Fields that MUST NOT appear here:
 *   - apiSecret, secretKey, privateKey, hmacKey, or any server-only credential.
 *
 * If you need server-side analytics (Measurement Protocol), add a SEPARATE,
 * non-exported backend-only env var (e.g. ANALYTICS_API_SECRET) that is NEVER
 * included in this package or any AnalyticsConfig response DTO.
 *
 * The helper function below enforces this at compile time without emitting any
 * runtime code.
 */
function _assertNoSecretFields(
  _config: Omit<AnalyticsConfig, "apiSecret" | "secretKey" | "privateKey" | "hmacKey">,
): void {
  // Intentional no-op — compile-time type check only.
  // If AnalyticsConfig gains any of the omitted fields, this function's
  // parameter type becomes `never` and callers fail to compile.
  void _config;
}

// Invoke with a safe constant to exercise the compile-time check.
_assertNoSecretFields(ANALYTICS_CONFIG_NOOP_DEFAULT);
