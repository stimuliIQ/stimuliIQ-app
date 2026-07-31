/**
 * CollegeCollageMotif — the /for-colleges hero backdrop: a staggered masonry band of
 * partner-college logo cards hanging from the top of the section, with the headline sitting
 * in clean space beneath it.
 *
 * MATCHES THE REFERENCE COMPOSITION, which is specific and worth stating because two
 * earlier passes got it wrong:
 *   - Cards occupy a BAND ACROSS THE TOP only. They do not ring the copy and they do not
 *     appear below it; the bottom half of the section is deliberately empty page.
 *   - Cards are PORTRAIT and AXIS-ALIGNED. An earlier pass tilted them, which reads as a
 *     scrapbook rather than the reference's calm grid.
 *   - Columns are on a fixed pitch; only the vertical offset and height vary. That stagger
 *     is the entire effect — random scatter loses it.
 *   - A row of blank cards is cut off by the top edge, so the band reads as continuing
 *     upward out of frame rather than as a row that happens to start there.
 *
 * LIMITED SET: 13 logo cards, not the full 27-logo sheet. The reference's density comes
 * from stagger and pitch, not volume; every extra card past this flattens the composition
 * into wallpaper.
 *
 * DATA: the BUNDLED logo sheet (`BUNDLED_COLLEGE_LOGOS`), not the live CRM partner list.
 * A decorative layer must not blank out when the API is down, and CRM-uploaded logos are
 * served through the asset CDN, which is unset in production today (those URLs 404). The
 * live, named list still drives the marquee section further down the page. This is
 * wallpaper, and it is `aria-hidden`.
 *
 * LEGIBILITY: the band fades to nothing at its lower edge via a linear mask, so no card
 * ever reaches the headline. The hero adds matching top padding for this motif (see
 * `hero-block.tsx`) to reserve the band's height.
 *
 * DETERMINISTIC: positions are hand-placed constants, never `Math.random()` — a random
 * layout would differ between server and client renders and hydrate-mismatch.
 *
 * Server Component. No motion: the reference is static, and a drifting logo field behind an
 * h1 is exactly the noise the previous `campus-network` motif was removed for.
 */
import Image from "next/image";
import { BUNDLED_COLLEGE_LOGOS } from "../../lib/college-logos";

/**
 * One card. `x` is the column centre as a percentage of width; `top` and `h` are multiples
 * of the card width (`--card`), so the whole band scales as one unit with the viewport.
 *
 * `dense` cards drop below `md`: a phone is a third of the width, and all nine columns
 * collapse into an unreadable smear. Five columns survive, keeping the stagger legible.
 */
interface Card {
  x: number;
  top: number;
  h: number;
  dense?: boolean;
}

/**
 * 14 columns on a fixed 7.15% pitch. Columns alternate between a high and a low pair so
 * neighbours never line up — that offset IS the masonry effect.
 *
 * The centre column carries a single card: the reference thins out directly above the
 * headline, and a full pair there closes the gap the copy needs.
 *
 * Card count is 13 x 2 + 1 = 27, exactly the bundled logo sheet, so every partner college
 * appears once and none repeats.
 */
const COLUMNS: Array<{ x: number; tops: number[]; dense?: boolean }> = [
  // The five columns that SURVIVE below `md` (3.5 / 24.9 / 46.4 / 67.8 / 89.3) are spaced
  // evenly ~21% apart on purpose. Keeping an arbitrary subset left a cluster at each edge
  // and a hole through the middle of the phone layout.
  { x: 3.5, tops: [0.9, 2.25] },
  { x: 10.6, tops: [0.45, 1.8], dense: true },
  { x: 17.8, tops: [0.95, 2.3], dense: true },
  { x: 24.9, tops: [0.4, 1.75] },
  { x: 32.1, tops: [0.9, 2.25], dense: true },
  { x: 39.2, tops: [0.45, 1.8], dense: true },
  { x: 46.4, tops: [0.9] },
  { x: 53.5, tops: [0.45, 1.8], dense: true },
  { x: 60.7, tops: [0.95, 2.3], dense: true },
  { x: 67.8, tops: [0.4, 1.75] },
  { x: 75.0, tops: [0.9, 2.25], dense: true },
  { x: 82.1, tops: [0.45, 1.8], dense: true },
  { x: 89.3, tops: [0.95, 2.3] },
  { x: 96.4, tops: [0.4, 1.75], dense: true },
];

