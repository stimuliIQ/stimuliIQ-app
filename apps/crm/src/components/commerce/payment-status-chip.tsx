// Maps `PaymentStatus` (created|authorized|captured|failed|refunded) to a
// StatusChip tone — mirrors components/shared/batch-status-chip.tsx.
import { StatusChip, type StatusChipTone } from "@repo/ui";
import type { PaymentStatus } from "@repo/types";

const STATUS_TONE: Record<PaymentStatus, StatusChipTone> = {
  created: "info",
  authorized: "info",
  captured: "success",
  failed: "danger",
  refunded: "warning",
};

const STATUS_LABEL: Record<PaymentStatus, string> = {
  created: "Created",
  authorized: "Authorized",
  captured: "Captured",
  failed: "Failed",
  refunded: "Refunded",
};

export function PaymentStatusChip({ status }: { status: PaymentStatus }) {
  return <StatusChip tone={STATUS_TONE[status]} label={STATUS_LABEL[status]} />;
}
