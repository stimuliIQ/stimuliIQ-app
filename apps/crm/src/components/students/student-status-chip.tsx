// Maps the `StudentStatus` domain enum (lead|active|alumni) to a StatusChip
// tone — the ONLY place this mapping lives (docs/07 §5: "domain enums map to
// a tone at the call site, never hardcoded inside StatusChip").
import { StatusChip, type StatusChipTone } from "@repo/ui";
import type { StudentStatus } from "@repo/types";

// `alumni` = success, matching `LifecycleChip`'s terminal-success phase tone
// (docs/specs/crm-ui-consistency.md §2/§3) — a graduated student must render
// the same color on every surface, not neutral here vs. success on lifecycle.
const STATUS_TONE: Record<StudentStatus, StatusChipTone> = {
  lead: "info",
  active: "success",
  alumni: "success",
};

const STATUS_LABEL: Record<StudentStatus, string> = {
  lead: "Lead",
  active: "Active",
  alumni: "Completed",
};

export function StudentStatusChip({ status }: { status: StudentStatus }) {
  return <StatusChip tone={STATUS_TONE[status]} label={STATUS_LABEL[status]} />;
}
