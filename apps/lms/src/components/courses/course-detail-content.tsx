// Course detail + curriculum page content — Udemy-style layout.
// Data from:
//   useEnrollment(id)    → GET /api/v1/me/enrollments/:id (enrollment header)
//   useCurriculum(id)    → GET /api/v1/me/enrollments/:id/curriculum (tree)
//
// LAYOUT (course-player redesign):
//   Desktop: curriculum sidebar (CourseSidebar) on the left, main content right —
//   dark hero banner (program title + progress), lesson filter, and per-module
//   lesson lists. Mobile: main content first, sidebar below.
//
// ENROLLMENT SCOPE:
//   Both endpoints return 403 if the enrollment doesn't belong to the requesting student.
//   The API is the enforcement point. The UI surfaces the 403 as a "not found" empty state
//   (we don't distinguish "doesn't exist" vs "forbidden" to avoid leaking information).
//
// PREVIEW vs LOCKED:
//   The curriculum API returns `locked: true` for lessons the student cannot access.
//   Locked lessons are rendered non-clickable. The server is always authoritative;
//   the UI reflects, never gates.
//
// CLAUDE.md §3: "no business logic in components — use hooks/services".
"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  BookOpen,
  Check,
  Clock,
  Lock,
  Play,
  Search,
} from "lucide-react";
import {
  Button,
  Card,
  CardFooter,
  CardHeader,
  CardTitle,
  CardDescription,
  cn,
  EmptyState,
  Skeleton,
} from "@repo/ui";
import type { CurriculumLessonNode, CurriculumModuleNode } from "@repo/types";

