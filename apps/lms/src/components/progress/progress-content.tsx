// My Progress page content — Wave 5b.
//
// Renders:
//   - Overall progress summary (total lessons completed / total across all programs)
//   - Per-program ProgressRing + title + status
//   - Per-module ProgressBar breakdown within each program
//
// Data:
//   - useMyProgress() → GET /api/v1/me/progress (MyProgressResponse)
//
// Loading / empty / error states per CLAUDE.md §3 / docs/04 §3.6.
// CLAUDE.md §3: "no business logic in components — use hooks/services".
"use client";

import * as React from "react";
import Link from "next/link";
import { CheckCircle, RefreshCw } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  EmptyState,
  Skeleton,
  ProgressRing,
  ProgressBar,
} from "@repo/ui";
import type { ProgramProgressDetail } from "@repo/types";

import { useMyProgress } from "../../hooks/use-my-progress";
import { GamificationSection } from "./gamification-section";
import { useMe } from "../../hooks/use-me";

// ---------------------------------------------------------------------------
// Skeletons
// ---------------------------------------------------------------------------

function ProgressSkeleton(): React.JSX.Element {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      aria-label="Loading progress data"
      className="space-y-6"
      data-testid="progress-skeleton"
    >
      {/* Overall summary */}
      <div className="flex items-center gap-4 rounded-lg border border-border bg-card p-4">
        <Skeleton shape="block" className="size-14 rounded-full shrink-0" />
        <div className="flex-1 space-y-2">
          <Skeleton shape="line" className="h-4 w-40" />
          <Skeleton shape="line" className="h-3 w-24" />
        </div>
      </div>
      {/* Program cards */}
      {[1, 2].map((i) => (
        <div key={i} className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div className="flex items-center gap-4">
            <Skeleton shape="block" className="size-14 rounded-full shrink-0" />
            <div className="flex-1 space-y-2">
              <Skeleton shape="line" className="h-4 w-56" />
              <Skeleton shape="line" className="h-3 w-32" />
            </div>
          </div>
          <Skeleton shape="block" className="h-2 w-full" />
          <Skeleton shape="block" className="h-2 w-full" />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Program progress card
// ---------------------------------------------------------------------------

function ProgramProgressCard({
  program,
}: {
  program: ProgramProgressDetail;
}): React.JSX.Element {
  const tone =
    program.progressPct === 100
      ? "success"
      : program.progressPct >= 50
      ? "brand"
      : "brand";

  return (
    <Card data-testid="program-progress-card">
      <CardHeader>
        <div className="flex items-start gap-4">
          {/* Progress ring */}
          <ProgressRing
            value={program.progressPct}
            size="lg"
            tone={tone}
            label={`${program.programTitle}, ${program.progressPct}% complete`}
            data-testid="program-progress-ring"
          />

          {/* Program info */}
          <div className="min-w-0 flex-1">
            <CardTitle className="line-clamp-2 text-base">
              {program.programTitle}
            </CardTitle>
            <CardDescription className="mt-1">
              {program.lessonsCompleted} of {program.lessonsTotal} lessons completed
            </CardDescription>
            {program.status === "completed" ? (
              <div className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-success">
                <CheckCircle aria-hidden="true" className="size-4" />
                Program complete
              </div>
            ) : null}
          </div>
        </div>
      </CardHeader>

      {/* Module breakdown */}
      {program.modules.length > 0 ? (
        <CardContent>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-fg-muted">
            Module breakdown
          </h3>
          <ul
            className="flex flex-col gap-3"
            aria-label={`Module breakdown for ${program.programTitle}`}
          >
            {program.modules
              .slice()
              .sort((a, b) => a.order - b.order)
              .map((mod) => (
                <li key={mod.moduleId} data-testid="module-progress-item">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-sm text-fg line-clamp-1 flex-1">
                      {mod.moduleTitle}
                    </span>
                    <span className="shrink-0 text-xs text-fg-muted tabular-nums">
                      {mod.lessonsCompleted}/{mod.lessonsTotal}
                    </span>
                  </div>
                  <ProgressBar
                    value={mod.progressPct}
                    label={`${mod.moduleTitle} completion`}
                    size="sm"
                    tone={mod.progressPct === 100 ? "success" : "brand"}
                    showLabel
                    data-testid="module-progress-bar"
                  />
                </li>
              ))}
          </ul>
        </CardContent>
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Overall summary bar
// ---------------------------------------------------------------------------

function OverallSummary({
  overallProgressPct,
  overallLessonsCompleted,
  overallLessonsTotal,
}: {
  overallProgressPct: number;
  overallLessonsCompleted: number;
  overallLessonsTotal: number;
}): React.JSX.Element {
  return (
    <Card data-testid="overall-progress-summary">
      <CardContent className="pt-4">
        <div className="flex items-center gap-4">
          <ProgressRing
            value={overallProgressPct}
            size="lg"
            tone={overallProgressPct === 100 ? "success" : "brand"}
            label={`Overall progress, ${overallProgressPct}% complete`}
            data-testid="overall-progress-ring"
          />
          <div>
            <p className="text-lg font-bold text-fg">{overallProgressPct}% overall</p>
            <p className="text-sm text-fg-muted">
              {overallLessonsCompleted} of {overallLessonsTotal} lessons across all programs
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// ProgressContent
// ---------------------------------------------------------------------------

/**
 * ProgressContent — the main content for /progress.
 *
 * Renders per-program progress rings + module breakdowns.
 * Handles loading / empty / error / signed-out states.
 */
export function ProgressContent(): React.JSX.Element {
  const progress = useMyProgress();
  const { me } = useMe();

  // ── Signed-out (either query) ────────────────────────────────────────────
  if (progress.isSignedOut) {
    return (
      <Card data-testid="progress-signed-out">
        <CardHeader>
          <CardTitle>You&apos;re signed out</CardTitle>
          <CardDescription>Sign in to view your progress.</CardDescription>
        </CardHeader>
        <div className="p-4">
          <Button asChild>
            <a href="/login">Sign in</a>
          </Button>
        </div>
      </Card>
    );
  }

  // ── Loading ──────────────────────────────────────────────────────────────
  if (progress.isLoading) {
    return <ProgressSkeleton />;
  }

  // ── Error ────────────────────────────────────────────────────────────────
  if (progress.isError) {
    return (
      <Card data-testid="progress-error">
        <CardHeader>
          <CardTitle>Couldn&apos;t load progress</CardTitle>
          <CardDescription>
            {progress.error?.problem.detail ??
              progress.error?.problem.title ??
              "Something went wrong loading your progress."}
          </CardDescription>
        </CardHeader>
        <div className="p-4">
          <Button
            variant="secondary"
            onClick={progress.refetch}
            data-testid="progress-retry"
          >
            <RefreshCw aria-hidden="true" className="size-4" />
            Try again
          </Button>
        </div>
      </Card>
    );
  }

  // ── Empty ────────────────────────────────────────────────────────────────
  if (!progress.data || progress.data.programs.length === 0) {
    return (
      <EmptyState
        data-testid="progress-empty"
        title="No programs enrolled"
        description="Enroll in a program to start tracking your progress here."
        action={
          <Button asChild variant="secondary" size="sm">
            <Link href="/courses">Browse My Courses</Link>
          </Button>
        }
      />
    );
  }

  // ── Content ──────────────────────────────────────────────────────────────
  const { programs, overallProgressPct, overallLessonsCompleted, overallLessonsTotal } =
    progress.data;

  return (
    <div className="space-y-6" data-testid="progress-content">
      {/* Overall summary ring */}
      <OverallSummary
        overallProgressPct={overallProgressPct}
        overallLessonsCompleted={overallLessonsCompleted}
        overallLessonsTotal={overallLessonsTotal}
      />

      {/* Per-program section */}
      <section aria-labelledby="programs-heading">
        <h2
          id="programs-heading"
          className="mb-3 text-sm font-semibold uppercase tracking-wide text-fg-muted"
        >
          By Program
        </h2>
        <ul className="flex flex-col gap-4" aria-label="Progress by program">
          {programs.map((program) => (
            <li key={program.enrollmentId}>
              <ProgramProgressCard program={program} />
            </li>
          ))}
        </ul>
      </section>


      {/* P6: Gamification section — points, badges, streak, opt-in leaderboard */}
      <section aria-labelledby="gamification-heading" data-testid="progress-gamification">
        <h2
          id="gamification-heading"
          className="mb-3 text-sm font-semibold uppercase tracking-wide text-fg-muted"
        >
          Learning Achievements
        </h2>
        <GamificationSection
          // The leaderboard is per BATCH. This used to pass `enrollmentId` — a different
          // id entirely — so `GET /batches/:id/leaderboard` 404'd every time and the LMS
          // rendered that as "Leaderboard is not available for this batch", which reads
          // like a deliberate product state rather than a broken call.
          //
          // The first enrolled program's batch is shown. A student in several programs
          // sees the first one's cohort; making that selectable is a product decision, not
          // a defect. `batchId` is null until an enrollment is placed in a batch, and the
          // section already renders its own "open a course" state for that.
          batchId={progress.data?.programs[0]?.batchId ?? null}
        />
      </section>
    </div>
  );
}
