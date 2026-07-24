// Shared error-state (with retry) for every Analytics dashboard —
// CLAUDE.md §4 DoD: "every async widget has loading, empty, and error
// states". `ChartFrame`/`KpiCard`'s own `error` prop renders a message but
// has no retry affordance, so query-level failures render this block
// instead of the KPI/chart grid (loading/empty stay handled by the chart
// primitives themselves once the query is not erroring).
import * as React from "react";
import { Button, EmptyState } from "@repo/ui";
import { AlertTriangle } from "lucide-react";

export interface ReportErrorStateProps {
  message: string;
  onRetry: () => void;
  "data-testid": string;
}

export function ReportErrorState({
  message,
  onRetry,
  "data-testid": testId,
}: ReportErrorStateProps): React.JSX.Element {
  return (
    <EmptyState
      icon={<AlertTriangle />}
      title="Couldn't load this dashboard"
      description={message}
      action={
        <Button variant="secondary" onClick={onRetry} data-testid={`${testId}-retry`}>
          Try again
        </Button>
      }
      data-testid={testId}
    />
  );
}
ReportErrorState.displayName = "ReportErrorState";
