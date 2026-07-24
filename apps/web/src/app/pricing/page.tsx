/**
 * Pricing page — /pricing
 *
 * ISR: revalidate = 3600 (programs and their prices change infrequently).
 * Fetches public programs for the pricing grid inline (async page function).
 *
 * Sections:
 *   1. Page header
 *   2. Per-program pricing grid (from live catalog, PricingTable cards variant)
 *   3. EMI explainer
 *   4. Comparison table (static tiers)
 *   5. Coupon field (CouponValidator — client component, needs a programId)
 *   6. Refund policy link
 *
 * States: empty (no public programs), error (fetch failed).
 *
 * a11y: heading hierarchy, table has proper th scope, CouponValidator has labelled input.
 *
 * Money: all paise values come from the API. The CouponValidator client component
 * renders the server-returned display string — NO client-side arithmetic (AC-21).
 */
import type { Metadata } from "next";

import { buildMetadata } from "../../lib/seo/metadata";
import { serverApiClient } from "../../lib/api-client";
import { PricingTable, EmptyState } from "@repo/ui";
import { formatPaiseDisplay } from "../../lib/format";
import { CouponValidator } from "./_components/coupon-validator";
import type { PublicProgramSummary, Bundle } from "@repo/types";

// ---------------------------------------------------------------------------
// ISR
// ---------------------------------------------------------------------------

export const revalidate = 3600;

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

