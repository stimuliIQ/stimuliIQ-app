"use client";

import * as React from "react";
import * as AccordionPrimitive from "@radix-ui/react-accordion";
import {
  ChevronDown,
  Lock,
  PlayCircle,
  BookOpen,
  CheckCircle2,
  Eye,
} from "lucide-react";

import { cn } from "../lib/cn";

/**
 * CurriculumAccordion / LessonList — program curriculum browser for the LMS student portal.
 * Per docs/07-design-system.md §5 ("Accordion — curriculum, FAQ, record tabs") and
 * docs/02-prd-lms.md §7.2 ("curriculum tree: sections → lessons; completion checkmarks,
 * locked items if sequential path enabled").
 *
 * Built on @radix-ui/react-accordion — standard shadcn/ui stack. Radix provides:
 * - Keyboard navigation: Space/Enter toggle, Tab moves focus, Home/End jump to first/last.
 * - Proper ARIA roles: button with aria-expanded on triggers, region panels.
 *
 * Lesson types: "video" | "reading" — rendered with appropriate icons (PlayCircle / BookOpen).
 * Locked: non-preview, non-enrolled lessons show a Lock icon + "Locked" label — NEVER
 *   color-only; the lock icon + text together signal the state.
 * Completed: CheckCircle2 icon in success tone.
 * Preview: Eye icon — viewable pre-enrollment.
 * Active / current: aria-current="true" + visual highlight.
 *
 * Usage:
 *   <CurriculumAccordion
 *     modules={[
 *       {
 *         id: "mod-1",
 *         title: "Python Basics",
 *         lessons: [
 *           {
 *             id: "les-1",
 *             title: "Variables & types",
 *             type: "video",
 *             durationMin: 12,
 *             status: "completed",
 *             isPreview: false,
 *             isLocked: false,
 *           },
 *           {
 *             id: "les-2",
 *             title: "Control flow",
 *             type: "video",
 *             durationMin: 18,
 *             status: "not_started",
 *             isPreview: false,
 *             isLocked: true,
 *           },
 *         ],
 *       },
 *     ]}
 *     activeLessonId="les-2"
 *     onLessonClick={(id) => router.push(`/lessons/${id}`)}
 *   />
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LessonType = "video" | "reading";
export type LessonStatus = "not_started" | "in_progress" | "completed";

export interface LessonItem {
  id: string;
  title: string;
  type: LessonType;
  /** Duration rounded to nearest minute (optional). */
  durationMin?: number;
  status: LessonStatus;
  /** Preview lessons are visible to non-enrolled students. */
  isPreview: boolean;
  /** Locked: enrollment required and not met, OR sequential path gate not passed. */
  isLocked: boolean;
}

export interface CurriculumModule {
  id: string;
  title: string;
  lessons: LessonItem[];
  /** Completion count out of total (computed from lessons if omitted). */
  completedCount?: number;
}

