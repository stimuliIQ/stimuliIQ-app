/**
 * HeroMotif — decorative animated backgrounds for `hero` blocks that carry no
 * `backgroundImageKey`, which is why /about and /for-colleges read as empty white
 * bands today.
 *
 *   - `campus-network` (/for-colleges) — a constellation of campus nodes joined by
 *                                        animated links, standing for student groups
 *                                        collaborating across institutions.
 *
 * /about does NOT use a hero motif. It gets `BrandMarkBand` (also exported here): the
 * logo centred in a band of its own ABOVE the copy, with halo rings pulsing out around
 * it. Every attempt to keep the logo inside the hero put letterforms under the h1, where
 * they read as a rendering fault rather than as a brand mark.
 *
 * Pure CSS + inline SVG, plus the existing 18 KB logo PNG for the band. No video
 * or GIF: the site's CSP admits only same-origin and *.stimuliiq.com media, the CDN
 * base is currently unset, and a full-bleed decorative video would dominate the page
 * weight of a mostly-text hero.
 *
 * A CMS-uploaded `backgroundImageKey` always wins — HeroBlock only reaches for a motif
 * when no background image is set, so staff can override any of this from the CRM
 * without a deploy.
 *
 * Server component. Entirely `aria-hidden` — nothing here carries meaning that isn't
 * already in the hero's own headline and subheadline. Motion is neutralised for
 * prefers-reduced-motion users by the global rule in @repo/ui/styles.css.
 */
import Image from "next/image";

export type HeroMotifKind = "campus-network";

/** Slug → motif. Pages absent from this map keep the plain background they have today.
 *
 * EMPTY on purpose (user decision, 2026-07-29): the `campus-network` constellation on
 * /for-colleges read as visual noise over the hero copy, so no page currently opts in.
 * The motif implementation below is kept so a page can be re-mapped with one line. */
const MOTIF_BY_SLUG: Record<string, HeroMotifKind> = {};

export function heroMotifForSlug(slug: string | undefined): HeroMotifKind | undefined {
  return slug ? MOTIF_BY_SLUG[slug] : undefined;
}

/** Slugs whose hero is preceded by the standalone `BrandMarkBand`. */
const BRAND_MARK_BAND_SLUGS = new Set(["about"]);

export function showsBrandMarkBand(slug: string | undefined): boolean {
  return slug != null && BRAND_MARK_BAND_SLUGS.has(slug);
}

// ---------------------------------------------------------------------------
// Shared colour field
// ---------------------------------------------------------------------------

/**
 * Two slow-drifting blurred blobs in brand tints. Deliberately low-opacity: the hero's
 * headline sits on top at `text-fg`, and the contrast ratio has to survive the brightest
 * frame of the drift, not just the resting one.
 */
