/**
 * Navigation configuration — consumed by MarketingHeader and MegaMenu.
 *
 * Centralised here so #7 (homepage/programs) and #8 (funnels) don't need
 * to duplicate the structure; import from here.
 *
 * The Programs mega-menu and the footer "Programs" column are DYNAMIC: the
 * root layout fetches the live catalog via lib/nav-programs.ts (CRM-published
 * courses) and injects it through buildNavItems()/buildFooterColumns(). The
 * static sections below are the FALLBACK, used only when the API is
 * unreachable or the catalog is empty — the header must never render an
 * empty Programs menu.
 *
 * No business logic — configuration + pure assembly helpers only.
 */
import { createElement } from "react";
import type { NavItem, MegaMenuSection } from "@repo/ui";

/**
 * Fallback mega-menu (used ONLY when the live catalog is unreachable/empty).
 *
 * Deliberately minimal (2026-07-18 nav fix): the old fallback was a hardcoded
 * FAKE catalog (Full Stack Web Development, Python for Data Science, …) whose
 * slugs don't exist in the DB — every link 404'd. Worse, a bug in the live
 * fetch (limit=100 > the API's max of 50) meant the fallback rendered ALWAYS,
 * so visitors only ever saw the fake dead-link list. The nav must never invent
 * courses: when live data is unavailable, point at the real catalog page.
 */
export const FALLBACK_PROGRAM_SECTIONS: MegaMenuSection[] = [
  {
    heading: "Programs",
    items: [
      {
        label: "Browse all programs",
        href: "/programs",
        description: "Explore the full live catalog",
      },
    ],
  },
];

/**
 * Mega-menu footer strip: the "All Courses" entry point to the full catalog.
 * createElement (not JSX) because this config module is a plain .ts file.
 */
function allCoursesFooter() {
  return createElement(
    "a",
    {
      href: "/programs",
      className:
        "inline-flex min-h-[44px] items-center gap-2 text-sm font-semibold text-brand-500 " +
        "transition-colors hover:text-brand-600 focus-visible:outline-none focus-visible:underline",
      "data-testid": "nav-all-courses",
    },
    "View All Programs →",
  );
}

/**
 * Static default nav link list — IDENTICAL to the `nav.primary_links` SiteSetting seed
 * (prisma/seed.ts "Phase-10 Page Builder — SiteSetting defaults") so wiring the header to
 * read from the CRM-editable setting is a visual no-op when the setting is unavailable.
 * The "Courses" entry is a plain `{label, href}` pair here too (SiteSetting stores
 * primitives, not composed mega-menu sections) — `buildNavItems` below reconciles it back
 * into the live mega-menu by label match (see that function's doc comment).
 */
export const DEFAULT_NAV_LINKS: Array<{ label: string; href: string }> = [
  { label: "Courses", href: "/programs" },
  { label: "Mentors", href: "/mentors" },
  { label: "Scholarship", href: "/scholarship" },
  { label: "For Colleges", href: "/for-colleges" },
  { label: "About", href: "/about" },
  { label: "Blog", href: "/blog" },
  { label: "Contact", href: "/contact" },
];

/**
 * Assemble the header nav.
 *
 * @param programSections Live catalog mega-menu sections (`lib/nav-programs.ts`); falls
 *   back to `FALLBACK_PROGRAM_SECTIONS` when null/empty.
 * @param settingsLinks `nav.primary_links` from `GET /public/site-settings` (Phase-10 item
 *   D); falls back to `DEFAULT_NAV_LINKS` when the settings fetch failed/is unavailable.
 *
 * RECONCILIATION (Phase-10 item D — "keep the dynamic Courses mega-menu behavior intact"):
 * `SiteSetting` stores `nav.primary_links` as flat `{label, href}` pairs — it has no
 * concept of a mega-menu. The entry labelled "Courses" (case-insensitive match — the CRM
 * super_admin edits this setting's `label`/`href` like any other link, but MUST NOT be
 * able to accidentally turn the live catalog mega-menu into a dead plain link) is treated
 * as a LABEL-ONLY override: its `label` renders the mega-menu trigger text, but the menu
 * content underneath always comes from the live catalog (`programSections`), never from
 * the setting's `href`. Every other entry renders as a plain link using the setting's
 * `label`/`href` verbatim.
 */
