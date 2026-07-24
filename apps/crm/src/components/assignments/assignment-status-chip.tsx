import * as React from "react";
import { StatusChip } from "@repo/ui";
import type { SubmissionStatus } from "@repo/types";

const TONE_MAP: Record<SubmissionStatus, "info" | "success" | "warning"> = {
  submitted: "info",
  graded: "success",
  returned: "warning",
};

const LABEL_MAP: Record<SubmissionStatus, string> = {
  submitted: "Submitted",
  graded: "Graded",
  returned: "Returned",
};

interface AssignmentStatusChipProps {
  status: SubmissionStatus;
}

export function AssignmentStatusChip({ status }: AssignmentStatusChipProps): React.JSX.Element {
  return <StatusChip tone={TONE_MAP[status]} label={LABEL_MAP[status]} />;
}
