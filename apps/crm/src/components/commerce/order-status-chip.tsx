// Maps `OrderStatus` (created|paid|failed|refunded) to a StatusChip tone —
// mirrors components/shared/batch-status-chip.tsx conventions.
import { StatusChip, type StatusChipTone } from "@repo/ui";
import type { OrderStatus } from "@repo/types";

const STATUS_TONE: Record<OrderStatus, StatusChipTone> = {
  created: "info",
  paid: "success",
  failed: "danger",
  refunded: "warning",
};

const STATUS_LABEL: Record<OrderStatus, string> = {
  created: "Created",
  paid: "Paid",
  failed: "Failed",
  refunded: "Refunded",
};

export function OrderStatusChip({ status }: { status: OrderStatus }) {
  return <StatusChip tone={STATUS_TONE[status]} label={STATUS_LABEL[status]} />;
}
