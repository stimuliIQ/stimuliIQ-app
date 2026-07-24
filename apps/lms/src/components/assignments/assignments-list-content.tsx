// AssignmentsListContent — student assignment list view.
// Data from useMyAssignments(); all presentation here — no fetching.
// Grouped by kind (regular assignments vs projects) for clarity.
// CLAUDE.md §3: no business logic in components.
"use client";

import * as React from "react";
import Link from "next/link";
import { ClipboardList, FolderKanban } from "lucide-react";
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
} from "@repo/ui";
import type { AssignmentListItem } from "@repo/types";

import { useMyAssignments } from "../../hooks/use-assignments";
import { AssignmentStatusChip } from "./assignment-status-chip";

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function AssignmentsListSkeleton(): React.JSX.Element {
  return (
    <div aria-busy="true" aria-live="polite" role="status" aria-label="Loading assignments">
      <div className="space-y-3">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} shape="block" className="h-20 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single assignment row
// ---------------------------------------------------------------------------

function AssignmentRow({ item }: { item: AssignmentListItem }): React.JSX.Element {
  const href =
    item.kind === "project"
      ? `/assignments/${item.id}/project`
      : `/assignments/${item.id}`;

  const formattedDue = item.dueAt
    ? new Date(item.dueAt).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : null;

  return (
    <li>
      <Link
        href={href}
        data-testid="assignment-row"
        className="flex items-start gap-4 rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        {/* Icon */}
        <span aria-hidden="true" className="mt-0.5 shrink-0 text-fg-subtle">
          {item.kind === "project" ? (
            <FolderKanban className="size-5" strokeWidth={1.5} />
          ) : (
            <ClipboardList className="size-5" strokeWidth={1.5} />
          )}
        </span>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <p className="text-sm font-medium text-fg line-clamp-1">{item.title}</p>
            <AssignmentStatusChip status={item.status} />
          </div>
          <p className="mt-0.5 text-xs text-fg-muted line-clamp-1">
            {item.lessonTitle}
            {formattedDue ? ` · Due ${formattedDue}` : " · No due date"}
          </p>
          {item.status === "graded" && item.score !== null ? (
            <p className="mt-1 text-xs font-medium text-success" aria-label={`Score: ${item.score} of ${item.maxScoreDisplay}`}>
              Score: {item.score}/{item.maxScoreDisplay}
            </p>
          ) : null}
          {item.kind === "project" && item.milestoneCount > 0 ? (
            <p className="mt-1 text-xs text-fg-subtle">
              {item.milestoneCount} milestone{item.milestoneCount !== 1 ? "s" : ""}
            </p>
          ) : null}
        </div>
      </Link>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Section (assignments vs projects)
// ---------------------------------------------------------------------------

function AssignmentSection({
  title,
  items,
  emptyText,
}: {
  title: string;
  items: AssignmentListItem[];
  emptyText: string;
}): React.JSX.Element {
  if (items.length === 0) {
    return (
      <section aria-labelledby={`section-${title.toLowerCase().replace(/\s+/g, "-")}`}>
        <h2
          id={`section-${title.toLowerCase().replace(/\s+/g, "-")}`}
          className="mb-3 flex items-center gap-2 text-base font-semibold text-fg"
        >
          <span aria-hidden="true" className="h-4 w-1 rounded-full bg-brand-500" />
          {title}
        </h2>
        <p className="text-sm text-fg-muted">{emptyText}</p>
      </section>
    );
  }

  return (
    <section aria-labelledby={`section-${title.toLowerCase().replace(/\s+/g, "-")}`}>
      <h2
        id={`section-${title.toLowerCase().replace(/\s+/g, "-")}`}
        className="mb-3 flex items-center gap-2 text-base font-semibold text-fg"
      >
        <span aria-hidden="true" className="h-4 w-1 rounded-full bg-brand-500" />
        {title}
      </h2>
      <ul className="flex flex-col gap-2" aria-label={title}>
        {items.map((item) => (
          <AssignmentRow key={item.id} item={item} />
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// AssignmentsListContent — top-level client component
// ---------------------------------------------------------------------------

export function AssignmentsListContent(): React.JSX.Element {
  const { assignments, isLoading, isSignedOut, isError, error, refetch } = useMyAssignments();

  if (isLoading) return <AssignmentsListSkeleton />;

  if (isSignedOut) {
    return (
      <Card data-testid="assignments-signed-out">
        <CardHeader>
          <CardTitle>You&apos;re signed out</CardTitle>
          <CardDescription>Sign in to see your assignments.</CardDescription>
        </CardHeader>
        <CardFooter>
          <Button asChild data-testid="assignments-sign-in-cta">
            <a href="/login">Sign in</a>
          </Button>
        </CardFooter>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card data-testid="assignments-error">
        <CardHeader>
          <CardTitle>Failed to load assignments</CardTitle>
          <CardDescription>
            {error?.problem.detail ?? error?.problem.title ?? "Something went wrong."}
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Button variant="secondary" onClick={refetch} data-testid="assignments-retry">
            Try again
          </Button>
        </CardFooter>
      </Card>
    );
  }

  if (assignments.length === 0) {
    return (
      <EmptyState
        data-testid="assignments-empty"
        title="No assignments yet"
        description="Assignments from your courses will appear here once your faculty publishes them."
      />
    );
  }

  const regularAssignments = assignments.filter((a) => a.kind === "assignment");
  const projects = assignments.filter((a) => a.kind === "project");

  return (
    <div data-testid="assignments-list-content" className="space-y-6 md:space-y-8">
      <PageHeader
        title="My Assignments"
        description="Assignments and projects from your enrolled courses."
      />
      <AssignmentSection
        title="Assignments"
        items={regularAssignments}
        emptyText="No regular assignments."
      />
      <AssignmentSection
        title="Projects"
        items={projects}
        emptyText="No projects assigned."
      />
    </div>
  );
}
