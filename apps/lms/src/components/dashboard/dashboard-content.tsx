// Dashboard page content — all presentation, no data fetching.
// Data arrives from useDashboard() which calls GET /api/v1/me/dashboard.
// CLAUDE.md §3: "no business logic in components — use hooks/services".
"use client";

import * as React from "react";
import Link from "next/link";
import {
  Button,
  Card,
  CardFooter,
  CardHeader,
  CardTitle,
  CardDescription,
  EmptyState,
  PageHeader,
  Skeleton,
  ContinueLearning,
  CourseCard,
  StatusChip,
} from "@repo/ui";
import type {
  MeDashboardResponse,
  EnrollmentCard,
  ContinueLearningItem,
  ProgramProgressSummary,
} from "@repo/types";

import { useDashboard } from "../../hooks/use-dashboard";
import { useMe } from "../../hooks/use-me";
import {
  DeadlinesWidget,
  AnnouncementsWidget,
  StreakBadgesWidget,
  LearningPathWidget,
} from "./dashboard-widgets";

// ---------------------------------------------------------------------------
// Section heading — one consistent, scannable header for every dashboard block.
// A left brand accent bar + display-weight title replaces the old monotone
// uppercase-muted labels, giving the page a clear visual rhythm.
// ---------------------------------------------------------------------------

