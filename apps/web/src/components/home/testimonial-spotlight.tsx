"use client";

/**
 * TestimonialSpotlight — homepage "What Our Students Say" carousel. Shows one
 * TestimonialCard at a time (the "spotlight" look) with prev/next controls and
 * dot indicators to cycle through the rest, instead of a 3-card grid.
 *
 * Auto-advances every 6 s, with the WCAG 2.2 (2.2.2) mitigations that make an
 * auto-carousel acceptable: it PAUSES while hovered or while any control inside
 * has keyboard focus, STOPS for good the moment the user navigates manually
 * (their choice of card must not be yanked away), and never starts at all for
 * `prefers-reduced-motion` users.
 *
 * a11y: the active card sits in an `aria-live="polite"` region so screen readers
 * announce the change; prev/next buttons are labelled; dots are a `tablist` with
 * `aria-selected` on the active one — no color-only state (active dot is also
 * wider, and the whole control set is keyboard-operable via native buttons).
 *
 * Client component: only the index state + nav controls need JS; each
 * TestimonialCard render is still static, SEO-visible markup.
 */

import * as React from "react";
import { TestimonialCard, cn } from "@repo/ui";

export interface TestimonialSpotlightItem {
  id: string;
  quote: string;
  studentName: string;
  college?: string;
  program?: string;
  ratingStars?: number;
  avatarSrc?: string;
}

function ChevronIcon({ direction }: { direction: "left" | "right" }) {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
    >
      <path d={direction === "left" ? "m15 18-6-6 6-6" : "m9 18 6-6-6-6"} />
    </svg>
  );
}

export function TestimonialSpotlight({
  items,
  ctaHref = "/testimonials",
}: {
  items: TestimonialSpotlightItem[];
  ctaHref?: string;
}) {
  const count = items.length;
  const AUTOPLAY_MS = 6000;
  const [index, setIndex] = React.useState(0);
  // Autoplay gates — see the header comment for the WCAG reasoning behind each.
  const [hovered, setHovered] = React.useState(false);
  const [focusWithin, setFocusWithin] = React.useState(false);
  const [userNavigated, setUserNavigated] = React.useState(false);
  const [reducedMotion, setReducedMotion] = React.useState(false);

  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const autoplayActive = count > 1 && !hovered && !focusWithin && !userNavigated && !reducedMotion;

  React.useEffect(() => {
    if (!autoplayActive) return;
    const timer = setInterval(() => setIndex((i) => i + 1), AUTOPLAY_MS);
    return () => clearInterval(timer);
  }, [autoplayActive]);

  if (count === 0) return null;

  const current = items[((index % count) + count) % count]!;
  const goTo = (i: number) => {
    // Manual navigation permanently stops autoplay — the visitor picked a card;
    // don't advance it out from under them.
    setUserNavigated(true);
    setIndex(((i % count) + count) % count);
  };

  return (
    <div
      className="mx-auto max-w-3xl"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocusWithin(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocusWithin(false);
      }}
    >
      <div aria-live="polite" aria-atomic="true">
        <TestimonialCard
          key={current.id}
          quote={current.quote}
          studentName={current.studentName}
          college={current.college}
          program={current.program}
          ratingStars={current.ratingStars}
          avatarSrc={current.avatarSrc}
          href={ctaHref}
          ctaLabel="Read full story"
        />
      </div>

      {count > 1 ? (
        <div className="mt-6 flex items-center justify-center gap-4">
          <button
            type="button"
            onClick={() => goTo(index - 1)}
            aria-label="Previous testimonial"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border text-fg-muted transition-colors duration-fast hover:border-chart-3/40 hover:text-chart-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <ChevronIcon direction="left" />
          </button>

          <div role="tablist" aria-label="Testimonials" className="flex items-center gap-2">
            {items.map((t, i) => {
              const active = i === index;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-label={`Show testimonial ${i + 1} of ${count}`}
                  onClick={() => goTo(i)}
                  className={cn(
                    "h-2 rounded-full transition-all duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    active ? "w-6 bg-chart-3" : "w-2 bg-border hover:bg-fg-subtle",
                  )}
                />
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => goTo(index + 1)}
            aria-label="Next testimonial"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border text-fg-muted transition-colors duration-fast hover:border-chart-3/40 hover:text-chart-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <ChevronIcon direction="right" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
