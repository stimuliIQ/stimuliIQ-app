import * as React from "react";
import { Check, X } from "lucide-react";

import { cn } from "../lib/cn";

/**
 * PricingTable — per-program pricing with optional comparison grid.
 * Per docs/01-prd-website.md §7.5 ("per-program pricing, comparison table").
 *
 * Two display modes:
 * 1. `variant="cards"` — vertical pricing tier cards side by side.
 * 2. `variant="comparison"` — horizontal feature × tier comparison table.
 *
 * a11y:
 * - Comparison table uses proper <table>, <thead>, <th scope="col"/"row">.
 * - Checkmark / cross icons have aria-label; never color-only.
 * - Highlighted (recommended) plan uses aria-label="Recommended" on the header cell.
 *
 * SSR-safe: purely presentational.
 *
 * Usage (cards):
 *   <PricingTable
 *     variant="cards"
 *     tiers={[
 *       { id: "basic", name: "Self-Paced", priceDisplay: "₹8,999", features: ["Recorded videos", "Certificate"], ctaLabel: "Enroll", ctaHref: "/enroll/self-paced" },
 *       { id: "live", name: "Live + Recorded", priceDisplay: "₹12,999", recommended: true, features: ["All basics", "Live sessions", "Placement support"], ctaLabel: "Enroll", ctaHref: "/enroll/live" },
 *     ]}
 *   />
 *
 * Usage (comparison):
 *   <PricingTable
 *     variant="comparison"
 *     tiers={[ ... ]}
 *     featureRows={[
 *       { label: "Recorded videos", values: { basic: true, live: true } },
 *       { label: "Live sessions", values: { basic: false, live: true } },
 *     ]}
 *   />
 */

export interface PricingTier {
  id: string;
  name: string;
  priceDisplay: string;
  emiDisplay?: string;
  description?: string;
  features: string[];
  ctaLabel?: string;
  ctaHref?: string;
  onCtaClick?: () => void;
  recommended?: boolean;
}

export interface PricingFeatureRow {
  label: string;
  /** Map of tier.id → true/false/string */
  values: Record<string, boolean | string>;
}

