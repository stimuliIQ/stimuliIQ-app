/**
 * FeatureGridBlock — page-builder block #4 (docs/specs/phase-10-page-builder.md
 * §"4. feature_grid"). Three variants:
 *   - `cards`       — Pillars/Benefits/For-Colleges card grid (default 3 columns).
 *   - `split-media` — `why-us.tsx`'s 2-cards | photo | 2-cards layout (exactly 4 items).
 *   - `strip`       — About's Commitments compact row (default 4 columns).
 */
import Image from "next/image";
import type { FeatureGridBlockData } from "@repo/types";
import { resolveAssetUrl } from "../../../lib/media";
import { BlockIcon } from "../icon-registry";
import { HighlightText } from "../highlight-text";

function SectionHeading({ heading }: { heading: FeatureGridBlockData["heading"] }) {
  if (!heading) return null;
  return (
    <div className="mx-auto mb-12 max-w-xl text-center lg:mb-16">
      {heading.eyebrow ? <p className="text-xs font-semibold uppercase tracking-[0.2em] text-fg-muted">{heading.eyebrow}</p> : null}
      <h2 className="font-display text-3xl font-bold tracking-tight text-fg md:text-4xl">
        <HighlightText text={heading.title} highlight={heading.titleHighlight} />
      </h2>
      {heading.subtitle ? <p className="mx-auto mt-4 max-w-md text-lg leading-relaxed text-fg-muted">{heading.subtitle}</p> : null}
    </div>
  );
}

/*
 * Column steps. These cards are compact (icon tile + title + one line), so they take a
 * `md` step — without it a tablet sat on the `sm` 2-column rendering all the way to
 * 1024px and each card ran ~370px wide for two lines of text.
 */
const COLS_CLASS: Record<string, string> = {
  "2": "sm:grid-cols-2",
  "3": "sm:grid-cols-2 md:grid-cols-3",
  "4": "sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4",
};

function CardsVariant({ data }: { data: FeatureGridBlockData }) {
  const cols = COLS_CLASS[data.columns ?? "3"] ?? COLS_CLASS["3"];
  return (
    <div className={`grid grid-cols-1 gap-5 ${cols}`}>
      {data.items.map((item) => (
        <div
          key={item.title}
          className={[
            "group flex h-full items-start gap-4 rounded-2xl border border-border bg-card p-6",
            "shadow-sm transition-all duration-[150ms] ease-out",
            "hover:-translate-y-0.5 hover:border-brand-500/30 hover:shadow-md",
          ].join(" ")}
        >
          {/* The icon tile is the card's only colour, so it does the visual work: a
              tinted rounded square with an inset ring at rest, inverting to a solid
              brand fill on hover. Bigger than the previous 40px chip — at that size a
              20px glyph read as an afterthought rather than a deliberate mark. */}
          <span
            aria-hidden="true"
            className={[
              "flex h-12 w-12 shrink-0 items-center justify-center rounded-xl",
              "bg-brand-50 text-brand-600 ring-1 ring-inset ring-brand-500/10",
              "transition-colors duration-[150ms] ease-out",
              "group-hover:bg-brand-500 group-hover:text-white group-hover:ring-brand-500",
            ].join(" ")}
          >
            <BlockIcon iconKey={item.iconKey} className="h-[22px] w-[22px]" />
          </span>
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold leading-snug text-fg">{item.title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-fg-muted">{item.description}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function SplitMediaVariant({ data }: { data: FeatureGridBlockData }) {
  const src = resolveAssetUrl(data.centerImageKey);
  const [left, right] = [data.items.slice(0, 2), data.items.slice(2, 4)];
  return (
    // md: the photo spans the row and the two card stacks pair up beside each other —
    // the same tablet fix as `why-us.tsx`, whose layout this variant mirrors.
    <div className="grid grid-cols-1 items-stretch gap-6 md:grid-cols-2 lg:grid-cols-[1fr_1.15fr_1fr]">
      <div className="flex flex-col gap-6">
        {left.map((item) => (
          <div key={item.title} className="flex flex-1 flex-col rounded-2xl bg-card p-7 shadow-sm">
            <span aria-hidden="true" className="flex h-14 w-14 items-center justify-center rounded-full bg-surface text-fg">
              <BlockIcon iconKey={item.iconKey} />
            </span>
            <h3 className="mt-12 text-2xl font-bold text-fg">{item.title}</h3>
            <p className="mt-3 max-w-xs text-base leading-relaxed text-fg-muted">{item.description}</p>
          </div>
        ))}
      </div>

      {src ? (
        <div aria-hidden="true" className="relative min-h-[380px] md:order-first md:col-span-2 md:min-h-[420px] lg:order-none lg:col-span-1 lg:min-h-0">
          <Image src={src} alt="" fill sizes="(min-width: 1024px) 40vw, 100vw" className="rounded-2xl object-cover" />
        </div>
      ) : null}

      <div className="flex flex-col gap-6">
        {right.map((item) => (
          <div key={item.title} className="flex flex-1 flex-col rounded-2xl bg-card p-7 shadow-sm">
            <span aria-hidden="true" className="flex h-14 w-14 items-center justify-center rounded-full bg-surface text-fg">
              <BlockIcon iconKey={item.iconKey} />
            </span>
            <h3 className="mt-12 text-2xl font-bold text-fg">{item.title}</h3>
            <p className="mt-3 max-w-xs text-base leading-relaxed text-fg-muted">{item.description}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function StripVariant({ data }: { data: FeatureGridBlockData }) {
  const cols = COLS_CLASS[data.columns ?? "4"] ?? COLS_CLASS["4"];
  return (
    <div className={`grid grid-cols-1 gap-8 ${cols}`}>
      {data.items.map((item) => (
        <div key={item.title} className="flex items-start gap-3">
          <span aria-hidden="true" className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface text-fg">
            <BlockIcon iconKey={item.iconKey} className="h-5 w-5" />
          </span>
          <div>
            <h3 className="text-sm font-bold text-fg">{item.title}</h3>
            <p className="mt-1 text-sm leading-relaxed text-fg-muted">{item.description}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

export function FeatureGridBlock({ data }: { data: FeatureGridBlockData }): React.JSX.Element {
  return (
    <section aria-label={data.heading?.title ?? "Features"} data-testid="page-builder-feature-grid" className="py-16 lg:py-24">
      <div className="mx-auto max-w-screen-xl px-4 md:px-6">
        <SectionHeading heading={data.heading} />
        {data.variant === "cards" ? <CardsVariant data={data} /> : null}
        {data.variant === "split-media" ? <SplitMediaVariant data={data} /> : null}
        {data.variant === "strip" ? <StripVariant data={data} /> : null}
      </div>
    </section>
  );
}
