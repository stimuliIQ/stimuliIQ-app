/**
 * Shared JSON-LD helper — the SINGLE escaping choke-point for all structured data.
 *
 * SECURITY: Every JSON-LD string emitted by this module escapes `</script>` sequences
 * as `</script>` — this resolves the P4 L-1 script-breakout vulnerability (AC-33).
 * No page should bypass this module to build JSON-LD directly.
 *
 * Usage:
 *   // In an RSC page or component:
 *   const jsonLd = buildOrganizationJsonLd();
 *   return <JsonLdScript data={jsonLd} />;
 *
 *   // Or call helpers that return the serialized string:
 *   const faqLd  = buildFaqJsonLd(items);         // re-export from @repo/ui
 *   const breadLd = buildBreadcrumbJsonLd(items);  // re-export from @repo/ui
 *
 * Re-exports:
 *   buildFaqJsonLd, buildBreadcrumbJsonLd — wrapped so escaping runs through this module.
 *
 * All helpers that accept user-controlled strings run through `escapeJsonLd()`.
 */

// ---------------------------------------------------------------------------
// Core escape function — every JSON-LD string MUST flow through this.
// ---------------------------------------------------------------------------

/**
 * Serialise a JSON-LD object and escape any `</script>` that could break out of
 * the embedding `<script type="application/ld+json">` tag.
 *
 * Uses `<` — the safest form: valid JSON, not eval'd by browsers differently,
 * passed through all JSON parsers, and recognised by schema validators.
 */
export function escapeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

// ---------------------------------------------------------------------------
// NOTE: JsonLdScript (JSX component) intentionally NOT in this file.
// To embed JSON-LD in a page component, use the escaped string directly:
//
//   const jsonLd = buildOrganizationJsonLd();
//   return (
//     <script
//       type="application/ld+json"
//       dangerouslySetInnerHTML={{ __html: jsonLd }}
//     />
//   );
//
// This avoids JSX in a .ts file and keeps the helper tree-shakeable.
// ---------------------------------------------------------------------------
// Sitewide: Organization schema
// ---------------------------------------------------------------------------

import { SITE_NAME, SITE_URL } from "./metadata";

export interface OrganizationJsonLdOptions {
  /** Override the default logo URL. */
  logoUrl?: string;
  /** Override the default contact number. */
  contactPhone?: string;
  /** Override the sameAs social profile URLs. */
  sameAs?: string[];
}

/**
 * Build the sitewide `Organization` JSON-LD (embedded in the root layout).
 * User-controlled strings from options are serialised via `escapeJsonLd`.
 */
export function buildOrganizationJsonLd(opts: OrganizationJsonLdOptions = {}): string {
  const {
    logoUrl = `${SITE_URL}/logo.png`,
    contactPhone,
    sameAs = [
      "https://linkedin.com/company/stimuliiq",
      "https://instagram.com/stimuliiq",
      "https://twitter.com/stimuliiq",
    ],
  } = opts;

  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "EducationalOrganization",
    name: SITE_NAME,
    url: SITE_URL,
    logo: {
      "@type": "ImageObject",
      url: logoUrl,
    },
    sameAs,
  };

  if (contactPhone) {
    data.contactPoint = {
      "@type": "ContactPoint",
      telephone: contactPhone,
      contactType: "customer support",
      areaServed: "IN",
      availableLanguage: ["English", "Hindi"],
    };
  }

  return escapeJsonLd(data);
}

// ---------------------------------------------------------------------------
// Article / BlogPosting schema
// ---------------------------------------------------------------------------

export interface ArticleJsonLdOptions {
  headline: string;
  description: string;
  url: string;
  imageUrl?: string;
  authorName?: string;
  publishedAt: string;
  modifiedAt?: string;
  publisherName?: string;
  publisherLogoUrl?: string;
  /** "Article" (default) or "BlogPosting". */
  type?: "Article" | "BlogPosting";
}

/**
 * Build `Article` or `BlogPosting` JSON-LD for blog posts.
 * All string values from options go through `escapeJsonLd`.
 */
