import { StatusChip, type StatusChipTone } from "@repo/ui";
import type { ProgramStatus } from "@repo/types";

const STATUS_TONE: Record<ProgramStatus, StatusChipTone> = {
  draft: "neutral",
  published: "success",
  archived: "warning",
};

const STATUS_LABEL: Record<ProgramStatus, string> = {
  draft: "Draft",
  published: "Published",
  archived: "Archived",
};

export function ProgramStatusChip({ status }: { status: ProgramStatus }) {
  return <StatusChip tone={STATUS_TONE[status]} label={STATUS_LABEL[status]} />;
}
