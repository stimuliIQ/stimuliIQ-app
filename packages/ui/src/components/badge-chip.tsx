import * as React from "react";
import { Award, CalendarCheck, Flame, Lock, Medal, Star, Target, Trophy } from "lucide-react";

import { cn } from "../lib/cn";

/**
 * BadgeChip — compact earned/locked badge display for the gamification surface.
 * Per docs/02-prd-lms.md §7.12/§7.19, docs/07 §5/§11.
 *
 * Design rules:
 * - Status conveyed by icon+label, never color alone (docs/07 §2).
 * - `locked` state is indicated by a Lock icon overlay AND the word "Locked" in
 *   the accessible label — not just a greyed color.
 * - `data-testid` defaults to "badge-chip".
 *
 * BadgeGrid — responsive grid of BadgeChips with section heading + empty/loading states.
 *
 * Usage:
 *   <BadgeChip
 *     name="First Project"
 *     icon="🏆"
 *     description="Submitted your first project"
 *     earned
 *   />
 *   <BadgeChip name="Streak Master" icon="🔥" description="30-day streak" locked />
 *
 *   <BadgeGrid
 *     badges={userBadges}
 *     loading={isLoading}
 *   />
 */

export interface BadgeChipProps {
  /** Display name of the badge. */
  name: string;
  /**
   * Icon to render. Can be a plain emoji string or a React node (e.g. an <img> or SVG).
   * Rendered as aria-hidden — the `name` provides the accessible label.
   */
  icon?: React.ReactNode;
  /** Short description of how the badge is earned (shown on hover/focus via title). */
  description?: string;
  /** Badge has been earned and should render in full color. */
  earned?: boolean;
  /** Badge is not yet earned — rendered locked/greyed. */
  locked?: boolean;
  /** Size variant. Defaults to "md". */
  size?: "sm" | "md" | "lg";
  className?: string;
  /** Test hook; defaults to "badge-chip". */
  "data-testid"?: string;
}

const sizeMap = {
  sm: { chip: "h-12 w-12 gap-0.5", icon: "text-lg", name: "text-[10px]", lockSize: "size-3", glyph: "size-4" },
  md: { chip: "h-16 w-16 gap-1", icon: "text-xl", name: "text-[11px]", lockSize: "size-4", glyph: "size-5" },
  lg: { chip: "h-20 w-20 gap-1.5", icon: "text-2xl", name: "text-xs", lockSize: "size-5", glyph: "size-6" },
} as const;

/**
 * `badges.icon` in the DB holds a semantic TOKEN ("trophy", "flame-gold", …), not
 * an emoji — see prisma/seed.ts. Rendering that string directly printed the literal
 * word inside the chip, overflowing it. Tokens map to real icons here so the DB
 * stays presentation-agnostic and every consumer renders consistently.
 */
const BADGE_ICON_TOKENS: Record<string, React.ComponentType<{ className?: string }>> = {
  trophy: Trophy,
  flame: Flame,
  "flame-gold": Flame,
  medal: Medal,
  "star-medal": Medal,
  star: Star,
  "calendar-check": CalendarCheck,
  award: Award,
  target: Target,
};

/**
 * Renders a badge glyph from either a token, an emoji, or a caller-supplied node.
 * Falls back to a generic award icon so an unrecognised token can never spill raw
 * text into the chip.
 */
function BadgeIcon({
  icon,
  className,
}: {
  icon?: React.ReactNode;
  className?: string;
}): React.JSX.Element {
  if (icon == null || icon === "") return <Award className={className} />;

  if (typeof icon === "string") {
    const Mapped = BADGE_ICON_TOKENS[icon.toLowerCase()];
    if (Mapped) return <Mapped className={className} />;
    // Short non-word strings are emoji ("🏆") — safe to print as-is. Anything
    // longer is an unknown token; show the fallback rather than overflow the chip.
    if (icon.length <= 2) return <span>{icon}</span>;
    return <Award className={className} />;
  }

  // Caller passed a node (<img>, custom SVG) — render as given.
  return <>{icon}</>;
}

