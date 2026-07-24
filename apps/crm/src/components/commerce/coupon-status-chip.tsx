// Maps `CouponStatus` (active|inactive|expired) to a StatusChip tone —
// mirrors components/shared/batch-status-chip.tsx.
import { StatusChip, type StatusChipTone } from "@repo/ui";
import type { CouponStatus } from "@repo/types";

const STATUS_TONE: Record<CouponStatus, StatusChipTone> = {
  active: "success",
  inactive: "neutral",
  expired: "warning",
};

const STATUS_LABEL: Record<CouponStatus, string> = {
  active: "Active",
  inactive: "Inactive",
  expired: "Expired",
};

export function CouponStatusChip({ status }: { status: CouponStatus }) {
  return <StatusChip tone={STATUS_TONE[status]} label={STATUS_LABEL[status]} />;
}
