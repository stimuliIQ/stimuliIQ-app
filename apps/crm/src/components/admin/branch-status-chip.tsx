// Maps `BranchStatus` (active|inactive) to a StatusChip tone — the only
// place this mapping lives (docs/07 §5: "domain enums map to a tone at the
// call site, never hardcoded inside StatusChip").
import { StatusChip, type StatusChipTone } from "@repo/ui";
import type { BranchStatus } from "@repo/types";

const STATUS_TONE: Record<BranchStatus, StatusChipTone> = {
  active: "success",
  inactive: "neutral",
};

const STATUS_LABEL: Record<BranchStatus, string> = {
  active: "Active",
  inactive: "Inactive",
};

export function BranchStatusChip({ status }: { status: BranchStatus }) {
  return <StatusChip tone={STATUS_TONE[status]} label={STATUS_LABEL[status]} />;
}
