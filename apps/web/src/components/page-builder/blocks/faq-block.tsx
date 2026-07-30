/**
 * FaqBlock — page-builder block #6 (docs/specs/phase-10-page-builder.md §"6. faq").
 * Thin wrapper around `@repo/ui`'s `FaqAccordion` (already generic — per the spec's
 * "renders via" column, no adaptation needed beyond mapping the block's `{question,
 * answer}` items to `FaqAccordion`'s `{id, question, answer}` shape).
 */
import { FaqAccordion } from "@repo/ui";
import type { FaqBlockData } from "@repo/types";
import { safeHref } from "../../../lib/safe-href";
import { HighlightText } from "../highlight-text";

export function FaqBlock({ data }: { data: FaqBlockData }): React.JSX.Element {
  const viewAllHref = safeHref(data.viewAllHref);
  const items = data.items.map((item, i) => ({
    id: `faq-${i}`,
    question: item.question,
    answer: item.answer,
    answerText: item.answer,
  }));

  return (
    <section aria-label={data.heading?.title ?? "Frequently asked questions"} data-testid="page-builder-faq" className="py-16">
      <div className="mx-auto max-w-screen-xl px-4 md:px-6">
        {data.heading ? (
          <div className="mb-10 text-center">
            <h2 className="text-3xl font-bold text-fg md:text-4xl">
              <HighlightText text={data.heading.title} highlight={data.heading.titleHighlight} />
            </h2>
            {data.heading.subtitle ? <p className="mt-3 text-lg text-fg-muted">{data.heading.subtitle}</p> : null}
          </div>
        ) : null}
        <div className="mx-auto max-w-2xl">
          <FaqAccordion items={items} />
        </div>
        {viewAllHref ? (
          <div className="mt-8 text-center">
            <a href={viewAllHref} className="text-sm font-medium text-brand-500 hover:text-brand-600 focus-visible:outline-none focus-visible:underline">
              View all FAQs &rarr;
            </a>
          </div>
        ) : null}
      </div>
    </section>
  );
}
