// My Courses list — renders the student's enrolled programs as CourseCards.
// Data from useMyCourses() which calls GET /api/v1/me/enrollments.
// Server enforces enrollment scope: only the authenticated student's own enrollments
// are returned. The API is the enforcement point.
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
  CourseCard,
  EmptyState,
  Skeleton,
} from "@repo/ui";

import { useMyCourses } from "../../hooks/use-my-courses";

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function MyCoursesSkeleton(): React.JSX.Element {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      role="status"
      aria-label="Loading your courses"
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
    >
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <Skeleton key={i} shape="block" className="h-48 rounded-xl" />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MyCoursesList
// ---------------------------------------------------------------------------

/**
 * Renders the student's full enrollment list as a responsive CourseCard grid.
 *
 * Enrollment-scoped: the API only returns the authenticated student's own
 * enrollments — no cross-student data possible at the API level.
 * This comment is the reminder: the server is the enforcement point.
 */
export function MyCoursesList(): React.JSX.Element {
  const { data, isLoading, isSignedOut, isError, error, refetch } = useMyCourses();

  if (isLoading) return <MyCoursesSkeleton />;

  if (isSignedOut) {
    return (
      <Card data-testid="my-courses-signed-out">
        <CardHeader>
          <CardTitle>You&apos;re signed out</CardTitle>
          <CardDescription>Sign in to see your enrolled courses.</CardDescription>
        </CardHeader>
        <CardFooter>
          <Button asChild data-testid="sign-in-cta">
            <a href="/login">Sign in</a>
          </Button>
        </CardFooter>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card data-testid="my-courses-error">
        <CardHeader>
          <CardTitle>Couldn&apos;t load your courses</CardTitle>
          <CardDescription>
            {error?.problem.detail ?? error?.problem.title ?? "Something went wrong. Please try again."}
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Button variant="secondary" onClick={refetch} data-testid="my-courses-retry">
            Try again
          </Button>
        </CardFooter>
      </Card>
    );
  }

  const enrollments = data?.items ?? [];

  if (enrollments.length === 0) {
    return (
      <EmptyState
        data-testid="my-courses-empty"
        title="You're not enrolled in any courses yet"
        description="Contact your administrator or complete enrollment via the website to get started."
        action={
          <Button asChild variant="primary" size="sm">
            <a href="https://stimuliiq.com" target="_blank" rel="noopener noreferrer">
              Visit website
            </a>
          </Button>
        }
      />
    );
  }

  return (
    <div
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
      data-testid="my-courses-grid"
      aria-label="My enrolled courses"
    >
      {enrollments.map((enr) => (
        <CourseCard
          key={enr.id}
          data-testid="course-card"
          title={enr.programTitle}
          program={enr.batchName}
          thumbnail={enr.programImageUrl ?? undefined}
          progress={enr.progressPct}
          statusTone={
            enr.status === "active" ? "success" :
            enr.status === "completed" ? "neutral" :
            "warning"
          }
          statusLabel={
            enr.status === "active" ? "Active" :
            enr.status === "completed" ? "Completed" :
            "Dropped"
          }
          cta={
            <Button asChild variant="secondary" size="sm" className="w-full">
              <Link href={`/courses/${enr.id}`}>
                {enr.status === "completed" ? "Review course" : "Continue learning"}
              </Link>
            </Button>
          }
        />
      ))}
    </div>
  );
}
