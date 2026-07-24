// Shared "Soon" pill for nav items not yet wired to a real route —
// docs/specs/crm-ui-consistency.md §8. Previously built twice (once for
// section rows, once for leaf rows) with a duplicated `text-[10px]`
// arbitrary-value literal; this is the one implementation both reuse.
import * as React from "react";
import { cn } from "@repo/ui";

export interface ComingSoonBadgeProps {
  className?: string;
}

export function ComingSoonBadge({ className }: ComingSoonBadgeProps): React.JSX.Element {
  return (
    <span
      className={cn(
        "rounded-full border border-border bg-surface px-1.5 py-0.5 text-xs uppercase tracking-wide text-fg-subtle",
        className,
      )}
    >
      Soon
    </span>
  );
}
ComingSoonBadge.displayName = "ComingSoonBadge";
