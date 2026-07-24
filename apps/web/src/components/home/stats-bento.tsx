/**
 * StatsBento — homepage "by the numbers" section (section 2): a full-width,
 * light "premium" band. A dot-matrix world map sits behind a centered heading
 * and a single row of stats (icon chip, oversized figure, label, supporting
 * line), divided by hairlines — no cards/boxes, letting the map read through.
 *
 * Metrics are deliberately internship-focused — Students trained · Programs ·
 * Cities. There is NO "placement rate": StimuliiQ is a hands-on internship
 * training program, not a placement service, so a placement stat would
 * misrepresent it.
 *
 * VISUAL SYSTEM (docs/07-design-system.md): stays on the site's black-and-white
 * brand — white band, dark text — lifted with a single restrained accent
 * (chart-3, teal/green) reused across the map dots, icon chips, and figures,
 * rather than the previous per-card rainbow. Colour is decorative only and
 * never the sole carrier of meaning (icon + label + figure always present).
 *
 * The figures count up from 0 when scrolled into view (CountUp island); the
 * final value is server-rendered for SEO / no-JS / reduced-motion.
 *
 * Server component (static marketing figures live in the HTML for SEO). a11y:
 * <dl>/<dt>/<dd> so the figure↔caption pairing is programmatic; tabular figures;
 * heading hierarchy under the hero's <h1>; decorative map/icons hidden.
 */

import { CountUp } from "./count-up";
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
  /** Small caption above the figure (e.g. "Students trained"). */
  label: string;
  /** The oversized figure, pre-formatted (e.g. "15,000+"). */
  value: string;
  /** One-line supporting sentence. */
  description: string;
  icon: React.ReactNode;
}

const STATS: Stat[] = [
  {
    label: "Students trained",
    value: "15,000+",
    description: "Learners upskilled through project-based internship programs across India.",
    icon: <GraduationCapIcon />,
  },
  {
    label: "Programs",
    value: "30+",
    description: "Hands-on internship tracks spanning web, data, cloud, AI, and more.",
    icon: <StackIcon />,
  },
  {
    label: "Cities",
    value: "50+",
    description: "Students joining from campuses in every corner of the country.",
    icon: <MapPinIcon />,
  },
];

export function StatsBento() {
  return (
    <section
      aria-label="StimuliiQ by the numbers"
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
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-fg-muted">By the numbers</p>
          <h2 className="mt-3 font-display text-3xl font-bold tracking-tight text-fg md:text-4xl">
            A hands-on <span className="text-chart-3">internship program</span>, trusted across India
          </h2>
        </div>

        <dl className="grid grid-cols-1 divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {STATS.map((stat) => (
            <div key={stat.label} className="flex flex-col items-center gap-3 px-6 py-10 text-center first:pt-0 last:pb-0 sm:py-0">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-chart-3/10 text-chart-3">
                {stat.icon}
              </span>
              <dd className="font-display text-5xl font-bold tabular-nums leading-none text-fg lg:text-6xl">
                <CountUp value={stat.value} />
              </dd>
              <dt className="text-sm font-medium uppercase tracking-wider text-fg-muted">{stat.label}</dt>
              <p className="max-w-[16rem] text-sm text-fg-muted">{stat.description}</p>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
