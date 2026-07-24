// `brain_showcase` block fields (docs/specs/phase-10-page-builder.md block #11) — no
// fields. A zero-config positional placeholder; still addable/removable/reorderable like
// any block, its rendered content never changes (spec: "deliberately not made editable
// this phase").
import * as React from "react";

export function BrainShowcaseFields(): React.JSX.Element {
  return (
    <p className="rounded-md bg-surface px-3 py-2 text-sm text-fg-muted" data-testid="brain-showcase-no-fields">
      No editable fields — this is the fixed 3D brand moment. Use the move/remove controls above to position or remove
      it.
    </p>
  );
}
