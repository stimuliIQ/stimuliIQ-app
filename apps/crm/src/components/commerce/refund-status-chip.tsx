// Maps `RefundStatus` (requested|approved|rejected|processed|failed) to a
// StatusChip tone — mirrors components/shared/batch-status-chip.tsx.
import { StatusChip, statusTone, type StatusChipTone } from "@repo/ui";
import type { RefundStatus } from "@repo/types";

// `approved` (pending processing) = info, not warning (docs/specs/crm-ui-consistency.md §2).
const STATUS_TONE: Record<RefundStatus, StatusChipTone> = {
  requested: statusTone("requested"),
  approved: statusTone("approved"),
  rejected: statusTone("rejected"),
  processed: "success",
  failed: statusTone("failed"),
};

const STATUS_LABEL: Record<RefundStatus, string> = {
  requested: "Requested",
  approved: "Approved",
  rejected: "Rejected",
  processed: "Processed",
  failed: "Failed",
};

export function RefundStatusChip({ status }: { status: RefundStatus }) {
  return <StatusChip tone={STATUS_TONE[status]} label={STATUS_LABEL[status]} />;
}
