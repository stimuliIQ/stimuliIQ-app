// Student 360 — Timeline tab (Phase 9 Completion T37). Real data via the
// existing audit-log module, filtered to this student's `entity`/`entityId`
// (docs/03 §7.16/§20(b)).
import * as React from "react";
import { ActivityTimeline, type ActivityItem, EmptyState, Skeleton } from "@repo/ui";

import { useAuditLogsList } from "../../hooks/use-audit-logs";

export function StudentTimelineTab({ studentId }: { studentId: string }): React.JSX.Element {
  const { data, isLoading, isError } = useAuditLogsList({ entity: "student", entityId: studentId, page: 1, pageSize: 50 });

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading timeline">
        <Skeleton shape="line" />
        <Skeleton shape="line" />
        <Skeleton shape="line" />
      </div>
    );
  }

  if (isError) {
    return <p role="alert" className="text-sm text-danger">Couldn't load this student's timeline.</p>;
  }

  const items: ActivityItem[] = (data?.items ?? []).map((entry) => ({
    id: entry.id,
    type: "note",
    actorName: entry.actorName ?? "System",
    timestamp: new Date(entry.createdAt),
    content: `${entry.action[0]?.toUpperCase()}${entry.action.slice(1)} — ${entry.entity}`,
  }));

  if (items.length === 0) {
    return <EmptyState title="No activity yet" description="Changes to this student's record will appear here." />;
  }

  return <ActivityTimeline items={items} data-testid="student-timeline" />;
}
