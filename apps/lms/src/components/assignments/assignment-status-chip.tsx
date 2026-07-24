// AssignmentStatusChip — maps AssignmentStudentStatus to a StatusChip.
// Never conveys status by color alone (chip + label/icon per docs/07 §2).
import type { AssignmentStudentStatus } from "@repo/types";
import { StatusChip, type StatusChipTone } from "@repo/ui";

const toneMap: Record<AssignmentStudentStatus, StatusChipTone> = {
  assigned: "neutral",
  submitted: "info",
  graded: "success",
  overdue: "danger",
};

const labelMap: Record<AssignmentStudentStatus, string> = {
  assigned: "Assigned",
  submitted: "Submitted",
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