export interface CurriculumAccordionProps {
  modules: CurriculumModule[];
  /** The lesson currently being viewed — receives aria-current="true". */
  activeLessonId?: string;
  /**
   * Called when a non-locked lesson row is clicked (or activated via keyboard).
   * Locked lessons do not fire this callback.
   */
  onLessonClick?: (lessonId: string) => void;
  /**
   * Whether all modules are open by default.
   * Radix Accordion type="multiple" allows any/all open simultaneously.
   * Default: all modules open.
   */
  defaultOpenAll?: boolean;
  className?: string;
  /** Test hook; defaults to "curriculum-accordion". */
  "data-testid"?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const lessonIcon: Record<LessonType, React.FC<{ className?: string }>> = {
  video: PlayCircle,
  reading: BookOpen,
};

const lessonTypeLabel: Record<LessonType, string> = {
  video: "Video lesson",
  reading: "Reading",
};

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

// ---------------------------------------------------------------------------
// LessonRow (individual lesson within a module)
// ---------------------------------------------------------------------------

interface LessonRowProps {
  lesson: LessonItem;
  isActive: boolean;
  onLessonClick?: (id: string) => void;
}

function LessonRow({ lesson, isActive, onLessonClick }: LessonRowProps): React.JSX.Element {
  const Icon = lessonIcon[lesson.type];
  const typeLabel = lessonTypeLabel[lesson.type];
  const isClickable = !lesson.isLocked && !!onLessonClick;

  function handleClick(): void {
    if (isClickable) onLessonClick?.(lesson.id);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLLIElement>): void {
    if (isClickable && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      onLessonClick?.(lesson.id);
    }
  }

  return (
    <li
      data-testid="lesson-row"
      aria-current={isActive ? "true" : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onClick={isClickable ? handleClick : undefined}
      onKeyDown={isClickable ? handleKeyDown : undefined}
      className={cn(
        "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm",
        "transition-colors duration-fast ease-out",
        isActive && "bg-brand-50 dark:bg-brand-700/20",
        isClickable && [
          "cursor-pointer hover:bg-surface",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        ],
        lesson.isLocked && "opacity-60",
      )}
    >
      {/* Type icon */}
      <Icon
        aria-hidden="true"
        className={cn(
          "size-4 shrink-0",
          isActive ? "text-brand-500" : "text-fg-subtle",
        )}
      />

      {/* Title + meta */}
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "line-clamp-1 font-medium",
            isActive ? "text-brand-500" : "text-fg",
          )}
        >
          {/* SR-only type label so screen readers announce context */}
          <span className="sr-only">{typeLabel}: </span>
          {lesson.title}
        </p>
        <div className="flex items-center gap-1.5 mt-0.5">
          {lesson.durationMin != null ? (
            <span className="text-xs text-fg-muted">{formatDuration(lesson.durationMin)}</span>
          ) : null}
          {lesson.isPreview ? (
            <span className="inline-flex items-center gap-0.5 text-xs text-info font-medium">
              <Eye aria-hidden="true" className="size-3" />
              Preview
            </span>
          ) : null}
        </div>
      </div>

      {/* Status / lock indicator — never color-only */}
      <div className="shrink-0 flex items-center gap-1">
        {lesson.isLocked ? (
          // Lock: icon + text so it is never color-only
          <span className="inline-flex items-center gap-1 text-xs text-fg-subtle">
            <Lock aria-hidden="true" className="size-3.5" />
            <span>Locked</span>
          </span>
        ) : lesson.status === "completed" ? (
          <CheckCircle2
            aria-label="Completed"
            className="size-4 text-success"
          />
        ) : lesson.status === "in_progress" ? (
          // Partial progress indicator — dot + label
          <span className="inline-flex items-center gap-1 text-xs text-brand-500 font-medium">
            <span aria-hidden="true" className="size-2 rounded-full bg-brand-500 inline-block" />
            <span>In progress</span>
          </span>
        ) : null}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Module header / accordion item
// ---------------------------------------------------------------------------

/**
 * CurriculumModule displayed as a single Radix accordion item.
 * Internal — not exported separately; consumers use CurriculumAccordion.
 */
interface ModuleAccordionItemProps {
  module: CurriculumModule;
  activeLessonId?: string;
  onLessonClick?: (id: string) => void;
}

function ModuleAccordionItem({
  module,
  activeLessonId,
  onLessonClick,
}: ModuleAccordionItemProps): React.JSX.Element {
  const completed = module.completedCount ??
    module.lessons.filter((l) => l.status === "completed").length;
  const total = module.lessons.length;

  return (
    <AccordionPrimitive.Item
      value={module.id}
      data-testid="curriculum-module"
      className="border border-border rounded-lg overflow-hidden"
    >
      <AccordionPrimitive.Header asChild>
        {/* <h3> gives the module heading semantics in the outline */}
        <h3 className="m-0">
          <AccordionPrimitive.Trigger
            data-testid="curriculum-module-trigger"
            className={cn(
              "flex w-full items-center justify-between gap-3 px-4 py-3",
              "text-left text-sm font-semibold text-fg bg-card",
              "transition-colors duration-fast ease-out hover:bg-surface",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
              "[&[data-state=open]>svg]:rotate-180",
            )}
          >
            <span className="min-w-0 flex-1 line-clamp-1">{module.title}</span>
            {/* Completion count — textual, not color-only */}
            <span className="shrink-0 text-xs font-normal text-fg-muted tabular-nums">
              {completed}/{total}
            </span>
            <ChevronDown
              aria-hidden="true"
              className="size-4 shrink-0 text-fg-muted transition-transform duration-base ease-out"
            />
          </AccordionPrimitive.Trigger>
        </h3>
      </AccordionPrimitive.Header>

      <AccordionPrimitive.Content
        data-testid="curriculum-module-content"
        className={cn(
          "overflow-hidden",
          // Radix animates data-state open/closed via CSS custom properties
          "data-[state=open]:animate-accordion-down data-[state=closed]:animate-accordion-up",
        )}
      >
        <ol
          aria-label={`Lessons in ${module.title}`}
          className="list-none p-0 m-0 py-1 px-1 flex flex-col gap-0.5"
        >
          {module.lessons.map((lesson) => (
            <LessonRow
              key={lesson.id}
              lesson={lesson}
              isActive={lesson.id === activeLessonId}
              onLessonClick={onLessonClick}
            />
          ))}
        </ol>
      </AccordionPrimitive.Content>
    </AccordionPrimitive.Item>
  );
}

// ---------------------------------------------------------------------------
// CurriculumAccordion (public component)
// ---------------------------------------------------------------------------

export function CurriculumAccordion({
  modules,
  activeLessonId,
  onLessonClick,
  defaultOpenAll = true,
  className,
  "data-testid": testId,
}: CurriculumAccordionProps): React.JSX.Element {
  return (
    <AccordionPrimitive.Root
      type="multiple"
      defaultValue={defaultOpenAll ? modules.map((m) => m.id) : []}
      data-testid={testId ?? "curriculum-accordion"}
      role="region"
      aria-label="Course curriculum"
      className={cn("flex flex-col gap-2", className)}
    >
      {modules.map((module) => (
        <ModuleAccordionItem
          key={module.id}
          module={module}
          activeLessonId={activeLessonId}
          onLessonClick={onLessonClick}
        />
      ))}
    </AccordionPrimitive.Root>
  );
}

// ---------------------------------------------------------------------------
// LessonList — flat lesson list variant (no accordion wrapping)
// ---------------------------------------------------------------------------

/**
 * LessonList — flat (non-collapsible) ordered list of lessons. Use when the module
 * context is already provided by a parent heading, e.g. inside a course tab pane.
 *
 * Usage:
 *   <LessonList
 *     lessons={module.lessons}
 *     activeLessonId={currentLessonId}
 *     onLessonClick={(id) => router.push(`/lessons/${id}`)}
 *   />
 */
export interface LessonListProps {
  lessons: LessonItem[];
  activeLessonId?: string;
  onLessonClick?: (lessonId: string) => void;
  /** aria-label for the <ol> element. */
  label?: string;
  className?: string;
  /** Test hook; defaults to "lesson-list". */
  "data-testid"?: string;
}

export function LessonList({
  lessons,
  activeLessonId,
  onLessonClick,
  label = "Lessons",
  className,
  "data-testid": testId,
}: LessonListProps): React.JSX.Element {
  return (
    <ol
      data-testid={testId ?? "lesson-list"}
      aria-label={label}
      className={cn("list-none p-0 m-0 flex flex-col gap-0.5", className)}
    >
      {lessons.map((lesson) => (
        <LessonRow
          key={lesson.id}
          lesson={lesson}
          isActive={lesson.id === activeLessonId}
          onLessonClick={onLessonClick}
        />
      ))}
    </ol>
  );
}
