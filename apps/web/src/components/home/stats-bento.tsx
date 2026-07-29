/**
 * StatsBento — homepage "at a glance" section (section 2): a full-width,
 * light "premium" band. A dot-matrix world map sits behind a centered heading
 * and a single row of pillars (icon chip, bold label, supporting line),
 * divided by hairlines — no cards/boxes, letting the map read through.
 *
 * Pillars are deliberately training-focused — Students trained · Programs ·
 * Cities. There are NO numeric figures ("15,000+", "placement rate", etc.):
 * unverifiable stats are a credibility risk, so figures only return here once
 * real, defensible numbers exist to back them.
 *
 * VISUAL SYSTEM (docs/07-design-system.md): stays on the site's black-and-white
 * brand — white band, dark text — lifted with a single restrained accent
 * (chart-3, teal/green) reused across the map dots, icon chips, and figures,
 * rather than the previous per-card rainbow. Colour is decorative only and
 * never the sole carrier of meaning (icon + label + figure always present).
 *
 * Server component (static marketing copy lives in the HTML for SEO). a11y:
 * h2 + h3 hierarchy under the hero's <h1>; decorative map/icons hidden.
 */

import { WorldMapDots } from "./world-map-dots";

// ---------------------------------------------------------------------------
// Icons (inline SVG, stroke = currentColor — matches WhyUsSection's approach so
// apps/web keeps no direct lucide-react dependency)
// ---------------------------------------------------------------------------

function GraduationCapIcon() {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-6 w-6"
    >
      <path d="M22 10 12 5 2 10l10 5 10-5Z" />
      <path d="M6 12v5c0 1 2.5 2.5 6 2.5s6-1.5 6-2.5v-5" />
      <path d="M22 10v6" />
    </svg>
  );
}

function StackIcon() {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-6 w-6"
    >
      <path d="m12 3 9 5-9 5-9-5 9-5Z" />
      <path d="m3 13 9 5 9-5" />
      <path d="m3 17 9 5 9-5" />
    </svg>
  );
}

function MapPinIcon() {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-6 w-6"
    >
      <path d="M20 10c0 5.5-8 12-8 12s-8-6.5-8-12a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

interface Stat {
  /** Bold pillar label (e.g. "Students trained"). */
  label: string;
  /** One-line supporting sentence. */
  description: string;
  icon: React.ReactNode;
}

const STATS: Stat[] = [
  {
    label: "Students trained",
    description: "Medical and psychology students trained through structured, mentor-led programs across India.",
    icon: <GraduationCapIcon />,
  },
  {
    label: "Programs",
    description: "Hands-on training and internship tracks spanning psychology, clinical practice, and allied healthcare.",
    icon: <StackIcon />,
  },
  {
    label: "Cities",
    description: "Students join us from medical, dental, nursing, and pharmacy campuses across the country.",
    icon: <MapPinIcon />,
  },
];

export function StatsBento() {
  return (
    <section
      aria-label="StimuliiQ at a glance"
      data-testid="homepage-stats"
      className="relative overflow-hidden bg-bg py-20 lg:py-28"
    >
      {/* Decorative dot-matrix world map, faded out toward the section edges */}
      <WorldMapDots
        className="pointer-events-none absolute inset-0 mx-auto h-full w-full max-w-6xl text-chart-3/[0.16]"
        style={{
          maskImage:
            "radial-gradient(ellipse 70% 65% at 50% 45%, black 45%, transparent 90%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 70% 65% at 50% 45%, black 45%, transparent 90%)",
        }}
      />

      <div className="relative mx-auto max-w-screen-xl px-4 md:px-6">
        <div className="mx-auto mb-16 max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-fg-muted">At a glance</p>
          <h2 className="mt-3 font-display text-3xl font-bold tracking-tight text-fg md:text-4xl">
            A hands-on <span className="text-chart-3">healthcare training program</span>, trusted across India
          </h2>
        </div>

        <div className="grid grid-cols-1 divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {STATS.map((stat) => (
            <div key={stat.label} className="flex flex-col items-center gap-3 px-6 py-10 text-center first:pt-0 last:pb-0 sm:py-0">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-chart-3/10 text-chart-3">
                {stat.icon}
              </span>
              <h3 className="font-display text-xl font-bold uppercase tracking-wider text-fg">{stat.label}</h3>
              <p className="max-w-[16rem] text-sm text-fg-muted">{stat.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
