/**
 * Program badge resolution — the single place that decides WHICH badge a program card
 * shows and what colour it is.
 *
 * A program can qualify for two badges at once: the staff-authored marketing badge (text
 * and colour chosen per program in the CRM) and the older "Scholarship available" flag.
 * Every card in the site has exactly one badge slot, so one has to win — the marketing
 * badge does, because it is the more deliberate, per-program editorial choice, whereas the
 * scholarship flag is a broad category marker that also appears elsewhere on the page.
 *
 * The public API has already applied the on/off toggle before this runs: `badgeColor` and
 * `badgeLabel` arrive null unless staff have a badge configured AND switched on (see
 * PublicCatalogService.toSummary), so there is no "enabled" check to repeat here.
 *
 * Lives in `web` rather than `@repo/ui` because two of the three card implementations
 * (`explore-courses.tsx`, `mentors/courses-explorer.tsx`) render their own markup instead
 * of `@repo/ui`'s ProgramCard, and would otherwise each grow their own copy of this.
 */
import { isValidBadgeColor, readableTextOn } from "@repo/ui";

/** The subset of a program the badge decision needs — keeps callers free of DTO coupling. */
export interface ProgramBadgeSource {
  badgeColor?: string | null;
  badgeLabel?: string | null;
  scholarshipAvailable?: boolean;
}

export interface ResolvedProgramBadge {
  label: string;
  /** Inline style, not a class: the colour is staff data, so it cannot be a Tailwind token. */
  style: { backgroundColor: string; color: string };
}

/**
 * The red the scholarship ribbon has always used. A literal rather than the `danger` token
 * because this badge now travels as an inline style alongside staff-picked colours, and
 * mixing the two mechanisms would make the fallback the odd one out.
 */
const SCHOLARSHIP_BADGE_COLOR = "#DC2626";

/**
 * The staff-authored marketing badge ONLY — no scholarship fallback.
 *
 * Split out for surfaces too cramped to carry the fallback's long "Scholarship available"
 * text, currently the Courses mega-menu: its rows are single-line course titles in a narrow
 * column, where a 20-character chip would outweigh the title it annotates and, since the
 * flag is set on most programs, would repeat down the whole list. The per-program marketing
 * badge is the deliberate editorial signal and is short by construction (24-char DB cap).
 */
export function resolveMarketingBadge(program: ProgramBadgeSource): ResolvedProgramBadge | null {
  // A stored colour is re-validated here rather than trusted: it reaches the DOM as an
  // inline style, and a malformed value would silently produce an unstyled chip.
  if (program.badgeLabel && program.badgeColor && isValidBadgeColor(program.badgeColor)) {
    return {
      label: program.badgeLabel,
      style: { backgroundColor: program.badgeColor, color: readableTextOn(program.badgeColor) },
    };
  }
  return null;
}

/** Returns the badge to render, or null when the program has none. */
export function resolveProgramBadge(program: ProgramBadgeSource): ResolvedProgramBadge | null {
  const marketing = resolveMarketingBadge(program);
  if (marketing) return marketing;
  if (program.scholarshipAvailable) {
    return {
      label: "Scholarship available",
      style: {
        backgroundColor: SCHOLARSHIP_BADGE_COLOR,
        color: readableTextOn(SCHOLARSHIP_BADGE_COLOR),
      },
    };
  }
  return null;
}
