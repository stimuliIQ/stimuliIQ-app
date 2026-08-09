/**
 * app/robots.ts — robots.txt for apps/web.
 *
 * AC-31: "allow crawling of /programs/* and references the sitemap URL."
 *
 * Allow public routes (programs, blog, about, etc.).
 * Disallow private/utility paths (account, API, etc.).
 */
import type { MetadataRoute } from "next";
import { SITE_URL } from "../lib/seo/metadata";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: [
          "/",
          "/programs/",
          "/programs/*",
          "/programs/city/",
          "/programs/city/*",
          "/blog/",
          "/blog/*",
          "/about",
          "/testimonials",
          "/gallery",
          "/careers",
          "/contact",
          "/faq",
          "/pricing",
          "/for-colleges",
          "/verify",
        ],
        disallow: [
          "/account",
          "/account/*",
          "/api/",
          "/api/*",
          // `/_next/` is deliberately NOT disallowed. It holds the compiled CSS and JS, and
          // blocking it stops Googlebot rendering the page it just downloaded: it sees the HTML
          // without the styles or client behaviour, which suppresses both indexing quality and
          // the Core Web Vitals it measures. Google's own guidance is to let crawlers fetch
          // these files. There is nothing private in the bundle; it is served to every visitor.
          // NOTE: /onboarding and /pay/:token are intentionally absent. Both already carry
          // `noindex` in their metadata, and Google has to crawl a page to read that directive,
          // so disallowing them here would keep any already-indexed URL in the index with no
          // content instead of removing it. Disallow and noindex are alternatives, not a pair.
          "/book-free-slot", // lead funnel, not an organic-search target
          "/lp/",
          "/lp/*", // campaign landing pages for ad traffic, not organic search
          "/search", // dynamic results, also noindex'd via metadata
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