export function buildNavItems(
  programSections?: MegaMenuSection[] | null,
  settingsLinks?: Array<{ label: string; href: string }> | null,
): NavItem[] {
  const sections =
    programSections && programSections.length > 0
      ? programSections
      : FALLBACK_PROGRAM_SECTIONS;
  const links = settingsLinks && settingsLinks.length > 0 ? settingsLinks : DEFAULT_NAV_LINKS;

  return links.map((link) =>
    link.label.trim().toLowerCase() === "courses"
      ? { label: link.label, megaMenu: { sections, footer: allCoursesFooter() } }
      : { label: link.label, href: link.href },
  );
}

/** Static default (fallback catalog + fallback settings) — kept for callers without live data. */
export const NAV_ITEMS: NavItem[] = buildNavItems(null, null);

/**
 * Fallback footer "Programs" links (live catalog unavailable). Minimal for the
 * same reason as FALLBACK_PROGRAM_SECTIONS — never list made-up courses.
 */
export const FALLBACK_FOOTER_PROGRAM_LINKS = [
  { label: "View All Programs", href: "/programs" },
];

/**
 * Static default footer columns (Company/Resources/Legal) — IDENTICAL to the
 * `footer.columns` SiteSetting seed. The "Courses" column is NOT part of this setting
 * (it's always live-catalog-driven, see `buildFooterColumns` below) — matches the seed
 * data's own scope.
 */
export const DEFAULT_FOOTER_COLUMNS = [
  {
    heading: "Company",
    links: [
      { label: "About Us", href: "/about" },
      { label: "Mentors", href: "/mentors" },
      { label: "Faculty", href: "/faculty" },
      { label: "Testimonials", href: "/testimonials" },
      { label: "Partners", href: "/partners" },
      { label: "Gallery", href: "/gallery" },
      { label: "Careers", href: "/careers" },
    ],
  },
  {
    heading: "Resources",
    links: [
      { label: "Blog", href: "/blog" },
      { label: "Scholarship", href: "/scholarship" },
      { label: "FAQ", href: "/faq" },
      { label: "Pricing", href: "/pricing" },
      { label: "For Colleges", href: "/for-colleges" },
    ],
  },
  {
    heading: "Legal",
    links: [
      { label: "Privacy Policy", href: "/privacy" },
      { label: "Terms of Service", href: "/terms" },
      { label: "Refund Policy", href: "/refund-policy" },
      { label: "Contact Us", href: "/contact" },
    ],
  },
];

/**
 * Assemble footer columns.
 *
 * @param programLinks Live catalog footer links (`lib/nav-programs.ts`); falls back to
 *   `FALLBACK_FOOTER_PROGRAM_LINKS` when null/empty.
 * @param settingsColumns `footer.columns` from `GET /public/site-settings`; falls back to
 *   `DEFAULT_FOOTER_COLUMNS` when the settings fetch failed/is unavailable. The "Courses"
 *   column is always prepended separately (never sourced from settings — see
 *   `DEFAULT_FOOTER_COLUMNS` doc comment).
 */
export function buildFooterColumns(
  programLinks?: Array<{ label: string; href: string }> | null,
  settingsColumns?: Array<{ heading: string; links: Array<{ label: string; href: string }> }> | null,
) {
  return [
    {
      heading: "Courses",
      links:
        programLinks && programLinks.length > 0
          ? programLinks
          : FALLBACK_FOOTER_PROGRAM_LINKS,
    },
    ...(settingsColumns && settingsColumns.length > 0 ? settingsColumns : DEFAULT_FOOTER_COLUMNS),
  ];
}

/** Static default (fallback catalog + fallback settings) — kept for callers without live data. */
export const FOOTER_COLUMNS = buildFooterColumns(null, null);

/** Static default legal links — IDENTICAL to the `footer.legal_links` SiteSetting seed. */
export const DEFAULT_LEGAL_LINKS = [
  { label: "Privacy Policy", href: "/privacy" },
  { label: "Terms of Service", href: "/terms" },
  { label: "Refund Policy", href: "/refund-policy" },
];

export const LEGAL_LINKS = DEFAULT_LEGAL_LINKS;

export const BOOK_SLOT_HREF = "/book-free-slot";
export const CERT_VERIFY_HREF = "/verify";
