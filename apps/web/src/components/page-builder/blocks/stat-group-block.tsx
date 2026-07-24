/**
 * StatGroupBlock — page-builder block #3 (docs/specs/phase-10-page-builder.md
 * §"3. stat_group"). Three variants:
 *   - `bento`  — `stats-bento.tsx`'s 3-card asymmetric grid (exactly 3 items).
 *   - `band`   — a flat stat row (About's `StatBand`-style look, Scholarship's overlap band).
 *   - `bars`   — Scholarship's fund-distribution labeled progress-bar list.
 *
 * DEVIATION FROM SPEC TABLE (noted for design-system/db-architect): the spec's `band`
 * variant lists `@repo/ui`'s `StatBand` as the renderer, but `StatBand` requires a
 * NUMERIC `value` (it count-up-animates from 0). `StatItemSchema.value` here is
 * deliberately a STRING (spec #3: "audited data includes non-numeric formats — 'Up to
 * ₹1 Crore', '90%+', '15,000+'"), which `StatBand` cannot accept. This renders `band` as a
 * static (non-animated) `<dl>` row matching `StatBand`'s visual layout instead of reusing
 * the component directly — the count-up animation is not preserved for builder-authored
 * stat groups. `bars` similarly cannot compute a numeric proportional bar width from an
 * arbitrary formatted string; it best-effort-parses a leading numeric magnitude out of
 * `value` (falls back to an equal-width bar when unparseable) rather than requiring a
 * separate numeric field the spec doesn't define.
 */
import type { StatGroupBlockData } from "@repo/types";
import { BlockIcon } from "../icon-registry";
import { HighlightText } from "../highlight-text";

function SectionHeading({ heading }: { heading: StatGroupBlockData["heading"] }) {
  if (!heading) return null;
  return (
    <div className="mx-auto mb-12 max-w-2xl text-center">
      {heading.eyebrow ? <p className="text-xs font-semibold uppercase tracking-[0.2em] text-fg-muted">{heading.eyebrow}</p> : null}
      <h2 className="mt-3 font-display text-3xl font-bold tracking-tight text-fg md:text-4xl">
        <HighlightText text={heading.title} highlight={heading.titleHighlight} />
      </h2>
      {heading.subtitle ? <p className="mt-3 text-lg text-fg-muted">{heading.subtitle}</p> : null}
    </div>
  );
}

// Full literal class strings (Tailwind's JIT scanner needs static strings — a
// template-interpolated `bg-${accent}/12` class name is invisible to the scanner and
// never gets generated, so this is a lookup, not a computed class name).
const BENTO_ACCENT_CLASSES = [
  { chip: "flex h-12 w-12 items-center justify-center rounded-2xl bg-chart-2/12 text-chart-2" },
  { chip: "flex h-12 w-12 items-center justify-center rounded-2xl bg-chart-3/12 text-chart-3" },
] as const;

