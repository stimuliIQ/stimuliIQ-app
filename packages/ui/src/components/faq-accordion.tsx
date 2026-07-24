"use client";

import * as React from "react";
import * as AccordionPrimitive from "@radix-ui/react-accordion";
import { ChevronDown } from "lucide-react";

import { cn } from "../lib/cn";

/**
 * FaqAccordion — FAQ section with Radix Accordion, per docs/01-prd-website.md §7.2/§7.4
 * ("FAQ — accordion") and docs/07-design-system.md §5/§11.
 *
 * Composes Radix Accordion (not CurriculumAccordion — different visual language).
 *
 * a11y:
 * - Radix provides `button[aria-expanded]` triggers and `region` panels.
 * - Keyboard: Space/Enter toggle; arrow keys move between triggers; Home/End jump.
 * - Focus ring via Tailwind focus-visible utilities.
 *
 * JSON-LD for FAQ Schema:
 * - `emitJsonLd` prop: when true, renders a <script type="application/ld+json"> with
 *   FAQPage schema. Callers can instead use the returned data from `buildFaqJsonLd()`.
 * - The JSON-LD is escaped (`</script>` → `<\/script>`) per P4 L-1 security requirement.
 *
 * SSR-safety: `"use client"` is required because Radix Accordion manages state.
 *
 * Usage:
 *   <FaqAccordion
 *     items={[
 *       { id: "q1", question: "What is the duration?", answer: "12 weeks." },
 *     ]}
 *     emitJsonLd
 *   />
 *
 *   // JSON-LD only (no component)
 *   const jsonLd = buildFaqJsonLd(items);
 */

export interface FaqItem {
  id: string;
  question: string;
  /** Answer text (plain text or a React node for rich content — JSON-LD only uses text). */
  answer: string | React.ReactNode;
  /** Plain text version of the answer for JSON-LD (required when answer is ReactNode). */
  answerText?: string;
}

export interface FaqAccordionProps {
  items: FaqItem[];
  /**
   * If true, renders an inline JSON-LD <script> with FAQPage schema.
   * Use this when the component is the sole FAQ on the page.
   * For SSG/per-page metadata, use `buildFaqJsonLd` and inject the script in <head>.
   */
  emitJsonLd?: boolean;
  /** Allow multiple items open simultaneously. Defaults to single-open. */
  allowMultiple?: boolean;
  className?: string;
  "data-testid"?: string;
}

// ---------------------------------------------------------------------------
// JSON-LD helpers
// ---------------------------------------------------------------------------

export interface FaqJsonLdItem {
  question: string;
  answerText: string;
}

/** Build the FAQPage JSON-LD structure from FAQ items. */
export function buildFaqJsonLd(items: FaqJsonLdItem[]): string {
  const obj = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answerText,
      },
    })),
  };
  // Escape </script> per P4 L-1 requirement
  return JSON.stringify(obj).replace(/<\/script>/gi, "<\\/script>");
}

// ---------------------------------------------------------------------------
// FaqAccordion (public component)
// ---------------------------------------------------------------------------

export function FaqAccordion({
  items,
  emitJsonLd = false,
  allowMultiple = false,
  className,
  "data-testid": testId,
}: FaqAccordionProps): React.JSX.Element {
  const jsonLdItems: FaqJsonLdItem[] = items.map((item) => ({
    question: item.question,
    answerText:
      item.answerText ?? (typeof item.answer === "string" ? item.answer : ""),
  }));

  const accordionProps = allowMultiple
    ? ({ type: "multiple" } as const)
    : ({ type: "single", collapsible: true } as const);

  return (
    <>
      {emitJsonLd ? (
        <script
          type="application/ld+json"
          // Intentional JSON-LD injection; buildFaqJsonLd escapes `</script>` (react/no-danger
          // is not registered in @repo/ui's flat config, so no disable directive is used).
          dangerouslySetInnerHTML={{ __html: buildFaqJsonLd(jsonLdItems) }}
        />
      ) : null}

      <AccordionPrimitive.Root
        {...accordionProps}
        data-testid={testId ?? "faq-accordion"}
        className={cn("flex flex-col gap-2", className)}
      >
        {items.map((item) => (
          <AccordionPrimitive.Item
            key={item.id}
            value={item.id}
            data-testid="faq-item"
            className="rounded-lg border border-border bg-card overflow-hidden"
          >
            <AccordionPrimitive.Header asChild>
              {/* h3 provides heading semantics in the page outline */}
              <h3 className="m-0">
                <AccordionPrimitive.Trigger
                  data-testid="faq-trigger"
                  className={cn(
                    "flex w-full items-center justify-between gap-4 px-5 py-4",
                    "text-left text-base font-medium text-fg bg-card",
                    "transition-colors duration-[150ms] ease-out hover:bg-surface",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                    "[&[data-state=open]>svg]:rotate-180",
                  )}
                >
                  <span className="min-w-0 flex-1">{item.question}</span>
                  <ChevronDown
                    aria-hidden="true"
                    className="size-5 shrink-0 text-fg-muted transition-transform duration-[150ms] ease-out"
                  />
                </AccordionPrimitive.Trigger>
              </h3>
            </AccordionPrimitive.Header>

            <AccordionPrimitive.Content
              data-testid="faq-content"
              className="overflow-hidden data-[state=open]:animate-accordion-down data-[state=closed]:animate-accordion-up"
            >
              <div className="border-t border-border px-5 py-4 text-base text-fg-muted leading-relaxed">
                {item.answer}
              </div>
            </AccordionPrimitive.Content>
          </AccordionPrimitive.Item>
        ))}
      </AccordionPrimitive.Root>
    </>
  );
}

FaqAccordion.displayName = "FaqAccordion";
