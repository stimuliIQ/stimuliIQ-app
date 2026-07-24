// Dashboard widgets — Phase 9 Completion, T35 (docs/plans/phase-9-completion.md,
// docs/02 §7.1 "upcoming assignment/assessment deadlines, announcements, streak +
// recent badges", §7.13 "learning path ... what to do next"). Live Classes was
// dropped from the product — its widget was removed. Each widget is
// presentation-only; the actual data fetching lives in the hooks it composes.
// CLAUDE.md §3: "no business logic in components — use hooks/services".
"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, Award, Bell, ExternalLink, ListChecks } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  PointsBadge,
  Skeleton,
  StatusChip,
  StreakFlame,
} from "@repo/ui";

import { useMyAssignments } from "../../hooks/use-assignments";
import { useNotifications } from "../../hooks/use-notifications";
import { useGamificationSummary } from "../../hooks/use-gamification";
import { useLearningPath } from "../../hooks/use-learning-path";

// ---------------------------------------------------------------------------
// Upcoming deadlines widget
// ---------------------------------------------------------------------------

export function DeadlinesWidget(): React.JSX.Element | null {
  const { assignments, isLoading } = useMyAssignments();

  if (isLoading) {
    return <Skeleton shape="block" className="h-32 w-full rounded-lg" data-testid="dashboard-deadlines-widget-skeleton" />;
  }

  const upcoming = assignments
    .filter((a) => a.dueAt && (a.status === "assigned" || a.status === "overdue"))
    .sort((a, b) => new Date(a.dueAt as string).getTime() - new Date(b.dueAt as string).getTime())
    .slice(0, 4);

  if (upcoming.length === 0) return null;

  return (
    <Card data-testid="dashboard-deadlines-widget">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-1.5 text-sm">
          <ListChecks aria-hidden="true" className="size-4" />
          Upcoming deadlines
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <ul className="flex flex-col gap-2" aria-label="Upcoming assignment deadlines">
          {upcoming.map((a) => (
            <li key={a.id}>
              <Link
                href={`/assignments/${a.id}`}
                className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              >
                <span className="min-w-0 flex-1 truncate text-fg">{a.title}</span>
                <StatusChip
                  tone={a.status === "overdue" ? "danger" : "warning"}
                  size="sm"
                  label={new Date(a.dueAt as string).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                />
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Announcements widget
// ---------------------------------------------------------------------------

export function AnnouncementsWidget(): React.JSX.Element | null {
  const { items, isLoading } = useNotifications();

  if (isLoading) {
    return <Skeleton shape="block" className="h-24 w-full rounded-lg" data-testid="dashboard-announcements-widget-skeleton" />;
  }

  const announcements = items.filter((n) => n.type === "announcement").slice(0, 3);
  if (announcements.length === 0) return null;

  return (
    <Card data-testid="dashboard-announcements-widget">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-1.5 text-sm">
          <Bell aria-hidden="true" className="size-4" />
          Announcements
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <ul className="flex flex-col gap-2" aria-label="Recent announcements">
          {announcements.map((n) => (
            <li key={n.id} className="text-sm">
              <p className="text-fg">{String(n.payload.title ?? "New announcement")}</p>
              <p className="text-xs text-fg-muted">
                {new Date(n.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
              </p>
            </li>
          ))}
        </ul>
        <Button asChild variant="ghost" size="sm" className="mt-2">
          <Link href="/notifications">
            View all
            <ExternalLink aria-hidden="true" className="size-3.5" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Streak / badges widget (compact — full detail lives on /progress)
// ---------------------------------------------------------------------------

export function StreakBadgesWidget(): React.JSX.Element | null {
  const { summary, isLoading } = useGamificationSummary();

  if (isLoading) {
    return <Skeleton shape="block" className="h-16 w-full rounded-lg" data-testid="dashboard-streak-widget-skeleton" />;
  }

  if (!summary) return null;

  const displayPoints = Math.max(0, summary.totalPoints);

  return (
    <Card data-testid="dashboard-streak-widget">
      <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <PointsBadge points={displayPoints} label="XP" size="sm" />
          <StreakFlame days={summary.streak.currentDays} size="sm" />
          {summary.badges.length > 0 ? (
            <span className="inline-flex items-center gap-1 text-xs text-fg-muted">
              <Award aria-hidden="true" className="size-3.5" />
              {summary.badges.length} badge{summary.badges.length === 1 ? "" : "s"}
            </span>
          ) : null}
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link href="/progress">View progress</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Learning path widget — "what to do next" across active enrollments
// ---------------------------------------------------------------------------

export function LearningPathWidget(): React.JSX.Element | null {
  const { steps, isLoading } = useLearningPath();

  if (isLoading) {
    return <Skeleton shape="block" className="h-24 w-full rounded-lg" data-testid="dashboard-learning-path-widget-skeleton" />;
  }

  const nextUp = steps.filter((s) => s.isNextUp);
  if (nextUp.length === 0) return null;

  return (
    <section aria-labelledby="learning-path-heading" data-testid="dashboard-learning-path-widget">
      <h2 id="learning-path-heading" className="mb-3 text-sm font-semibold uppercase tracking-wide text-fg-muted">
        What to do next
      </h2>
      <ul className="flex flex-col gap-2" aria-label="Recommended next steps">
        {nextUp.map((step) => (
          <li key={`${step.enrollmentId}-${step.lessonId}`}>
            <Link
              href={`/lessons/${step.lessonId}`}
              className="flex items-center gap-3 rounded-md border border-border bg-card px-4 py-3 text-sm transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              data-testid="learning-path-item"
            >
              <AlertTriangle aria-hidden="true" className="size-4 shrink-0 text-brand-500" />
              <span className="min-w-0 flex-1">
                <span className="line-clamp-1 font-medium text-fg">{step.lessonTitle}</span>
                <span className="block text-xs text-fg-muted line-clamp-1">
                  {step.programTitle} · {step.moduleTitle}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
