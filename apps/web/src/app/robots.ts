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
          "/_next/",
          "/book-free-slot", // exclude landing-page funnel from direct bot indexing
          "/lp/",
          "/lp/*", // campaign landing pages: ad-traffic surfaces, not organic-search targets
          "/search", // dynamic search results — noindex'd via metadata too
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
