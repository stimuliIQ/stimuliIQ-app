// Course context panel — the right-hand rail on the lesson and course pages.
//
// Four tabs (Outline / Notes / Activity / Progress) built on the shared
// `DetailShell` primitive, which is already a tabbed panel over Radix Tabs
// (roving-tabindex keyboard nav, correct tablist/tab/tabpanel roles).
//
// Responsive treatment:
//   - lg+ : an in-flow sticky <aside> beside the content.
//   - <lg: a right-side Drawer opened from a toolbar button, because a 4-tab
//     panel stacked under the content on a phone is unusable. Drawer already
//     gives focus trap / ESC / overlay dismiss / return-focus.
// The two share one <PanelTabs> body so the tabs can never drift apart.
//
// No business logic here — all data comes from hooks.
"use client";

import * as React from "react";
import Link from "next/link";
import { Activity, ListTree, NotebookPen, PanelRightOpen, TrendingUp } from "lucide-react";
import {
  Button,
  DetailShell,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerTrigger,
  EmptyState,
  NotificationItem,
  ProgressBar,
  Skeleton,
  StatusChip,
  type DetailShellTab,
} from "@repo/ui";

import { useCurriculum } from "../../hooks/use-curriculum";
import { useNotifications } from "../../hooks/use-notifications";
import {
  deriveNotificationBody,
  deriveNotificationTitle,
} from "../../lib/notification-copy";
import { LessonNotesPanel } from "../lessons/lesson-notes-panel";
import { CourseSidebar } from "./course-sidebar";

/** How many notifications the Activity tab shows before deferring to /notifications. */
const ACTIVITY_LIMIT = 8;

export interface CourseContextPanelProps {
  enrollmentId: string;
  /** Present on the lesson page only — enables the Notes tab. */
  lessonId?: string;
  /** Highlights the current lesson in the Outline tab. */
  activeLessonId?: string;
  /** Last-synced playback position, for timestamp-anchored notes. */
  lastPositionS?: number | null;
  className?: string;
}

// ---------------------------------------------------------------------------
// Progress tab — course completion + the next lesson to resume
// ---------------------------------------------------------------------------

