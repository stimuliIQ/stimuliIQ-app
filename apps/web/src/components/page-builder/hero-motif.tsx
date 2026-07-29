/**
 * HeroMotif — decorative animated backgrounds for `hero` blocks that carry no
 * `backgroundImageKey`, which is why /about and /for-colleges read as empty white
 * bands today.
 *
 * Two motifs, chosen by page:
 *   - `brand-mark`     (/about)        — the StimuliiQ logo breathing inside expanding
 *                                        rings over a drifting brand colour field.
 *   - `campus-network` (/for-colleges) — a constellation of campus nodes joined by
 *                                        animated links, standing for student groups
 *                                        collaborating across institutions.
 *
 * Pure CSS + inline SVG, plus the existing 18 KB logo PNG for `brand-mark`. No video
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

export type HeroMotifKind = "brand-mark" | "campus-network";

/** Slug → motif. Pages absent from this map keep the plain background they have today. */
const MOTIF_BY_SLUG: Record<string, HeroMotifKind> = {
  about: "brand-mark",
  "for-colleges": "campus-network",
};

export function heroMotifForSlug(slug: string | undefined): HeroMotifKind | undefined {
  return slug ? MOTIF_BY_SLUG[slug] : undefined;
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
// brand-mark (/about)
// ---------------------------------------------------------------------------

function BrandMarkMotif() {
  return (
    <>
      <AuroraField />
      {/* Rings + logo, parked behind the centred headline column. Sized in vmin-ish
          terms via percentage so it scales with the hero rather than the viewport. */}
      <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center">
        {[0, 1.3, 2.6].map((delay) => (
          <span
            key={delay}
            className="animate-pulse-ring absolute h-56 w-56 rounded-full border border-brand-500/25"
            style={{ animationDelay: `${delay}s` }}
          />
        ))}
        <Image
          src="/stimuliiq-logo.png"
          alt=""
          width={1506}
          height={355}
          // opacity-[0.07]: the logo is a watermark behind body copy, so it has to
          // stay well under the text it sits beneath. Any higher and the wordmark
          // competes with the h1 directly on top of it.
          className="animate-logo-breathe h-auto w-[min(60vw,520px)] opacity-[0.07]"
        />
      </div>
    </>
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
  { x: 12, y: 26, r: 5 },
  { x: 24, y: 62, r: 3.5 },
  { x: 8, y: 76, r: 4 },
  { x: 30, y: 16, r: 3 },
  { x: 88, y: 30, r: 5 },
  { x: 76, y: 66, r: 3.5 },
  { x: 92, y: 74, r: 4 },
  { x: 70, y: 18, r: 3 },
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
              className="animate-link-flow"
              // Staggered so signals travel the network out of phase rather than
              // all pulsing on the same beat.
              style={{ animationDelay: `${i * 0.35}s` }}
            />
          );
        })}
        {NODES.map((n, i) => (
          <g key={`${n.x}-${n.y}`}>
            <circle
              cx={n.x}
              cy={n.y}
              r={n.r}
              fill="rgb(var(--brand-500) / 0.10)"
              className="animate-pulse-ring"
              style={{ animationDelay: `${i * 0.45}s`, transformOrigin: `${n.x}% ${n.y}%` }}
            />
            <circle cx={n.x} cy={n.y} r={n.r * 0.42} fill="rgb(var(--brand-500) / 0.45)" />
          </g>
        ))}
      </svg>
    </>
  );
}

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

export function HeroMotif({ kind }: { kind: HeroMotifKind }): React.JSX.Element {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      {kind === "brand-mark" ? <BrandMarkMotif /> : <CampusNetworkMotif />}
    </div>
  );
}

HeroMotif.displayName = "HeroMotif";
