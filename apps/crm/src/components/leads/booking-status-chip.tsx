// Maps `BookingStatus` (requested|confirmed|completed|cancelled|no_show) to
// a StatusChip tone — mirrors components/commerce/order-status-chip.tsx.
import { StatusChip, statusTone, type StatusChipTone } from "@repo/ui";
import type { BookingStatus } from "@repo/types";

// `requested` = info and `cancelled` = neutral per docs/specs/crm-ui-consistency.md §2
// — cancelled is a deliberate, non-error stop, not a failure; danger is reserved for
// true errors (no_show / failed).
const STATUS_TONE: Record<BookingStatus, StatusChipTone> = {
  requested: statusTone("requested"),
  confirmed: "info",
  completed: statusTone("completed"),
  cancelled: statusTone("cancelled"),
  no_show: "warning",
};

const STATUS_LABEL: Record<BookingStatus, string> = {
  requested: "Requested",
  confirmed: "Confirmed",
  completed: "Completed",
  cancelled: "Cancelled",
  no_show: "No-show",
};

export function BookingStatusChip({ status }: { status: BookingStatus }) {
  return <StatusChip tone={STATUS_TONE[status]} label={STATUS_LABEL[status]} />;
}
