"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";

import { cn } from "../lib/cn";
import { ProgressBar } from "./progress";
import { StatusChip, type StatusChipTone } from "./status-chip";

/**
 * CourseCard — enrollment/course tile for the LMS "My Courses" dashboard grid.
 * Per docs/07-design-system.md §5 ("Card — header/body/footer; used for programs,
 * KPIs, lessons") + docs/02-prd-lms.md §7.1/§7.2 ("enrolled programs as cards:
 * cover, progress %, next item").
 *
 * The card is interactive (clickable / keyboard-focusable) via `onClick` + `asChild`
 * (renders onto a Next.js `<Link>` etc.). Either `onClick` or `asChild` wires the
 * interaction; both can coexist if the caller controls the anchor child.
 *
 * Slots:
 * - thumbnail: cover image (16:9 slot; pass a string URL or a custom element)
 * - statusTone / statusLabel: StatusChip tone+label (e.g. "success"/"Active")
 * - progress: 0–100 completion percentage → ProgressBar + label
 * - nextLesson: text of the next lesson to continue (shown below the progress bar)
 * - cta: React.ReactNode for the "Continue" button slot
 *
 * a11y:
 * - Card is keyboard-focusable (tabIndex=0 unless rendered as a native link/button).
 * - Focus ring via Tailwind focus-visible utilities mapped to the --ring token.
 * - StatusChip uses icon+label so status is never color-only.
 * - onClick + onKeyDown(Enter/Space) when not rendered asChild.
 *
 * Usage:
 *   // As a plain interactive div
 *   <CourseCard
 *     title="Python for Data Science"
 *     program="B.Tech 2024 Batch A"
 *     thumbnail="/covers/python.jpg"
 *     progress={65}
 *     statusTone="success"
 *     statusLabel="Active"
 *     nextLesson="Module 3 · NumPy arrays"
 *     onClick={() => router.push('/courses/enr-001')}
 *   />
 *
 *   // As a Next.js Link (asChild)
 *   <CourseCard asChild title="..." progress={40}>
 *     <Link href="/courses/enr-001" />
 *   </CourseCard>
 */
export interface CourseCardProps {
  title: string;
  /** Sub-heading: batch / program name. */
  program?: string;
  /**
   * Thumbnail image URL. Rendered as an <img> with alt="".
   * Pass `thumbnailElement` to override with a custom React node.
   */
  thumbnail?: string;
  /** Override the entire thumbnail slot with a custom element. */
  thumbnailElement?: React.ReactNode;
  /** Completion percentage 0–100. */
  progress?: number;
  /**
   * StatusChip tone — maps to one of the five semantic tones.
   * Default: "neutral".
   */
  statusTone?: StatusChipTone;
  /** StatusChip label. */
  statusLabel?: string;
  /** Text description of the next lesson to continue. */
  nextLesson?: string;
  /** CTA slot — rendered at the bottom of the card (e.g. a Button). */
  cta?: React.ReactNode;
  /**
   * If true, the card wraps a child element (e.g. Next.js `<Link>`) passed as `children`.
   * Radix `Slot` merges className and event handlers onto the single child element,
   * making the entire card an interactive link. The card's visual content is nested inside
   * the child element.
   *
   * Usage:
   *   <CourseCard asChild title="..." progress={40}>
   *     <Link href="/courses/enr-001" />
   *   </CourseCard>
   */
  asChild?: boolean;
  /**
   * Child element to render onto when `asChild` is true (e.g. `<Link href="...">`).
   * Ignored when `asChild` is false.
   */
  children?: React.ReactElement;
  onClick?: React.MouseEventHandler<HTMLDivElement>;
  className?: string;
  /** Test hook; defaults to "course-card". */
  "data-testid"?: string;
}

export const CourseCard = React.forwardRef<HTMLDivElement, CourseCardProps>(
  (
    {
      title,
      program,
      thumbnail,
      thumbnailElement,
      progress,
      statusTone = "neutral",
      statusLabel,
      nextLesson,
      cta,
      asChild = false,
      children,
      onClick,
      className,
      "data-testid": testId,
    },
    ref,
  ) => {
    const handleKeyDown = React.useCallback(
      (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (onClick && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onClick(e as unknown as React.MouseEvent<HTMLDivElement>);
        }
      },
      [onClick],
    );

    const cardClassName = cn(
      "block rounded-lg border border-border bg-card text-fg shadow-sm overflow-hidden",
      "transition-shadow duration-fast ease-out",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
      onClick && "cursor-pointer hover:shadow-md",
      className,
    );

    const inner = (
      <>
        {/* Thumbnail — 16:9 */}
        <div className="relative aspect-video w-full overflow-hidden rounded-t-lg bg-surface">
          {thumbnailElement ??
            (thumbnail ? (
              <img
                src={thumbnail}
                alt=""
                aria-hidden="true"
                className="h-full w-full object-cover"
              />
            ) : (
              <div
                aria-hidden="true"
                className="h-full w-full bg-gradient-to-br from-brand-100/60 to-brand-500/10"
              />
            ))}
          {/* Status chip overlaid on thumbnail */}
          {statusLabel ? (
            <span className="absolute left-2 top-2">
              <StatusChip tone={statusTone} label={statusLabel} size="sm" />
            </span>
          ) : null}
        </div>

        {/* Body */}
        <div className="flex flex-col gap-2 p-4">
          {/* Title */}
          <h3 className="line-clamp-2 text-sm font-semibold leading-heading text-fg">
            {title}
          </h3>
          {/* Program / batch */}
          {program ? (
            <p className="text-xs text-fg-muted line-clamp-1">{program}</p>
          ) : null}

          {/* Progress bar */}
          {progress != null ? (
            <div className="flex flex-col gap-1 pt-1">
              <ProgressBar
                value={progress}
                label={`${title} completion`}
                size="sm"
                showLabel
              />
              {nextLesson ? (
                <p className="text-xs text-fg-muted line-clamp-1">
                  <span className="font-medium text-fg">Next:</span> {nextLesson}
                </p>
              ) : null}
            </div>
          ) : null}

          {/* CTA slot */}
          {cta ? <div className="mt-1">{cta}</div> : null}
        </div>
      </>
    );

    if (asChild && children) {
      // Merge card styles + testid onto the consumer's child element (e.g. Next.js Link).
      // The card's visual content is injected as the children of that slotted element.
      return (
        <Slot
          ref={ref as React.Ref<HTMLDivElement>}
          data-testid={testId ?? "course-card"}
          className={cardClassName}
        >
          {React.cloneElement(children, {}, inner)}
        </Slot>
      );
    }

    return (
      <div
        ref={ref}
        data-testid={testId ?? "course-card"}
        role={onClick ? "button" : undefined}
        tabIndex={onClick ? 0 : undefined}
        onClick={onClick}
        onKeyDown={onClick ? handleKeyDown : undefined}
        className={cn(
          "rounded-lg border border-border bg-card text-fg shadow-sm overflow-hidden",
          "transition-shadow duration-fast ease-out",
          onClick && [
            "cursor-pointer hover:shadow-md",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
          ],
          className,
        )}
      >
        {inner}
      </div>
    );
  },
);
CourseCard.displayName = "CourseCard";