import { useEnrollment } from "../../hooks/use-enrollment";
import { useCurriculum } from "../../hooks/use-curriculum";
import { formatClock } from "../../lib/format-duration";
import { CourseContextPanel, CourseContextPanelDrawer } from "./course-context-panel";

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function CourseDetailSkeleton(): React.JSX.Element {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      role="status"
      aria-label="Loading course"
      className="space-y-4"
    >
      <Skeleton shape="line" className="h-4 w-32" />
      <Skeleton shape="block" className="h-48 w-full rounded-xl" />
      <Skeleton shape="block" className="h-12 w-full rounded-lg" />
      <Skeleton shape="block" className="h-20 w-full rounded-xl" />
      <Skeleton shape="block" className="h-64 w-full rounded-xl" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lesson row (main column, Udemy-style)
// ---------------------------------------------------------------------------

interface CourseLessonRowProps {
  lesson: CurriculumLessonNode;
  onNavigate: (lessonId: string) => void;
}

function CourseLessonRow({
  lesson,
  onNavigate,
}: CourseLessonRowProps): React.JSX.Element {
  const isCompleted = lesson.progress?.status === "completed";
  const TypeIcon = lesson.type === "video" ? Play : BookOpen;

  return (
    <li>
      <button
        type="button"
        disabled={lesson.locked}
        aria-disabled={lesson.locked || undefined}
        onClick={() => onNavigate(lesson.id)}
        data-testid="course-lesson-row"
        className={cn(
          "flex w-full items-center gap-4 rounded-xl px-3 py-3 text-left transition-colors duration-fast",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
          lesson.locked
            ? "cursor-not-allowed opacity-70"
            : "hover:bg-surface",
        )}
      >
        {/* Play / type tile */}
        <span
          aria-hidden="true"
          className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-surface text-fg-muted"
        >
          <TypeIcon className="size-5" />
        </span>

        {/* Title + duration */}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="line-clamp-1 text-sm font-semibold text-fg sm:text-base">
              {lesson.title}
            </span>
            {isCompleted ? (
              <Check
                aria-label="Completed"
                className="size-4 shrink-0 text-success"
              />
            ) : null}
          </span>
          {lesson.durationS != null ? (
            <span className="mt-1 flex items-center gap-1.5 text-xs text-fg-muted sm:text-sm">
              <Clock aria-hidden="true" className="size-3.5" />
              <span className="tabular-nums">{formatClock(lesson.durationS)}</span>
            </span>
          ) : null}
        </span>

        {/* Trailing badge — lock or Free */}
        <span className="flex w-14 shrink-0 justify-end">
          {lesson.locked ? (
            <span
              aria-label="Locked"
              title="Locked"
              className="inline-flex size-8 items-center justify-center rounded-md bg-surface text-fg-subtle"
            >
              <Lock aria-hidden="true" className="size-4" />
            </span>
          ) : lesson.isPreview ? (
            <span className="inline-flex items-center rounded-md bg-surface px-2.5 py-1 text-xs font-medium text-fg-muted">
              Free
            </span>
          ) : null}
        </span>
      </button>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Module section (band header + lesson rows)
// ---------------------------------------------------------------------------

interface ModuleSectionProps {
  module: CurriculumModuleNode;
  lessons: CurriculumLessonNode[];
  onNavigate: (lessonId: string) => void;
}

function ModuleSection({
  module,
  lessons,
  onNavigate,
}: ModuleSectionProps): React.JSX.Element {
  return (
    <section
      aria-labelledby={`module-heading-${module.id}`}
      data-testid="course-module-section"
    >
      {/* Module band */}
      <div className="flex items-center justify-between gap-4 rounded-xl bg-surface px-5 py-4">
        <div className="min-w-0">
          <h2
            id={`module-heading-${module.id}`}
            className="line-clamp-1 text-base font-bold text-fg sm:text-lg"
          >
            {module.title}
          </h2>
          <p className="mt-0.5 text-xs text-fg-muted sm:text-sm">
            {module.progress.lessonsCompleted}/{module.progress.lessonsTotal} completed
          </p>
        </div>
        <span className="shrink-0 text-xs text-fg-muted sm:text-sm tabular-nums">
          {module.progress.lessonsTotal} Lessons
        </span>
      </div>

      {/* Lesson rows */}
      <ol className="m-0 mt-2 list-none space-y-1 p-0">
        {lessons.map((lesson) => (
          <CourseLessonRow
            key={lesson.id}
            lesson={lesson}
            onNavigate={onNavigate}
          />
        ))}
      </ol>
    </section>
  );
}

// ---------------------------------------------------------------------------
// CourseDetailContent
// ---------------------------------------------------------------------------

export interface CourseDetailContentProps {
  enrollmentId: string;
}

/**
 * Renders:
 *   1. Curriculum sidebar (desktop left / mobile below) — CourseSidebar
 *   2. Hero banner — batch name + program title + progress
 *   3. Lesson filter input (client-side title filter)
 *   4. Per-module lesson lists with preview/locked/completion state
 *
 * Lesson navigation: clicking a non-locked lesson navigates to /lessons/[lessonId].
 */
export function CourseDetailContent({
  enrollmentId,
}: CourseDetailContentProps): React.JSX.Element {
  const router = useRouter();
  const [filter, setFilter] = React.useState("");

  const {
    data: enrollment,
    isLoading: enrollmentLoading,
    isForbidden: enrollmentForbidden,
    isSignedOut: enrollmentSignedOut,
    isError: enrollmentError,
    error: enrollmentErr,
    refetch: refetchEnrollment,
  } = useEnrollment(enrollmentId);

  const {
    data: curriculum,
    isLoading: curriculumLoading,
    isForbidden: curriculumForbidden,
    isSignedOut: curriculumSignedOut,
    isError: curriculumError,
    error: curriculumErr,
    refetch: refetchCurriculum,
  } = useCurriculum(enrollmentId);

  const isLoading = enrollmentLoading || curriculumLoading;
  const isForbidden = enrollmentForbidden || curriculumForbidden;
  const isSignedOut = enrollmentSignedOut || curriculumSignedOut;
  const isError = enrollmentError || curriculumError;
  const errorMsg =
    enrollmentErr?.problem.detail ??
    curriculumErr?.problem.detail ??
    enrollmentErr?.problem.title ??
    curriculumErr?.problem.title ??
    "Something went wrong. Please try again.";

  function handleRetry() {
    refetchEnrollment();
    refetchCurriculum();
  }

  if (isLoading) return <CourseDetailSkeleton />;

  if (isSignedOut) {
    return (
      <Card data-testid="course-detail-signed-out">
        <CardHeader>
          <CardTitle>You&apos;re signed out</CardTitle>
          <CardDescription>Sign in to access this course.</CardDescription>
        </CardHeader>
        <CardFooter>
          <Button asChild>
            <a href="/login">Sign in</a>
          </Button>
        </CardFooter>
      </Card>
    );
  }

  if (isForbidden) {
    // Enrollment doesn't belong to this student OR doesn't exist.
    // We don't distinguish 403 vs 404 to avoid information leakage.
    return (
      <EmptyState
        data-testid="course-detail-forbidden"
        title="Course not found"
        description="This course doesn't exist or you're not enrolled in it."
        action={
          <Button asChild variant="secondary">
            <Link href="/courses">Back to My Courses</Link>
          </Button>
        }
      />
    );
  }

  if (isError) {
    return (
      <Card data-testid="course-detail-error">
        <CardHeader>
          <CardTitle>Couldn&apos;t load this course</CardTitle>
          <CardDescription>{errorMsg}</CardDescription>
        </CardHeader>
        <CardFooter>
          <Button variant="secondary" onClick={handleRetry} data-testid="course-detail-retry">
            Try again
          </Button>
        </CardFooter>
      </Card>
    );
  }

  if (!enrollment || !curriculum) {
    // Defensive: queries settled without data — treat as empty/error
    return (
      <EmptyState
        data-testid="course-detail-empty"
        title="No course data"
        description="We didn't receive course data. Please try again."
        action={
          <Button variant="secondary" onClick={handleRetry}>
            Try again
          </Button>
        }
      />
    );
  }

  // Client-side lesson title filter (presentation-only). Modules with no
  // matching lessons are hidden while a filter is active.
  const normalizedFilter = filter.trim().toLowerCase();
  const visibleModules = curriculum.modules
    .map((module) => ({
      module,
      lessons: normalizedFilter
        ? module.lessons.filter((l) =>
            l.title.toLowerCase().includes(normalizedFilter),
          )
        : module.lessons,
    }))
    .filter(({ lessons }) => lessons.length > 0);

  function handleNavigate(lessonId: string) {
    router.push(`/lessons/${lessonId}`);
  }

  return (
    <div data-testid="course-detail-content">
      {/* Back link */}
      <Link
        href="/courses"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset rounded"
        data-testid="back-to-courses"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        My Courses
      </Link>

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        {/* Main column. No `order-*` here: the context panel is a later sibling
            and must stay on the right, so document order is the layout order. */}
        <div className="min-w-0 flex-1">
          {/* Hero banner — course image (when uploaded in CRM) under a dark overlay */}
          <header
            data-testid="course-header"
            className="relative flex flex-col items-center justify-center gap-2 overflow-hidden rounded-xl bg-gradient-to-b from-neutral-950 via-neutral-800 to-neutral-600 px-6 py-14 text-center sm:py-20"
          >
            {enrollment.programImageUrl ? (
              <>
                <img
                  src={enrollment.programImageUrl}
                  alt=""
                  aria-hidden="true"
                  className="absolute inset-0 size-full object-cover"
                  data-testid="course-header-image"
                />
                <div aria-hidden="true" className="absolute inset-0 bg-black/60" />
              </>
            ) : null}
            <p className="relative text-sm font-medium text-neutral-300">
              {enrollment.batchName}
            </p>
            <h1 className="relative text-2xl font-bold text-white sm:text-4xl">
              {curriculum.programTitle}
            </h1>
            <p className="relative mt-2 text-xs text-neutral-300 sm:text-sm tabular-nums">
              {curriculum.completedLessons}/{curriculum.totalLessons} lessons completed
              {" · "}
              {curriculum.progressPct}%
            </p>
            {/* Progress bar — visual companion to the textual stats above */}
            <div
              aria-hidden="true"
              className="relative mt-1 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-white/20"
            >
              <div
                className="h-full rounded-full bg-white"
                style={{ width: `${curriculum.progressPct}%` }}
              />
            </div>
          </header>

          {/* Course panel trigger — below lg, where the right rail is hidden */}
          <div className="mt-6">
            <CourseContextPanelDrawer enrollmentId={enrollmentId} />
          </div>

          {/* Lesson filter */}
          <div className="relative mt-6">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-fg-subtle"
            />
            <input
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              aria-label="Search lessons in this course"
              placeholder="Search"
              data-testid="course-lesson-filter"
              className={cn(
                "h-12 w-full rounded-lg border border-border bg-card pl-11 pr-4 text-sm text-fg",
                "placeholder:text-fg-subtle",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
            />
          </div>

          {/* Modules + lessons */}
          <div className="mt-6 space-y-8">
            {curriculum.modules.length === 0 ? (
              <EmptyState
                data-testid="curriculum-empty"
                title="No lessons yet"
                description="The curriculum hasn't been published yet. Check back soon."
              />
            ) : visibleModules.length === 0 ? (
              <EmptyState
                data-testid="curriculum-filter-empty"
                title="No lessons match"
                description={`No lesson titles match "${filter.trim()}".`}
                action={
                  <Button variant="secondary" onClick={() => setFilter("")}>
                    Clear search
                  </Button>
                }
              />
            ) : (
              visibleModules.map(({ module, lessons }) => (
                <ModuleSection
                  key={module.id}
                  module={module}
                  lessons={lessons}
                  onNavigate={handleNavigate}
                />
              ))
            )}
          </div>
        </div>

        {/* Course context panel — desktop right rail */}
        <CourseContextPanel enrollmentId={enrollmentId} />
      </div>
    </div>
  );
}
