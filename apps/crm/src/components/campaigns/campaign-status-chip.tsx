// Campaign status chip — maps CampaignStatus → StatusChip tone + label.
// Status conveyed by icon + label, never color alone (WCAG 2.2 AA).
import * as React from "react";
import { StatusChip, statusTone, type StatusChipTone } from "@repo/ui";
import type { CampaignStatus } from "@repo/types";

// Tones sourced from STATUS_SEMANTICS (docs/specs/crm-ui-consistency.md §2) — every
// key here matches a canonical state, so this drift-proofs against future edits.
// `sending` = info, not warning: warning is reserved for "needs a human" states.
const STATUS_MAP: Record<CampaignStatus, { tone: StatusChipTone; label: string }> = {
  draft:     { tone: statusTone("draft"),     label: "Draft" },
  scheduled: { tone: statusTone("scheduled"), label: "Scheduled" },
  sending:   { tone: statusTone("sending"),   label: "Sending" },
  sent:      { tone: statusTone("sent"),      label: "Sent" },
  paused:    { tone: statusTone("paused"),    label: "Paused" },
  cancelled: { tone: statusTone("cancelled"), label: "Cancelled" },
  failed:    { tone: statusTone("failed"),    label: "Failed" },
};

interface CampaignStatusChipProps {
  status: CampaignStatus;
}

export function CampaignStatusChip({ status }: CampaignStatusChipProps): React.JSX.Element {
  const { tone, label } = STATUS_MAP[status] ?? { tone: "neutral" as const, label: status };
  return <StatusChip tone={tone} label={label} />;
}
