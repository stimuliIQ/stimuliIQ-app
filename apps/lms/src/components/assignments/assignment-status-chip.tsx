// AssignmentStatusChip — maps AssignmentStudentStatus to a StatusChip.
// Never conveys status by color alone (chip + label/icon per docs/07 §2).
import type { AssignmentStudentStatus } from "@repo/types";
import { StatusChip, type StatusChipTone } from "@repo/ui";

const toneMap: Record<AssignmentStudentStatus, StatusChipTone> = {
  assigned: "neutral",
  submitted: "info",
  // Warning, not danger: the student has work to do, not a failure to absorb.
  returned: "warning",
  graded: "success",
  overdue: "danger",
};

const labelMap: Record<AssignmentStudentStatus, string> = {
  assigned: "Assigned",
  submitted: "Submitted",
  // Never "Rejected"/"Failed" — a student who reads that stops, and the whole point of
  // this state is that they try again.
  returned: "Changes needed",
  graded: "Graded",
  overdue: "Overdue",
};

interface AssignmentStatusChipProps {
  status: AssignmentStudentStatus;
  size?: "sm" | "md";
}

export function AssignmentStatusChip({ status, size = "sm" }: AssignmentStatusChipProps) {
  return (
    <StatusChip
      tone={toneMap[status]}
      label={labelMap[status]}
      size={size}
      data-testid={`assignment-status-${status}`}
    />
  );
}
