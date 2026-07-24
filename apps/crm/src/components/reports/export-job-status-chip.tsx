// Maps `ExportJobStatus` (queued|running|succeeded|failed) to a StatusChip
// tone — mirrors components/commerce/refund-status-chip.tsx.
import { StatusChip, type StatusChipTone } from "@repo/ui";
import type { ExportJobStatus } from "@repo/types";

const STATUS_TONE: Record<ExportJobStatus, StatusChipTone> = {
  queued: "neutral",
  running: "info",
  succeeded: "success",
  failed: "danger",
};

const STATUS_LABEL: Record<ExportJobStatus, string> = {
  queued: "Queued",
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
};

export function ExportJobStatusChip({ status }: { status: ExportJobStatus }) {
  return <StatusChip tone={STATUS_TONE[status]} label={STATUS_LABEL[status]} />;
}
