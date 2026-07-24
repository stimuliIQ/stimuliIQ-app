import * as React from "react";
import { Star } from "lucide-react";

import { cn } from "../lib/cn";

/**
 * TestimonialCard — student review card for the testimonials section.
 * Per docs/01-prd-website.md §7.2 ("Testimonials — student stories (video + quote)").
 *
 * Premium spotlight-card visual: a "logo slot" (the student's college, set in bold
 * caps with an accent underline — playing the role a company logo would on a B2B
 * site), a large quote, and a footer with avatar/name/rating plus an optional
 * "read more" CTA pill. Used both as a grid cell (about/programs/CMS pages) and as
 * a single large carousel slide (homepage) — padding/type scale work in both.
 *
 * Supports both text quote and video embed (video src URL or embed slot). When a video
 * is provided the quote is rendered below the video.
 *
 * a11y:
 * - <blockquote> wraps the quote text; <cite> for attribution.
 * - Star rating uses aria-label (never color-only).
 * - Video slot: caller must provide captions. The slot renders as-is (iframe/video).
 *
 * SSR-safe: purely presentational.
 *
 * Usage:
 *   <TestimonialCard
 *     quote="The Python program completely changed my career prospects..."
 *     studentName="Aditya R."
 *     college="NIT Warangal"
 *     program="Python for Data Science"
 *     ratingStars={5}
 *     avatarSrc="/avatars/aditya.jpg"
 *     href="/testimonials"
 *   />
 */

export interface TestimonialCardProps {
  quote: string;
  studentName: string;
  college?: string;
  program?: string;
  /** 1–5 integer. */
  ratingStars?: number;
  avatarSrc?: string;
  /** Optional video embed slot (iframe / video element with captions). */
  videoSlot?: React.ReactNode;
  /** Optional "read more" link — renders a pill CTA in the footer when provided. */
  href?: string;
  /** Label for the CTA pill; only used when `href` is provided. */
  ctaLabel?: string;
  className?: string;
  "data-testid"?: string;
}

export function TestimonialCard({
  quote,
  studentName,
  college,
  program,
  ratingStars,
  avatarSrc,
  videoSlot,
  href,
  ctaLabel = "Read full story",
  className,
  "data-testid": testId,
}: TestimonialCardProps): React.JSX.Element {
  const safeStars = ratingStars != null ? Math.min(5, Math.max(1, Math.round(ratingStars))) : null;

  return (
    <article
      data-testid={testId ?? "testimonial-card"}
      className={cn(
        "flex h-full flex-col gap-6 rounded-3xl border border-border bg-card p-8 shadow-sm",
        "motion-safe:transition-shadow motion-safe:hover:shadow-md",
        className,
      )}
    >
      {/* Video slot (optional) */}
      {videoSlot ? (
        <div className="overflow-hidden rounded-lg aspect-video w-full bg-surface">
          {videoSlot}
        </div>
      ) : null}

      {/* "Logo" slot — the student's college stands in for a company logo */}
      {college ? (
        <div>
          <p className="text-sm font-extrabold uppercase tracking-wide text-fg">{college}</p>
          <span aria-hidden="true" className="mt-1.5 block h-1 w-14 rounded-full bg-chart-3" />
        </div>
      ) : null}

      {/* Quote */}
      <blockquote className="flex-1">
        <p className="text-lg leading-relaxed text-fg">
          &ldquo;{quote}&rdquo;
        </p>
      </blockquote>

      {/* Attribution */}
      <footer className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {avatarSrc ? (
            <img
              src={avatarSrc}
              alt=""
              aria-hidden="true"
              className="size-11 rounded-full object-cover shrink-0"
            />
          ) : (
            <div
              aria-hidden="true"
              className="size-11 rounded-full bg-brand-100 shrink-0 flex items-center justify-center text-sm font-bold text-brand-600"
            >
              {studentName.charAt(0).toUpperCase()}
            </div>
          )}
          <cite className="not-italic">
            <p className="text-sm font-semibold text-fg">{studentName}</p>
            {(college || program) ? (
              <p className="text-xs text-fg-muted">
                {[program, college].filter(Boolean).join(", ")}
              </p>
            ) : null}
            {safeStars != null ? (
              <div
                aria-label={`Rated ${safeStars} out of 5 stars`}
                className="mt-1 flex items-center gap-0.5"
              >
                {Array.from({ length: 5 }, (_, i) => (
                  <Star
                    key={i}
                    aria-hidden="true"
                    className={cn(
                      "size-3.5",
                      i < safeStars
                        ? "fill-warning text-warning"
                        : "fill-none text-border",
                    )}
                  />
                ))}
              </div>
            ) : null}
          </cite>
        </div>

        {href ? (
          <a
            href={href}
            className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-surface px-4 py-2 text-sm font-semibold text-fg transition-colors duration-fast hover:border-chart-3/40 hover:text-chart-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {ctaLabel}
          </a>
        ) : null}
      </footer>
    </article>
  );
}

TestimonialCard.displayName = "TestimonialCard";
