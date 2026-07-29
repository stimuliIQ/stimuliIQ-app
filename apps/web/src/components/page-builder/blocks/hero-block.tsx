/**
 * HeroBlock — page-builder block #1 (docs/specs/phase-10-page-builder.md §"1. hero").
 * Generalizes `hero-centered.tsx` (variant=centered / centered-with-flanking-photos) and
 * the Scholarship hero markup (variant=split-with-cards) into one parametrized component,
 * per the spec's "renders via" column.
 *
 * The Scholarship hero's overlapping stat band is deliberately NOT part of this block
 * (spec note under block #1) — callers place a `stat_group(variant=band)` block
 * immediately after this one; see `page-blocks.tsx`.
 */
import Image from "next/image";
import type { HeroBlockData } from "@repo/types";
import { resolveAssetUrl } from "../../../lib/media";
import { safeHref } from "../../../lib/safe-href";
import { BlockIcon } from "../icon-registry";
import { HighlightText } from "../highlight-text";

function ArrowRightIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

function CtaRow({ ctas }: { ctas: HeroBlockData["ctas"] }) {
  if (!ctas || ctas.length === 0) return null;
  // Alignment rules (real-user defect on /scholarship): labels never wrap inside a
  // pill (whitespace-nowrap — the row itself wraps instead via flex-wrap when the
  // column is narrow), and both styles share the same 60px height (the primary's
  // py-2 + 44px arrow chip) so a mixed pair reads as one aligned control group.
  return (
    <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
      {ctas.map((cta, i) => {
        const href = safeHref(cta.href);
        if (!href) return null;
        return cta.style === "primary" ? (
          <a
            key={i}
            href={href}
            className="group inline-flex min-h-[60px] items-center gap-4 whitespace-nowrap rounded-full bg-brand-500 py-2 pl-8 pr-2 text-sm font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:bg-brand-600 active:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {cta.label}
            <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-fg transition-transform duration-fast group-hover:translate-x-0.5">
              <ArrowRightIcon />
            </span>
          </a>
        ) : (
          <a
            key={i}
            href={href}
            className="inline-flex min-h-[60px] items-center justify-center whitespace-nowrap rounded-full border border-border bg-card px-8 text-sm font-medium text-fg transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {cta.label}
          </a>
        );
      })}
    </div>
  );
}

function TrustBadge({ trustBadge }: { trustBadge: HeroBlockData["trustBadge"] }) {
  if (!trustBadge) return null;
  const stars = "★".repeat(trustBadge.ratingStars).padEnd(5, "☆");
  return (
    <div className="flex flex-col items-center gap-1">
      <span aria-hidden="true" className="text-xl tracking-[0.35em] text-fg">
        {stars}
      </span>
      <span className="sr-only">Rated {trustBadge.ratingStars} out of 5.</span>
      <p className="text-base font-medium text-fg">{trustBadge.caption}</p>
    </div>
  );
}

function CenteredHeadline({ data }: { data: HeroBlockData }) {
  return (
    <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
      {data.trustBadge ? (
        <div className="flex items-center gap-3">
          <TrustBadge trustBadge={data.trustBadge} />
        </div>
      ) : null}
      {data.eyebrow ? (
        <p className="mt-4 text-sm font-semibold uppercase tracking-[0.2em] text-fg-muted">{data.eyebrow}</p>
      ) : null}
      <h1 className="mt-8 font-display text-5xl font-bold leading-[1.05] tracking-tight text-fg sm:text-6xl lg:text-7xl">
        <HighlightText text={data.headline} highlight={data.headlineHighlight} />
      </h1>
      {data.subheadline ? (
        <p className="mt-7 max-w-xl text-lg leading-relaxed text-fg-muted">{data.subheadline}</p>
      ) : null}
      <CtaRow ctas={data.ctas} />
    </div>
  );
}

function FlankingPhoto({
  photo,
  side,
}: {
  photo: NonNullable<HeroBlockData["flankingPhotos"]>[number];
  side: "left" | "right";
}) {
  const src = resolveAssetUrl(photo.imageKey);
  if (!src) return null;
  const position = side === "left" ? "left-[6%] xl:left-[9%]" : "right-[4%] xl:right-[7%]";
  const badgePosition = side === "left" ? "-left-16 bottom-10" : "-left-20 bottom-8";
  return (
    <div className={`absolute top-1/2 hidden -translate-y-1/2 lg:block ${position}`}>
      <div className="relative">
        <Image src={src} alt="" width={200} height={250} className="h-[250px] w-[200px] rounded-2xl object-cover shadow-md" />
        <div className={`absolute flex items-center gap-3 rounded-xl border border-border bg-card p-3 pr-5 shadow-md ${badgePosition}`}>
          <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-border text-fg">
            <BlockIcon iconKey={photo.statIconKey} className="h-5 w-5" />
          </span>
          <span className="flex flex-col leading-tight">
            <span className="text-base font-bold text-fg">{photo.statValue}</span>
            <span className="text-sm text-fg-muted">{photo.statLabel}</span>
          </span>
        </div>
      </div>
    </div>
  );
}

