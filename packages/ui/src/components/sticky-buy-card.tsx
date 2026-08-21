"use client";

import * as React from "react";

import { cn } from "../lib/cn";

/**
 * StickyBuyCard + MobileBuyBar — enrollment price widget for the program detail page.
 * Per docs/01-prd-website.md §7.4/§14/§20 ("Sticky enroll/price card (desktop right
 * rail, mobile bottom bar)"; "tap targets ≥44px").
 * Per docs/07-design-system.md §6 ("Sticky buy card / bottom bar").
 *
 * a11y:
 * - StickyBuyCard: aside with aria-label. CTAs are ≥44px.
 * - MobileBuyBar: fixed bar, aria-label, z-index above content but below dialogs.
 *   Includes a `aria-live` region so price updates are announced.
 * - All interactive controls ≥44px.
 *
 * SSR-safety: StickyBuyCard is pure markup (no window access). MobileBuyBar uses
 * "use client" and `useEffect` to avoid SSR/hydration issues with `fixed` positioning
 * (safe as-is; Next.js suppresses that hydration diff).
 *
 * Usage:
 *   // Desktop (in the right-rail)
 *   <StickyBuyCard
 *     priceDisplay="₹12,999"
 *     originalPriceDisplay="₹18,999"
 *     emiDisplay="or ₹1,100/mo (0% EMI)"
 *     primaryCtaLabel="Enroll Now"
 *     primaryCtaHref="/enroll/python-ds"
 *     secondaryCtaLabel="Book Free Slot"
 *     secondaryCtaHref="/book-free-slot"
 *     included={["12 weeks", "Live + Recorded", "Certificate", "Placement support"]}
 *   />
 *
 *   // Mobile (fixed bottom bar)
 *   <MobileBuyBar
 *     priceDisplay="₹12,999"
 *     primaryCtaLabel="Enroll Now"
 *     primaryCtaHref="/enroll/python-ds"
 *   />
 */

// ---------------------------------------------------------------------------
// StickyBuyCard
// ---------------------------------------------------------------------------

export interface StickyBuyCardProps {
  priceDisplay: string;
  originalPriceDisplay?: string;
  /** Optional saving badge e.g. "53% OFF" — caller-computed (`formatDiscountPercent`). */
  discountLabel?: string;
  emiDisplay?: string;
  primaryCtaLabel?: string;
  primaryCtaHref?: string;
  onPrimaryCtaClick?: () => void;
  secondaryCtaLabel?: string;
  secondaryCtaHref?: string;
  onSecondaryCtaClick?: () => void;
  /** List of what is included — rendered as a ul. */
  included?: string[];
  /** Optional slot for a coupon input or trust badges. */
  extraSlot?: React.ReactNode;
  className?: string;
  "data-testid"?: string;
}

export function StickyBuyCard({
  priceDisplay,
  originalPriceDisplay,
  discountLabel,
  emiDisplay,
  primaryCtaLabel = "Enroll Now",
  primaryCtaHref,
  onPrimaryCtaClick,
  secondaryCtaLabel = "Book Free Slot",
  secondaryCtaHref,
  onSecondaryCtaClick,
  included,
  extraSlot,
  className,
  "data-testid": testId,
}: StickyBuyCardProps): React.JSX.Element {
  return (
    <aside
      data-testid={testId ?? "sticky-buy-card"}
      aria-label="Program enrollment"
      className={cn(
        "flex flex-col gap-5 rounded-xl border border-border bg-card p-6 shadow-md",
        className,
      )}
    >
      {/* Price */}
      <div>
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-bold text-fg">{priceDisplay}</span>
          {originalPriceDisplay ? (
            <span className="text-base text-fg-muted line-through">{originalPriceDisplay}</span>
          ) : null}
          {discountLabel ? (
            <span className="rounded bg-success/10 px-2 py-0.5 text-sm font-bold text-success">
              {discountLabel}
            </span>
          ) : null}
        </div>
        {emiDisplay ? (
          <p className="mt-1 text-sm text-fg-muted">{emiDisplay}</p>
        ) : null}
      </div>

      {/* Primary CTA */}
      {primaryCtaHref ? (
        <a
          href={primaryCtaHref}
          onClick={onPrimaryCtaClick}
          className={cn(
            "flex min-h-[44px] items-center justify-center rounded-md bg-brand-500 px-6 text-base font-semibold text-white",
            "transition-colors hover:bg-brand-600 active:bg-brand-700",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          )}
        >
          {primaryCtaLabel}
        </a>
      ) : (
        <button
          type="button"
          onClick={onPrimaryCtaClick}
          className={cn(
            "flex min-h-[44px] w-full items-center justify-center rounded-md bg-brand-500 px-6 text-base font-semibold text-white",
            "transition-colors hover:bg-brand-600 active:bg-brand-700",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          )}
        >
          {primaryCtaLabel}
        </button>
      )}

      {/* Secondary CTA. Requires an ACTION as well as a label: `secondaryCtaLabel`
          carries a default, so a caller that deliberately omits both the href and the
          click handler used to get a rendered-but-inert "Book Free Slot" button. Callers
          hide the secondary action by passing neither href nor handler. */}
      {secondaryCtaLabel && (secondaryCtaHref || onSecondaryCtaClick) ? (
        secondaryCtaHref ? (
          <a
            href={secondaryCtaHref}
            onClick={onSecondaryCtaClick}
            className={cn(
              "flex min-h-[44px] items-center justify-center rounded-md border border-border px-6 text-base font-medium text-fg",
              "transition-colors hover:bg-surface",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            )}
          >
            {secondaryCtaLabel}
          </a>
        ) : (
          <button
            type="button"
            onClick={onSecondaryCtaClick}
            className={cn(
              "flex min-h-[44px] w-full items-center justify-center rounded-md border border-border px-6 text-base font-medium text-fg",
              "transition-colors hover:bg-surface",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            )}
          >
            {secondaryCtaLabel}
          </button>
        )
      ) : null}

      {/* Included list */}
      {included && included.length > 0 ? (
        <ul className="flex flex-col gap-2" aria-label="What's included" role="list">
          {included.map((item) => (
            <li key={item} className="flex items-center gap-2 text-sm text-fg-muted">
              <span
                aria-hidden="true"
                className="inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-success/20 text-success text-xs font-bold"
              >
                ✓
              </span>
              {item}
            </li>
          ))}
        </ul>
      ) : null}

      {/* Extra slot (coupon, trust badges) */}
      {extraSlot ? <div>{extraSlot}</div> : null}
    </aside>
  );
}

