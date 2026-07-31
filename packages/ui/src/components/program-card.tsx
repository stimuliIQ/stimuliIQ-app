import * as React from "react";
import { Star } from "lucide-react";

import { cn } from "../lib/cn";

/**
 * ProgramCard — marketing program tile for the programs listing and homepage featured
 * section. Per docs/01-prd-website.md §7.2/§7.3/§20 ("Program card = icon top-left,
 * title, meta row, price + rating, CTA bottom") and docs/07-design-system.md §5/§6.
 *
 * Anatomy (§20, extended with the Coursera-style media header):
 *   ┌─────────────────────────────┐
 *   │ [16:9 image]   [badge]      │  ← optional imageUrl + badgeLabel overlay
 *   │ [icon]  [domain chip]       │
 *   │ Title (2-line clamp)        │
 *   │ Summary (2-line clamp)      │  ← optional cardSummary hook
 *   │ Meta row: duration · mode · level │
 *   │ ─────────────────────────── │
 *   │ ₹X,XXX   ★ 4.8 (123)  [CTA]│
 *   └─────────────────────────────┘
 *
 * a11y:
 * - Card is a semantic <article> with a heading.
 * - Rating: aria-label conveys the number (not just stars) so it's not color/icon-only.
 * - Hover lift uses CSS transition; respects prefers-reduced-motion via `motion-safe:`.
 * - CTA is a full-width <a> or <button> with ≥44px tap target.
 *
 * SSR-safe: purely presentational, no client-only APIs.
 *
 * Usage:
 *   <ProgramCard
 *     icon={<PythonIcon />}
 *     domain="Data Science"
 *     title="Python for Data Science & ML"
 *     duration="12 weeks"
 *     mode="Live + Recorded"
 *     level="Beginner"
 *     priceDisplay="₹12,999"
 *     emiDisplay="EMI from ₹1,100/mo"
 *     ratingAvg={4.8}
 *     ratingCount={312}
 *     ctaLabel="Explore Program"
 *     ctaHref="/programs/python-data-science"
 *   />
 */

/**
 * Fallback chip colours for a caller that passes a `badgeLabel` with no `badgeStyle` —
 * the scholarship badge's original red, with white text. Callers that carry a staff-picked
 * colour pass `badgeStyle` and never hit this.
 */
const DEFAULT_BADGE_STYLE: React.CSSProperties = { backgroundColor: "#DC2626", color: "#FFFFFF" };

export interface ProgramCardProps {
  /** Icon slot — domain icon, rendered at top-left ~32px. */
  icon?: React.ReactNode;
  /** 16:9 media header image (CDN URL). Omitted → text-only card (legacy look). */
  imageUrl?: string;
  /** Decorative alt — course images are illustrative; defaults to "". */
  imageAlt?: string;
  /** Ribbon overlaid on the image (or chip when no image), e.g. "Scholarship available". */
  badgeLabel?: string;
  /**
   * Badge colours as an inline style — background plus the text colour derived from it
   * (`resolveProgramBadge` in web builds this). An inline style rather than a token because
   * staff pick the colour freely in the CRM, so it cannot be a fixed Tailwind class.
   * Omitted → the scholarship badge's original red ribbon.
   */
  badgeStyle?: React.CSSProperties;
  /** Short marketing hook (cardSummary) rendered under the title, 2-line clamp. */
  summary?: string;
  /** Domain category label. */
  domain?: string;
  title: string;
  duration?: string;
  mode?: string;
  level?: string;
  /** Formatted price string e.g. "₹12,999" — the amount actually charged. */
  priceDisplay?: string;
  /**
   * Optional struck-through "was" price e.g. "₹14,999". Display only; the caller is
   * responsible for only passing it when it is genuinely higher than `priceDisplay`
   * (web callers go through `formatCompareAtDisplay`, which enforces that).
   */
  originalPriceDisplay?: string;
  /**
   * Optional saving badge e.g. "53% OFF". Computed by the caller (web goes through
   * `formatDiscountPercent`) for the same reason as `originalPriceDisplay`: this component
   * receives formatted money strings, never paise, so it cannot derive the figure itself.
   */
  discountLabel?: string;
  /** Optional EMI blurb e.g. "EMI from ₹1,100/mo". */
  emiDisplay?: string;
  /** 0–5 rating average. */
  ratingAvg?: number;
  /** Number of ratings for the "(123)" count. */
  ratingCount?: number;
  /** CTA button/link label. */
  ctaLabel?: string;
  /** href — if provided the CTA renders as an <a>; otherwise a <button>. */
  ctaHref?: string;
  /** Called when CTA is clicked. */
  onCtaClick?: () => void;
  className?: string;
  "data-testid"?: string;
}

