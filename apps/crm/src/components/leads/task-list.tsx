// Shared task-list renderer — activities of type=task, sorted by SLA,
// with a complete action. Used by lead-detail-drawer.tsx (a single lead's
// tasks), counselling-workspace.tsx (today's/overdue queue), and
// tasks-page.tsx (the user's full task list). Pure presentation + the
// complete-task mutation; no other business logic (CLAUDE.md §3).
import * as React from "react";
import { Check } from "lucide-react";
import { Button, EmptyState, SlaChip, Skeleton, useToast } from "@repo/ui";
import type { ActivityDetail } from "@repo/types";

import { useCompleteTask } from "../../hooks/use-activities";
import { queryErrorMessage, surfaceError } from "../../lib/surface-error";

interface TaskListProps {
  tasks: ActivityDetail[];
  isLoading?: boolean;
  isError?: boolean;
  /** The failure behind `isError`, so the empty state can say WHY (403 vs offline vs 500). */
  error?: unknown;
  onRetry?: () => void;
  emptyTitle?: string;
  emptyDescription?: string;
  /** Shows the lead's name alongside each task — used in cross-lead views (Tasks/Counselling). */
  showLeadId?: boolean;
  "data-testid"?: string;
}

export function TaskList({
  tasks,
  isLoading,
  isError,
  error,
  onRetry,
  emptyTitle = "No follow-up tasks",
  emptyDescription = "Tasks you log with a due date will appear here.",
  showLeadId = false,
  "data-testid": testId,
}: TaskListProps): React.JSX.Element {
  const { toast } = useToast();
  const completeTask = useCompleteTask();

  async function handleComplete(task: ActivityDetail) {
    try {
      await completeTask.mutateAsync({ id: task.id, leadId: task.leadId ?? undefined });
      toast({ title: "Task completed", variant: "success" });
    } catch (error) {
      surfaceError(toast, error, "Couldn't complete this task");
    }
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2" data-testid={testId ? `${testId}-loading` : "task-list-loading"}>
        <Skeleton shape="line" />
        <Skeleton shape="line" />
        <Skeleton shape="line" />
      </div>
    );
  }

  if (isError) {
    return (
      <EmptyState
        data-testid={testId ? `${testId}-error` : "task-list-error"}
        title="Couldn't load tasks"
        description={queryErrorMessage(error, "Something went wrong fetching follow-up tasks.")}
        action={
          onRetry ? (
            <Button variant="secondary" onClick={onRetry} data-testid="task-list-retry">
              Try again
            </Button>
          ) : undefined
        }
      />
    );
  }

  if (tasks.length === 0) {
    return <EmptyState data-testid={testId ? `${testId}-empty` : "task-list-empty"} title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <ul className="flex flex-col gap-2" data-testid={testId ?? "task-list"} aria-label="Follow-up tasks">
      {tasks.map((task) => {
        const description = typeof task.payload.description === "string" ? task.payload.description : "Follow-up";
        const done = Boolean(task.doneAt);
        return (
          <li
            key={task.id}
            className="flex items-center justify-between gap-3 rounded-md border border-border bg-card p-3"
            data-testid="task-list-item"
          >
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate text-sm text-fg">{description}</span>
              <span className="text-xs text-fg-muted">
                {task.userName}
                {showLeadId && task.leadId ? ` · Lead ${task.leadId.slice(0, 8)}` : ""}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {task.dueAt ? <SlaChip dueAt={new Date(task.dueAt)} done={done} /> : done ? <SlaChip dueAt={new Date()} done /> : null}
              {!done ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => handleComplete(task)}
                  loading={completeTask.isPending}
                  data-testid="task-list-complete"
                >
                  <Check className="size-3.5" aria-hidden="true" />
                  Complete
                </Button>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
