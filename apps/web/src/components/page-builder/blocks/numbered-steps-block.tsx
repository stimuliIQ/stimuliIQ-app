/**
 * NumberedStepsBlock — page-builder block #5 (docs/specs/phase-10-page-builder.md
 * §"5. numbered_steps"). Three variants:
 *   - `arrows`   — Homepage "How it works" (staggered zigzag cards, `HowItWorksSteps`).
 *   - `timeline` — About "Journey" (vertical connected list).
 *   - `compact`  — Scholarship "Process" (numbered grid, no connectors).
 */
import type { NumberedStepsBlockData } from "@repo/types";
import { HowItWorksSteps } from "../../home/how-it-works-steps";
import { HighlightText } from "../highlight-text";

function SectionHeading({ heading }: { heading: NumberedStepsBlockData["heading"] }) {
  if (!heading) return null;
  return (
    <div className="mx-auto mb-10 max-w-2xl text-center">
      {heading.eyebrow ? <p className="text-xs font-semibold uppercase tracking-[0.2em] text-fg-muted">{heading.eyebrow}</p> : null}
      <h2 className="mt-3 text-3xl font-bold text-fg md:text-4xl">
        <HighlightText text={heading.title} highlight={heading.titleHighlight} />
      </h2>
      {heading.subtitle ? <p className="mt-3 text-lg text-fg-muted">{heading.subtitle}</p> : null}
    </div>
  );
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function TimelineVariant({ items }: { items: NumberedStepsBlockData["items"] }) {
  return (
    <ol role="list" className="mx-auto flex max-w-3xl flex-col">
      {items.map((step, index) => (
        <li key={step.title} className="relative flex gap-6 pb-12 last:pb-0">
          {index < items.length - 1 ? (
            <span aria-hidden="true" className="absolute left-6 top-14 h-[calc(100%-3.5rem)] w-px bg-border" />
          ) : null}
          <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-500 font-display text-sm font-bold text-white">
            {pad(index + 1)}
          </span>
          <div className="pt-2.5">
            <h3 className="text-xl font-bold text-fg">{step.title}</h3>
            <p className="mt-2 max-w-xl text-base leading-relaxed text-fg-muted">{step.description}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function CompactVariant({ items }: { items: NumberedStepsBlockData["items"] }) {
  return (
    <ol role="list" className="mx-auto grid max-w-6xl grid-cols-1 gap-8 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
      {items.map((step, index) => (
        <li key={step.title} className="flex flex-col gap-3">
          <span aria-hidden="true" className="flex h-11 w-11 items-center justify-center rounded-lg border-2 border-brand-500 text-base font-bold text-brand-600">
            {pad(index + 1)}
          </span>
          <h3 className="text-base font-semibold text-fg">{step.title}</h3>
          <p className="text-sm leading-relaxed text-fg-muted">{step.description}</p>
        </li>
      ))}
    </ol>
  );
}

export function NumberedStepsBlock({ data }: { data: NumberedStepsBlockData }): React.JSX.Element {
  return (
    // id="how-it-works": the numbered-steps block is the page's process/how-it-works
    // section, and CMS-authored hero CTAs link to it as "#how-it-works" (e.g.
    // Scholarship's "See How It Works"). scroll-mt offsets the sticky header.
    <section
      id="how-it-works"
      aria-label={data.heading?.title ?? "Steps"}
      data-testid="page-builder-numbered-steps"
      className="scroll-mt-20 py-16 lg:py-20"
    >
      <div className="mx-auto max-w-screen-xl px-4 md:px-6">
        <SectionHeading heading={data.heading} />
        {data.variant === "arrows" ? <HowItWorksSteps steps={data.items} /> : null}
        {data.variant === "timeline" ? <TimelineVariant items={data.items} /> : null}
        {data.variant === "compact" ? <CompactVariant items={data.items} /> : null}
      </div>
    </section>
  );
}
