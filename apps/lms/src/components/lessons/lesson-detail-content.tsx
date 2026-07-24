// Lesson detail page content — Udemy-style course player layout.
//
// LAYOUT (course-player redesign):
//   Desktop (lg+): lesson content on the left; the CourseContextPanel right rail
//   on the right, carrying Outline / Notes / Activity / Progress as tabs. The
//   outline moved here from a left sidebar so the content column keeps enough
//   width for the video at max-w-6xl.
//   Below lg: lesson content full width, with the same panel behind a
//   "Course panel" drawer trigger.
//   A sticky bottom action bar carries Previous (left) and the completion CTA
//   (right): "Mark complete & continue" marks the lesson complete and then
//   navigates to the next lesson; once completed it becomes "Next lesson".
//
// VIDEO WIRING (Wave 5b, unchanged):
//   LessonVideoPlayer owns the stream-url fetch, progress pings, onEnded
//   auto-complete, watermark, and URL re-mint on expiry.
//
// ENROLLMENT GATE:
//   The API returns 403 for non-enrolled, non-preview lessons.
//   Preview lessons (is_preview=true) are accessible without enrollment.
//   The UI renders "Access denied" for 403 responses — never bypasses the gate.
//
// CLAUDE.md §3: "no business logic in components — use hooks/services".
"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle,
  FileText,
  Download,
  RefreshCw,
} from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  CardDescription,
  EmptyState,
  Skeleton,
  StatusChip,
} from "@repo/ui";
import type { LessonDetailResponse, ResourceMeta } from "@repo/types";