export function buildArticleJsonLd(opts: ArticleJsonLdOptions): string {
  const {
    headline,
    description,
    url,
    imageUrl,
    authorName,
    publishedAt,
    modifiedAt,
    publisherName = SITE_NAME,
    publisherLogoUrl = `${SITE_URL}/logo.png`,
    type = "Article",
  } = opts;

  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": type,
    headline,
    description,
    url,
    datePublished: publishedAt,
    ...(modifiedAt ? { dateModified: modifiedAt } : {}),
    publisher: {
      "@type": "Organization",
      name: publisherName,
      logo: {
        "@type": "ImageObject",
        url: publisherLogoUrl,
      },
    },
  };

  if (authorName) {
    data.author = {
      "@type": "Person",
      name: authorName,
    };
  }

  if (imageUrl) {
    data.image = {
      "@type": "ImageObject",
      url: imageUrl,
    };
  }

  return escapeJsonLd(data);
}

// ---------------------------------------------------------------------------
// FAQPage + BreadcrumbList builders
//
// Implemented DIRECTLY here (not re-exported from @repo/ui) because @repo/ui's
// buildFaqJsonLd / buildBreadcrumbJsonLd live in files that have "use client"
// directives (FaqAccordion, Breadcrumbs). Re-exporting from a "use client" file
// causes a Next.js server build error: "Attempted to call X from the server but
// X is on the client."
//
// The implementations below are identical to @repo/ui's helpers but live in a
// server-safe module. Both pass output through escapeJsonLd() so the P4 L-1
// </script> fix is applied consistently.
// ---------------------------------------------------------------------------

/** FAQ item shape accepted by buildFaqJsonLd. */
export interface FaqJsonLdItem {
  question: string;
  answerText: string;
}

/** Breadcrumb item shape accepted by buildBreadcrumbJsonLd. */
export interface BreadcrumbItem {
  label: string;
  href?: string;
}

/**
 * Build FAQPage JSON-LD. Escaped via escapeJsonLd (P4 L-1 / AC-33).
 *
 * Use this (not the @repo/ui import) on all server-side pages so the
 * escaping choke-point is always this module.
 */
export function buildFaqJsonLd(items: FaqJsonLdItem[]): string {
  const data = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answerText,
      },
    })),
  };
  return escapeJsonLd(data);
}

/**
 * Build BreadcrumbList JSON-LD. Escaped via escapeJsonLd (P4 L-1 / AC-33).
 *
 * @param items - Array of breadcrumb items (label + optional href).
 * @param baseUrl - Absolute base URL prepended to href values (default: SITE_URL).
 */
export function buildBreadcrumbJsonLd(
  items: BreadcrumbItem[],
  baseUrl: string = SITE_URL,
): string {
  const data = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.label,
      ...(item.href ? { item: `${baseUrl}${item.href}` } : {}),
    })),
  };
  return escapeJsonLd(data);
}

// ---------------------------------------------------------------------------
// Course schema (program detail pages)
// ---------------------------------------------------------------------------

export interface CourseJsonLdOptions {
  name: string;
  description: string;
  url: string;
  imageUrl?: string;
  /** Price in paise — converted to INR for schema. */
  pricePaise: number;
  /** Duration string, e.g. "12 weeks". */
  duration?: string;
  providerName?: string;
  providerUrl?: string;
  ratingValue?: number;
  ratingCount?: number;
}

/**
 * Build `Course` JSON-LD for program detail pages.
 * pricePaise is converted to INR (divide by 100) server-side — no money math in client.
 */
export function buildCourseJsonLd(opts: CourseJsonLdOptions): string {
  const {
    name,
    description,
    url,
    imageUrl,
    pricePaise,
    duration,
    providerName = SITE_NAME,
    providerUrl = SITE_URL,
    ratingValue,
    ratingCount,
  } = opts;

  const priceINR = (pricePaise / 100).toFixed(2);

  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Course",
    name,
    description,
    url,
    provider: {
      "@type": "Organization",
      name: providerName,
      url: providerUrl,
    },
    offers: {
      "@type": "Offer",
      price: priceINR,
      priceCurrency: "INR",
      availability: "https://schema.org/InStock",
    },
  };

  if (imageUrl) data.image = imageUrl;
  if (duration) data.timeRequired = duration;

  if (ratingValue !== undefined && ratingCount !== undefined && ratingCount > 0) {
    data.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: ratingValue.toFixed(1),
      reviewCount: ratingCount,
      bestRating: "5",
      worstRating: "1",
    };
  }

  return escapeJsonLd(data);
}
