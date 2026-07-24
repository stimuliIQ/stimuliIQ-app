import * as React from "react";

import { cn } from "../lib/cn";

/**
 * Skeleton — shimmer loading placeholder, per docs/07-design-system.md §5/§7. Reused by
 * DataTable's loading rows and by Card-based async surfaces. Respects
 * `prefers-reduced-motion` (the shimmer animation is disabled globally in styles.css).
 */
export type SkeletonShape = "block" | "line" | "circle";

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Visual shape: a rectangular block, a single text line, or a circle (avatar). */
  shape?: SkeletonShape;
  /** Test hook; defaults to "skeleton" when omitted. */
  "data-testid"?: string;
}

const shapeClassName: Record<SkeletonShape, string> = {
  block: "h-20 w-full rounded-md",
  line: "h-4 w-full rounded-sm",
  circle: "size-10 rounded-full",
};

export const Skeleton = React.forwardRef<HTMLDivElement, SkeletonProps>(
  ({ className, shape = "block", "data-testid": testId, ...props }, ref) => (
    <div
      ref={ref}
      data-testid={testId ?? "skeleton"}
      role="presentation"
      aria-hidden="true"
      className={cn(
        "animate-pulse bg-surface",
        shapeClassName[shape],
        className,
      )}
      {...props}
    />
  ),
);
Skeleton.displayName = "Skeleton";
