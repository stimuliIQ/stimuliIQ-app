// CourseSidebar — Udemy-style curriculum sidebar shared by the course detail
// page and the lesson player page.
//
// Renders the module → lesson tree from useCurriculum(enrollmentId):
//   - Module headers are single-open accordion rows; the module containing the
//     active lesson opens by default (falls back to the first module).
//   - Lesson rows show title, duration (m:ss), and exactly one trailing badge:
//     lock (server-set `locked`), completed check, or "Free" (preview).
//   - The active lesson is highlighted and marked aria-current.
//
// LOCKED semantics: the server is authoritative (curriculum.schemas.ts) — locked
// rows are rendered non-navigable; the API would 403 anyway.
// CLAUDE.md §3: "no business logic in components — use hooks/services".
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Lock } from "lucide-react";
import { cn, Skeleton } from "@repo/ui";
import type { CurriculumLessonNode, CurriculumModuleNode } from "@repo/types";

import { useCurriculum } from "../../hooks/use-curriculum";
import { formatClock } from "../../lib/format-duration";

// ---------------------------------------------------------------------------
// Lesson row
// ---------------------------------------------------------------------------

interface SidebarLessonRowProps {
  lesson: CurriculumLessonNode;
  isActive: boolean;
  onNavigate: (lessonId: string) => void;
}

