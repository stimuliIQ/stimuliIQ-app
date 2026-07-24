// Shared page chrome for every Analytics dashboard — heading + RBAC gate.
// CLAUDE.md §3.5 / docs/03 §9: the API is the only real enforcement (a
// direct nav to the URL still gets a 403 from the query if it ever fires) —
// this component just avoids rendering the dashboard's controls/queries at
// all when the caller's `me.permissions` already lacks the matching
// `reports.*.view` key, matching how nav-config.ts hides the same items.
import * as React from "react";
import { EmptyState, PageHeader } from "@repo/ui";
import { ShieldAlert } from "lucide-react";

export interface ReportPageShellProps {
  title: string;
  description: string;
  /** RBAC gate — from `getModulePermissions`/`hasPermission` against the caller's `me`. */
  canView: boolean;
  children: React.ReactNode;
  "data-testid": string;
}

export function ReportPageShell({
  title,
  description,
  canView,
  children,
  "data-testid": testId,
}: ReportPageShellProps): React.JSX.Element {
  return (
    <div className="space-y-6 md:space-y-8" data-testid={testId}>
      <PageHeader title={title} description={description} />
      {canView ? (
        children
      ) : (
        <EmptyState
          icon={<ShieldAlert />}
          title="You don't have access to this dashboard"
          description="Ask an Admin/Owner to grant the matching reports permission if you believe this is wrong."
          data-testid={`${testId}-access-denied`}
        />
      )}
    </div>
  );
}
ReportPageShell.displayName = "ReportPageShell";
