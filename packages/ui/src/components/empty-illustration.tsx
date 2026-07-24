import * as React from "react";

import { cn } from "../lib/cn";

/**
 * EmptyIllustration — the shared "nothing to show" graphic used as the default visual of
 * <EmptyState> (docs/07-design-system.md §5). A soft, grayscale "searching an empty space"
 * scene: rounded background blobs, a dashed placeholder card, and a magnifying glass with a
 * "?" lens. Purely decorative (the parent EmptyState marks the region aria-hidden and
 * carries the accessible title/description), so it takes no label.
 *
 * Theme-aware: strokes/fills are drawn in `currentColor` at layered opacities, so it
 * inherits the wrapper's text color (`text-fg-subtle`) and adapts to light/dark
 * automatically — no hardcoded greys.
 */
export interface EmptyIllustrationProps extends React.SVGProps<SVGSVGElement> {
  className?: string;
}

export function EmptyIllustration({ className, ...props }: EmptyIllustrationProps): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 200 160"
      fill="none"
      role="presentation"
      aria-hidden="true"
      className={cn("h-32 w-32 text-fg-subtle", className)}
      {...props}
    >
      {/* Soft background blobs */}
      <g opacity="0.12" fill="currentColor">
        <rect x="34" y="34" width="120" height="26" rx="13" />
        <rect x="20" y="70" width="150" height="26" rx="13" />
        <rect x="44" y="106" width="100" height="26" rx="13" />
      </g>

      {/* Dashed "missing content" placeholder card */}
      <rect
        x="46"
        y="40"
        width="78"
        height="78"
        rx="12"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeDasharray="7 8"
        strokeLinecap="round"
        opacity="0.5"
      />

      {/* Sparkle, top-left */}
      <g stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity="0.5">
        <path d="M32 30 L32 44" />
        <path d="M25 37 L39 37" />
      </g>

      {/* Magnifying glass, bottom-right */}
      <g>
        {/* opaque lens (card-colored) so the dashed placeholder doesn't show through it */}
        <circle cx="112" cy="96" r="30" className="fill-card" />
        <circle cx="112" cy="96" r="30" stroke="currentColor" strokeWidth="3.5" opacity="0.85" />
        {/* handle */}
        <path
          d="M134 118 L152 136"
          stroke="currentColor"
          strokeWidth="6"
          strokeLinecap="round"
          opacity="0.85"
        />
        {/* "?" in the lens */}
        <path
          d="M104 89 a8 8 0 1 1 12 6 c-3 2 -4 4 -4 7"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          opacity="0.7"
        />
        <circle cx="112" cy="109" r="1.9" fill="currentColor" opacity="0.7" />
      </g>
    </svg>
  );
}
EmptyIllustration.displayName = "EmptyIllustration";