/** Height varies on a short cycle so the band never reads as a uniform grid. */
const HEIGHT_CYCLE = [1.15, 1.25, 1.1, 1.2];

const CARDS: Card[] = COLUMNS.flatMap((col) =>
  col.tops.map((top, i) => ({
    x: col.x,
    top,
    h: HEIGHT_CYCLE[(Math.round(col.x) + i) % HEIGHT_CYCLE.length]!,
    dense: col.dense,
  })),
);

/**
 * The half-cut blank row along the very top edge. Empty on purpose — these are the
 * reference's pale placeholder cards, and giving them logos would double the logo count
 * while making the top edge busier than the band beneath it.
 */
const TOP_STUBS = [7, 21.4, 35.7, 50, 64.3, 78.6, 93];

/**
 * Faint dashed verticals descending between columns, as in the reference. Purely a texture
 * cue that the band continues downward; they sit under the cards and fade with the mask.
 */
const GUIDE_LINES = [14.2, 50, 85.8];

/** Fades the band out before it can reach the headline. */
const BAND_FADE = "linear-gradient(to bottom, #000 0%, #000 62%, rgba(0,0,0,0.25) 84%, transparent 100%)";

export function CollegeCollageMotif(): React.JSX.Element {
  return (
    <div
      aria-hidden="true"
      // Height is driven by the tallest column (top 2.25 + h 1.4 ≈ 3.7 cards) plus fade
      // headroom, expressed in the same `--card` unit so band and cards scale together.
      className="pointer-events-none absolute inset-x-0 top-0 select-none overflow-hidden"
      style={{
        // Sized off the 7.15% column pitch so neighbouring cards sit a hair apart rather
        // than touching: 14 columns across the full width is a tighter grid than the 9 the
        // band carried before, so the card itself has to come down with it.
        ["--card" as string]: "clamp(46px, 6.05vw, 90px)",
        height: "calc(var(--card) * 4.3)",
        WebkitMaskImage: BAND_FADE,
        maskImage: BAND_FADE,
      }}
    >
      {GUIDE_LINES.map((x) => (
        <span
          key={`guide-${x}`}
          className="absolute top-0 h-full border-l border-dashed border-border/40"
          style={{ left: `${x}%` }}
        />
      ))}

      {TOP_STUBS.map((x, i) => (
        <span
          key={`stub-${x}`}
          className={`absolute -translate-x-1/2 rounded-2xl bg-surface ${i % 2 === 0 ? "hidden md:block" : ""}`}
          style={{
            left: `${x}%`,
            // Negative top: the card is cut by the section's edge rather than tucked under it.
            top: "calc(var(--card) * -0.42)",
            width: "var(--card)",
            height: "calc(var(--card) * 0.85)",
          }}
        />
      ))}

      {CARDS.map((card, i) => {
        const src = BUNDLED_COLLEGE_LOGOS[i % BUNDLED_COLLEGE_LOGOS.length];
        if (!src) return null;
        return (
          <span
            key={src}
            className={`absolute -translate-x-1/2 overflow-hidden rounded-2xl border border-border bg-card p-3 shadow-sm ${
              card.dense ? "hidden md:flex" : "flex"
            } items-center justify-center`}
            style={{
              left: `${card.x}%`,
              top: `calc(var(--card) * ${card.top})`,
              width: "var(--card)",
              height: `calc(var(--card) * ${card.h})`,
            }}
          >
            <Image
              src={src}
              alt=""
              width={108}
              height={108}
              // Decorative and above the fold: `priority` would contend with the LCP
              // headline for bandwidth, and lazy would pop in after paint. Plain eager.
              sizes="108px"
              className="h-full w-full object-contain"
            />
          </span>
        );
      })}
    </div>
  );
}

CollegeCollageMotif.displayName = "CollegeCollageMotif";
