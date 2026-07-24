"use client";

import * as React from "react";
import { PlayCircle } from "lucide-react";

import { cn } from "../lib/cn";
import { ProgressBar } from "./progress";
import { Button } from "./button";

/**
 * ContinueLearning — "Resume where you left off" hero card for the LMS dashboard.
 * Per docs/07-design-system.md §6 ("Continue-learning rail + progress ring (LMS
 * dashboard)") and docs/02-prd-lms.md §7.1 ("'Continue learning' rail — resume video
 * at timestamp").
 *
 * Fully presentational — all data comes via props. The consuming page / hook resolves
 * the latest `lesson_progress` via `GET /me/dashboard` and passes the resolved values.
 *
 * Props:
 * - lessonTitle: title of the lesson to resume.
 * - moduleTitle: module/section context (e.g. "Module 2 · NumPy arrays").
 * - programTitle: program name (e.g. "Python for Data Science").
 * - progress: 0–100 completion % of the program or module (for the ProgressBar).
 * - lastPositionS: seconds into the video to seek on resume (passed through to the
 *   lesson page via the `resumeHref` deep-link or the `onResume` callback; this component
 *   does NOT interpret or format it beyond formatting for the label).
 * - resumeHref: if provided, the CTA becomes a Link (via asChild on the Button). Pass
 *   the lesson URL with the position encoded, e.g. `/lessons/les-001?t=120`.
 * - onResume: if `resumeHref` is not provided, fire this callback when the CTA is clicked.
 * - thumbnail: cover image URL (optional; shown as a 16:9 thumbnail to the left).
 *
 * a11y:
 * - The CTA Button has an explicit aria-label describing the action.
 * - ProgressBar is labelled.
 * - Thumbnail is decorative (aria-hidden).
 * - The card is not itself a link — only the CTA is interactive, avoiding nested-link issues.
 *
 * Usage (plain onClick):
 *   <ContinueLearning
 *     lessonTitle="Variables & data types"
 *     moduleTitle="Module 1 · Intro"
 *     programTitle="Python for Data Science"
 *     progress={35}
 *     lastPositionS={420}
 *     onResume={() => router.push('/lessons/les-001?t=420')}
 *   />
 *
 * Usage (with href — passes resumeHref directly to Button asChild + Link):
 *   <ContinueLearning
 *     lessonTitle="NumPy arrays"
 *     moduleTitle="Module 3"
 *     programTitle="Python for Data Science"
 *     progress={60}
 *     lastPositionS={180}
 *     resumeHref="/lessons/les-012?t=180"
 *     resumeLinkComponent={NextLink}  // optional: pass router's Link; defaults to <a>
 *   />
 */
export interface ContinueLearningProps {
  lessonTitle: string;
  /** Module or section context label. */
  moduleTitle?: string;
  /** Program / course name. */
  programTitle?: string;
  /** Program-level completion 0–100 (shown in the ProgressBar). */
  progress?: number;
  /**
   * Resume position in seconds. Used only to format the human-readable time label;
   * the actual seek is encoded in `resumeHref` or handled by `onResume`.
   */
  lastPositionS?: number;
  /**
   * Deep-link URL to the lesson at the last position (e.g. `/lessons/les-001?t=420`).
   * If provided, the CTA renders as an anchor. If omitted, use `onResume` callback.
   */
  resumeHref?: string;
  /**
   * Callback fired when the resume CTA is clicked. Used when you cannot pre-compute
   * a deep-link (e.g. when you need to re-mint the signed URL first).
   */
  onResume?: () => void;
  /**
   * Optional thumbnail cover image URL (decorative, aria-hidden).
   */
  thumbnail?: string;
  className?: string;
  /** Test hook; defaults to "continue-learning". */
  "data-testid"?: string;
}

/** Format seconds as "m:ss" (e.g. 420 → "7:00"). */
function formatSeconds(s: number): string {
  const m = Math.floor(s / 60);
  const rem = Math.floor(s % 60);
  return `${m}:${rem.toString().padStart(2, "0")}`;
}

export function ContinueLearning({
  lessonTitle,
  moduleTitle,
  programTitle,
  progress,
  lastPositionS,
  resumeHref,
  onResume,
  thumbnail,
  className,
  "data-testid": testId,
}: ContinueLearningProps): React.JSX.Element {
  const resumeLabel =
    lastPositionS != null && lastPositionS > 0
      ? `Resume "${lessonTitle}" at ${formatSeconds(lastPositionS)}`
      : `Continue "${lessonTitle}"`;

  // Build the CTA element
  const cta = resumeHref ? (
    <Button
      asChild
      variant="primary"
      size="sm"
      aria-label={resumeLabel}
      data-testid="continue-learning-cta"
    >
      {/* Render onto a plain <a> by default; the consuming app swaps with Next.js Link */}
      <a href={resumeHref}>
        <PlayCircle aria-hidden="true" className="size-4" />
        Resume
      </a>
    </Button>
  ) : (
    <Button
      variant="primary"
      size="sm"
      aria-label={resumeLabel}
      onClick={onResume}
      data-testid="continue-learning-cta"
    >
      <PlayCircle aria-hidden="true" className="size-4" />
      Resume
    </Button>
  );

  return (
    <div
      data-testid={testId ?? "continue-learning"}
      className={cn(
        "flex items-center gap-4 rounded-lg border border-border bg-card p-4 shadow-sm",
        "transition-shadow duration-fast ease-out hover:shadow-md",
        className,
      )}
    >
      {/* Thumbnail (decorative) */}
      {thumbnail ? (
        <div className="hidden sm:block shrink-0 w-24 aspect-video rounded-md overflow-hidden bg-surface">
          <img
            src={thumbnail}
            alt=""
            aria-hidden="true"
            className="h-full w-full object-cover"
          />
        </div>
      ) : null}

      {/* Content */}
      <div className="min-w-0 flex-1 flex flex-col gap-2">
        {/* Context breadcrumb */}
        {(programTitle ?? moduleTitle) ? (
          <p
            data-testid="continue-learning-context"
            className="text-xs text-fg-muted line-clamp-1"
          >
            {[programTitle, moduleTitle].filter(Boolean).join(" · ")}
          </p>
        ) : null}

        {/* Lesson title */}
        <p
          data-testid="continue-learning-title"
          className="text-sm font-semibold text-fg line-clamp-2"
        >
          {lessonTitle}
        </p>

        {/* Position hint */}
        {lastPositionS != null && lastPositionS > 0 ? (
          <p className="text-xs text-fg-muted">
            Last watched at{" "}
            <span className="font-medium text-fg">{formatSeconds(lastPositionS)}</span>
          </p>
        ) : null}

        {/* Progress bar */}
        {progress != null ? (
          <ProgressBar
            value={progress}
            label={`${programTitle ?? "Program"} completion`}
            size="sm"
            showLabel
          />
        ) : null}
      </div>

      {/* CTA */}
      <div className="shrink-0">{cta}</div>
    </div>
  );
}