StickyBuyCard.displayName = "StickyBuyCard";

// ---------------------------------------------------------------------------
// MobileBuyBar — fixed bottom bar (mobile only)
// ---------------------------------------------------------------------------

export interface MobileBuyBarProps {
  priceDisplay: string;
  /** Optional struck-through "was" price, e.g. "₹14,999". */
  originalPriceDisplay?: string;
  /** Optional saving badge e.g. "53% OFF" — caller-computed (`formatDiscountPercent`). */
  discountLabel?: string;
  primaryCtaLabel?: string;
  primaryCtaHref?: string;
  onPrimaryCtaClick?: () => void;
  className?: string;
  "data-testid"?: string;
}

export function MobileBuyBar({
  priceDisplay,
  originalPriceDisplay,
  discountLabel,
  primaryCtaLabel = "Enroll Now",
  primaryCtaHref,
  onPrimaryCtaClick,
  className,
  "data-testid": testId,
}: MobileBuyBarProps): React.JSX.Element {
  return (
    <div
      data-testid={testId ?? "mobile-buy-bar"}
      aria-label="Program enrollment, quick access"
      className={cn(
        "fixed bottom-0 inset-x-0 z-30 border-t border-border bg-card/95 backdrop-blur-sm",
        "flex items-center justify-between gap-3 px-4 py-3 lg:hidden",
        className,
      )}
    >
      {/* Price — aria-live so dynamic updates are announced */}
      <div aria-live="polite" aria-atomic="true" className="flex items-baseline gap-1.5">
        <span className="text-xl font-bold text-fg">{priceDisplay}</span>
        {originalPriceDisplay ? (
          <>
            <span aria-hidden="true" className="text-sm text-fg-subtle line-through">{originalPriceDisplay}</span>
            <span className="sr-only">, reduced from {originalPriceDisplay}</span>
          </>
        ) : null}
        {discountLabel ? (
          <span className="rounded bg-success/10 px-1.5 py-0.5 text-xs font-bold text-success">
            {discountLabel}
          </span>
        ) : null}
      </div>

      {/* CTA — ≥44px */}
      {primaryCtaHref ? (
        <a
          href={primaryCtaHref}
          onClick={onPrimaryCtaClick}
          className={cn(
            "flex min-h-[44px] items-center rounded-md bg-brand-500 px-6 text-sm font-semibold text-white",
            "transition-colors hover:bg-brand-600 active:bg-brand-700",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          )}
        >
          {primaryCtaLabel}
        </a>
      ) : (
        <button
          type="button"
          onClick={onPrimaryCtaClick}
          className={cn(
            "flex min-h-[44px] items-center rounded-md bg-brand-500 px-6 text-sm font-semibold text-white",
            "transition-colors hover:bg-brand-600 active:bg-brand-700",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          )}
        >
          {primaryCtaLabel}
        </button>
      )}
    </div>
  );
}

MobileBuyBar.displayName = "MobileBuyBar";
