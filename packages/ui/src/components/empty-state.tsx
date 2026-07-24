import * as React from "react";

import { cn } from "../lib/cn";
import { EmptyIllustration } from "./empty-illustration";

/**
 * EmptyState — icon + title + description + optional action slot, per
 * docs/07-design-system.md §5. Used inside DataTable's empty-rows region and standalone
 * for empty lists/dashboards. Not an error state — see usage with ConfirmDialog/DataTable
 * for retry/error patterns at the call site.
 */
export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Decorative visual. Defaults to the shared <EmptyIllustration> "nothing to show"
   * graphic — pass a custom node only when a contextual glyph is genuinely more meaningful
   * (e.g. a signed-out / gated state). Always `aria-hidden`.
   */
  icon?: React.ReactNode;
  title: string;
  description?: string;
  /** Optional call-to-action, e.g. a <Button> to create the first record. */
  action?: React.ReactNode;
  /** Test hook; defaults to "empty-state" when omitted. */
  "data-testid"?: string;
}

export const EmptyState = React.forwardRef<HTMLDivElement, EmptyStateProps>(
  (
    { className, icon, title, description, action, "data-testid": testId, ...props },
    ref,
  ) => (
    <div
      ref={ref}
      data-testid={testId ?? "empty-state"}
      role="status"
      className={cn(
        "flex flex-col items-center justify-center gap-3 px-6 py-12 text-center",
        className,
      )}
      {...props}
    >
      <div aria-hidden="true" className="text-fg-subtle">
        {icon ?? <EmptyIllustration />}
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-fg">{title}</p>
        {description ? <p className="text-sm text-fg-muted">{description}</p> : null}
      </div>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  ),
);
EmptyState.displayName = "EmptyState";