export const metadata: Metadata = buildMetadata({
  title: "Pricing — Transparent Program Fees & EMI Options",
  description:
    "Clear, transparent pricing for all StimuliiQ programs. EMI options available. No hidden fees. Apply a coupon to save on your enrollment.",
  canonicalPath: "/pricing",
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build PricingTable tiers from the public program list */
function buildTiers(programs: PublicProgramSummary[]) {
  return programs.map((p) => ({
    id: p.id,
    name: p.title,
    priceDisplay: formatPaiseDisplay(p.pricePaise),
    emiDisplay: p.emiDisplay ?? undefined,
    description: p.cardSummary ?? undefined,
    features: [
      p.durationWeeks ? `${p.durationWeeks} weeks` : "Full program",
      p.mode === "live"
        ? "Live instructor-led"
        : p.mode === "recorded"
          ? "Self-paced, recorded"
          : "Live + Recorded",
      "Industry mentor access",
      "Verifiable certificate",
      "Placement support",
    ],
    ctaLabel: "Enroll Now",
    ctaHref: `/enroll/${p.slug}`,
  }));
}

// ---------------------------------------------------------------------------
// Static comparison data
// ---------------------------------------------------------------------------

type ComparisonValues = { live: boolean; recorded: boolean; hybrid: boolean };

const COMPARISON_ROWS: Array<{ label: string; values: ComparisonValues }> = [
  { label: "Live sessions with mentors", values: { live: true, recorded: false, hybrid: true } },
  { label: "Recorded video library", values: { live: true, recorded: true, hybrid: true } },
  { label: "Project-based curriculum", values: { live: true, recorded: true, hybrid: true } },
  { label: "1:1 mentor support", values: { live: true, recorded: false, hybrid: true } },
  { label: "Placement assistance", values: { live: true, recorded: true, hybrid: true } },
  { label: "Verifiable certificate", values: { live: true, recorded: true, hybrid: true } },
  { label: "EMI options", values: { live: true, recorded: true, hybrid: true } },
];

const COMPARISON_TIERS = [
  {
    id: "recorded",
    name: "Self-Paced",
    priceDisplay: "From ₹8,999",
    description: "Fully recorded — learn at your own pace.",
    features: [] as string[],
    ctaLabel: "Browse Programs",
    ctaHref: "/programs?mode=recorded",
  },
  {
    id: "hybrid",
    name: "Live + Recorded",
    priceDisplay: "From ₹12,999",
    description: "Best of both — structured live + flexible recorded.",
    features: [] as string[],
    ctaLabel: "Browse Programs",
    ctaHref: "/programs?mode=hybrid",
    recommended: true,
  },
  {
    id: "live",
    name: "Fully Live",
    priceDisplay: "From ₹16,999",
    description: "100% live, cohort-based, highest mentor interaction.",
    features: [] as string[],
    ctaLabel: "Browse Programs",
    ctaHref: "/programs?mode=live",
  },
];

/** Build a "₹X – ₹Y" price-range display string for a bundle. DISPLAY ONLY — server paise. */
function formatPriceRange(minPaise: number, maxPaise: number): string {
  if (minPaise === maxPaise) return formatPaiseDisplay(minPaise);
  return `${formatPaiseDisplay(minPaise)} – ${formatPaiseDisplay(maxPaise)}`;
}

// Build featureRows compatible with PricingTable comparison variant
// Each row has: label, values keyed by tier id → boolean
const PRICING_FEATURE_ROWS = COMPARISON_ROWS.map((row) => ({
  label: row.label,
  values: Object.fromEntries(
    COMPARISON_TIERS.map((tier) => [
      tier.id,
      row.values[tier.id as keyof ComparisonValues],
    ]),
  ),
}));

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function PricingPage() {
  // Fetch programs for pricing grid server-side (ISR)
  let programs: PublicProgramSummary[] = [];
  let fetchError = false;

  try {
    const result = await serverApiClient.public.programs.list({ limit: 50, sort: "popularity" });
    programs = Array.isArray(result.items) ? result.items : [];
  } catch {
    fetchError = true;
  }

  const hasPrograms = !fetchError && programs.length > 0;

  // Bundles/tracks (T33: docs/plans/phase-9-completion.md) — programs grouped by
  // domain, from `client.public.bundles.list()`.
  let bundles: Bundle[] = [];
  let bundlesError = false;

  try {
    const result = await serverApiClient.public.bundles.list();
    bundles = result.bundles;
  } catch {
    bundlesError = true;
  }

  return (
    <main
      id="main-content"
      className="mx-auto max-w-screen-xl px-4 py-10 md:px-6"
      data-testid="pricing-page"
    >
      {/* Page header */}
      <div className="mb-10 text-center">
        <h1 className="text-3xl font-bold text-fg md:text-4xl">
          Transparent, <span className="text-chart-3">Affordable Pricing</span>
        </h1>
        <p className="mt-3 text-lg text-fg-muted">
          No hidden fees. Choose the program that&apos;s right for you and pay securely.
          EMI options available.
        </p>
      </div>

      {/* Program pricing — error / empty / filled states */}
      {fetchError ? (
        <EmptyState
          title="Unable to load program pricing"
          description="We couldn't fetch current pricing. Please refresh or try again later."
          action={
            <a
              href="/pricing"
              className="inline-flex min-h-[44px] items-center rounded-md bg-brand-500 px-6 text-sm font-semibold text-white transition-colors hover:bg-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Retry
            </a>
          }
          data-testid="pricing-error"
        />
      ) : !hasPrograms ? (
        <EmptyState
          title="No programs listed yet"
          description="Program pricing will appear here once programs are published."
          data-testid="pricing-empty"
        />
      ) : (
        <div className="flex flex-col gap-12" data-testid="program-pricing-section">
          {/* Per-program pricing cards */}
          <section aria-label="Per-program pricing">
            <h2 className="mb-6 text-2xl font-bold text-fg">Choose Your Program</h2>
            <PricingTable
              variant="cards"
              tiers={buildTiers(programs)}
              data-testid="pricing-table-cards"
            />
          </section>

          {/* Coupon field */}
          <section
            aria-label="Apply coupon code"
            data-testid="coupon-section"
            className="rounded-xl border border-border bg-card p-6"
          >
            <h2 className="mb-4 text-lg font-semibold text-fg">Apply a Coupon</h2>
            <p className="mb-4 text-sm text-fg-muted">
              Have a coupon or promo code? Enter it below to see your discounted price
              before you enroll. Discount is applied at checkout.
            </p>
            {/* CouponValidator is a client component — passes programId for server-side coupon scope check */}
            <CouponValidator programId={programs[0]?.id ?? ""} />
          </section>
        </div>
      )}

      {/* Bundles / tracks (T33) — programs grouped by domain, from client.public.bundles */}
      <section aria-label="Shop by track" className="mt-16" data-testid="bundles-section">
        <h2 className="mb-6 text-2xl font-bold text-fg">Shop by Track</h2>
        {bundlesError ? (
          <EmptyState
            title="Unable to load tracks"
            description="We couldn't fetch bundled track pricing. Please refresh or try again later."
            data-testid="bundles-error"
          />
        ) : bundles.length === 0 ? (
          <EmptyState
            title="No tracks available yet"
            description="Bundled tracks will appear here once published."
            data-testid="bundles-empty"
          />
        ) : (
          <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3" role="list" data-testid="bundles-list">
            {bundles.map((bundle) => (
              <li key={bundle.domain}>
                <article className="flex h-full flex-col rounded-xl border border-border bg-card p-6">
                  <h3 className="text-lg font-semibold text-fg">{bundle.domain}</h3>
                  <p className="mt-1 text-sm text-fg-muted">
                    {bundle.programCount} program{bundle.programCount === 1 ? "" : "s"}
                  </p>
                  <p className="mt-3 text-xl font-bold text-fg">
                    {formatPriceRange(bundle.minPricePaise, bundle.maxPricePaise)}
                  </p>
                  <ul className="mt-4 flex flex-1 flex-col gap-1.5" role="list">
                    {bundle.programs.slice(0, 4).map((p) => (
                      <li key={p.id}>
                        <a
                          href={`/programs/${p.slug}`}
                          className="text-sm text-fg-muted underline-offset-2 hover:text-brand-500 hover:underline"
                        >
                          {p.title}
                        </a>
                      </li>
                    ))}
                  </ul>
                  <a
                    href={`/programs?domain=${encodeURIComponent(bundle.domain)}`}
                    className="mt-5 inline-flex min-h-[40px] items-center justify-center rounded-md border border-border px-4 text-sm font-medium text-fg transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    data-testid={`bundle-cta-${bundle.domain}`}
                  >
                    View {bundle.domain} programs
                  </a>
                </article>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* EMI explainer */}
      <section
        aria-label="EMI options explained"
        data-testid="emi-explainer"
        className="mt-16 rounded-xl border border-border bg-surface p-8"
      >
        <h2 className="mb-4 text-2xl font-bold text-fg">0% EMI — Pay in Easy Installments</h2>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <div>
            <h3 className="mb-2 font-semibold text-fg">How it works</h3>
            <p className="text-sm text-fg-muted leading-relaxed">
              Select your EMI plan at checkout. The installment amount is charged to your
              card or bank account monthly. No interest charged by us — 0% EMI.
            </p>
          </div>
          <div>
            <h3 className="mb-2 font-semibold text-fg">Eligible cards</h3>
            <p className="text-sm text-fg-muted leading-relaxed">
              Most major credit cards from HDFC, ICICI, SBI, Axis, Kotak, and other Indian
              banks support EMI options at checkout. Debit card EMI varies by bank.
            </p>
          </div>
          <div>
            <h3 className="mb-2 font-semibold text-fg">Tenures available</h3>
            <p className="text-sm text-fg-muted leading-relaxed">
              3-month, 6-month, and 9-month tenures. Exact options depend on your bank and
              the program price. Available options are shown at the Razorpay checkout screen.
            </p>
          </div>
        </div>
      </section>

      {/* Comparison table */}
      <section
        aria-label="Program mode comparison"
        data-testid="pricing-comparison"
        className="mt-12"
      >
        <h2 className="mb-6 text-2xl font-bold text-fg">Which Mode is Right for You?</h2>
        <PricingTable
          variant="comparison"
          tiers={COMPARISON_TIERS}
          featureRows={PRICING_FEATURE_ROWS}
          data-testid="pricing-comparison-table"
        />
      </section>

      {/* Refund policy */}
      <section
        aria-label="Refund policy"
        data-testid="refund-policy-link"
        className="mt-12 rounded-xl border border-border bg-card p-6 text-center"
      >
        <h2 className="mb-3 text-lg font-semibold text-fg">Not satisfied? Get a refund.</h2>
        <p className="text-sm text-fg-muted">
          We offer a 7-day no-questions-asked refund on all programs. Your satisfaction matter.
        </p>
        <a
          href="/refund-policy"
          className="mt-3 inline-flex items-center text-sm font-medium text-brand-500 hover:text-brand-600 focus-visible:outline-none focus-visible:underline"
        >
          Read our full Refund Policy &rarr;
        </a>
      </section>
    </main>
  );
}
