import * as React from "react";

import { cn } from "../lib/cn";

/**
 * HeroSplit — 60/40 split hero section for the marketing homepage and landing pages.
 * Per docs/01-prd-website.md §7.2/§20 ("Hero = 60/40 split (copy/visual) desktop,
 * stacked mobile") and docs/07-design-system.md §5/§12 (web spacious personality).
 *
 * SSR-safe: purely presentational, no client-only APIs.
 *
 * Usage:
 *   <HeroSplit
 *     eyebrow="India's #1 EdTech for B.Tech Students"
 *     heading="Launch your career with real internship training"
 *     subheading="Project-based, mentor-led programs with verifiable certificates and placement support."
 *     primaryCta={<Button asChild size="lg"><Link href="/programs">Explore Programs</Link></Button>}
 *     secondaryCta={<Button asChild size="lg" variant="secondary"><Link href="/book-free-slot">Book Free Slot</Link></Button>}
 *     trustStrip={<TrustStrip />}
 *     visual={<img src="/hero-image.jpg" alt="Students in a training session" />}
 *   />
 */

export interface HeroSplitProps {
  /** Optional short eyebrow text above the heading. */
  eyebrow?: React.ReactNode;
  heading: React.ReactNode;
  subheading?: React.ReactNode;
  primaryCta?: React.ReactNode;
  secondaryCta?: React.ReactNode;
  /** Trust strip slot — rendered below CTAs (student count, ratings, partner logos). */
  trustStrip?: React.ReactNode;
  /** Right-side visual slot (image, illustration, video). */
  visual?: React.ReactNode;
  /** Controls the heading element tag. Defaults to h1 (use only once per page). */
  headingLevel?: 1 | 2;
  className?: string;
  "data-testid"?: string;
}

export function HeroSplit({
  eyebrow,
  heading,
  subheading,
  primaryCta,
  secondaryCta,
  trustStrip,
  visual,
  headingLevel = 1,
  className,
  "data-testid": testId,
}: HeroSplitProps): React.JSX.Element {
  const HeadingTag = `h${headingLevel}` as "h1" | "h2";

  return (
    <section
      data-testid={testId ?? "hero-split"}
      aria-label="Hero section"
      className={cn(
        "relative w-full overflow-hidden bg-bg py-16 md:py-24",
        className,
      )}
    >
      <div className="mx-auto grid max-w-screen-xl grid-cols-1 items-center gap-10 px-4 md:px-6 lg:grid-cols-5">
        {/* Copy column — 60% (~3/5) */}
        <div className="flex flex-col gap-6 lg:col-span-3">
          {eyebrow ? (
            <p className="text-sm font-semibold uppercase tracking-wider text-brand-500">
              {eyebrow}
            </p>
          ) : null}

          <HeadingTag
            className={cn(
              "font-display font-bold leading-heading text-fg",
              "text-4xl md:text-5xl lg:text-5xl",
            )}
          >
            {heading}
          </HeadingTag>

          {subheading ? (
            <p className="max-w-xl text-lg text-fg-muted leading-relaxed">
              {subheading}
            </p>
          ) : null}

          {(primaryCta || secondaryCta) ? (
            <div className="flex flex-wrap items-center gap-3 pt-2">
              {primaryCta}
              {secondaryCta}
            </div>
          ) : null}

          {trustStrip ? (
            <div className="pt-4">{trustStrip}</div>
          ) : null}
        </div>

        {/* Visual column — 40% (~2/5) */}
        {visual ? (
          <div
            aria-hidden="true"
            className={cn(
              "relative hidden lg:col-span-2 lg:flex lg:items-center lg:justify-center",
              "overflow-hidden rounded-xl",
            )}
          >
            {visual}
          </div>
        ) : null}
      </div>
    </section>
  );
}

HeroSplit.displayName = "HeroSplit";