import { useLesson } from "../../hooks/use-lesson";
import { useProgressReporting } from "../../hooks/use-progress-reporting";
import { LessonVideoPlayer } from "./lesson-video-player";
import { LessonNotesPanel } from "./lesson-notes-panel";
import { BookmarkButton } from "../shared/bookmark-button";
import {
  CourseContextPanel,
  CourseContextPanelDrawer,
} from "../courses/course-context-panel";

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function LessonSkeleton(): React.JSX.Element {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      role="status"
      aria-label="Loading lesson"
      className="space-y-4"
    >
      <Skeleton shape="line" className="h-4 w-32" />
      <Skeleton shape="line" className="h-7 w-3/4" />
      <Skeleton shape="block" className="h-[200px] w-full rounded-lg" />
      <Skeleton shape="block" className="h-32 w-full rounded-lg" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Resource list (P3: metadata only — no download URLs)
// ---------------------------------------------------------------------------

function ResourceList({ resources }: { resources: ResourceMeta[] }): React.JSX.Element | null {
  if (resources.length === 0) return null;

  function formatBytes(bytes: number | null): string {
    if (!bytes) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return (
    <section aria-labelledby="resources-heading" className="mt-6">
      <h2 id="resources-heading" className="mb-3 text-sm font-semibold uppercase tracking-wide text-fg-muted">
        Resources
      </h2>
      <ul className="flex flex-col gap-2" aria-label="Lesson resources" data-testid="resource-list">
        {resources.map((res) => (
          <li
            key={res.id}
            className="flex items-center gap-3 rounded-md border border-border bg-card px-4 py-3"
            data-testid="resource-item"
          >
            <FileText aria-hidden="true" className="size-4 shrink-0 text-fg-subtle" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-fg line-clamp-1">{res.title}</span>
              <span className="text-xs text-fg-muted">
                {res.type.toUpperCase()}
                {res.sizeBytes ? ` · ${formatBytes(res.sizeBytes)}` : ""}
              </span>
            </span>
            {/* Download URLs are deferred to P4 (StorageProvider). */}
            <span
              className="inline-flex items-center gap-1 text-xs text-fg-subtle"
              aria-label="Download available in a future update"
              title="Download coming in P4"
            >
              <Download aria-hidden="true" className="size-3.5" />
              <span>Soon</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Reading content renderer
// ---------------------------------------------------------------------------

function ReadingContent({ content }: { content: unknown }): React.JSX.Element | null {
  if (!content) return null;

  // `content` is opaque (string | JSON) per the DTO contract.
  // P3: render as HTML if string, or JSON.stringify as fallback.
  if (typeof content === "string") {
    return (
      <div
        className="prose prose-sm mt-4 max-w-none overflow-x-auto text-fg dark:prose-invert prose-img:h-auto prose-img:max-w-full prose-pre:overflow-x-auto prose-table:block prose-table:overflow-x-auto"
        // Safe: content is authored server-side by trusted CRM faculty.
        dangerouslySetInnerHTML={{ __html: content }}
        data-testid="reading-content"
      />
    );
  }

  return (
    <pre
      className="mt-4 overflow-auto rounded-md bg-surface p-4 text-xs text-fg-muted"
      data-testid="reading-content-raw"
    >
      {JSON.stringify(content, null, 2)}
    </pre>
  );
}

// ---------------------------------------------------------------------------
// Video type lesson
// ---------------------------------------------------------------------------

interface VideoLessonProps {
  lesson: LessonDetailResponse;
  /**
   * Initial seek position in seconds (from the ?t= URL param).
   * Passed to the VideoPlayer as the resume position.
   */
  initialTimeS: number;
}

function VideoLesson({ lesson, initialTimeS }: VideoLessonProps): React.JSX.Element {
  const videoMeta = lesson.videoMeta;

  // Handle the case where the video is errored (transcode failed) — no point
  // trying to fetch a stream URL. Show a clear error state.
  if (videoMeta?.status === "errored") {
    return (
      <div data-testid="video-lesson-errored" className="mt-4">
        <Card>
          <CardHeader>
            <CardTitle>Video unavailable</CardTitle>
            <CardDescription>
              This video failed to process. Please contact support or check back later.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div data-testid="video-lesson" className="mt-4">
      <LessonVideoPlayer lesson={lesson} initialTimeS={initialTimeS} />

      {/* Video meta (informational) */}
      {videoMeta ? (
        <div className="mt-2 flex items-center gap-3 text-xs text-fg-muted">
          {/* `errored` is handled by the early return above, so status here is
              narrowed to "ready" | "processing". */}
          <StatusChip
            tone={videoMeta.status === "ready" ? "success" : "warning"}
            label={videoMeta.status === "ready" ? "Ready" : "Processing"}
            size="sm"
          />
          {videoMeta.durationS != null ? (
            <span>
              {Math.floor(videoMeta.durationS / 60)}m {videoMeta.durationS % 60}s
            </span>
          ) : null}
          {videoMeta.captionTracks.length > 0 ? (
            <span>
              Captions: {videoMeta.captionTracks.join(", ")}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bottom action bar — Previous (left) + completion CTA (right)
// ---------------------------------------------------------------------------

function LessonActionBar({ lesson }: { lesson: LessonDetailResponse }): React.JSX.Element {
  const router = useRouter();

  const { markComplete, isMarkingComplete, isCompleted } = useProgressReporting({
    lessonId: lesson.id,
    onCompleted: () => {
      // "Mark complete & continue" — advance to the next lesson once saved.
      if (lesson.nextLessonId) router.push(`/lessons/${lesson.nextLessonId}`);
    },
  });

  // Server-side status (kept fresh by the player's cache updates) OR this
  // session's optimistic flag.
  const completed = isCompleted || lesson.progress?.status === "completed";
  const backHref = lesson.enrollmentId ? `/courses/${lesson.enrollmentId}` : "/courses";

  return (
    <nav
      aria-label="Lesson navigation"
      data-testid="lesson-nav"
      className="sticky bottom-16 z-10 mt-8 flex items-center justify-between gap-3 border-t border-border bg-bg/95 py-3 backdrop-blur sm:bottom-0"
    >
      {lesson.prevLessonId ? (
        <Button asChild variant="secondary" size="sm">
          <Link href={`/lessons/${lesson.prevLessonId}`}>
            <ArrowLeft aria-hidden="true" className="size-4" />
            Previous
          </Link>
        </Button>
      ) : (
        <span />
      )}

      {completed ? (
        lesson.nextLessonId ? (
          <Button asChild variant="primary" size="sm" data-testid="lesson-next-btn">
            <Link href={`/lessons/${lesson.nextLessonId}`}>
              Next lesson
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          </Button>
        ) : (
          <Button asChild variant="secondary" size="sm" data-testid="lesson-back-to-course-btn">
            <Link href={backHref}>
              <CheckCircle aria-hidden="true" className="size-4" />
              Course home
            </Link>
          </Button>
        )
      ) : (
        <Button
          variant="primary"
          size="sm"
          onClick={markComplete}
          disabled={isMarkingComplete}
          aria-label={
            lesson.nextLessonId
              ? `Mark "${lesson.title}" as complete and continue to the next lesson`
              : `Mark "${lesson.title}" as complete`
          }
          data-testid="lesson-mark-complete-btn"
        >
          {isMarkingComplete ? (
            <>
              <RefreshCw aria-hidden="true" className="size-4 animate-spin" />
              Saving…
            </>
          ) : lesson.nextLessonId ? (
            <>
              Mark complete &amp; continue
              <ArrowRight aria-hidden="true" className="size-4" />
            </>
          ) : (
            <>
              <CheckCircle aria-hidden="true" className="size-4" />
              Mark complete
            </>
          )}
        </Button>
      )}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// LessonDetailContent
// ---------------------------------------------------------------------------

export interface LessonDetailContentProps {
  lessonId: string;
}

/**
 * Renders the lesson player page:
 *   - Breadcrumb (program) + module context
 *   - Curriculum sidebar (desktop left / mobile below) with the active lesson
 *   - Video player or reading content
 *   - Resources list (metadata only — download deferred to P4)
 *   - Personal notes panel
 *   - Sticky bottom bar: Previous + "Mark complete & continue" (bottom right)
 */
export function LessonDetailContent({
  lessonId,
}: LessonDetailContentProps): React.JSX.Element {
  const searchParams = useSearchParams();
  const tParam = searchParams.get("t");
  const initialTimeS = tParam ? parseInt(tParam, 10) || 0 : 0;

  const { data: lesson, isLoading, isForbidden, isSignedOut, isError, error, refetch } =
    useLesson(lessonId);

  if (isLoading) return <LessonSkeleton />;

  if (isSignedOut) {
    return (
      <Card data-testid="lesson-signed-out">
        <CardHeader>
          <CardTitle>You&apos;re signed out</CardTitle>
          <CardDescription>Sign in to access this lesson.</CardDescription>
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
    // The API returned 403 — not enrolled in this program or lesson doesn't exist.
    // We don't distinguish to avoid leaking existence information.
    return (
      <EmptyState
        data-testid="lesson-forbidden"
        title="Lesson not found"
        description="This lesson doesn't exist or you don't have access to it. It may require enrollment."
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
      <Card data-testid="lesson-error">
        <CardHeader>
          <CardTitle>Couldn&apos;t load this lesson</CardTitle>
          <CardDescription>
            {error?.problem.detail ?? error?.problem.title ?? "Something went wrong."}
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Button variant="secondary" onClick={refetch} data-testid="lesson-retry">
            Try again
          </Button>
        </CardFooter>
      </Card>
    );
  }

  if (!lesson) {
    return (
      <EmptyState
        data-testid="lesson-empty"
        title="No lesson data"
        description="We didn't receive lesson data. Please try again."
        action={
          <Button variant="secondary" onClick={refetch}>Try again</Button>
        }
      />
    );
  }

  const backHref = lesson.enrollmentId
    ? `/courses/${lesson.enrollmentId}`
    : "/courses";

  return (
    <div data-testid="lesson-detail-content">
      {/* Breadcrumb / back nav */}
      <Link
        href={backHref}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset rounded"
        data-testid="back-to-course"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        {lesson.programTitle}
      </Link>

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        {/* Main column. No `order-*` here: the context panel is a later sibling
            and must stay on the right, so document order is the layout order. */}
        <div className="min-w-0 flex-1">
          {/* Module context */}
          <p className="text-xs text-fg-muted" data-testid="lesson-module-context">
            {lesson.moduleTitle}
          </p>

          {/* Lesson title */}
          <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
            <h1 className="text-xl font-bold text-fg" data-testid="lesson-title">
              {lesson.title}
            </h1>
            <BookmarkButton refType="lesson" refId={lesson.id} label={lesson.title} data-testid="lesson-bookmark-btn" />
          </div>

          {/* Badges */}
          <div className="mt-2 flex items-center gap-2">
            <StatusChip
              tone="neutral"
              label={lesson.type === "video" ? "Video" : lesson.type === "reading" ? "Reading" : lesson.type}
              size="sm"
              data-testid="lesson-type-chip"
            />
            {lesson.isPreview ? (
              <StatusChip
                tone="info"
                label="Preview"
                size="sm"
                data-testid="lesson-preview-chip"
              />
            ) : null}
            {lesson.progress?.status === "completed" ? (
              <StatusChip
                tone="success"
                label="Completed"
                size="sm"
                data-testid="lesson-completed-chip"
              />
            ) : lesson.progress?.status === "in_progress" ? (
              <StatusChip
                tone="warning"
                label="In progress"
                size="sm"
                data-testid="lesson-in-progress-chip"
              />
            ) : null}
          </div>

          {/* --- Lesson content area --- */}
          {lesson.type === "video" ? (
            <VideoLesson lesson={lesson} initialTimeS={initialTimeS} />
          ) : (
            /* Reading / assignment / quiz */
            <Card className="mt-4" data-testid="reading-lesson-card">
              <CardContent className="pt-4">
                <ReadingContent content={lesson.content} />
                {!lesson.content ? (
                  <p className="py-4 text-center text-sm text-fg-muted">No content available yet.</p>
                ) : null}
              </CardContent>
            </Card>
          )}

          {/* Resources */}
          <ResourceList resources={lesson.resources} />

          {/* Notes, outline, activity and progress now live in the course
              context panel (right rail on lg+, drawer below). Preview lessons
              have no enrollmentId, so they keep the inline notes section — there
              is no course to build a panel from. */}
          {lesson.enrollmentId ? (
            <div className="mt-6">
              <CourseContextPanelDrawer
                enrollmentId={lesson.enrollmentId}
                lessonId={lesson.id}
                activeLessonId={lesson.id}
                lastPositionS={lesson.progress?.lastPositionS ?? null}
              />
            </div>
          ) : (
            <LessonNotesPanel
              lessonId={lesson.id}
              lastPositionS={lesson.progress?.lastPositionS ?? null}
            />
          )}

          {/* Sticky bottom bar: Previous / Mark complete & continue */}
          <LessonActionBar lesson={lesson} />
        </div>

        {/* Course context panel — desktop right rail */}
        {lesson.enrollmentId ? (
          <CourseContextPanel
            enrollmentId={lesson.enrollmentId}
            lessonId={lesson.id}
            activeLessonId={lesson.id}
            lastPositionS={lesson.progress?.lastPositionS ?? null}
          />
        ) : null}
      </div>
    </div>
  );
}