function AuroraField() {
  return (
    <>
      <span className="animate-aurora absolute -left-[15%] -top-[30%] h-[70%] w-[60%] rounded-full bg-brand-100 opacity-60 blur-3xl" />
      <span
        className="animate-aurora absolute -right-[10%] top-[10%] h-[80%] w-[55%] rounded-full bg-brand-50 opacity-80 blur-3xl"
        style={{ animationDelay: "-9s", animationDuration: "24s" }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Brand-mark band (/about)
// ---------------------------------------------------------------------------

/**
 * Concentric halo rings, inside → outside. `size` is a CSS length (vmin keeps the set
 * proportional on any viewport); alpha and border weight taper outward so the set reads
 * as a glow fading into the page, not a target. Delays put the rings out of phase — the
 * whole set is never at max or min scale on the same frame, which is what makes the
 * breathing look organic instead of mechanical.
 */
const HALO_RINGS = [
  { size: "42vmin", alpha: 0.35, border: "1.5px", delay: 0 },
  { size: "60vmin", alpha: 0.22, border: "1.25px", delay: -2.7 },
  { size: "80vmin", alpha: 0.14, border: "1px", delay: -5.4 },
  { size: "102vmin", alpha: 0.08, border: "1px", delay: -8.1 },
];

/**
 * BrandMarkBand — the About page's opening band: a near-full-viewport (80–90vh) stage
 * with the logo centred on its own and concentric rings breathing around it — a slow
 * scale-up/scale-down, not the expand-and-fade radar pulse of `pulse-ring`. The page
 * copy starts in the section BELOW this, so nothing ever sits on the mark.
 *
 * Earlier revisions ran the logo as a watermark inside the hero (opacity .07, then .035,
 * then bottom-anchored and half-cropped). At every setting the letterforms stayed legible
 * straight through the h1 and read as a rendering fault. Giving it a band of its own is
 * what fixes it, and it means the mark no longer has to hide at 6%.
 *
 * Negative animation delays on the rings are load-bearing: a positive delay would hold
 * every ring frozen at scale(1) for its first N seconds on page load — negative ones
 * start each ring mid-cycle, already out of phase.
 *
 * Rendered on the About page by both paths — `PageBlocks` injects it ahead of the hero
 * block (see `showsBrandMarkBand`), and `AboutPageFallback` places it inline.
 *
 * Decorative, hence `aria-hidden`: "Stimuli IQ" is already the h1's subject and the site
 * header's logo carries the accessible name.
 */
export function BrandMarkBand(): React.JSX.Element {
  return (
    <div
      aria-hidden="true"
      // `svh` not `vh`: on mobile, 100vh includes the browser chrome, so an 80vh band
      // plus the sticky header would overflow the first screen and push the halo off
      // centre. No `border-b`: the band flows straight into the hero below it — the
      // aurora/halo already fades out at the bottom, so a hairline only added a seam.
      className="pointer-events-none relative flex min-h-[80svh] select-none items-center justify-center overflow-hidden bg-bg px-4 md:min-h-[86svh]"
    >
      <AuroraField />

      {/* Soft radial glow directly behind the mark, so the logo sits in a pool of light
          rather than flat on the page. */}
      <span className="absolute left-1/2 top-1/2 h-[52vmin] w-[52vmin] -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-100/50 blur-3xl" />

      {/* No translate utilities on the rings — `animate-ring-breathe` carries the
          centring offset in its own keyframe, and an animated `transform` replaces any
          it finds on the same element (see globals.css). */}
      {HALO_RINGS.map((ring) => (
        <span
          key={ring.size}
          className="animate-ring-breathe absolute left-1/2 top-1/2 rounded-full"
          style={{
            width: ring.size,
            height: ring.size,
            border: `${ring.border} solid rgb(var(--brand-500) / ${ring.alpha})`,
            animationDelay: `${ring.delay}s`,
          }}
        />
      ))}

      <Image
        src="/stimuliiq-logo.png"
        alt=""
        width={1506}
        height={355}
        priority
        className="animate-logo-breathe relative h-auto w-[min(60vw,360px)]"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// campus-network (/for-colleges)
// ---------------------------------------------------------------------------

/**
 * Node positions as viewBox percentages. Hand-placed rather than generated: they sit
 * clear of the centred headline column (roughly x 32–68) so the constellation frames
 * the copy instead of running underneath it.
 */
const NODES = [
  { x: 12, y: 26, size: 18 },
  { x: 24, y: 62, size: 12 },
  { x: 8, y: 76, size: 14 },
  { x: 30, y: 16, size: 10 },
  { x: 88, y: 30, size: 18 },
  { x: 76, y: 66, size: 12 },
  { x: 92, y: 74, size: 14 },
  { x: 70, y: 18, size: 10 },
];

/** Which nodes are joined. Indices into NODES; kept sparse so it reads as a network. */
const LINKS: Array<[number, number]> = [
  [0, 1],
  [0, 3],
  [1, 2],
  [4, 5],
  [4, 7],
  [5, 6],
  [3, 7],
];

function CampusNetworkMotif() {
  return (
    <>
      <AuroraField />
      {/* Links only. `preserveAspectRatio="none"` stretches the 100×100 viewBox across
          the hero's real (very wide) box — harmless for straight lines, which is exactly
          why the NODES are NOT drawn here: circles in this viewBox come out as ellipses.
          They're rendered below as round, px-sized divs at the same percentages. */}
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full"
      >
        {LINKS.map(([a, b], i) => {
          const from = NODES[a]!;
          const to = NODES[b]!;
          return (
            <line
              key={`${a}-${b}`}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke="rgb(var(--brand-500) / 0.28)"
              strokeWidth="0.35"
              vectorEffect="non-scaling-stroke"
              className="animate-link-flow"
              // Staggered so signals travel the network out of phase rather than
              // all pulsing on the same beat.
              style={{ animationDelay: `${i * 0.35}s` }}
            />
          );
        })}
      </svg>

      {NODES.map((n, i) => (
        <span
          key={`${n.x}-${n.y}`}
          className="absolute -translate-x-1/2 -translate-y-1/2"
          style={{ left: `${n.x}%`, top: `${n.y}%` }}
        >
          <span
            className="animate-pulse-ring absolute left-1/2 top-1/2 rounded-full bg-brand-500/15"
            style={{ width: n.size, height: n.size, animationDelay: `${i * 0.45}s` }}
          />
          <span
            className="block rounded-full bg-brand-500/45"
            style={{ width: n.size * 0.42, height: n.size * 0.42 }}
          />
        </span>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

export function HeroMotif({ kind }: { kind: HeroMotifKind }): React.JSX.Element {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      {kind === "campus-network" ? <CampusNetworkMotif /> : null}
    </div>
  );
}

HeroMotif.displayName = "HeroMotif";
