import * as React from "react";

import { cn } from "../lib/cn";
import { Switch } from "./switch";

/**
 * FeatureFlagRow — a single flag/setting toggle row for the CRM feature-flags and
 * settings screens (T19, docs/plans/phase-9-completion.md). Pairs the accessible `Switch`
 * with a label/description/badge layout so every flag row looks identical.
 *
 * a11y: the `Switch` is labelled via `aria-labelledby` pointing at the row's visible
 * label, so screen readers announce the flag name, not a generic "switch".
 *
 * Usage:
 *   <FeatureFlagRow
 *     name="flags.new_dashboard"
 *     label="New dashboard"
 *     description="Rolls out the redesigned overview dashboard."
 *     enabled={flag.enabled}
 *     onEnabledChange={(v) => updateFlag(flag.key, v)}
 *     rolloutBadge={<StatusChip tone="info" label="50% rollout" size="sm" />}
 *   />
 */
export interface FeatureFlagRowProps {
  /** Flag key, e.g. "flags.new_dashboard" — shown as secondary text. */
  name: string;
  label: string;
  description?: string;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  disabled?: boolean;
  rolloutBadge?: React.ReactNode;
  className?: string;
  /** Test hook; defaults to "feature-flag-row" when omitted. */
  "data-testid"?: string;
}

export function FeatureFlagRow({
  name,
  label,
  description,
  enabled,
  onEnabledChange,
  disabled = false,
  rolloutBadge,
  className,
  "data-testid": testId,
}: FeatureFlagRowProps): React.JSX.Element {
  const labelId = React.useId();

  return (
    <div
      data-testid={testId ?? "feature-flag-row"}
      className={cn(
        "flex items-center justify-between gap-4 rounded-md border border-border bg-card px-4 py-3",
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <span id={labelId} className="text-sm font-medium text-fg">
            {label}
          </span>
          {rolloutBadge}
        </div>
        <span className="text-xs text-fg-subtle">{name}</span>
        {description ? <p className="mt-0.5 text-sm text-fg-muted">{description}</p> : null}
      </div>
      <Switch
        checked={enabled}
        onCheckedChange={onEnabledChange}
        disabled={disabled}
        aria-labelledby={labelId}
        data-testid={`${testId ?? "feature-flag-row"}-switch`}
      />
    </div>
  );
}
FeatureFlagRow.displayName = "FeatureFlagRow";
