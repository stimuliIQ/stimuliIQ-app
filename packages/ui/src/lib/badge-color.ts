/**
 * Badge colour helpers — shared by the CRM authoring UI and the public site so a staff
 * member sees exactly the chip visitors will see.
 *
 * Staff choose only a BACKGROUND colour. The text colour is derived from it here rather
 * than being a second thing to pick, because a free colour picker otherwise makes it
 * trivial to ship an unreadable badge (white on yellow), and WCAG 2.2 AA is a project
 * requirement rather than a polish step (CLAUDE.md §3.9).
 */

/** Canonical `#RRGGBB` form. Rejects shorthand, alpha, and named colours on purpose: the
 *  DB column is VARCHAR(7) and every consumer assumes a single parseable format. */
export const BADGE_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export function isValidBadgeColor(value: string): boolean {
  return BADGE_COLOR_PATTERN.test(value);
}

/**
 * Relative luminance per WCAG 2.x, including the sRGB gamma expansion. The gamma step is
 * what separates this from a naive `(r+g+b)/3` brightness check — without it, saturated
 * mid-tones (pure red, pure blue) get misjudged and land on the wrong text colour.
 */
function relativeLuminance(hex: string): number {
  const int = parseInt(hex.slice(1), 16);
  const channels = [(int >> 16) & 255, (int >> 8) & 255, int & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/** Contrast ratio between two luminances, per the WCAG formula (1:1 to 21:1). */
function contrastRatio(a: number, b: number): number {
  const [lighter, darker] = a > b ? [a, b] : [b, a];
  return (lighter + 0.05) / (darker + 0.05);
}

const WHITE_LUMINANCE = 1;
const BLACK_LUMINANCE = 0;

/**
 * Near-black rather than pure `#000`: on a light chip it reads as intentional type instead
 * of a harsh outline, and it still clears AA against every background that picks it.
 */
const DARK_TEXT = "#111827";
const LIGHT_TEXT = "#FFFFFF";

/**
 * The more readable of white/near-black on `backgroundHex`, chosen by actual contrast
 * ratio rather than a luminance threshold — a fixed cutoff picks the wrong side for
 * mid-tones where the two ratios are close.
 *
 * Falls back to white for a malformed colour: unreadable-but-visible beats a chip whose
 * text vanishes into its background.
 */
export function readableTextOn(backgroundHex: string): string {
  if (!isValidBadgeColor(backgroundHex)) return LIGHT_TEXT;
  const bg = relativeLuminance(backgroundHex);
  return contrastRatio(bg, BLACK_LUMINANCE) >= contrastRatio(bg, WHITE_LUMINANCE)
    ? DARK_TEXT
    : LIGHT_TEXT;
}

/**
 * Best achievable contrast ratio on this background (i.e. against whichever text colour
 * `readableTextOn` picks). The CRM surfaces this so staff get told when a colour is a poor
 * choice — AA needs 4.5:1 for normal text, 3:1 for large/bold.
 */
export function badgeContrastRatio(backgroundHex: string): number {
  if (!isValidBadgeColor(backgroundHex)) return 1;
  const bg = relativeLuminance(backgroundHex);
  return Math.max(contrastRatio(bg, BLACK_LUMINANCE), contrastRatio(bg, WHITE_LUMINANCE));
}

/**
 * Named starting points offered as one-click swatches in the CRM. These are a convenience
 * only — they resolve to a plain hex on save, so a "Hot" badge is not locked to red and
 * nothing downstream needs to know a preset was involved.
 */
export const BADGE_COLOR_PRESETS: ReadonlyArray<{ label: string; color: string }> = [
  { label: "Hot", color: "#DC2626" },
  { label: "New", color: "#16A34A" },
  { label: "Trending", color: "#2563EB" },
  { label: "Bestseller", color: "#D97706" },
  { label: "Limited", color: "#7C3AED" },
];
