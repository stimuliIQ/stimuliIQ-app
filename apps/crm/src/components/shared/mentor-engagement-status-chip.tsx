// Maps `MentorEngagementStatus` (prospective|active|inactive) to a
// StatusChip tone — mirrors batch-status-chip.tsx's pattern. AC-10
// (docs/specs/phase-8-mentor.md): `inactive` is a normal engagement status,
// distinct from soft-delete — this chip never represents deletion.
import { StatusChip, type StatusChipTone } from "@repo/ui";
import type { MentorEngagementStatus } from "@repo/types";

const STATUS_TONE: Record<MentorEngagementStatus, StatusChipTone> = {
  prospective: "info",
  active: "success",
  inactive: "neutral",
};

const STATUS_LABEL: Record<MentorEngagementStatus, string> = {
  prospective: "Prospective",
  active: "Active",
  inactive: "Inactive",
};

export function MentorEngagementStatusChip({ status }: { status: MentorEngagementStatus }) {
  return <StatusChip tone={STATUS_TONE[status]} label={STATUS_LABEL[status]} />;
}