function SectionHeading({
  children,
  action,
  id,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
  id?: string;
}): React.JSX.Element {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2
        id={id}
        className="flex items-center gap-2 text-base font-semibold text-fg"
      >
        <span aria-hidden="true" className="h-4 w-1 rounded-full bg-brand-500" />
        {children}
      </h2>
      {action}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton — mirrors the real hero + two-column grid so the layout
// doesn't jump when data arrives.
// ---------------------------------------------------------------------------

function DashboardSkeleton(): React.JSX.Element {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      role="status"
      aria-label="Loading dashboard"
      className="space-y-6 md:space-y-8"
    >
      {/* Hero */}
      <div className="space-y-2">
        <Skeleton shape="line" className="h-8 w-56" />
        <Skeleton shape="line" className="h-4 w-40" />
      </div>
      {/* Stat tiles */}
      <div className="grid grid-cols-3 gap-3 sm:gap-4">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} shape="block" className="h-20 rounded-xl" />
        ))}
      </div>
      {/* Continue learning */}
      <Skeleton shape="block" className="h-28 w-full rounded-xl" />
      {/* Two-column grid */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {[0, 1].map((i) => (
              <Skeleton key={i} shape="block" className="h-48 rounded-xl" />
            ))}
          </div>
        </div>
        <Skeleton shape="block" className="h-64 rounded-xl" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Continue Learning section
// ---------------------------------------------------------------------------

function ContinueLearningSection({
  item,
}: {
  item: ContinueLearningItem | null;
}): React.JSX.Element {
  if (!item) {
    // Graceful empty affordance.
    return (
      <EmptyState
        data-testid="continue-learning-empty"
        title="Nothing in progress"
        description="Start a lesson from My Courses to see your resume point here."
        action={
          <Button asChild variant="primary" size="sm">
            <Link href="/courses">Browse my courses</Link>
          </Button>
        }
      />
    );
  }

  const resumeHref = `/lessons/${item.lessonId}${item.lastPositionS > 0 ? `?t=${item.lastPositionS}` : ""}`;
  const progressPct =
    item.progressStatus === "completed" ? 100 : item.lastPositionS > 0 && item.durationS
      ? Math.round((item.lastPositionS / item.durationS) * 100)
      : 0;

  return (
    <div>
      <SectionHeading>Continue learning</SectionHeading>
      <ContinueLearning
        data-testid="continue-learning-card"
        lessonTitle={item.lessonTitle}
        moduleTitle={item.moduleTitle}
        programTitle={item.programTitle}
        progress={progressPct}
        lastPositionS={item.lastPositionS}
        resumeHref={resumeHref}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Enrollment card helpers
// ---------------------------------------------------------------------------

function enrollmentStatusTone(status: EnrollmentCard["status"]): "success" | "warning" | "neutral" {
  switch (status) {
    case "active":
      return "success";
    case "completed":
      return "neutral";
    case "dropped":
      return "warning";
    default:
      return "neutral";
  }
}

function enrollmentStatusLabel(status: EnrollmentCard["status"]): string {
  switch (status) {
    case "active":
      return "Active";
    case "completed":
      return "Completed";
    case "dropped":
      return "Dropped";
    default:
      return status;
  }
}

// ---------------------------------------------------------------------------
// My Courses grid
// ---------------------------------------------------------------------------

function MyCoursesGrid({
  enrollments,
  progressSummary,
}: {
  enrollments: EnrollmentCard[];
  progressSummary: ProgramProgressSummary[];
}): React.JSX.Element {
  if (enrollments.length === 0) {
    return (
      <EmptyState
        data-testid="my-courses-empty"
        title="You're not enrolled in any courses yet"
        description="Contact your administrator or enroll via the website to get started."
        className="py-8"
      />
    );
  }

  // Build a progress map from the summary for quick lookup
  const progressByEnrollment = new Map<string, number>(
    progressSummary.map((p) => [p.enrollmentId, p.progressPct]),
  );

  return (
    <div
      className="grid grid-cols-1 gap-4 sm:grid-cols-2"
      data-testid="my-courses-grid"
      aria-label="My enrolled courses"
    >
      {enrollments.map((enr) => {
        const progress = progressByEnrollment.get(enr.enrollmentId) ?? enr.progressPct;
        return (
          <CourseCard
            key={enr.enrollmentId}
            data-testid="course-card"
            title={enr.programTitle}
            program={enr.batchName}
            thumbnail={enr.programImageUrl ?? undefined}
            progress={progress}
            statusTone={enrollmentStatusTone(enr.status)}
            statusLabel={enrollmentStatusLabel(enr.status)}
            cta={
              <Button asChild variant="secondary" size="sm" className="w-full">
                <Link href={`/courses/${enr.enrollmentId}`}>
                  Open course
                </Link>
              </Button>
            }
          />
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Progress summary bar
// ---------------------------------------------------------------------------

function StatTile({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone: "fg" | "success" | "brand";
}): React.JSX.Element {
  const valueTone =
    tone === "success" ? "text-success" : tone === "brand" ? "text-brand-500" : "text-fg";
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className={`text-2xl font-bold tabular-nums md:text-3xl ${valueTone}`}>{value}</p>
      <p className="mt-0.5 text-xs font-medium text-fg-muted">{label}</p>
    </div>
  );
}

function ProgressSummaryBar({
  total,
  completed,
}: {
  total: number;
  completed: number;
}): React.JSX.Element {
  if (total === 0) return <></>;
  return (
    <div className="grid grid-cols-3 gap-3 sm:gap-4" data-testid="progress-summary-bar">
      <StatTile value={total} label="Enrolled" tone="fg" />
      <StatTile value={completed} label="Completed" tone="success" />
      <StatTile value={total - completed} label="In progress" tone="brand" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Upcoming lessons section
// ---------------------------------------------------------------------------

function UpcomingSection({
  data,
}: {
  data: MeDashboardResponse["upcomingLessons"];
}): React.JSX.Element | null {
  if (data.length === 0) return null;
  return (
    <div data-testid="upcoming-lessons">
      <SectionHeading>Up next</SectionHeading>
      <ul className="flex flex-col gap-2" aria-label="Upcoming lessons">
        {data.slice(0, 4).map((lesson) => (
          <li key={lesson.lessonId}>
            <Link
              href={`/lessons/${lesson.lessonId}`}
              className="flex items-center gap-3 rounded-md border border-border bg-card px-4 py-3 text-sm transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              data-testid="upcoming-lesson-item"
            >
              <span className="min-w-0 flex-1">
                <span className="line-clamp-1 font-medium text-fg">{lesson.lessonTitle}</span>
                <span className="block text-xs text-fg-muted line-clamp-1">
                  {lesson.programTitle} · {lesson.moduleTitle}
                </span>
              </span>
              <StatusChip
                tone="neutral"
                label={lesson.lessonType === "video" ? "Video" : lesson.lessonType}
                size="sm"
              />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Signed-out state
// ---------------------------------------------------------------------------

function SignedOutCard(): React.JSX.Element {
  return (
    <Card data-testid="dashboard-signed-out">
      <CardHeader>
        <CardTitle>You&apos;re signed out</CardTitle>
        <CardDescription>
          Sign in to see your courses, progress, and certificates.
        </CardDescription>
      </CardHeader>
      <CardFooter>
        <Button asChild data-testid="dashboard-sign-in-cta">
          <a href="/login">Sign in</a>
        </Button>
      </CardFooter>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Error state
// ---------------------------------------------------------------------------

function ErrorCard({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}): React.JSX.Element {
  return (
    <Card data-testid="dashboard-error">
      <CardHeader>
        <CardTitle>Something went wrong</CardTitle>
        <CardDescription>{message}</CardDescription>
      </CardHeader>
      <CardFooter>
        <Button variant="secondary" onClick={onRetry} data-testid="dashboard-retry">
          Try again
        </Button>
      </CardFooter>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// DashboardContent — top-level client component
// ---------------------------------------------------------------------------

/**
 * DashboardContent renders the student dashboard:
 *   - Continue-learning card (resume last in-progress lesson)
 *   - My Courses grid (CourseCard per enrollment with ProgressRing)
 *   - Progress summary bar (enrolled / completed / in-progress counts)
 *   - Upcoming lessons rail (next unwatched in each program)
 *
 * All data is the student's OWN — server enforces `courses.view scope:own`.
 * This component does NOT call any API directly — useDashboard() does.
 */
export function DashboardContent(): React.JSX.Element {
  const { me } = useMe();
  const { data, isLoading, isSignedOut, isError, error, refetch } = useDashboard();

  if (isLoading) return <DashboardSkeleton />;
  if (isSignedOut) return <SignedOutCard />;
  if (isError) {
    return (
      <ErrorCard
        message={error?.problem.detail ?? error?.problem.title ?? "We couldn't load your dashboard."}
        onRetry={refetch}
      />
    );
  }

  // Greeting
  const firstName = me?.user.name?.split(" ")[0] ?? "there";

  return (
    <div data-testid="dashboard-content" className="space-y-6 md:space-y-8">
      {/* Hero greeting */}
      <PageHeader
        data-testid="dashboard-greeting"
        title={data ? `Welcome back, ${firstName}` : "Your Dashboard"}
        description={
          data
            ? data.totalEnrollments === 0
              ? "You have no enrollments yet."
              : `${data.totalEnrollments} course${data.totalEnrollments !== 1 ? "s" : ""} enrolled · keep your streak going`
            : undefined
        }
      />

      {data ? (
        <>
          {/* Stat tiles + streak */}
          <ProgressSummaryBar total={data.totalEnrollments} completed={data.totalCompleted} />
          <StreakBadgesWidget />

          {/* Continue learning — the single most important resume affordance */}
          <ContinueLearningSection item={data.continueLearning} />

          {/* Two-column working area: primary study list on the left, at-a-glance
              widgets on the right. Collapses to a single column below lg. */}
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="min-w-0 space-y-6 lg:col-span-2">
              <section aria-labelledby="my-courses-heading">
                <SectionHeading id="my-courses-heading">My courses</SectionHeading>
                <MyCoursesGrid
                  enrollments={data.enrollments}
                  progressSummary={data.progressSummary}
                />
              </section>

              <UpcomingSection data={data.upcomingLessons} />
            </div>

            <aside className="min-w-0 space-y-6" aria-label="At a glance">
              <LearningPathWidget />
              <DeadlinesWidget />
              <AnnouncementsWidget />
            </aside>
          </div>
        </>
      ) : (
        /* Defensive: query settled without data or error */
        <Card data-testid="dashboard-empty">
          <CardHeader>
            <CardTitle>No data available</CardTitle>
            <CardDescription>We didn&apos;t receive dashboard data. Please try again.</CardDescription>
          </CardHeader>
          <CardFooter>
            <Button variant="secondary" onClick={refetch} data-testid="dashboard-retry">
              Try again
            </Button>
          </CardFooter>
        </Card>
      )}
    </div>
  );
}
