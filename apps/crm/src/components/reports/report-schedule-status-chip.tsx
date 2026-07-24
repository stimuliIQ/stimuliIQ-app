// Maps a report schedule's `active` flag + last-run status to StatusChips —
// mirrors components/commerce/refund-status-chip.tsx conventions.
import { StatusChip, statusTone, type StatusChipTone } from "@repo/ui";
import type { ReportScheduleRunStatus } from "@repo/types";

export function ScheduleActiveChip({ active }: { active: boolean }) {
  // "Paused" = warning everywhere (docs/specs/crm-ui-consistency.md §2) — matches
  // campaign-status-chip's "Paused", was neutral only here.
  return active ? (
    <StatusChip tone="success" label="Active" />
  ) : (
    <StatusChip tone={statusTone("paused")} label="Paused" />
  );
}

const RUN_STATUS_TONE: Record<ReportScheduleRunStatus, StatusChipTone> = {
  succeeded: "success",
  failed: "danger",
  skipped_suppressed: "warning",
  sent_no_data: "info",
};

const RUN_STATUS_LABEL: Record<ReportScheduleRunStatus, string> = {
  succeeded: "Sent",
  failed: "Failed",
  skipped_suppressed: "Skipped (suppressed)",
  sent_no_data: "Sent (no data)",
};

export function ScheduleRunStatusChip({ status }: { status: ReportScheduleRunStatus }) {
  return <StatusChip tone={RUN_STATUS_TONE[status]} label={RUN_STATUS_LABEL[status]} />;
}
