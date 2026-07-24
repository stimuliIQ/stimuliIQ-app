# ADR 0037: SEO system — single escapeJsonLd choke-point, dynamic sitemap/robots, structured data, Vercel deploy + Lighthouse/axe CI gates

## Status

Accepted

## Context

`docs/01-prd-website.md §22` requires Lighthouse SEO ≥ 95 on program detail pages.
Phase 5 introduces multiple pages that embed JSON-LD structured data (Course, Review,
FAQ, Breadcrumb, Organization, Article). Phase 4 left open a low-severity finding
(L-1): the existing verify page's JSON-LD block did not escape `</script>` sequences,
meaning a crafted `seo_title` or `holderName` value containing `</script>` would break
out of the embedding script tag.

The site also needs a dynamic `sitemap.xml` (covering all public programs) and a
`robots.txt` that references it, both required for AC-31.

The web deployment was previously guarded by `if: false` in CI (carried from P0).

## Decision

### JSON-LD escaping — single choke-point

A shared `escapeJsonLd(data: object): string` function in `apps/web/src/lib/seo/json-ld.ts`
serialises a JSON-LD object and replaces any `</script>` occurrence with `<\/script>`
before embedding. Every JSON-LD helper (`buildOrganizationJsonLd`, `buildCourseJsonLd`,
`buildReviewJsonLd`, `buildFaqJsonLd`, `buildBreadcrumbJsonLd`, `buildArticleJsonLd`)
routes through this function. No page builds a JSON-LD `<script>` tag outside this module
(enforced by convention; tested by `json-ld.test.ts`). This resolves P4 L-1 globally
across all pages including the existing `/verify/[certId]` page.

### Dynamic sitemap and robots

`apps/web/app/sitemap.ts` — Next.js 15 App Router metadata route — queries
`GET /public/programs` at revalidation time and emits one URL per
`status=published AND is_public=true` program plus all static routes. ISR revalidation
is 3600 s.

`apps/web/app/robots.ts` — static metadata route — explicitly allows `/programs/*` and
references the sitemap URL (derived from `NEXT_PUBLIC_SITE_URL`).

### Structured data coverage

| Page | JSON-LD types emitted |
|---|---|
| All pages | `Organization` (site-wide, in root layout) |
| Program detail `/programs/[slug]` | `Course`, `AggregateRating`/`Review`, `FAQPage`, `BreadcrumbList` |
| Blog article `/blog/[slug]` | `Article`/`BlogPosting`, `BreadcrumbList` |
| Homepage | `Organization`, `BreadcrumbList` |
| Verify page `/verify/[certId]` | `BreadcrumbList` (existing page updated to use shared helper) |

### Vercel deploy

`apps/web/vercel.json` configures `apps/web` to deploy to Vercel:
- Region: `bom1` (Mumbai — India-first latency)
- Production deploy: triggered by Vercel's git integration on push to `main`
  (`git.deploymentEnabled.main = true`)
- PR preview deploy: wired in `.github/workflows/ci.yml` as job `deploy-preview-web`,
  gated on `vars.VERCEL_TOKEN_PRESENT == 'true'` (replaces the carried `if: false` guard
  from P0)
- Required GitHub secrets: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID_WEB`
- Required GitHub variable: `VERCEL_TOKEN_PRESENT` (set to `"true"` once secrets are wired)
- All client vars in Vercel env reference Vercel secret aliases (e.g. `@stimuliiq-web-api-url`)
- Security headers (CSP, HSTS, `X-Content-Type-Options`, `Referrer-Policy`,
  `X-Frame-Options`, `Permissions-Policy`) are set in both `next.config.mjs` (via
  `headers()`) and `vercel.json` (global headers fallback)

### Lighthouse CI and axe gates in CI

`lighthouserc.json` configures LHCI with:
- URLs audited: `/`, `/programs`, `/pricing`
- Assertion: `categories:seo` ≥ 0.95 (hard `error`); performance metrics and
  `categories:accessibility` ≥ 0.90 are `warn` (not hard-fail yet)
- LCP ≤ 2000 ms, TBT ≤ 300 ms, CLS ≤ 0.1 — all `warn` until budgets are clean

Both `web-lighthouse` and `web-axe` CI jobs run with `continue-on-error: true`
(warn-only) for now. Flip to `false` once scores are stable. Tracked in
`docs/phase-5-followups.md`.

## Consequences

- P4 L-1 (JSON-LD script-breakout) is resolved globally; a new page cannot regress it
  without bypassing the shared helper.
- The sitemap and robots are tested in CI (`web-lighthouse` job checks `/sitemap.xml`
  and `/robots.txt` reachability as hard checks, not warn-only).
- Preview deploys are now live for `apps/web` PRs once Vercel secrets are provisioned;
  lms/crm/api preview jobs remain `if: false` until their projects are provisioned.
- Lighthouse SEO ≥ 95 is the authoritative CI gate target; flipping from warn to hard-fail
  is a one-line change in `lighthouserc.json`.

## Alternatives considered

- **Per-page JSON-LD construction**: rejected — a single missed `</script>` escape in any
  page would re-open L-1. A shared module with a unit test is the only reliable guard.
- **Cloudflare Pages for `apps/web`**: viable alternative; `vercel.json` chosen because
  it has first-class Next.js 15 App Router support and the Mumbai (`bom1`) edge region.
  The `CaptchaProvider` abstraction (ADR-0036) means the hosting choice does not lock in
  Turnstile or any other Cloudflare product.
- **Static sitemap file**: rejected — program listing changes at runtime; a dynamic route
  with ISR revalidation is the correct approach for SSG/ISR Next.js sites.
