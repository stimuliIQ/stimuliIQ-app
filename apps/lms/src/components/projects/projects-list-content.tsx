// Projects page — the student's project work, surfaced on its own instead of
// buried inside the Assignments list.
//
// A project IS an assignment with `kind='project'` (+ milestones). This page is a
// filtered view over the same data/cache, so it never disagrees with Assignments.
//
// CERTIFICATE LINK: a program's FINAL project (`isFinal`) is one of the three
// certificate gates — progress ≥90%, required assessments passed, final project
// approved. A program with NO final project satisfies that gate vacuously, so its
// students receive a certificate on completion without any project step. That's
// why this page (and its nav entry) only appear when the student actually has
// project work; the copy below states the consequence explicitly so a student
// knows exactly what stands between them and their certificate.
"use client";

import * as React from "react";
import Link from "next/link";
import { ClipboardList, Award } from "lucide-react";
import { Button, Card, CardDescription, CardHeader, CardTitle, CardFooter, EmptyState, PageHeader, Skeleton, StatusChip } from "@repo/ui";
import type { AssignmentListItem } from "@repo/types";

import { useMyProjects } from "../../hooks/use-my-projects";

function statusTone(status: AssignmentListItem["status"]): "success" | "info" | "warning" | "danger" | "neutral" {
  switch (status) {
    case "graded":
      return "success";
    case "submitted":
      return "info";
    case "overdue":
      return "danger";
    default:
      return "neutral";
  }
}

function statusLabel(status: AssignmentListItem["status"]): string {
  switch (status) {
    case "graded":
      return "Approved";
    case "submitted":
      return "Under review";
    case "overdue":
      return "Overdue";
    default:
      return "Not started";
  }
}

export function ProjectsListContent(): React.JSX.Element {
  const { projects, pendingCount, isLoading, isSignedOut, isError, refetch } = useMyProjects();

  if (isLoading) {
    return (
      <div role="status" aria-busy="true" aria-label="Loading projects" className="space-y-6 md:space-y-8">
        <Skeleton shape="line" className="h-7 w-40" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton shape="block" className="h-44 w-full rounded-2xl" />
          <Skeleton shape="block" className="h-44 w-full rounded-2xl" />
          <Skeleton shape="block" className="h-44 w-full rounded-2xl" />
        </div>
      </div>
    );
  }

  if (isSignedOut) {
    return (
      <Card data-testid="projects-signed-out">
        <CardHeader>
          <CardTitle>You&apos;re signed out</CardTitle>
          <CardDescription>Sign in to see your projects.</CardDescription>
        </CardHeader>
        <CardFooter>
          <Button asChild>
            <a href="/login">Sign in</a>
          </Button>
        </CardFooter>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card data-testid="projects-error">
        <CardHeader>
          <CardTitle>Couldn&apos;t load your projects</CardTitle>
          <CardDescription>Something went wrong. Please try again.</CardDescription>
        </CardHeader>
        <CardFooter>
          <Button variant="secondary" onClick={refetch}>Try again</Button>
        </CardFooter>
      </Card>
    );
  }

  return (
    <div data-testid="projects-content" className="space-y-6 md:space-y-8">
      <PageHeader
        title="Projects"
        description={
          projects.length === 0
            ? "Your programs don't include a project."
            : pendingCount > 0
              ? `${pendingCount} project${pendingCount === 1 ? "" : "s"} still to complete.`
              : "All your projects are approved."
        }
      />

      {projects.length === 0 ? (
        <EmptyState
          title="No projects in your programs"
          description="This program doesn't require a project. Finish your lessons and assessments and your certificate will be issued."
          action={
            <Button asChild variant="secondary" size="sm">
              <Link href="/courses">Back to My Courses</Link>
            </Button>
          }
          data-testid="projects-empty"
        />
      ) : (
        <ul className="m-0 grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 lg:grid-cols-3" data-testid="projects-list">
          {projects.map((p) => (
            <li key={p.id}>
              <Link
                href={`/assignments/${p.id}/project`}
                data-testid="project-row"
                className="group flex h-full flex-col gap-4 rounded-2xl border border-border bg-card p-5 transition-all hover:border-brand-500/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {/* Top row: icon (left) + status (right) — never competes with the title for width. */}
                <div className="flex items-start justify-between gap-3">
                  <span
                    aria-hidden="true"
                    className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-surface text-fg-muted transition-colors group-hover:bg-brand-50 group-hover:text-brand-600 dark:group-hover:bg-brand-500/10 dark:group-hover:text-brand-400"
                  >
                    <ClipboardList className="size-5" />
                  </span>
                  <StatusChip tone={statusTone(p.status)} label={statusLabel(p.status)} size="sm" />
                </div>

                {/* Title + meta — full card width, wraps naturally. */}
                <div className="min-w-0 flex-1">
                  <h2 className="text-base font-semibold leading-snug tracking-tight text-fg">{p.title}</h2>
                  <p className="mt-1.5 text-xs text-fg-muted">
                    {p.lessonTitle}
                    {p.milestoneCount > 0 ? ` · ${p.milestoneCount} milestone${p.milestoneCount === 1 ? "" : "s"}` : ""}
                    {p.score != null ? ` · ${p.score}/${p.maxScoreDisplay}` : ""}
                  </p>
                </div>

                {/* Certificate gate — its own footer row with an award icon, never a wrapping pill. */}
                {p.isFinal ? (
                  <div className="flex items-center gap-1.5 border-t border-border pt-3 text-xs font-medium text-brand-600 dark:text-brand-400">
                    <Award className="size-3.5 shrink-0" aria-hidden="true" />
                    <span>Required for certificate</span>
                  </div>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