export const BadgeChip = React.forwardRef<HTMLDivElement, BadgeChipProps>(
  (
    {
      name,
      icon,
      description,
      earned = false,
      locked = false,
      size = "md",
      className,
      "data-testid": testId,
    },
    ref,
  ) => {
    const { chip, icon: iconClass, name: nameClass, lockSize, glyph: glyphClass } = sizeMap[size];
    const isLocked = locked && !earned;

    return (
      <div
        ref={ref}
        data-testid={testId ?? "badge-chip"}
        data-earned={earned}
        data-locked={isLocked}
        title={description}
        aria-label={`${name}${isLocked ? ", Locked" : ""}`}
        className={cn(
          "relative flex flex-col items-center justify-center rounded-xl border p-1 text-center",
          "transition-colors",
          isLocked
            ? "border-border bg-surface opacity-50 grayscale"
            : "border-brand-200 bg-brand-50 dark:border-brand-500/30 dark:bg-brand-500/10",
          chip,
          className,
        )}
      >
        {/* Icon — resolves `badges.icon` tokens ("trophy", "flame", …) to real
            glyphs. Rendering the raw token as text overflowed the chip. */}
        <span aria-hidden="true" className={cn("flex shrink-0 items-center justify-center leading-none", iconClass)}>
          <BadgeIcon icon={icon} className={glyphClass} />
        </span>

        {/* Badge name — min-w-0 so `truncate` can actually shrink it inside the
            flex column (a flex item's default min-width:auto blocks truncation). */}
        <span
          className={cn(
            "w-full min-w-0 truncate px-0.5 text-center font-medium leading-none text-fg",
            nameClass,
          )}
        >
          {name}
        </span>

        {/* Lock overlay — icon+tooltip convey locked state, not color alone */}
        {isLocked ? (
          <span
            aria-hidden="true"
            className="absolute bottom-1 right-1 rounded-full bg-surface p-0.5 text-fg-subtle"
          >
            <Lock className={lockSize} />
          </span>
        ) : null}
      </div>
    );
  },
);
BadgeChip.displayName = "BadgeChip";

// ---------------------------------------------------------------------------
// BadgeGrid
// ---------------------------------------------------------------------------

export interface BadgeGridItem {
  id: string;
  name: string;
  icon?: React.ReactNode;
  description?: string;
  earned: boolean;
}

export interface BadgeGridProps {
  badges: BadgeGridItem[];
  loading?: boolean;
  /** Heading displayed above the grid. */
  heading?: string;
  size?: BadgeChipProps["size"];
  className?: string;
  /** Test hook; defaults to "badge-grid". */
  "data-testid"?: string;
}

export function BadgeGrid({
  badges,
  loading = false,
  heading,
  size = "md",
  className,
  "data-testid": testId,
}: BadgeGridProps): React.JSX.Element {
  return (
    <section
      data-testid={testId ?? "badge-grid"}
      aria-label={heading ?? "Badges"}
      className={cn("flex flex-col gap-3", className)}
    >
      {heading ? (
        <h3 className="text-sm font-semibold text-fg">{heading}</h3>
      ) : null}

      {loading ? (
        <div className="flex flex-wrap gap-3" aria-busy="true" aria-label="Loading badges">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="h-16 w-16 animate-pulse rounded-xl bg-surface"
              aria-hidden="true"
            />
          ))}
        </div>
      ) : badges.length === 0 ? (
        <p className="text-sm text-fg-muted">No badges yet. Keep learning to earn your first one!</p>
      ) : (
        <ul
          className="flex flex-wrap gap-3"
          aria-label={heading ?? "Badges list"}
        >
          {badges.map((badge) => (
            <li key={badge.id}>
              <BadgeChip
                name={badge.name}
                icon={badge.icon}
                description={badge.description}
                earned={badge.earned}
                locked={!badge.earned}
                size={size}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
