/**
 * WhyUsVisual — the animated centre panel of the "Why Stimuli IQ?" band
 * (components/home/why-us.tsx), replacing the static team portrait.
 *
 * Entirely CSS + inline SVG: no video, no GIF, no external request. That matters
 * here for three reasons — the site's CSP only allows same-origin and *.stimuliiq.com
 * media, the CDN base is currently unset, and a portrait-shaped hero video would be
 * the heaviest asset on the homepage for something purely decorative.
 *
 * Composition (back to front):
 *   1. brand gradient field + two drifting aurora blobs
 *   2. expanding "vitals" rings behind the mark
 *   3. a caduceus-free medical mark (heart + pulse) that holds the centre
 *   4. an ECG trace that strokes itself across the lower third
 *   5. three floating credential chips naming what the band is about
 *
 * Server component — all static markup, no client JS, SEO-neutral.
 *
 * a11y: the whole panel is decorative (`aria-hidden`), so the chips' text is NOT
 * an accessible label for anything — every claim they make is also stated in the
 * four surrounding cards, which are real content. Motion respects
 * prefers-reduced-motion via the global rule in @repo/ui/styles.css.
 */

/** Path length of the ECG trace below, used to seed the dash animation. */
const TRACE_LEN = 620;

function PulseRings() {
  // Three rings on the same keyframe, staggered by a third of its duration each,
  // so one is always mid-expansion — a continuous pulse rather than a triple blink.
  return (
    <>
      {[0, 1.2, 2.4].map((delay) => (
        <span
          key={delay}
          className="animate-pulse-ring absolute left-1/2 top-1/2 h-32 w-32 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/50"
          style={{ animationDelay: `${delay}s` }}
        />
      ))}
    </>
  );
}

function HeartMark() {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="animate-logo-breathe relative h-20 w-20 text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.25)]"
    >
      <path d="M32 54S8 40 8 24a13 13 0 0 1 24-7 13 13 0 0 1 24 7c0 16-24 30-24 30Z" />
      <path d="M14 30h10l4-7 6 14 4-7h12" />
    </svg>
  );
}

function EcgTrace() {
  return (
    <svg
      viewBox="0 0 320 90"
      fill="none"
      preserveAspectRatio="none"
      className="h-full w-full"
    >
      {/* Resting baseline so the strip never reads as blank between sweeps. */}
      <path d="M0 45h320" stroke="rgb(255 255 255 / 0.18)" strokeWidth="1.5" />
      <path
        d="M0 45h64l10-26 12 52 11-40 9 14h30l10-20 12 40 11-30 9 12h142"
        stroke="rgb(255 255 255 / 0.95)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="animate-trace"
        style={{
          // `--trace-len` drives the keyframe; dasharray must match it so exactly
          // one copy of the stroke is drawn per cycle.
          ["--trace-len" as string]: `${TRACE_LEN}`,
          strokeDasharray: TRACE_LEN,
        }}
      />
    </svg>
  );
}

/**
 * Chip placement is hand-tuned to clear the centre mark, which sits at top 44%. The
 * middle chip sits ABOVE it (26%), not beside it — at 38% it collided with the heart
 * glyph's right edge and the two read as one smudged shape.
 */
const CHIPS = [
  { label: "Live mentors", top: "11%", side: "left-4", delay: "0s" },
  { label: "Real case work", top: "26%", side: "right-4", delay: "1.6s" },
  { label: "Verified certificate", top: "66%", side: "left-6", delay: "3.1s" },
];

export function WhyUsVisual() {
  return (
    <div
      aria-hidden="true"
      // Same aspect as the portrait it replaces, so the band's row height and the
      // stretch of the flanking cards are unchanged.
      className="relative aspect-[941/1672] overflow-hidden rounded-2xl bg-brand-600"
    >
      {/* 1. Drifting colour field */}
      <span className="animate-aurora absolute -left-1/4 top-[8%] h-1/2 w-[130%] rounded-full bg-brand-500 opacity-70 blur-3xl" />
      <span
        className="animate-aurora absolute -right-1/3 bottom-[6%] h-1/2 w-[130%] rounded-full bg-chart-3 opacity-50 blur-3xl"
        style={{ animationDelay: "-7s", animationDuration: "23s" }}
      />

      {/* 2 + 3. Rings and mark, held at the optical centre of the panel */}
      <div className="absolute left-1/2 top-[44%] flex -translate-x-1/2 -translate-y-1/2 items-center justify-center">
        <PulseRings />
        <HeartMark />
      </div>

      {/* 4. ECG strip across the lower third */}
      <div className="absolute inset-x-0 bottom-[16%] h-[90px] px-6">
        <EcgTrace />
      </div>

      {/* 5. Floating credential chips */}
      {CHIPS.map((chip) => (
        <span
          key={chip.label}
          className={`animate-float-soft absolute ${chip.side} rounded-full border border-white/25 bg-white/15 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur-sm`}
          style={{ top: chip.top, animationDelay: chip.delay }}
        >
          {chip.label}
        </span>
      ))}
    </div>
  );
}

WhyUsVisual.displayName = "WhyUsVisual";