export interface PricingTableProps {
  variant?: "cards" | "comparison";
  tiers: PricingTier[];
  /** Only used when variant="comparison". */
  featureRows?: PricingFeatureRow[];
  className?: string;
  "data-testid"?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function FeatureValue({ val }: { val: boolean | string }): React.JSX.Element {
  if (typeof val === "string") {
    return <span className="text-sm text-fg">{val}</span>;
  }
  if (val) {
    return (
      <Check
        aria-label="Included"
        className="mx-auto size-5 text-success"
      />
    );
  }
  return (
    <X
      aria-label="Not included"
      className="mx-auto size-5 text-fg-subtle"
    />
  );
}

// ---------------------------------------------------------------------------
// PricingTable
// ---------------------------------------------------------------------------

export function PricingTable({
  variant = "cards",
  tiers,
  featureRows,
  className,
  "data-testid": testId,
}: PricingTableProps): React.JSX.Element {
  const ctaShared = cn(
    "flex min-h-[44px] w-full items-center justify-center rounded-md px-5 text-sm font-semibold",
    "transition-colors duration-[150ms] ease-out",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
  );

  if (variant === "comparison" && featureRows) {
    return (
      <div
        data-testid={testId ?? "pricing-table"}
        className={cn("w-full overflow-x-auto", className)}
      >
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              {/* Empty cell for the feature label column */}
              <th scope="col" className="border-b border-border pb-4 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-fg-subtle">
                Feature
              </th>
              {tiers.map((tier) => (
                <th
                  key={tier.id}
                  scope="col"
                  aria-label={tier.recommended ? `${tier.name} — Recommended` : tier.name}
                  className={cn(
                    "border-b border-border pb-4 px-4 text-center",
                    tier.recommended && "border-x border-brand-500",
                  )}
                >
                  {tier.recommended ? (
                    <span className="mb-1 inline-block rounded-full bg-brand-500 px-2 py-0.5 text-xs font-semibold text-white">
                      Recommended
                    </span>
                  ) : null}
                  <div className="text-base font-semibold text-fg">{tier.name}</div>
                  <div className="text-xl font-bold text-fg">{tier.priceDisplay}</div>
                  {tier.emiDisplay ? (
                    <div className="text-xs text-fg-muted">{tier.emiDisplay}</div>
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {featureRows.map((row) => (
              <tr key={row.label} className="hover:bg-surface/50">
                <th
                  scope="row"
                  className="py-3 pr-4 text-left font-medium text-fg-muted"
                >
                  {row.label}
                </th>
                {tiers.map((tier) => (
                  <td
                    key={tier.id}
                    className={cn(
                      "py-3 px-4 text-center",
                      tier.recommended && "border-x border-brand-500/20",
                    )}
                  >
                    <FeatureValue val={row.values[tier.id] ?? false} />
                  </td>
                ))}
              </tr>
            ))}
            {/* CTA row */}
            <tr>
              <td />
              {tiers.map((tier) => (
                <td
                  key={tier.id}
                  className={cn(
                    "pt-4 px-4",
                    tier.recommended && "border-x border-b border-brand-500",
                  )}
                >
                  {tier.ctaHref ? (
                    <a
                      href={tier.ctaHref}
                      onClick={tier.onCtaClick}
                      className={cn(
                        ctaShared,
                        tier.recommended
                          ? "bg-brand-500 text-white hover:bg-brand-600"
                          : "border border-border text-fg hover:bg-surface",
                      )}
                    >
                      {tier.ctaLabel ?? "Enroll"}
                    </a>
                  ) : (
                    <button
                      type="button"
                      onClick={tier.onCtaClick}
                      className={cn(
                        ctaShared,
                        tier.recommended
                          ? "bg-brand-500 text-white hover:bg-brand-600"
                          : "border border-border text-fg hover:bg-surface",
                      )}
                    >
                      {tier.ctaLabel ?? "Enroll"}
                    </button>
                  )}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    );
  }

  // Cards variant (default)
  return (
    <div
      data-testid={testId ?? "pricing-table"}
      className={cn(
        "grid grid-cols-1 gap-6",
        tiers.length === 2 && "md:grid-cols-2",
        tiers.length >= 3 && "md:grid-cols-2 lg:grid-cols-3",
        className,
      )}
    >
      {tiers.map((tier) => (
        <div
          key={tier.id}
          data-testid="pricing-tier"
          className={cn(
            "relative flex flex-col gap-6 rounded-xl border bg-card p-6 shadow-sm",
            tier.recommended
              ? "border-brand-500 ring-2 ring-brand-500/30"
              : "border-border",
          )}
        >
          {/* Recommended badge */}
          {tier.recommended ? (
            <div
              aria-label="Recommended"
              className="absolute -top-3.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-brand-500 px-4 py-1 text-xs font-semibold text-white"
            >
              Recommended
            </div>
          ) : null}

          {/* Header */}
          <div>
            <h3 className="text-lg font-semibold text-fg">{tier.name}</h3>
            {tier.description ? (
              <p className="mt-1 text-sm text-fg-muted">{tier.description}</p>
            ) : null}
          </div>

          {/* Price */}
          <div>
            <span className="text-3xl font-bold text-fg">{tier.priceDisplay}</span>
            {tier.emiDisplay ? (
              <p className="mt-1 text-sm text-fg-muted">{tier.emiDisplay}</p>
            ) : null}
          </div>

          {/* Feature list */}
          <ul className="flex flex-1 flex-col gap-2.5" role="list">
            {tier.features.map((f) => (
              <li key={f} className="flex items-start gap-2.5 text-sm text-fg-muted">
                <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
                <span>{f}</span>
              </li>
            ))}
          </ul>

          {/* CTA */}
          {tier.ctaHref ? (
            <a
              href={tier.ctaHref}
              onClick={tier.onCtaClick}
              className={cn(
                ctaShared,
                tier.recommended
                  ? "bg-brand-500 text-white hover:bg-brand-600 active:bg-brand-700"
                  : "border border-border text-fg hover:bg-surface",
              )}
            >
              {tier.ctaLabel ?? "Enroll"}
            </a>
          ) : (
            <button
              type="button"
              onClick={tier.onCtaClick}
              className={cn(
                ctaShared,
                tier.recommended
                  ? "bg-brand-500 text-white hover:bg-brand-600 active:bg-brand-700"
                  : "border border-border text-fg hover:bg-surface",
              )}
            >
              {tier.ctaLabel ?? "Enroll"}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

PricingTable.displayName = "PricingTable";
