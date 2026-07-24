import * as React from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { cn } from "@repo/ui";

interface EligibilityGateProps {
  passed: boolean;
  label: string;
  detail?: string;
}

/**
 * Visual indicator for an eligibility gate (completion / assessments / project).
 * Uses icon + text, never color alone (AA a11y requirement).
 */
export function EligibilityGate({ passed, label, detail }: EligibilityGateProps): React.JSX.Element {
  return (
    <div className="flex items-start gap-2">
      {passed ? (
        <CheckCircle2
          className="size-4 text-success flex-shrink-0 mt-0.5"
          aria-hidden="true"
        />
      ) : (
        <XCircle
          className="size-4 text-danger flex-shrink-0 mt-0.5"
          aria-hidden="true"
        />
      )}
      <div>
        <p className={cn("text-sm font-medium", passed ? "text-success" : "text-danger")}>
          {label}
          <span className="sr-only">{passed ? " — passed" : " — not passed"}</span>
        </p>
        {detail ? <p className="text-xs text-fg-muted">{detail}</p> : null}
      </div>
    </div>
  );
}
