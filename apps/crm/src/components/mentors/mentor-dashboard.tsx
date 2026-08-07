// Mentor-facing dashboard (WS-4, docs/specs/phase-8-mentor.md, LOCK-3: the
// Mentor role logs into this SAME crm app, not the LMS). Scoped entirely
// server-side (LOCK-2/Rule M-1) — this component renders ONLY what
// `GET /me/mentor/dashboard` returns; it never accepts a batch/mentor
// selector from the client (AC-46/47/48 — a mentor cannot reach another
// batch by guessing an id here, there is no id input on this screen at
// all). Loading/empty(AC-51)/error(+retry) states per AC-60. The
// mark-complete affordance reuses the exact same `batches.markComplete`
// endpoint/permission as the CRM staff Completion tab (AC-53) — no separate
// mentor-only completion mechanism. "View full breakdown" deep-links into
// the existing Batches module, which is scoped identically for the Mentor
// role (assigned-only, via `batches.view`) — the same batch-detail-drawer
// Completion tab staff use (AC-52).
import * as React from "react";
import { CheckCircle2 } from "lucide-react";
import { Link } from "@tanstack/react-router";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  EmptyState,
  PageHeader,
  ProgressBar,
  Skeleton,
  useToast,
} from "@repo/ui";
import type { MentorDashboardBatchCard, MeResponse } from "@repo/types";
import { ApiError } from "@repo/api-client";

import { useMentorDashboard } from "../../hooks/use-mentor-dashboard";
import { useMarkBatchComplete } from "../../hooks/use-batch-completion";
import { hasPermission } from "../../lib/permissions";
import { queryErrorMessage, surfaceError } from "../../lib/surface-error";
import { BatchStatusChip } from "../shared/batch-status-chip";

interface MentorDashboardProps {
  me: MeResponse | undefined;
}

export function MentorDashboard({ me }: MentorDashboardProps): React.JSX.Element {
  const canMarkComplete = hasPermission(me?.permissions, "batches.markComplete");
  const { data, isLoading, isError, error, refetch } = useMentorDashboard();
  const markComplete = useMarkBatchComplete();
  const { toast } = useToast();
  const [completeTarget, setCompleteTarget] = React.useState<MentorDashboardBatchCard | null>(null);

  const handleMarkComplete = async () => {
    if (!completeTarget) return;
    try {
      const result = await markComplete.mutateAsync(completeTarget.batchId);
      toast({
        title: "Batch marked complete",
        description: `${result.summary.batchName} is now marked complete.`,
        variant: "success",
      });
      setCompleteTarget(null);
    } catch (err) {
      surfaceError(toast, err, "Couldn't mark this batch complete");
      setCompleteTarget(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4" data-testid="mentor-dashboard-loading">
        <Skeleton shape="line" className="h-6 w-64" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton shape="block" className="h-40" />
          <Skeleton shape="block" className="h-40" />
        </div>
      </div>
    );
  }

  // 403 here means "you're not an active mentor" (the endpoint requires a mentor
  // profile, not just the permission — admins hold the permission via their
  // wildcard grant but have no profile). Show a settled "not for you" state, NOT
  // a retryable error — retrying always 403s. This only fires on a deep-link now
  // that the nav hides this route for non-mentors.
  if (isError && error instanceof ApiError && error.isForbidden) {
    return (
      <EmptyState
        data-testid="mentor-dashboard-forbidden"
        title="Mentor dashboard"
        description="This dashboard is only available to active mentors. If you're staff, you can review any mentor's batches from the Academics → Batches section."
        action={
          <Button variant="secondary" asChild>
            <Link to="/batches">Go to Batches</Link>
          </Button>
        }
      />
    );
  }

  if (isError) {
    return (
      <EmptyState
        data-testid="mentor-dashboard-error"
        title="Couldn't load your dashboard"
        description={queryErrorMessage(error, "Something went wrong fetching your assigned batches.")}
        action={
          <Button variant="secondary" onClick={() => refetch()} data-testid="mentor-dashboard-retry">
            Try again
          </Button>
        }
      />
    );
  }

  const batches = data?.batches ?? [];

  return (
    <div className="space-y-4 md:space-y-5" data-testid="mentor-dashboard">
      <PageHeader
        title={`Welcome${data ? `, ${data.mentorFullName}` : ""}`}
        description={
          <>
            Your assigned batch{batches.length === 1 ? "" : "es"} — this is scoped to you only; you can't see other
            mentors' batches, students, or data outside this list.
          </>
        }
      />

      {batches.length === 0 ? (
        <EmptyState
          data-testid="mentor-dashboard-empty"
          title="No batches assigned yet"
          description="An Admin or Branch Manager will assign you to a batch — check back once you're staffed."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {batches.map((batch) => (
            <Card key={batch.batchId} data-testid={`mentor-dashboard-card-${batch.batchId}`}>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle>{batch.batchName}</CardTitle>
                  <BatchStatusChip status={batch.status} />
                </div>
                <CardDescription>
                  {batch.programTitle}
                  {batch.isLead ? " · You are the lead mentor" : ""}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <p className="text-sm text-fg-muted">{batch.studentCount} student(s)</p>
                <ProgressBar
                  value={batch.percentComplete ?? 0}
                  showLabel
                  label={`${batch.batchName} completion percentage`}
                  data-testid={`mentor-dashboard-progress-${batch.batchId}`}
                />
                <div className="flex items-center justify-between gap-2 pt-1">
                  <Link
                    to="/batches"
                    className="text-xs font-medium text-brand-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    data-testid={`mentor-dashboard-view-link-${batch.batchId}`}
                  >
                    View full breakdown
                  </Link>
                  {canMarkComplete && batch.status === "active" ? (
                    <Button
                      size="sm"
                      onClick={() => setCompleteTarget(batch)}
                      data-testid={`mentor-dashboard-mark-complete-${batch.batchId}`}
                    >
                      <CheckCircle2 className="size-4" aria-hidden="true" />
                      Mark complete
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(completeTarget)}
        onOpenChange={(next) => !next && setCompleteTarget(null)}
        title="Mark this batch complete?"
        description={
          completeTarget
            ? `${completeTarget.batchName}: ${completeTarget.studentCount} student(s), ${completeTarget.percentComplete ?? 0}% average completion. This is an operational milestone — it does not require 100% completion and cannot be undone from here.`
            : undefined
        }
        confirmLabel="Mark complete"
        loading={markComplete.isPending}
        onConfirm={handleMarkComplete}
        data-testid="mentor-dashboard-mark-complete-confirm"
      />
    </div>
  );
}
