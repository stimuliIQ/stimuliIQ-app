import * as React from "react";

import { cn } from "../lib/cn";

/**
 * PageHeader — the single, canonical page-title block for every top-level app
 * screen (LMS + CRM list/detail pages). Before this existed each page hand-rolled
 * its own `<h1>`, so titles drifted across three competing treatments (plain
 * `text-2xl font-bold`, the `font-display … md:text-3xl` variant, and pages with
 * no header at all). Routing every page through one component makes the title
 * typography, the optional description, and the optional right-aligned actions
 * slot identical everywhere — change it here, it changes everywhere.
 *
 * Pair it as the first child of a page root that owns the vertical rhythm, e.g.
 *   <div className="space-y-6 md:space-y-8">
 *     <PageHeader title="Downloads" description="Files you can use offline." />
 *     …
 *   </div>
 *
 * a11y:
 * - Renders an `<h1>` by default so the page title is the primary landmark
 *   heading (override with `headingLevel` on the rare nested surface).
 * - The description is plain muted text tied visually (not by aria) to the title;
 *   pass real elements (icons, links) freely — it accepts any ReactNode.
 */
export interface PageHeaderProps {
  title: React.ReactNode;
  /** Optional supporting line beneath the title (muted). Accepts rich content. */
  description?: React.ReactNode;
  /** Right-aligned controls (buttons, filters) — wraps below the title on narrow screens. */
  actions?: React.ReactNode;
  /** Heading level for the title. Defaults to `1` (the page's landmark heading). */
  headingLevel?: 1 | 2;
  className?: string;
  "data-testid"?: string;
}

export function PageHeader({
  title,
  description,
  actions,
  headingLevel = 1,
  className,
  "data-testid": testId,
}: PageHeaderProps): React.JSX.Element {
  const Heading = headingLevel === 2 ? "h2" : "h1";
  return (
    <div
      className={cn("flex flex-wrap items-start justify-between gap-x-4 gap-y-2", className)}
      data-testid={testId}
    >
      <div className="space-y-1">
        <Heading className="font-display text-2xl font-bold tracking-tight text-fg md:text-3xl">
          {title}
        </Heading>
        {description ? (
          <p className="text-sm text-fg-muted">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
