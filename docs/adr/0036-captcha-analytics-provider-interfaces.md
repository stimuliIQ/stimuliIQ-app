# ADR 0036: CaptchaProvider (Cloudflare Turnstile) and consent-gated AnalyticsProvider seams

## Status

Accepted

## Context

Phase 5 introduces public write endpoints (lead capture, booking, registration, coupon
validation, enroll funnel) that are high-value spam targets. Bot protection is mandatory.
Additionally, the public site must emit analytics (GA4 / GTM) for funnel measurement, but
DPDP compliance requires that analytics scripts load **only after explicit visitor consent**.

Both concerns share a pattern already established in the codebase: vendor SDKs behind a
provider interface with a Noop for dev/CI and fail-closed production behaviour (ADR-0006,
ADR-0023, ADR-0027).

## Decision

### CaptchaProvider

A new `CaptchaProvider` interface with a single method: `verify(token: string, ip?: string): Promise<{ success: boolean; errorCodes?: string[] }>`.

Three implementations, selected at boot by `CAPTCHA_PROVIDER` env var:

| Implementation | When used |
|---|---|
| `NoopCaptchaProvider` | `CAPTCHA_PROVIDER=noop` (default) — all tokens accepted; dev + CI |
| `TurnstileCaptchaProvider` | `CAPTCHA_PROVIDER=turnstile` — calls Cloudflare Turnstile siteverify endpoint using `CAPTCHA_SECRET_KEY` (server-only, never logged or returned) |
| `FailClosedCaptchaProvider` | Bound when `NODE_ENV=production` AND (`CAPTCHA_PROVIDER=noop` OR `CAPTCHA_SECRET_KEY` is absent) — every `verify()` call returns `{ success: false }`, making all captcha-gated writes return 422 (AC-44) |

Provider selection uses the `useFactory` pattern (ADR-0023), injected via the
`CAPTCHA_PROVIDER` DI token into `PublicFunnelService`.

**Cloudflare Turnstile** was chosen as the first real adapter (over hCaptcha) because:
- It is free for reasonable usage volumes
- It is privacy-friendly (no personal data processing required)
- It integrates cleanly with Cloudflare hosting/Pages
- The `NEXT_PUBLIC_TURNSTILE_SITE_KEY` env var in `apps/web` renders the challenge widget

Key classification:
- `CAPTCHA_SITE_KEY` — **PUBLIC** (safe for client bundle; also exposed as `NEXT_PUBLIC_TURNSTILE_SITE_KEY` in `apps/web`)
- `CAPTCHA_SECRET_KEY` — **SERVER-ONLY** (never in `NEXT_PUBLIC_*`, never logged, never returned)

### AnalyticsProvider

A consent-gated client-side analytics seam. The server-side configuration uses:
- `ANALYTICS_PROVIDER` — `noop` (default) | `ga4`
- `ANALYTICS_MEASUREMENT_ID` — GA4 Measurement ID (`G-XXXXXXXXXX`); also exposed as `NEXT_PUBLIC_ANALYTICS_MEASUREMENT_ID` in `apps/web`
- `ANALYTICS_GTM_ID` — GTM Container ID (`GTM-XXXXXXX`); also exposed as `NEXT_PUBLIC_ANALYTICS_GTM_ID` in `apps/web`

All analytics env vars are **PUBLIC** (safe for client bundles). GA4 / GTM do not
involve a server-side secret for tag loading.

The **DPDP consent invariant**: analytics scripts MUST NOT load until the visitor
explicitly accepts via the `ConsentBanner` component (`onAccept` callback). This is
enforced client-side in the `AnalyticsLoader` component, which is mounted only after
consent is recorded in browser state (localStorage). The `@next/third-parties` library
is used for lazy GA4/GTM loading.

Both providers do no business logic and have no effect on the request path — they are
purely observability/measurement seams.

## Consequences

- P5 is fully green on `CAPTCHA_PROVIDER=noop` in dev/CI — no Cloudflare credentials
  required to develop or run tests.
- A misconfigured production deployment (Turnstile selected but secret key missing)
  fails closed: all captcha-gated writes return 422 rather than silently accepting all
  tokens (AC-44, resolves the class of "provider configured but uncredentialed" gap).
- Analytics never fire for visitors who decline or do not interact with the consent
  banner (AC-34, AC-36) — DPDP compliance is structurally enforced, not just policy.
- Swapping to hCaptcha requires only a new `HcaptchaCaptchaProvider` adapter and an
  `CAPTCHA_PROVIDER=hcaptcha` env change — no changes to controllers or services.
- The `NEXT_PUBLIC_TURNSTILE_SITE_KEY` var name in `apps/web` is intentionally different
  from the server-side `CAPTCHA_SITE_KEY` to make the public/server split explicit in
  `.env.example` and Vercel project settings.

## Alternatives considered

- **hCaptcha**: viable alternative; `CaptchaProvider` abstraction makes it trivially
  swappable. Not chosen as the first adapter because Turnstile is free and integrates
  better with the anticipated Cloudflare hosting.
- **reCAPTCHA v3**: rejected — score-based, invisible, requires ongoing threshold tuning;
  also Google privacy implications on an India-first product.
- **Inline analytics without consent gating**: rejected — DPDP requires explicit consent
  before analytics data is collected. Structural enforcement (not fire until `onAccept`)
  is more reliable than policy alone.
