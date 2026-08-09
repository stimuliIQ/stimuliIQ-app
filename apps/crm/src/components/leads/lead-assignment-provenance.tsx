// LeadAssignmentProvenance — the four-line answer to "who is accountable for this lead,
// and what has actually happened to it?"
//
// Every fact here comes from a column on the lead itself, not from the audit log: the
// audit log records the same events but is admin-only and unreadable at a glance, so in
// practice nobody ever looked. Putting provenance on the record is what turns "somebody
// changed the owner at some point" into something a manager can act on in a stand-up.
//
// The NULL cases carry as much meaning as the populated ones and are spelled out rather
// than blanked:
//   createdByName null  → the lead came from the public site, not from a staff member.
//   assignedByName null → the round-robin chose the owner; no human made that call.
//   firstContactedAt null → NOBODY HAS CALLED THIS LEAD YET. Rendered as a warning, not
//                           as an em-dash, because it is the single most actionable fact
//                           on the whole record.
import * as React from "react";
import { AlertTriangle } from "lucide-react";
import type { LeadDetail, LeadSummary } from "@repo/types";

interface LeadAssignmentProvenanceProps {
  lead: LeadSummary | LeadDetail;
}

/** "12 Jun 2026, 14:30" — absolute, not "3 days ago": staff cross-reference these against call logs. */
function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Elapsed time in the coarsest unit that still reads honestly ("4h", "3d"). */
function formatElapsed(fromIso: string, toIso: string): string {
  const minutes = Math.max(0, Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 60000));
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / (60 * 24))}d`;
}

export function LeadAssignmentProvenance({ lead }: LeadAssignmentProvenanceProps): React.JSX.Element {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs" data-testid="lead-assignment-provenance">
      <dt className="text-fg-muted">Owner</dt>
      <dd className="text-fg">
        {lead.ownerName ?? <span className="text-warning">Unassigned</span>}
        {lead.assignedAt ? (
          <span className="text-fg-muted">
            {" — "}
            {lead.assignedByName ? `assigned by ${lead.assignedByName}` : "auto-assigned"} on{" "}
            {formatDateTime(lead.assignedAt)}
          </span>
        ) : null}
      </dd>

      <dt className="text-fg-muted">Created by</dt>
      <dd className="text-fg">
        {lead.createdByName ?? <span className="text-fg-muted">Website (inbound)</span>}
        <span className="text-fg-muted"> on {formatDateTime(lead.createdAt)}</span>
      </dd>

      <dt className="text-fg-muted">First contact</dt>
      <dd>
        {lead.firstContactedAt ? (
          <span className="text-fg">
            {formatDateTime(lead.firstContactedAt)}
            {/* Response time is only meaningful measured from the moment it became
                someone's job — from creation it would blame the assignee for the delay
                before the handover. */}
            {lead.assignedAt ? (
              <span className="text-fg-muted"> ({formatElapsed(lead.assignedAt, lead.firstContactedAt)} after assignment)</span>
            ) : null}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 font-medium text-warning">
            <AlertTriangle className="size-3.5" aria-hidden="true" />
            Not contacted yet
          </span>
        )}
      </dd>

      <dt className="text-fg-muted">Last activity</dt>
      <dd className="text-fg">
        {lead.lastActivityAt ? formatDateTime(lead.lastActivityAt) : <span className="text-fg-muted">No activity logged</span>}
      </dd>
    </dl>
  );
}
