/**
 * CollegeMarquee — the shared presentation for the "Institutional Network" college list:
 * TWO rows of cards scrolling continuously in opposite directions, edge-faded, full-bleed.
 *
 * Used by BOTH renderers of that section so they stay identical:
 *   - `page-builder/blocks/live-collection-ref-block.tsx` (`collection: "partners"`) — the
 *     live, CRM-driven path on every locked template that carries the section;
 *   - `home/partner-colleges.tsx` — the hardcoded fallback when that list resolves empty.
 *
 * Server Component — no client JS. The motion is pure CSS: see the `college-marquee`
 * rules in `app/globals.css` for how the seamless loop and the reduced-motion collapse
 * work. This file owns the geometry the CSS depends on (fixed card pitch, copy count,
 * per-row duration).
 *
 * Replaces a 4-column grid: 27 cards cost seven rows of vertical page, and before that a
 * height-capped viewport that nested a scrollbar inside the page. Two marquee rows show
 * the whole list in a fixed ~180px of height.
 *
 * a11y: one real `role="list"` per row — the duplicate copies that feed the loop are
 * `aria-hidden` and dropped entirely under `prefers-reduced-motion`, where each row
 * becomes a plain manually-scrollable strip. Motion parks on hover and on keyboard focus.
 */
import type { CSSProperties } from "react";

export interface CollegeCardItem {
  name: string;
  focus?: string;
  established?: string;
  city?: string;
  /** Optional logo — a minted CDN URL (live) or a /public path (bundled fallback). */
  logo?: string;
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** Card width and the gap that follows it — together, the pitch of one card. */
const CARD_W_PX = 280;
const CARD_GAP_PX = 12; // gap-3
const CARD_PITCH_PX = CARD_W_PX + CARD_GAP_PX;

/** Travel speed, px/s. Slow enough to read a card as it passes. */
const SPEED_PX_PER_S = 42;

/** Widest viewport a track has to out-measure (the rows are full-bleed). */
const MAX_VIEWPORT_PX = 1920;

// ---------------------------------------------------------------------------
// Bits
// ---------------------------------------------------------------------------

/** First letter of up to two significant words, e.g. "St. John's Medical College" → "SJ". */
function monogram(name: string): string {
  return name
    .replace(/[^A-Za-z ]/g, " ")
    .split(" ")
    .filter((word) => word.length > 1)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join("");
}

function PinIcon() {
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
      className="h-3.5 w-3.5 text-chart-1"
    >
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

/**
 * Horizontal card: logo chip on the LEFT, text stacked on the right. Fixed width, because
 * the cards ride a marquee track — an even pitch is what lets the loop shift by an exact
 * copy width, and it keeps the two rows in step with each other.
 */
function CollegeCard({ college }: { college: CollegeCardItem }) {
  return (
    <li className="flex w-[280px] shrink-0 items-center gap-3 rounded-xl border border-border bg-card p-3 shadow-sm transition-colors duration-[150ms] hover:border-chart-3/50">
      <span
        aria-hidden="true"
        className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-chart-3/10 ring-1 ring-inset ring-chart-3/15"
      >
        {college.logo ? (
          <img
            src={college.logo}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-contain p-1"
          />
        ) : (
          <span className="text-xs font-bold tracking-tight text-chart-3">
            {monogram(college.name)}
          </span>
        )}
      </span>

      <div className="min-w-0 flex-1">
        <h3 className="truncate text-[13px] font-semibold leading-snug text-fg" title={college.name}>
          {college.name}
        </h3>
        {college.focus ? (
          <p className="truncate text-[11px] leading-snug text-chart-3" title={college.focus}>
            {college.focus}
          </p>
        ) : null}
        {college.established || college.city ? (
          <p className="mt-0.5 flex items-center gap-2 text-[10px] text-fg-subtle">
            {college.established ? <span>Est. {college.established}</span> : null}
            {college.city ? (
              <span className="inline-flex min-w-0 items-center gap-0.5">
                <PinIcon />
                <span className="truncate">{college.city}</span>
              </span>
            ) : null}
          </p>
        ) : null}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

/**
 * One scrolling row. The track holds `copies` identical lists and the CSS shifts it left
 * by exactly ONE list width, so copy 2 lands where copy 1 started and the loop has no
 * seam. `copies` is at least 2, and more for a short list — the track must stay wider
 * than the viewport plus one copy or a gap would open at the tail of the loop.
 */
function MarqueeRow({
  items,
  reverse = false,
  testId,
}: {
  items: CollegeCardItem[];
  reverse?: boolean;
  testId?: string;
}) {
  const copyWidthPx = items.length * CARD_PITCH_PX;
  const copies = Math.max(2, Math.ceil(MAX_VIEWPORT_PX / copyWidthPx) + 1);
  const durationS = Math.max(20, Math.round(copyWidthPx / SPEED_PX_PER_S));

  return (
    <div className="college-marquee relative overflow-hidden py-1">
      <div
        className="college-marquee-track flex w-max"
        data-direction={reverse ? "reverse" : "forward"}
        style={
          {
            "--marquee-shift": `calc(-100% / ${copies})`,
            "--marquee-duration": `${durationS}s`,
          } as CSSProperties
        }
      >
        {Array.from({ length: copies }, (_, copy) => (
          // Only the first copy is real content; the rest exist purely to feed the loop.
          <ul
            key={copy}
            role="list"
            aria-hidden={copy > 0 || undefined}
            className="flex shrink-0 gap-3 pr-3"
            data-testid={copy === 0 ? testId : undefined}
          >
            {items.map((college) => (
              <CollegeCard key={college.name} college={college} />
            ))}
          </ul>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Marquee
// ---------------------------------------------------------------------------

export function CollegeMarquee({ colleges }: { colleges: CollegeCardItem[] }) {
  if (colleges.length === 0) return null;

  // Deal the list alternately into two rows so both stay the same length (±1) and the
  // pair reads as one shuffled set rather than "first half" over "second half".
  const topRow = colleges.filter((_, i) => i % 2 === 0);
  const bottomRow = colleges.filter((_, i) => i % 2 === 1);

  return (
    <div className="space-y-3" data-testid="college-marquee">
      <MarqueeRow items={topRow} testId="college-marquee-row-1" />
      {bottomRow.length > 0 ? (
        <MarqueeRow items={bottomRow} reverse testId="college-marquee-row-2" />
      ) : null}
    </div>
  );
}
