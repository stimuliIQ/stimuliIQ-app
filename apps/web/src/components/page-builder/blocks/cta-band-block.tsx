/**
 * CtaBandBlock — page-builder block #7 (docs/specs/phase-10-page-builder.md
 * §"7. cta_band"). Consolidates the homepage CTA band, About's verify-certificate
 * callout + final CTA, Scholarship's application-form section, and For-Colleges' CTA.
 */
import type { CtaBandBlockData } from "@repo/types";
import { LeadFormConnected } from "../../leads/lead-form-connected";
import { safeHref } from "../../../lib/safe-href";
import { HighlightText } from "../highlight-text";

// No hairline dividers: `brand` is a deliberate saturated full-colour band and needs
// no help reading as its own zone, while `surface` uses `.section-band` (globals.css)
// so its tint fades in and out of the page background instead of stepping.
const BACKGROUND_CLASSES: Record<CtaBandBlockData["background"], string> = {
  brand: "bg-brand-500 text-white",
  surface: "section-band text-fg",
  default: "bg-bg text-fg",
};

const HEADING_CLASS: Record<CtaBandBlockData["background"], string> = {
  brand: "text-white",
  surface: "text-fg",
  default: "text-fg",
};

const SUBHEADING_CLASS: Record<CtaBandBlockData["background"], string> = {
  brand: "text-brand-100",
  surface: "text-fg-muted",
  default: "text-fg-muted",
};

function PrimaryButtonClass(onBrand: boolean): string {
  return onBrand
    ? "inline-flex min-h-[48px] items-center justify-center rounded-full bg-white px-8 text-base font-semibold text-brand-600 transition-colors hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-brand-500"
    : "inline-flex min-h-[48px] items-center justify-center rounded-full bg-brand-500 px-8 text-sm font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:bg-brand-600 active:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";
}

function SecondaryButtonClass(onBrand: boolean): string {
  return onBrand
    ? "inline-flex min-h-[48px] items-center justify-center rounded-full border border-white/30 px-8 text-base font-medium text-white transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-brand-500"
    : "inline-flex min-h-[48px] items-center justify-center rounded-full border border-border bg-card px-8 text-sm font-medium text-fg transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";
}

export function CtaBandBlock({ data }: { data: CtaBandBlockData }): React.JSX.Element {
  const onBrand = data.background === "brand";

  return (
    // id="apply": the band that carries a lead form IS the page's application/signup
    // section, and CMS-authored hero CTAs link to it as "#apply" (e.g. Scholarship's
    // "Take an Eligibility Test"). scroll-mt offsets the sticky header on anchor jumps.
    <section
      id={data.leadForm ? "apply" : undefined}
      aria-label={data.heading}
      data-testid="page-builder-cta-band"
      className={`${BACKGROUND_CLASSES[data.background]} scroll-mt-20 py-20 lg:py-24`}
    >
      <div className="mx-auto max-w-screen-xl px-4 text-center md:px-6">
        <h2 className={`text-3xl font-bold md:text-4xl ${HEADING_CLASS[data.background]}`}>
          <HighlightText text={data.heading} highlight={data.headingHighlight} />
        </h2>
        {data.subheading ? <p className={`mx-auto mt-4 max-w-xl text-lg ${SUBHEADING_CLASS[data.background]}`}>{data.subheading}</p> : null}

        {data.buttons && data.buttons.length > 0 ? (
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            {data.buttons.map((cta, i) => {
              const href = safeHref(cta.href);
              if (!href) return null;
              return (
                <a key={i} href={href} className={cta.style === "primary" ? PrimaryButtonClass(onBrand) : SecondaryButtonClass(onBrand)}>
                  {cta.label}
                </a>
              );
            })}
          </div>
        ) : null}

        {data.leadForm ? (
          <div className="mx-auto mt-12 max-w-md text-left">
            <LeadFormConnected
              source={data.leadForm.source}
              heading={data.leadForm.heading}
              subheading={data.leadForm.subheading}
              fields={data.leadForm.fields}
              submitLabel={data.leadForm.submitLabel}
              data-testid="page-builder-cta-band-lead-form"
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}
