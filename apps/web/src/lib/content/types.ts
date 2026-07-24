/**
 * Typed frontmatter schemas for MDX content pages.
 *
 * Every MDX file in the `content/` directory must export a `frontmatter` object
 * matching one of these interfaces. `remark-mdx-frontmatter` generates the export
 * automatically from the YAML frontmatter block.
 *
 * Usage in an MDX consumer:
 *   const { frontmatter } = await import(`../../../content/blog/${slug}.mdx`);
 *
 * Or for static generation use the `getAllPosts()` / `getAllPages()` utilities
 * in `./loader.ts` which use gray-matter to extract frontmatter at build time.
 */

// ---------------------------------------------------------------------------
// Base (shared by all content types)
// ---------------------------------------------------------------------------

export interface BaseFrontmatter {
  /** Page title (used in <title> and h1). */
  title: string;
  /** Meta description (≤160 chars). */
  description: string;
  /** Absolute or root-relative path to the OG image. */
  ogImage?: string;
}

// ---------------------------------------------------------------------------
// Blog posts
// ---------------------------------------------------------------------------

export interface BlogPostFrontmatter extends BaseFrontmatter {
  /** ISO-8601 published date. */
  date: string;
  /** ISO-8601 last modified date (optional). */
  modifiedDate?: string;
  /** Author display name. */
  author: string;
  /** Author avatar path (optional). */
  authorAvatar?: string;
  /** Comma-separated or array of category tags. */
  tags: string[];
  /** Short excerpt shown in listing cards (≤200 chars). If absent, first 160 chars of body. */
  excerpt?: string;
  /** Whether to feature on the homepage blog teaser. */
  featured?: boolean;
  /** Slug override (defaults to the filename without extension). */
  slug?: string;
}

// ---------------------------------------------------------------------------
// Trust & content pages (About, Faculty, Testimonials, Partners, Gallery, Career, FAQ)
// ---------------------------------------------------------------------------

export interface ContentPageFrontmatter extends BaseFrontmatter {
  /** Section/category for nav grouping (optional). */
  section?: string;
  /** Whether to show breadcrumbs (default: true). */
  breadcrumbs?: boolean;
}

// ---------------------------------------------------------------------------
// FAQ entry (used in the FAQ content page and program-detail FAQs)
// ---------------------------------------------------------------------------

export interface FaqEntryFrontmatter {
  /** FAQ entry ID (used as accordion item key). */
  id: string;
  /** FAQ question. */
  question: string;
  /** Plain-text answer for JSON-LD (required). */
  answerText: string;
  /** Category for grouping (optional). */
  category?: string;
  /** Sort order (lower = first). */
  order?: number;
}

// ---------------------------------------------------------------------------
// Blog post listing item (returned by content loader — no full body)
// ---------------------------------------------------------------------------

export interface BlogPostMeta extends BlogPostFrontmatter {
  /** The slug derived from the filename. */
  slug: string;
  /** URL path for this post. */
  href: string;
}

// ---------------------------------------------------------------------------
// Content page listing item
// ---------------------------------------------------------------------------

export interface ContentPageMeta extends ContentPageFrontmatter {
  /** The slug derived from the filename. */
  slug: string;
  /** URL path for this page. */
  href: string;
}
