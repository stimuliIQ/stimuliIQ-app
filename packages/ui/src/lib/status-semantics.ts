import type { StatusChipTone } from "../components/status-chip";

/**
 * STATUS_SEMANTICS — canonical status-state → tone map, per
 * docs/specs/crm-ui-consistency.md §2. `StatusChip` only knows about the five
 * tones; every domain enum across the apps (lead/student/batch/campaign/
 * booking/report-schedule/...) maps a human-facing state word onto one of
 * these tones **at the call site**, and this map is the single source of
 * truth for that mapping so the same word never renders two different colors
 * on two different screens.
 *
 * This module intentionally does NOT know about any app-specific enum
 * (`LeadStatus`, `CampaignStatus`, ...) — call sites translate their own
 * enum values to a `StatusSemantic` key (usually a 1:1 lowercase mapping)
 * and look up the tone here. See `makeStatusChip` (status-chip.tsx) for a
 * factory that wires an enum → label + tone map in one shot.
 *
 * Resolved conflicts from the audit (docs/specs/crm-ui-consistency.md §2):
 *   - completed / graduated / sent            → success (was neutral on some)
 *   - cancelled                                → neutral (never danger — a
 *                                                 deliberate, non-error stop;
 *                                                 danger is reserved for true
 *                                                 failures)
 *   - paused                                   → warning (was neutral on
 *                                                 report-schedule)
 *   - requested / in-progress / running /
 *     sending / authorized                     → info (not warning — warning
 *                                                 is reserved for "needs a
 *                                                 human" states)
 *   - approved (pending processing)            → info (not warning)
 */
export type StatusSemantic =
  // success — terminal-good / active-good
  | "active"
  | "completed"
  | "sent"
  | "succeeded"
  | "paid"
  | "published"
  | "graduated"
  | "certified"
  | "passed"
  | "resolved"
  | "won"
  // info — in-progress / awaiting, no error
  | "pending"
  | "requested"
  | "scheduled"
  | "running"
  | "sending"
  | "in-progress"
  | "authorized"
  | "approved"
  | "new"
  // warning — needs attention / paused / aging
  | "paused"
  | "on-hold"
  | "expired"
  | "archived"
  | "overdue"
  | "refunded"
  | "at-risk"
  // danger — error / hard-negative
  | "failed"
  | "rejected"
  | "void"
  | "revoked"
  | "blocked"
  | "lost"
  // neutral — inert / not-started / user-cancelled
  | "draft"
  | "inactive"
  | "cancelled"
  | "closed"
  | "not-started"
  | "n/a"
  | "unknown";

/** Canonical `StatusSemantic` → `StatusChipTone` map — the single source of truth (§2). */
export const STATUS_SEMANTICS: Record<StatusSemantic, StatusChipTone> = {
  // success
  active: "success",
  completed: "success",
  sent: "success",
  succeeded: "success",
  paid: "success",
  published: "success",
  graduated: "success",
  certified: "success",
  passed: "success",
  resolved: "success",
  won: "success",
  // info
  pending: "info",
  requested: "info",
  scheduled: "info",
  running: "info",
  sending: "info",
  "in-progress": "info",
  authorized: "info",
  approved: "info",
  new: "info",
  // warning
  paused: "warning",
  "on-hold": "warning",
  expired: "warning",
  archived: "warning",
  overdue: "warning",
  refunded: "warning",
  "at-risk": "warning",
  // danger
  failed: "danger",
  rejected: "danger",
  void: "danger",
  revoked: "danger",
  blocked: "danger",
  lost: "danger",
  // neutral
  draft: "neutral",
  inactive: "neutral",
  cancelled: "neutral",
  closed: "neutral",
  "not-started": "neutral",
  "n/a": "neutral",
  unknown: "neutral",
};

/**
 * Resolves a canonical status state to its `StatusChipTone`. Falls back to
 * `"neutral"` for anything not in the map (fail-safe rather than fail-loud —
 * an unrecognized state should render as inert, not crash a list/detail view).
 */
export function statusTone(state: StatusSemantic | (string & {})): StatusChipTone {
  return (STATUS_SEMANTICS as Record<string, StatusChipTone | undefined>)[state] ?? "neutral";
}
