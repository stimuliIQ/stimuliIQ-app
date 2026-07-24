// Maps `InvoiceStatus` (draft|issued|void) to a StatusChip tone — mirrors
// components/shared/batch-status-chip.tsx.
import { StatusChip, type StatusChipTone } from "@repo/ui";
import type { InvoiceStatus } from "@repo/types";

const STATUS_TONE: Record<InvoiceStatus, StatusChipTone> = {
  draft: "neutral",
  issued: "success",
  void: "danger",
};

const STATUS_LABEL: Record<InvoiceStatus, string> = {
  draft: "Draft",
  issued: "Issued",
  void: "Void",
};

export function InvoiceStatusChip({ status }: { status: InvoiceStatus }) {
  return <StatusChip tone={STATUS_TONE[status]} label={STATUS_LABEL[status]} />;
}