function SidebarLessonRow({
  lesson,
  isActive,
  onNavigate,
}: SidebarLessonRowProps): React.JSX.Element {
  const isCompleted = lesson.progress?.status === "completed";

  return (
    <li>
      <button
        type="button"
        disabled={lesson.locked}
        aria-current={isActive ? "true" : undefined}
        aria-disabled={lesson.locked || undefined}
        onClick={() => onNavigate(lesson.id)}
        data-testid="sidebar-lesson-row"
        className={cn(
          "flex w-full items-center gap-3 px-4 py-3 text-left text-sm transition-colors duration-fast",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
          isActive
            ? "bg-surface font-medium text-fg"
            : "text-fg-muted hover:bg-surface hover:text-fg",
          lesson.locked && "cursor-not-allowed opacity-70 hover:bg-transparent hover:text-fg-muted",
        )}
      >
        <span className="min-w-0 flex-1 leading-snug line-clamp-2">
          {lesson.title}
        </span>

        {lesson.durationS != null ? (
          <span className="shrink-0 text-xs tabular-nums text-fg-muted">
            {formatClock(lesson.durationS)}
          </span>
        ) : null}

        {/* Trailing badge — exactly one of: lock / completed / Free */}
        <span className="flex w-10 shrink-0 justify-end">
          {lesson.locked ? (
            <span
              aria-label="Locked"
              title="Locked"
              className="inline-flex size-7 items-center justify-center rounded-md bg-surface text-fg-subtle"
            >
              <Lock aria-hidden="true" className="size-3.5" />
            </span>
          ) : isCompleted ? (
            <span
              aria-label="Completed"
              title="Completed"
              className="inline-flex size-7 items-center justify-center rounded-md bg-success/10 text-success"
            >
              <Check aria-hidden="true" className="size-3.5" />
            </span>
          ) : lesson.isPreview ? (
            <span className="inline-flex items-center rounded-md bg-surface px-2 py-1 text-xs font-medium text-fg-muted">
              Free
            </span>
          ) : null}
        </span>
      </button>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Module accordion section
// ---------------------------------------------------------------------------

interface SidebarModuleProps {
  module: CurriculumModuleNode;
  isOpen: boolean;
  onToggle: (moduleId: string) => void;
  activeLessonId?: string;
  onNavigate: (lessonId: string) => void;
}

function SidebarModule({
  module,
  isOpen,
  onToggle,
  activeLessonId,
  onNavigate,
}: SidebarModuleProps): React.JSX.Element {
  const panelId = `sidebar-module-panel-${module.id}`;

  return (
    <li data-testid="sidebar-module">
      <h3 className="m-0">
        <button
          type="button"
          aria-expanded={isOpen}
          aria-controls={panelId}
          onClick={() => onToggle(module.id)}
          data-testid="sidebar-module-trigger"
          className={cn(
            "flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-semibold transition-colors duration-fast",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
            isOpen
              ? "border-l-2 border-fg bg-surface text-fg"
              : "border-l-2 border-transparent text-fg-muted hover:bg-surface hover:text-fg",
          )}
        >
          <span className="min-w-0 flex-1 line-clamp-1">{module.title}</span>
          <ChevronDown
            aria-hidden="true"
            className={cn(
              "size-4 shrink-0 text-fg-muted transition-transform duration-base",
              isOpen && "rotate-180",
            )}
          />
        </button>
      </h3>

      {isOpen ? (
        <ol
          id={panelId}
          aria-label={`Lessons in ${module.title}`}
          className="m-0 list-none p-0"
        >
          {module.lessons.map((lesson) => (
            <SidebarLessonRow
              key={lesson.id}
              lesson={lesson}
              isActive={lesson.id === activeLessonId}
              onNavigate={onNavigate}
            />
          ))}
        </ol>
      ) : null}
    </li>
  );
}

// ---------------------------------------------------------------------------
// CourseSidebar (public)
// ---------------------------------------------------------------------------

export interface CourseSidebarProps {
  enrollmentId: string;
  /** The lesson currently being viewed (lesson player page). */
  activeLessonId?: string;
  className?: string;
  /**
   * Hides the "Modules" heading when the surrounding chrome already names the
   * section (e.g. the course context panel's "Outline" tab). The nav keeps its
   * aria-label either way.
   */
  hideHeading?: boolean;
}

/**
 * Curriculum sidebar. Renders its own skeleton while loading and collapses to
 * nothing on error/forbidden — the page's main content owns error surfaces.
 */
export function CourseSidebar({
  enrollmentId,
  activeLessonId,
  className,
  hideHeading = false,
}: CourseSidebarProps): React.JSX.Element | null {
  const router = useRouter();
  const { data: curriculum, isLoading } = useCurriculum(enrollmentId);

  // Single-open accordion. null = "not yet chosen" — resolved to the module
  // containing the active lesson (or the first module) once data arrives.
  const [openModuleId, setOpenModuleId] = React.useState<string | null>(null);
  const [hasAutoOpened, setHasAutoOpened] = React.useState(false);

  React.useEffect(() => {
    if (!curriculum || hasAutoOpened) return;
    const activeModule = activeLessonId
      ? curriculum.modules.find((m) =>
          m.lessons.some((l) => l.id === activeLessonId),
        )
      : undefined;
    setOpenModuleId(activeModule?.id ?? curriculum.modules[0]?.id ?? null);
    setHasAutoOpened(true);
  }, [curriculum, activeLessonId, hasAutoOpened]);

  if (isLoading) {
    return (
      <div
        role="status"
        aria-busy="true"
        aria-label="Loading course content"
        className={cn("space-y-3 rounded-xl border border-border bg-card p-4", className)}
        data-testid="course-sidebar-skeleton"
      >
        <Skeleton shape="line" className="h-4 w-24" />
        <Skeleton shape="block" className="h-10 w-full rounded-md" />
        <Skeleton shape="block" className="h-10 w-full rounded-md" />
        <Skeleton shape="block" className="h-10 w-full rounded-md" />
      </div>
    );
  }

  // Errors / forbidden / signed-out are surfaced by the page's main content.
  if (!curriculum || curriculum.modules.length === 0) return null;

  return (
    <nav
      aria-label="Course content"
      className={cn(
        "overflow-hidden rounded-xl border border-border bg-card",
        className,
      )}
      data-testid="course-sidebar"
    >
      {hideHeading ? null : (
        <p className="px-4 pb-1 pt-4 text-sm font-semibold uppercase tracking-wide text-fg-muted">
          Modules
        </p>
      )}
      <ol className="m-0 list-none p-0 pb-2">
        {curriculum.modules.map((module) => (
          <SidebarModule
            key={module.id}
            module={module}
            isOpen={module.id === openModuleId}
            onToggle={(id) =>
              setOpenModuleId((cur) => (cur === id ? null : id))
            }
            activeLessonId={activeLessonId}
            onNavigate={(lessonId) => router.push(`/lessons/${lessonId}`)}
          />
        ))}
      </ol>
    </nav>
  );
}
