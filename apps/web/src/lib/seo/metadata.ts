/**
 * Shared metadata helper — produces per-page Next.js `Metadata` objects.
 *
 * Usage (in any page):
 *   export const metadata = buildMetadata({ title: "About Us", description: "..." });
 *
 * For dynamic pages, call from generateMetadata():
 *   export async function generateMetadata({ params }) {
 *     return buildMetadata({ title: program.seoTitle, canonicalPath: `/programs/${params.slug}` });
 *   }
 *
 * Rules:
 *   - All fields have sane sitewide defaults (site name, description, OG image, Twitter card).
 *   - `canonicalPath` is resolved against NEXT_PUBLIC_SITE_URL — always absolute.
 *   - Title template: "{title} | StimuliiQ" (omitted when title IS the site name).
 *   - OG/Twitter images are absolute URLs (required by spec).
 *   - robots.noindex/nofollow can be set per-page.
 *
 * No business logic — purely structural.
 */
import type { Metadata } from "next";

// ---------------------------------------------------------------------------
// Constants (public env — safe for NEXT_PUBLIC_*)
// ---------------------------------------------------------------------------

export const SITE_NAME = "StimuliiQ" as const;
export const SITE_URL =
  (process.env.NEXT_PUBLIC_SITE_URL ?? "https://stimuliiq.com").replace(/\/$/, "");
export const DEFAULT_DESCRIPTION =
  "StimuliiQ — India's next generation healthcare learning platform. Structured training, real internships, and mentorship from healthcare industry experts for medical, psychology, and allied health science students.";
export const DEFAULT_OG_IMAGE = `${SITE_URL}/og-default.png`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BuildMetadataOptions {
  /** Page-specific title. Appended with " | StimuliiQ" unless it already contains the site name. */
  title?: string;
  /** Page-specific meta description (≤160 chars recommended). */
  description?: string;
  /** Absolute or site-root-relative canonical path, e.g. "/programs/python". */
  canonicalPath?: string;
  /** Absolute OG image URL. Defaults to the site-wide OG image. */
  ogImage?: string;
  /** OG image alt text for screen readers. */
  ogImageAlt?: string;
  /** Set to true to add noindex/nofollow (e.g. 404, revoked cert). */
  noIndex?: boolean;
  /** Override the OG type (default "website"). */
  ogType?: "website" | "article";
  /** Article published date (ISO-8601) — used when ogType is "article". */
  publishedAt?: string;
  /** Article modified date (ISO-8601) — used when ogType is "article". */
  modifiedAt?: string;
  /** Article author name — used when ogType is "article". */
  author?: string;
  /**
   * Phase-10 item D: sitewide fallback SEO metadata sourced from the CRM-editable
   * `seo.defaults` SiteSetting (`GET /public/site-settings`), with the hardcoded
   * `SITE_NAME`/`DEFAULT_DESCRIPTION`/`DEFAULT_OG_IMAGE` module constants as the fallback
   * when the setting is unavailable. Only the sitewide DEFAULTS are overridable this way
   * — a page's own `title`/`description`/`ogImage` args (above) always win when provided.
   */
  siteDefaults?: {
    siteName?: string;
    defaultDescription?: string;
    /** Site-relative path (e.g. "/og-default.png") — resolved against SITE_URL. */
    defaultOgImagePath?: string;
  };
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/**
 * Build a Next.js `Metadata` object with sitewide defaults.
 *
 * Called from `export const metadata` (static) or `generateMetadata()` (dynamic).
 */
export function buildMetadata(opts: BuildMetadataOptions = {}): Metadata {
  const {
    title,
    canonicalPath,
    ogImageAlt,
    noIndex = false,
    ogType = "website",
    publishedAt,
    modifiedAt,
    author,
    siteDefaults,
  } = opts;

  const siteName = siteDefaults?.siteName ?? SITE_NAME;
  const description = opts.description ?? siteDefaults?.defaultDescription ?? DEFAULT_DESCRIPTION;
  const ogImage = opts.ogImage ?? (siteDefaults?.defaultOgImagePath ? `${SITE_URL}${siteDefaults.defaultOgImagePath}` : DEFAULT_OG_IMAGE);
  const resolvedOgImageAlt = ogImageAlt ?? `${siteName} — internship & career training platform`;

  // Title template: "Page Title | StimuliiQ"
  // When no title given, fall back to the bare site name.
  const resolvedTitle = title
    ? title.includes(siteName)
      ? title
      : `${title} | ${siteName}`
    : siteName;

  // Canonical URL — always absolute
  const canonicalUrl = canonicalPath
    ? `${SITE_URL}${canonicalPath.startsWith("/") ? canonicalPath : `/${canonicalPath}`}`
    : undefined;

  const metadata: Metadata = {
    title: resolvedTitle,
    description,
    metadataBase: new URL(SITE_URL),
    ...(canonicalUrl
      ? { alternates: { canonical: canonicalUrl } }
      : {}),
    openGraph: {
      type: ogType,
      siteName,
      title: resolvedTitle,
      description,
      url: canonicalUrl,
      images: [
        {
          url: ogImage,
          width: 1200,
          height: 630,
          alt: resolvedOgImageAlt,
        },
      ],
      ...(ogType === "article" && publishedAt
        ? { publishedTime: publishedAt }
        : {}),
      ...(ogType === "article" && modifiedAt
        ? { modifiedTime: modifiedAt }
        : {}),
      ...(ogType === "article" && author
        ? { authors: [author] }
        : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: resolvedTitle,
      description,
      images: [ogImage],
    },
    ...(noIndex
      ? { robots: { index: false, follow: false } }
      : {}),
  };

  return metadata;
}
