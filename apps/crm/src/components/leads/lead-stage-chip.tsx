// Maps `LeadStage` (new|follow_up|won|lost — the simplified 4-stage model) to a
// StatusChip tone — mirrors components/commerce/order-status-chip.tsx.
import { StatusChip, statusTone, type StatusChipTone } from "@repo/ui";
import type { LeadStage } from "@repo/types";

// `new` = info (docs/specs/crm-ui-consistency.md §2) — was neutral here while
// contact-message-list.tsx's ContactSubmissionStatus "new" was already info;
// aligned so the same "just arrived" state reads the same color everywhere.
const STAGE_TONE: Record<LeadStage, StatusChipTone> = {
  new: statusTone("new"),
  follow_up: "info",
  won: statusTone("won"),
  lost: statusTone("lost"),
};

export const STAGE_LABEL: Record<LeadStage, string> = {
  new: "New Lead",
  follow_up: "Follow-up",
  won: "Won",
  lost: "Lost",
};

export function LeadStageChip({ stage }: { stage: LeadStage }) {
  return <StatusChip tone={STAGE_TONE[stage]} label={STAGE_LABEL[stage]} />;
}

export const LEAD_STAGE_COLUMNS: { id: LeadStage; title: string }[] = [
  { id: "new", title: "New Lead" },
  { id: "follow_up", title: "Follow-up" },
  { id: "won", title: "Won" },
  { id: "lost", title: "Lost" },
];

/**
 * Client-side pipeline transition hints — MUST mirror the server's `STAGE_TRANSITIONS`
 * (apps/api/.../leads.service.ts). The 4-stage model is deliberately permissive (the
 * redesign removed forced linear stepping): a lead can move forward, be marked won/lost
 * from anywhere, and a lost/won lead can be reopened. Used only to disable illegal drop
 * targets up front (better UX than a 422 round-trip) — the server remains the real gate.
 */
export const LEAD_STAGE_TRANSITIONS: Record<LeadStage, readonly LeadStage[]> = {
  new: ["follow_up", "won", "lost"],
  follow_up: ["won", "lost", "new"],
  won: ["follow_up", "lost"],
  lost: ["new", "follow_up"],
};

/** True if a lead may move from `from` to `to` under the permissive rule above. */
export function canMoveLeadStage(from: LeadStage, to: LeadStage): boolean {
  return LEAD_STAGE_TRANSITIONS[from]?.includes(to) ?? false;
}
