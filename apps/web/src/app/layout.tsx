/**
 * Root layout — global shell for apps/web.
 *
 * Renders:
 *   - Skip-to-content link (a11y: keyboard users jump to <main>)
 *   - MarketingHeader + MegaMenu (nav config, Book Free Slot CTA)
 *   - <main id="main-content"> (semantic landmark, skip-link target)
 *   - MarketingFooter
 *   - ConsentBanner + WhatsAppFab (client-side, deferred)
 *   - AnalyticsLoader (consent-gated GA4/GTM via @next/third-parties)
 *   - Organization JSON-LD (sitewide structured data)
 *
 * SSR-safe: header/footer are RSC; banner/fab/analytics are Client Components.
 * No business logic here — wiring only.
 *
 * a11y: semantic <header>/<main>/<footer> landmarks; skip-link precedes header;
 *       focus ring + SR announcements provided by @repo/ui primitives.
 *
 * Env vars consumed (all NEXT_PUBLIC_* — safe for the client bundle):
 *   NEXT_PUBLIC_SITE_URL         — canonical site URL
 *   NEXT_PUBLIC_WHATSAPP_NUMBER  — phone number for wa.me deep link (digits only)
 *   NEXT_PUBLIC_WHATSAPP_MESSAGE — optional prefilled message
 *   NEXT_PUBLIC_ANALYTICS_MEASUREMENT_ID — GA4 id (post-consent only)
 *   NEXT_PUBLIC_ANALYTICS_GTM_ID          — GTM id (post-consent only, optional)
 */
import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@repo/ui/styles.css";
import "./globals.css";

import { Providers } from "./providers";
import { SiteShell } from "../components/shell/site-shell";
import { buildNavItems, buildFooterColumns } from "../components/shell/nav-config";
import { getProgramsNav } from "../lib/nav-programs";
import { getSiteSettings, interpolateCopyrightTemplate } from "../lib/site-settings";
import { buildMetadata, SITE_URL } from "../lib/seo/metadata";
import { buildOrganizationJsonLd } from "../lib/seo/json-ld";
import { ADDRESS, PHONE_HREF } from "../lib/contact";

// ---------------------------------------------------------------------------
// Sitewide default metadata (per-page overrides via generateMetadata)
//
// Phase-10 item D: sitewide SEO defaults (siteName/description/OG image) are sourced
// from the CRM-editable `seo.defaults` SiteSetting when available, falling back to the
// hardcoded `buildMetadata` module constants (SITE_NAME/DEFAULT_DESCRIPTION/
// DEFAULT_OG_IMAGE) — this is why this export moved from a static `export const metadata`
// to an async `generateMetadata` (the settings fetch is async; a static export can't await).
// ---------------------------------------------------------------------------

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSiteSettings();
  return buildMetadata({
    canonicalPath: "/",
    siteDefaults: settings?.["seo.defaults"],
  });
}

// ---------------------------------------------------------------------------
// Root layout
// ---------------------------------------------------------------------------

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Programs nav from the live catalog (CRM-published courses) — cached 1 h via
  // unstable_cache; null on API failure → build helpers fall back to static config.
  // Site settings (nav labels, footer columns, WhatsApp, copyright — Phase-10 item D) —
  // same resilience contract: null on API failure → every build helper below falls back
  // to the exact hardcoded values that shipped before Phase-10 (see nav-config.ts /
  // site-shell.tsx doc comments). The CMS being down must never break the header/footer.
  const [programsNav, settings] = await Promise.all([getProgramsNav(), getSiteSettings()]);
  const navItems = buildNavItems(programsNav?.megaMenuSections, settings?.["nav.primary_links"]);
  const footerColumns = buildFooterColumns(programsNav?.footerLinks, settings?.["footer.columns"]);
  const legalLinks = settings?.["footer.legal_links"];
  const copyrightText = settings?.["footer.copyright_text"]
    ? interpolateCopyrightTemplate(settings["footer.copyright_text"].template, new Date().getFullYear())
    : undefined;
  const contactText = settings?.["contact.details"]?.contactText;
  const whatsappNumber = settings?.["contact.whatsapp"]?.number;
  const whatsappMessage = settings?.["contact.whatsapp"]?.message;
  // Announcement strip (announcement.bar) — undefined when the CMS is unreachable,
  // which the shell treats as "no bar" (an announcement is never load-bearing).
  const announcement = settings?.["announcement.bar"];

  // Sitewide Organization JSON-LD — injected once in the root layout.
  const orgJsonLd = buildOrganizationJsonLd({
    logoUrl: `${SITE_URL}/logo.png`,
    contactPhone: PHONE_HREF,
    address: {
      streetAddress: ADDRESS.streetAddress,
      addressLocality: ADDRESS.addressLocality,
      addressRegion: ADDRESS.addressRegion,
      postalCode: ADDRESS.postalCode,
      addressCountry: ADDRESS.addressCountry,
    },
    sameAs: [
      "https://linkedin.com/company/stimuliiq",
      "https://instagram.com/stimuliiq",
      "https://twitter.com/stimuliiq",
      "https://youtube.com/@stimuliiq",
    ],
  });

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Preconnect to Google Fonts (Inter + Plus Jakarta Sans) */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* Organization structured data (sitewide, escaped) */}
        <script
          type="application/ld+json"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD; content escaped via escapeJsonLd()
          dangerouslySetInnerHTML={{ __html: orgJsonLd }}
        />
      </head>
      <body>
        {/* Skip-to-content — first focusable element; visible on focus (a11y) */}
        <a
          href="#main-content"
          className={[
            "sr-only focus:not-sr-only",
            "focus:fixed focus:left-4 focus:top-4 focus:z-[100]",
            "focus:rounded-md focus:bg-brand-500 focus:px-4 focus:py-2",
            "focus:text-sm focus:font-semibold focus:text-white",
            "focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-brand-500",
          ].join(" ")}
        >
          Skip to main content
        </a>

        <Providers>
          {/* Global shell: header / main / footer / overlays */}
          <SiteShell
            navItems={navItems}
            footerColumns={footerColumns}
            legalLinks={legalLinks}
            copyrightText={copyrightText}
            contactText={contactText}
            whatsappNumber={whatsappNumber}
            whatsappMessage={whatsappMessage}
            announcement={announcement}
          >
            {children}
          </SiteShell>
        </Providers>
      </body>
    </html>
  );
}