export function ProgramCard({
  icon,
  imageUrl,
  imageAlt = "",
  badgeLabel,
  badgeStyle,
  summary,
  domain,
  title,
  duration,
  mode,
  level,
  priceDisplay,
  originalPriceDisplay,
  discountLabel,
  emiDisplay,
  ratingAvg,
  ratingCount,
  ctaLabel = "Explore Program",
  ctaHref,
  onCtaClick,
  className,
  "data-testid": testId,
}: ProgramCardProps): React.JSX.Element {
  const metaParts = [duration, mode, level].filter(Boolean);

  const ratingAriaLabel =
    ratingAvg != null
      ? `Rated ${ratingAvg.toFixed(1)} out of 5${ratingCount ? `, ${ratingCount.toLocaleString("en-IN")} reviews` : ""}`
      : undefined;

  const ctaSharedClass = cn(
    "mt-auto flex min-h-[44px] w-full items-center justify-center rounded-md bg-brand-500 px-4 text-sm font-semibold text-white",
    "transition-colors duration-[150ms] ease-out hover:bg-brand-600 active:bg-brand-700",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card",
  );

  return (
    <article
      data-testid={testId ?? "program-card"}
      className={cn(
        "flex flex-col rounded-xl border border-border bg-card text-fg shadow-sm overflow-hidden",
        "motion-safe:transition-shadow motion-safe:duration-[150ms] motion-safe:ease-out",
        "motion-safe:hover:shadow-md",
        className,
      )}
    >
      {/* Media header (Coursera-style) — 16:9 image with optional ribbon */}
      {imageUrl ? (
        <div className="relative aspect-video w-full overflow-hidden bg-surface">
          <img
            src={imageUrl}
            alt={imageAlt}
            loading="lazy"
            className="size-full object-cover"
          />
          {badgeLabel ? (
            <span
              className="absolute right-0 top-3 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider shadow-sm"
              style={badgeStyle ?? DEFAULT_BADGE_STYLE}
            >
              {badgeLabel}
            </span>
          ) : null}
        </div>
      ) : null}

      {/* Card body */}
      <div className="flex flex-1 flex-col gap-4 p-5">
        {/* Icon + domain row — omitted entirely when there is nothing to show */}
        {icon || domain || (badgeLabel && !imageUrl) ? (
        <div className="flex items-start gap-3">
          {icon ? (
            <div
              aria-hidden="true"
              className="shrink-0 flex size-10 items-center justify-center rounded-lg bg-brand-50 text-brand-500 [&>svg]:size-6"
            >
              {icon}
            </div>
          ) : null}
          {domain ? (
            <span className="mt-0.5 inline-block rounded-full border border-border bg-surface px-2.5 py-0.5 text-xs font-medium text-fg-muted">
              {domain}
            </span>
          ) : null}
          {/* No image to carry the ribbon — fall back to an inline chip */}
          {badgeLabel && !imageUrl ? (
            <span
              className="mt-0.5 inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold"
              style={badgeStyle ?? DEFAULT_BADGE_STYLE}
            >
              {badgeLabel}
            </span>
          ) : null}
        </div>
        ) : null}

        {/* Title */}
        <h3 className="line-clamp-2 text-base font-semibold leading-heading text-fg">
          {title}
        </h3>

        {/* Marketing hook */}
        {summary ? (
          <p className="line-clamp-2 text-sm text-fg-muted">{summary}</p>
        ) : null}

        {/* Meta row */}
        {metaParts.length > 0 ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {metaParts.map((part, i) => (
              <React.Fragment key={part}>
                <span className="text-xs text-fg-muted">{part}</span>
                {i < metaParts.length - 1 ? (
                  <span aria-hidden="true" className="text-border">·</span>
                ) : null}
              </React.Fragment>
            ))}
          </div>
        ) : null}

        {/* Spacer so price/rating/CTA stay at the bottom */}
        <div className="flex-1" />

        {/* Price + Rating row */}
        {(priceDisplay || ratingAvg != null) ? (
          <div className="flex items-end justify-between gap-2">
            {/* Price */}
            {priceDisplay ? (
              <div className="flex flex-col gap-0.5">
                <span className="flex items-baseline gap-1.5">
                  <span className="text-base font-bold text-fg">{priceDisplay}</span>
                  {/* Struck-through "was" price. `line-through` alone is a purely visual
                      cue, so the screen-reader text spells the relationship out — a
                      listener would otherwise just hear two prices in a row. */}
                  {originalPriceDisplay ? (
                    <>
                      <span aria-hidden="true" className="text-xs text-fg-subtle line-through">
                        {originalPriceDisplay}
                      </span>
                      <span className="sr-only">, reduced from {originalPriceDisplay}</span>
                    </>
                  ) : null}
                  {discountLabel ? (
                    <span className="rounded bg-success/10 px-1.5 py-0.5 text-[11px] font-bold text-success">
                      {discountLabel}
                    </span>
                  ) : null}
                </span>
                {emiDisplay ? (
                  <span className="text-xs text-fg-muted">{emiDisplay}</span>
                ) : null}
              </div>
            ) : null}

            {/* Rating */}
            {ratingAvg != null ? (
              <div
                aria-label={ratingAriaLabel}
                className="flex items-center gap-1"
              >
                <Star
                  aria-hidden="true"
                  className="size-4 fill-warning text-warning"
                />
                <span className="text-sm font-semibold text-fg tabular-nums">
                  {ratingAvg.toFixed(1)}
                </span>
                {ratingCount != null ? (
                  <span className="text-xs text-fg-muted tabular-nums">
                    ({ratingCount.toLocaleString("en-IN")})
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* CTA */}
        {ctaHref ? (
          <a
            href={ctaHref}
            onClick={onCtaClick}
            className={ctaSharedClass}
          >
            {ctaLabel}
          </a>
        ) : (
          <button
            type="button"
            onClick={onCtaClick}
            className={ctaSharedClass}
          >
            {ctaLabel}
          </button>
        )}
      </div>
    </article>
  );
}

ProgramCard.displayName = "ProgramCard";