function BentoVariant({ data }: { data: StatGroupBlockData }) {
  const [feature, ...rest] = data.items;
  return (
    <dl className="grid grid-cols-1 gap-4 md:grid-cols-3 md:grid-rows-2">
      {feature ? (
        <div className="group relative flex flex-col justify-between overflow-hidden rounded-3xl bg-brand-500 p-8 text-brand-foreground transition-transform duration-slow ease-out hover:-translate-y-1 md:col-span-1 md:row-span-2">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 text-white/[0.05]"
            style={{ backgroundImage: "radial-gradient(currentColor 1px, transparent 1.5px)", backgroundSize: "18px 18px" }}
          />
          <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-16 h-52 w-52 rounded-full bg-chart-1/30 blur-3xl" />
          <div className="relative flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-chart-1/25 text-white ring-1 ring-inset ring-white/15">
              <BlockIcon iconKey={feature.iconKey} className="h-6 w-6" />
            </span>
            <dt className="text-sm font-medium uppercase tracking-wider text-brand-foreground/70">{feature.label}</dt>
          </div>
          <div className="relative mt-10">
            <dd className="font-display text-6xl font-bold tabular-nums leading-none lg:text-7xl">{feature.value}</dd>
            <span aria-hidden="true" className="mt-5 block h-1 w-14 rounded-full bg-chart-1" />
            {feature.description ? <p className="mt-4 max-w-xs text-sm text-brand-foreground/80">{feature.description}</p> : null}
          </div>
        </div>
      ) : null}

      {rest.map((stat, i) => {
        const accent = BENTO_ACCENT_CLASSES[i % BENTO_ACCENT_CLASSES.length]!;
        return (
          <div
            key={stat.label}
            className={`group relative flex flex-col overflow-hidden rounded-3xl p-8 transition-transform duration-slow ease-out hover:-translate-y-1 md:col-span-2 ${i === 0 ? "bg-surface" : "border border-border bg-card"}`}
          >
            <div className="relative flex items-center gap-3">
              <span className={accent.chip}>
                <BlockIcon iconKey={stat.iconKey} className="h-6 w-6" />
              </span>
              <dt className="text-sm font-medium uppercase tracking-wider text-fg-muted">{stat.label}</dt>
            </div>
            <dd className="relative mt-4 font-display text-5xl font-bold tabular-nums leading-none text-fg lg:text-6xl">{stat.value}</dd>
            {stat.description ? <p className="relative mt-4 max-w-md text-sm text-fg-muted">{stat.description}</p> : null}
          </div>
        );
      })}
    </dl>
  );
}

function BandVariant({ data }: { data: StatGroupBlockData }) {
  return (
    <dl
      data-testid="page-builder-stat-band"
      className="relative z-10 grid grid-cols-1 divide-y divide-border rounded-2xl border border-border bg-card shadow-lg sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4"
    >
      {data.items.map((stat) => (
        <div key={stat.label} className="flex flex-col gap-1 p-8 text-center">
          <dt className="order-2 text-sm text-fg-muted">{stat.label}</dt>
          <dd className="order-1 text-3xl font-bold text-brand-600 lg:text-4xl">{stat.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Best-effort numeric magnitude for the `bars` variant's proportional width — see file doc. */
function parseMagnitude(value: string): number {
  const match = value.replace(/,/g, "").match(/[\d.]+/);
  const n = match ? parseFloat(match[0]!) : NaN;
  return Number.isFinite(n) ? n : 0;
}

function BarsVariant({ data }: { data: StatGroupBlockData }) {
  const magnitudes = data.items.map((item) => parseMagnitude(item.value));
  const max = Math.max(...magnitudes, 1);
  return (
    <div className="mx-auto max-w-2xl rounded-xl border border-border bg-card p-6 shadow-sm">
      <ul role="list" className="flex flex-col gap-5">
        {data.items.map((item, i) => {
          const widthPct = magnitudes[i]! > 0 ? (magnitudes[i]! / max) * 100 : 50;
          return (
            <li key={item.label}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium text-fg">{item.label}</span>
                <span className="text-sm font-semibold text-brand-600">{item.value}</span>
              </div>
              <div role="img" aria-label={`${item.label}: ${item.value}`} className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-surface">
                <div className="h-full rounded-full bg-brand-500" style={{ width: `${widthPct}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function StatGroupBlock({ data }: { data: StatGroupBlockData }): React.JSX.Element {
  return (
    <section aria-label={data.heading?.title ?? "Key statistics"} data-testid="page-builder-stat-group" className="py-16 lg:py-20">
      <div className="mx-auto max-w-screen-xl px-4 md:px-6">
        <SectionHeading heading={data.heading} />
        {data.variant === "bento" ? <BentoVariant data={data} /> : null}
        {data.variant === "band" ? <BandVariant data={data} /> : null}
        {data.variant === "bars" ? <BarsVariant data={data} /> : null}
      </div>
    </section>
  );
}
