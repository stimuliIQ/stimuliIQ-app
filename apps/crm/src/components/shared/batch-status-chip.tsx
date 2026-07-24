// Maps `BatchStatus` (planned|active|completed|archived) to a StatusChip
// tone — used read-only here (Faculty's "assigned batches" list); the full
// Batches module lands in Wave 4b, which should reuse this component rather
// than re-deriving the tone mapping.
import { StatusChip, statusTone, type StatusChipTone } from "@repo/ui";
import type { BatchStatus } from "@repo/types";

// Tones sourced from STATUS_SEMANTICS (docs/specs/crm-ui-consistency.md §2) where
// the state key matches a canonical key — `completed` = success everywhere, not
// neutral (was diverging from lead/campaign/booking "completed").
const STATUS_TONE: Record<BatchStatus, StatusChipTone> = {
  planned: "info",
  active: statusTone("active"),
  completed: statusTone("completed"),
  archived: statusTone("archived"),
};

const STATUS_LABEL: Record<BatchStatus, string> = {
  planned: "Planned",
  active: "Active",
  completed: "Completed",
  archived: "Archived",
};

export function BatchStatusChip({ status }: { status: BatchStatus }) {
  return <StatusChip tone={STATUS_TONE[status]} label={STATUS_LABEL[status]} />;
}
