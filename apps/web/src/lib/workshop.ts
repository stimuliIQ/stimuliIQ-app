/**
 * Upcoming workshop — the single source of truth for the site-wide workshop promo.
 *
 * WHY A CONSTANT (and not a CRM setting): the workshop promo is code-owned, exactly like
 * `lib/contact.ts`. `SiteSetting` has no workshop group and its schemas are `.strict()`,
 * so adding fields in the CRM without a reader on this side would be a save-that-does-
 * nothing — the trap that got `stats.headline` removed in P10-2. Editing this file and
 * deploying is the supported way to change the promo. The CRM-editable announcement bar
 * (`announcement.bar`) is the complementary surface for a same-day toggle.
 *
 * TO TAKE THE PROMO DOWN: set `enabled: false` — every surface stops rendering it, with
 * no other edits needed (the sections collapse to nothing).
 *
 * NO INVENTED FACTS: `dateLabel`/`timeLabel`/`modeLabel`/`seatsLabel` are `null` until a
 * real schedule exists. They render as a single `·`-joined meta line built from whichever
 * ones are set, and the layout is designed to read as complete with none of them — so an
 * unknown date never becomes a fake one.
 */

export interface UpcomingWorkshop {
  /** Master switch — false hides the promo on every surface. */
  enabled: boolean;
  /**
   * The section heading on the band, and the kicker on the strip. Kept as a full phrase
   * so the band's <h2> reads correctly on its own in a heading list.
   */
  eyebrow: string;
  /**
   * The word inside {@link eyebrow} rendered in the brand accent — the site's
   * "one coloured word in an otherwise plain heading" convention. Must be a literal
   * substring of `eyebrow`; if it isn't, the heading renders unhighlighted.
   */
  eyebrowHighlight: string;
  /** Text of the accent status chip above the title. */
  statusLabel: string;
  /** The workshop subject — the headline students actually scan for. */
  title: string;
  /** One or two sentences of context, used as the section subtitle. Review before launch. */
  summary: string;
  /** e.g. "Sat, 16 Aug" — leave null until the date is confirmed. */
  dateLabel: string | null;
  /** e.g. "6:00 PM IST" — leave null until confirmed. */
  timeLabel: string | null;
  /** e.g. "Online · Live on Zoom" — leave null until confirmed. */
  modeLabel: string | null;
  /** e.g. "Limited seats" — leave null unless the limit is real. */
  seatsLabel: string | null;
  ctaLabel: string;
  ctaHref: string;
}

export const UPCOMING_WORKSHOP: UpcomingWorkshop = {
  enabled: true,
  eyebrow: "Upcoming Workshop",
  eyebrowHighlight: "Workshop",
  statusLabel: "Registrations open",
  title: "Clinical Research",
  summary:
    "A live session with practising researchers on how clinical research actually runs, and the paths open to healthcare students who want to get into it.",
  dateLabel: null,
  timeLabel: null,
  modeLabel: null,
  seatsLabel: null,
  ctaLabel: "Reserve my seat",
  ctaHref: "/book-free-slot",
};

/**
 * The set schedule details as one `·`-joined line, or null when none are set (in which
 * case the caller renders no meta line at all rather than an empty one).
 */
export function workshopDetailLine(workshop: UpcomingWorkshop = UPCOMING_WORKSHOP): string | null {
  const parts = [workshop.dateLabel, workshop.timeLabel, workshop.modeLabel, workshop.seatsLabel]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .map((part) => part.trim());
  return parts.length > 0 ? parts.join(" · ") : null;
}
