// AssessmentsListContent — student assessment list view.
// Data from useMyAssessments(); all presentation here — no fetching.
// CLAUDE.md §3: no business logic in components.
"use client";

import * as React from "react";
import Link from "next/link";
import { FileQuestion } from "lucide-react";
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
  EmptyState,
  PageHeader,
  Skeleton,
  StatusChip,
  type StatusChipTone,
} from "@repo/ui";
import type { AssessmentSummary } from "@repo/types";

import { useMyAssessments } from "../../hooks/use-assessments";

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function AssessmentsListSkeleton(): React.JSX.Element {
  return (
    <div aria-busy="true" aria-live="polite" role="status" aria-label="Loading assessments">
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} shape="block" className="h-24 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Assessment row
// ---------------------------------------------------------------------------

function assessmentStatusTone(_summary: AssessmentSummary): { tone: StatusChipTone; label: string } {
  // AssessmentSummary doesn't carry per-student attempt status in the list view.
  // The detail page shows attemptsRemaining/hasPassingAttempt.
  // Here we indicate type only.
  return {
    tone: "neutral",
    label: _summary.type === "test" ? "Test" : "Quiz",
  };
}

function formatTime(seconds: number | null): string {
  if (seconds === null) return "Untimed";
  const m = Math.floor(seconds / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  return `${m} min`;
}

function AssessmentRow({ item }: { item: AssessmentSummary }): React.JSX.Element {
  const { tone, label } = assessmentStatusTone(item);

  return (
    <li>
      <Link
        href={`/assessments/${item.id}`}
        data-testid="assessment-row"
        className="flex items-start gap-4 rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <span aria-hidden="true" className="mt-0.5 shrink-0 text-fg-subtle">
          <FileQuestion className="size-5" strokeWidth={1.5} />
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <p className="text-sm font-medium text-fg line-clamp-1">{item.title}</p>
            <StatusChip tone={tone} label={label} size="sm" />
          </div>
          <p className="mt-0.5 text-xs text-fg-muted">
            {item.moduleTitle}
            {" · "}
            {formatTime(item.timeLimitS)}
            {" · "}
            {item.questionCount} question{item.questionCount !== 1 ? "s" : ""}
            {" · "}
            {item.totalPoints} pt{item.totalPoints !== 1 ? "s" : ""}
          </p>
          <p className="mt-1 text-xs text-fg-subtle">
            Pass: {item.passPct}%
            {item.isRequired ? " · Required for certificate" : ""}
            {" · "}
            {item.attemptsAllowed} attempt{item.attemptsAllowed !== 1 ? "s" : ""} allowed
          </p>
        </div>
      </Link>
    </li>
  );
}

// ---------------------------------------------------------------------------
// AssessmentsListContent — top-level client component
// ---------------------------------------------------------------------------

export function AssessmentsListContent(): React.JSX.Element {
  const { assessments, isLoading, isSignedOut, isError, error, refetch } = useMyAssessments();

  if (isLoading) return <AssessmentsListSkeleton />;

  if (isSignedOut) {
    return (
      <Card data-testid="assessments-signed-out">
        <CardHeader>
          <CardTitle>You&apos;re signed out</CardTitle>
          <CardDescription>Sign in to see your assessments.</CardDescription>
        </CardHeader>
        <CardFooter>
          <Button asChild data-testid="assessments-sign-in-cta">
            <a href="/login">Sign in</a>
          </Button>
        </CardFooter>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card data-testid="assessments-error">
        <CardHeader>
          <CardTitle>Failed to load assessments</CardTitle>
          <CardDescription>
            {error?.problem.detail ?? error?.problem.title ?? "Something went wrong."}
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Button variant="secondary" onClick={refetch} data-testid="assessments-retry">
            Try again
          </Button>
        </CardFooter>
      </Card>
    );
  }

  if (assessments.length === 0) {
    return (
      <EmptyState
        data-testid="assessments-empty"
        title="No assessments yet"
        description="Quizzes and tests from your courses will appear here once published."
      />
    );
  }

  return (
    <div data-testid="assessments-list-content" className="space-y-6 md:space-y-8">
      <PageHeader
        title="My Assessments"
        description="Quizzes and tests from your enrolled courses."
      />
      <ul className="flex flex-col gap-2" aria-label="Assessments">
        {assessments.map((item) => (
          <AssessmentRow key={item.id} item={item} />
        ))}
      </ul>
    </div>
  );
}