function ProgressTab({ enrollmentId }: { enrollmentId: string }): React.JSX.Element {
  const { data: curriculum, isLoading } = useCurriculum(enrollmentId);

  // First lesson that isn't finished and isn't locked. Modules and lessons both
  // arrive pre-sorted by `order`, so a linear scan is the reading order.
  const upNext = React.useMemo(() => {
    if (!curriculum) return null;
    for (const module of curriculum.modules) {
      for (const lesson of module.lessons) {
        if (lesson.locked) continue;
        if (lesson.progress?.status !== "completed") {
          return { lesson, moduleTitle: module.title };
        }
      }
    }
    return null;
  }, [curriculum]);

  if (isLoading) {
    return (
      <div role="status" aria-busy="true" aria-label="Loading progress" className="space-y-3">
        <Skeleton shape="line" className="h-4 w-32" />
        <Skeleton shape="block" className="h-2 w-full rounded-full" />
        <Skeleton shape="block" className="h-16 w-full rounded-md" />
      </div>
    );
  }

  if (!curriculum) {
    return <EmptyState title="No progress yet" description="Start a lesson to see your progress here." />;
  }

  return (
    <div className="space-y-5" data-testid="context-panel-progress">
      <div>
        <p className="text-sm font-medium text-fg tabular-nums">
          {curriculum.completedLessons}/{curriculum.totalLessons} lessons completed
        </p>
        <ProgressBar
          value={curriculum.progressPct}
          className="mt-2"
          aria-label={`Course progress: ${curriculum.progressPct}% complete`}
        />
        <p className="mt-1 text-xs text-fg-muted tabular-nums">{curriculum.progressPct}% complete</p>
      </div>

      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">Up next</h3>
        {upNext ? (
          <Link
            href={`/lessons/${upNext.lesson.id}`}
            data-testid="context-panel-up-next"
            className="block rounded-lg border border-border p-3 transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <p className="text-xs text-fg-muted">{upNext.moduleTitle}</p>
            <p className="mt-0.5 text-sm font-medium text-fg">{upNext.lesson.title}</p>
            <span className="mt-2 inline-block text-xs font-medium text-brand-500">
              {upNext.lesson.progress ? "Resume →" : "Start →"}
            </span>
          </Link>
        ) : (
          <p className="text-sm text-fg-muted" data-testid="context-panel-all-done">
            You&rsquo;ve completed every lesson in this course.
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Activity tab — recent notifications
// ---------------------------------------------------------------------------

function ActivityTab(): React.JSX.Element {
  const { items, isLoading, isSignedOut, markRead } = useNotifications();

  if (isSignedOut) {
    return <EmptyState title="Signed out" description="Sign in to see your recent activity." />;
  }

  if (isLoading) {
    return (
      <div role="status" aria-busy="true" aria-label="Loading activity" className="space-y-2">
        <Skeleton shape="block" className="h-14 w-full rounded-md" />
        <Skeleton shape="block" className="h-14 w-full rounded-md" />
        <Skeleton shape="block" className="h-14 w-full rounded-md" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        title="Nothing yet"
        description="Grades, announcements, and replies will show up here."
      />
    );
  }

  return (
    <div className="space-y-2" data-testid="context-panel-activity">
      <ul className="m-0 list-none space-y-2 p-0">
        {items.slice(0, ACTIVITY_LIMIT).map((n) => (
          <li key={n.id}>
            <NotificationItem
              id={n.id}
              type={n.type as React.ComponentProps<typeof NotificationItem>["type"]}
              title={deriveNotificationTitle(n.type, n.payload)}
              body={deriveNotificationBody(n.payload)}
              timestamp={new Date(n.createdAt)}
              isRead={Boolean(n.readAt)}
              onMarkRead={markRead}
            />
          </li>
        ))}
      </ul>
      {items.length > ACTIVITY_LIMIT ? (
        <Link
          href="/notifications"
          className="inline-block rounded text-sm font-medium text-brand-500 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          View all notifications →
        </Link>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared tab body
// ---------------------------------------------------------------------------

function usePanelTabs({
  enrollmentId,
  lessonId,
  activeLessonId,
  lastPositionS,
}: CourseContextPanelProps): DetailShellTab[] {
  const { unreadCount } = useNotifications();

  return React.useMemo(() => {
    const tabs: DetailShellTab[] = [
      {
        value: "outline",
        label: "Outline",
        icon: <ListTree aria-hidden="true" className="size-4" />,
        "data-testid": "context-tab-outline",
        content: (
          <CourseSidebar
            enrollmentId={enrollmentId}
            activeLessonId={activeLessonId}
            // Strip the standalone-card chrome: inside a tab the panel already
            // provides the border and background.
            className="rounded-none border-0 bg-transparent"
            hideHeading
          />
        ),
      },
    ];

    // Notes are lesson-scoped, so the tab only exists on the lesson page.
    if (lessonId) {
      tabs.push({
        value: "notes",
        label: "Notes",
        icon: <NotebookPen aria-hidden="true" className="size-4" />,
        "data-testid": "context-tab-notes",
        content: (
          <LessonNotesPanel lessonId={lessonId} lastPositionS={lastPositionS ?? null} className="" hideHeading />
        ),
      });
    }

    tabs.push(
      {
        value: "activity",
        label: "Activity",
        icon: <Activity aria-hidden="true" className="size-4" />,
        "data-testid": "context-tab-activity",
        // Count is visible text, never colour-only.
        badge:
          unreadCount > 0 ? (
            <StatusChip tone="info" size="sm" label={`${unreadCount} new`} />
          ) : undefined,
        content: <ActivityTab />,
      },
      {
        value: "progress",
        label: "Progress",
        icon: <TrendingUp aria-hidden="true" className="size-4" />,
        "data-testid": "context-tab-progress",
        content: <ProgressTab enrollmentId={enrollmentId} />,
      },
    );

    return tabs;
  }, [enrollmentId, lessonId, activeLessonId, lastPositionS, unreadCount]);
}

// ---------------------------------------------------------------------------
// CourseContextPanel
// ---------------------------------------------------------------------------

// Notes first on the lesson page (the reason a student opens the panel
// mid-video); Outline first on the course page.
function defaultTabFor(props: CourseContextPanelProps): string {
  return props.lessonId ? "notes" : "outline";
}

/**
 * Desktop right rail (lg+). Render as a direct child of the page's
 * `lg:flex-row` container, after the main column.
 */
export function CourseContextPanel(props: CourseContextPanelProps): React.JSX.Element {
  const tabs = usePanelTabs(props);

  return (
    <aside
      aria-label="Course context"
      data-testid="course-context-panel"
      className={cnPanel(props.className)}
    >
      <DetailShell
        tabs={tabs}
        defaultValue={defaultTabFor(props)}
        tabsAriaLabel="Course context sections"
        data-testid="course-context-detail-shell"
      />
    </aside>
  );
}

/**
 * Below-lg counterpart: a button that opens the same tabs in a right-side
 * Drawer. Deliberately a separate export rather than a second branch inside
 * CourseContextPanel — the two render at different points in the page flow, and
 * rendering one component in both places produced two triggers below `lg`.
 */
export function CourseContextPanelDrawer(
  props: CourseContextPanelProps,
): React.JSX.Element {
  const tabs = usePanelTabs(props);

  return (
    <div className="lg:hidden" data-testid="course-context-panel-mobile">
      <Drawer>
        <DrawerTrigger asChild>
          <Button variant="secondary" size="sm" data-testid="course-context-panel-open">
            <PanelRightOpen aria-hidden="true" className="size-4" />
            Course panel
          </Button>
        </DrawerTrigger>
        <DrawerContent title="Course panel" size="sm">
          <DrawerBody>
            <DetailShell
              tabs={tabs}
              defaultValue={defaultTabFor(props)}
              tabsAriaLabel="Course context sections"
            />
          </DrawerBody>
        </DrawerContent>
      </Drawer>
    </div>
  );
}

/**
 * Desktop rail geometry. Kept as a literal string so Tailwind's scanner keeps
 * the classes, matching the convention in lms-shell.tsx.
 */
function cnPanel(className?: string): string {
  return [
    "hidden lg:block lg:w-80 lg:shrink-0 lg:sticky lg:top-20",
    "max-h-[calc(100vh-6rem)] overflow-y-auto",
    "rounded-xl border border-border bg-card p-4",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
}