function SplitWithCardsHero({ data }: { data: HeroBlockData }) {
  const centerSrc = resolveAssetUrl(data.centerImageKey);
  const [leftCard, rightCard] = data.infoCards ?? [];
  return (
    <div className="relative mx-auto max-w-screen-xl px-4 pt-8 md:px-6">
      {data.watermarkText ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/3 select-none whitespace-nowrap text-center font-display text-[10.5vw] font-bold uppercase leading-none tracking-tight text-fg opacity-[0.04]"
        >
          {data.watermarkText}
        </span>
      ) : null}

      <div className="mx-auto mt-2 flex max-w-4xl flex-col items-center text-center">
        {data.eyebrow ? <p className="text-sm font-semibold uppercase tracking-[0.2em] text-fg-muted">{data.eyebrow}</p> : null}
        <h1 className="mt-2 font-display text-5xl font-bold leading-[1.05] tracking-tight text-fg sm:text-6xl lg:text-7xl">
          <HighlightText text={data.headline} highlight={data.headlineHighlight} />
        </h1>
        {data.subheadline ? <p className="mx-auto mt-4 max-w-2xl text-lg text-fg-muted">{data.subheadline}</p> : null}
      </div>

      <div className="mt-10 grid grid-cols-1 items-center gap-8 lg:grid-cols-[1fr_auto_1fr] lg:gap-4">
        <div className="order-2 flex flex-col items-start gap-6 lg:order-1">
          {leftCard ? (
            <div className="w-full rounded-xl border border-border bg-card p-6 shadow-sm">
              <p className={`text-base leading-relaxed ${leftCard.emphasis ? "font-semibold text-brand-600" : "text-fg"}`}>{leftCard.bodyText}</p>
            </div>
          ) : null}
          <CtaRow ctas={data.ctas} />
        </div>

        {centerSrc ? (
          <div className="order-1 flex justify-center lg:order-2 lg:-mb-16">
            <Image src={centerSrc} alt="" width={740} height={1056} priority className="h-auto w-[280px] drop-shadow-xl sm:w-[340px] lg:w-[400px]" />
          </div>
        ) : null}

        {rightCard ? (
          <div className="order-3 rounded-xl border border-border bg-card p-6 shadow-sm">
            <p className={`text-base leading-snug ${rightCard.emphasis ? "font-semibold text-brand-600" : "text-fg-muted"}`}>{rightCard.bodyText}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function HeroBlock({ data }: { data: HeroBlockData }): React.JSX.Element {
  const backgroundSrc = resolveAssetUrl(data.backgroundImageKey);

  if (data.variant === "split-with-cards") {
    return (
      <section aria-label={data.headline} data-testid="page-builder-hero" className="relative overflow-hidden border-b border-border bg-surface">
        {backgroundSrc ? (
          <div aria-hidden="true" className="absolute inset-0 opacity-50">
            <Image src={backgroundSrc} alt="" fill priority sizes="100vw" className="object-cover" />
          </div>
        ) : null}
        <SplitWithCardsHero data={data} />
      </section>
    );
  }

  return (
    <section aria-label={data.headline} data-testid="page-builder-hero" className="relative overflow-hidden bg-bg">
      {backgroundSrc ? (
        <div aria-hidden="true" className="absolute inset-0">
          <Image src={backgroundSrc} alt="" fill priority sizes="100vw" className="object-cover" />
        </div>
      ) : null}

      <div className="relative mx-auto max-w-screen-2xl px-4 py-20 md:px-6 lg:py-32">
        {data.variant === "centered-with-flanking-photos" && data.flankingPhotos?.[0] ? (
          <FlankingPhoto photo={data.flankingPhotos[0]} side="left" />
        ) : null}
        {data.variant === "centered-with-flanking-photos" && data.flankingPhotos?.[1] ? (
          <FlankingPhoto photo={data.flankingPhotos[1]} side="right" />
        ) : null}

        <CenteredHeadline data={data} />
      </div>
    </section>
  );
}
