// Leads ▸ Tasks — the user's follow-up tasks across leads, with
// overdue/today/upcoming filters (docs/03 §7.12, §10 IA). Reuses
// task-list.tsx for rendering + the complete action.
import * as React from "react";
import { PageHeader, Select, SelectItem } from "@repo/ui";
import type { MeResponse } from "@repo/types";

import { useActivitiesList } from "../../hooks/use-activities";
import { TaskList } from "./task-list";

type TaskFilter = "overdue" | "today" | "upcoming" | "all";

const FILTER_OPTIONS: { value: TaskFilter; label: string }[] = [
  { value: "overdue", label: "Overdue" },
  { value: "today", label: "Due today" },
  { value: "upcoming", label: "Upcoming" },
  { value: "all", label: "All pending" },
];

interface TasksPageProps {
  me: MeResponse | undefined;
}

export function TasksPage({ me: _me }: TasksPageProps): React.JSX.Element {
  const [filter, setFilter] = React.useState<TaskFilter>("overdue");

  // dueBefore narrows server-side for overdue/today; upcoming/all are
  // narrowed client-side from the same "pending tasks" fetch since the
  // contract has no `dueAfter` — documented tradeoff, dataset is small
  // (a counsellor's own task list).
  const now = React.useMemo(() => new Date(), []);
  const endOfToday = React.useMemo(() => {
    const d = new Date(now);
    d.setHours(23, 59, 59, 999);
    return d;
  }, [now]);

  const dueBefore = filter === "overdue" ? now.toISOString() : filter === "today" ? endOfToday.toISOString() : undefined;

  const tasksQuery = useActivitiesList({ pendingTasks: true, dueBefore, page: 1, pageSize: 100 });

  const filteredTasks = React.useMemo(() => {
    const items = tasksQuery.data?.items ?? [];
    const sorted = [...items].sort((a, b) => {
      if (!a.dueAt || !b.dueAt) return 0;
      return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
    });
    if (filter === "upcoming") {
      return sorted.filter((task) => task.dueAt && new Date(task.dueAt) > now);
    }
    return sorted;
  }, [tasksQuery.data, filter, now]);

  return (
    <div className="space-y-4 md:space-y-5" data-testid="tasks-page">
      <PageHeader
        title="Tasks"
        description="Your follow-up tasks across all leads, with SLA timers."
        actions={
          <Select
            label="Filter"
            placeholder="Select filter"
            value={filter}
            onValueChange={(value) => setFilter(value as TaskFilter)}
            wrapperClassName="w-44"
            data-testid="tasks-filter"
          >
            {FILTER_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </Select>
        }
      />

      <TaskList
        tasks={filteredTasks}
        isLoading={tasksQuery.isLoading}
        isError={tasksQuery.isError}
        error={tasksQuery.error}
        onRetry={() => tasksQuery.refetch()}
        showLeadId
        emptyTitle="No tasks here"
        emptyDescription="Try a different filter, or check back later."
        data-testid="tasks-page-list"
      />
    </div>
  );
}
