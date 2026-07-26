"use client";

/**
 * SiteShell — client component wrapping the global header, footer, consent banner,
 * WhatsApp FAB, and consent-gated analytics.
 *
 * Split into "use client" so we can wire ConsentBanner.onAccept → AnalyticsLoader.
 * The root layout (RSC) renders this as a child of <body>.
 *
 * Semantic layout:
 *   <header> (MarketingHeader — sticky, landmark)
 *   <main id="main-content"> (landmark + skip-link target)
 *   <footer> (MarketingFooter)
 *   <ConsentBanner> (fixed bottom, DPDP)
 *   <WhatsAppFab> (fixed bottom-right)
 *   <AnalyticsLoader> (post-consent only)
 */
import * as React from "react";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  MarketingHeader,
  MarketingFooter,
  ConsentBanner,
  WhatsAppFab,
  readStoredConsent,
} from "@repo/ui";
import type { NavItem } from "@repo/ui";
import { AnalyticsLoader } from "./analytics-loader";
import { TimedLeadPopupConnected } from "../leads/timed-lead-popup-connected";
import { NewsletterBand } from "../leads/newsletter-band";
import {
  NAV_ITEMS,
  FOOTER_COLUMNS,
  LEGAL_LINKS,
  BOOK_SLOT_HREF,
  CERT_VERIFY_HREF,
} from "./nav-config";

// ---------------------------------------------------------------------------
// Fallback defaults (env / hardcoded) — used when the root layout's site-settings
// fetch failed/is unavailable (Phase-10 item D resilience requirement: the CMS being
// down must never white-screen or break the header/footer/WhatsApp FAB).
// ---------------------------------------------------------------------------

const DEFAULT_WA_NUMBER = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? "919999999999";
/**
 * RAW human-readable text (NOT pre-encoded) — see the `whatsappMessage` prop doc comment
 * below (L3 security-review fix: the wa.me href is now built with a single
 * `encodeURIComponent()` at render time, so every source of this value — this default,
 * `NEXT_PUBLIC_WHATSAPP_MESSAGE`, and the `contact.whatsapp.message` SiteSetting — must be
 * raw text, never pre-encoded, or the href would be double-encoded).
 */
const DEFAULT_WA_MESSAGE =
  process.env.NEXT_PUBLIC_WHATSAPP_MESSAGE ??
  "Hi, I want to know more about StimuliiQ programs";
const DEFAULT_CONTACT_TEXT =
  "India's leading internship & career training platform for B.Tech, MBA, MCA, and Diploma students.";

const CURRENT_YEAR = new Date().getFullYear();
const DEFAULT_COPYRIGHT_TEXT = `© ${CURRENT_YEAR} StimuliiQ Technologies Pvt. Ltd. All rights reserved.`;

// ---------------------------------------------------------------------------
// Logo
// ---------------------------------------------------------------------------

function SiteLogo(): React.JSX.Element {
  return (
    <Image
      src="/stimuliiq-logo.png"
      alt="StimuliiQ"
      width={1506}
      height={355}
      priority
      className="h-8 w-auto"
    />
  );
}

// ---------------------------------------------------------------------------
// SiteShell
// ---------------------------------------------------------------------------

interface SiteShellProps {
  children: React.ReactNode;
  /**
   * Nav + footer built server-side from the live catalog (root layout via
   * lib/nav-programs.ts). Defaults to the static fallback config so the shell
   * still renders a complete header if a caller passes nothing.
   */
  navItems?: NavItem[];
  footerColumns?: typeof FOOTER_COLUMNS;
  /** `footer.legal_links` SiteSetting (root layout); falls back to `LEGAL_LINKS`. */
  legalLinks?: typeof LEGAL_LINKS;
  /** `footer.copyright_text` (already `{year}`-interpolated by the caller); falls back to the hardcoded default. */
  copyrightText?: string;
  /** `contact.details.contactText`; falls back to the hardcoded default. */
  contactText?: string;
  /** `contact.whatsapp.number`; falls back to `NEXT_PUBLIC_WHATSAPP_NUMBER`/hardcoded default. */
  whatsappNumber?: string;
  /**
   * `contact.whatsapp.message` — RAW human-readable text (NOT pre-encoded); falls back to
   * `NEXT_PUBLIC_WHATSAPP_MESSAGE`/hardcoded default. `encodeURIComponent()` is applied
   * exactly once, at the `waHref` construction below (L3 security-review fix — the
   * previous version interpolated this straight into the href unencoded).
   */
  whatsappMessage?: string;
}

export function SiteShell({
  children,
  navItems = NAV_ITEMS,
  footerColumns = FOOTER_COLUMNS,
  legalLinks = LEGAL_LINKS,
  copyrightText = DEFAULT_COPYRIGHT_TEXT,
  contactText = DEFAULT_CONTACT_TEXT,
  whatsappNumber = DEFAULT_WA_NUMBER,
  whatsappMessage = DEFAULT_WA_MESSAGE,
}: SiteShellProps): React.JSX.Element {
  // L3 (security review): both values are interpolated into a URL — encode once, here,
  // rather than trusting the caller/source to have pre-encoded them (a raw phone number
  // is a no-op under encodeURIComponent; the message needs it for spaces/punctuation).
  const waHref = `https://wa.me/${encodeURIComponent(whatsappNumber)}?text=${encodeURIComponent(whatsappMessage)}`;
  const pathname = usePathname();
  // FOCUSED CHECKOUT MODE (/pay/:token): a payment page must read as a checkout,
  // not a marketing page — no nav, mega-menu, newsletter band, footer link forest,
  // WhatsApp FAB, lead popup, or analytics. Just the logo (trust anchor), a
  // "Secure checkout" badge, the payment card, and a one-line reassurance footer.
  const isFocusedCheckout = pathname?.startsWith("/pay/") ?? false;
  // Consent state — initialised from localStorage (SSR-safe: readStoredConsent returns null on server)
  const [analyticsConsent, setAnalyticsConsent] = React.useState<boolean>(false);

  // On mount, check if consent was already given in a previous visit.
  React.useEffect(() => {
    const stored = readStoredConsent();
    if (stored === "accepted") {
      setAnalyticsConsent(true);
    }
  }, []);

  function handleConsentAccept() {
    setAnalyticsConsent(true);
  }

  if (isFocusedCheckout) {
    return (
      <>
        <header className="border-b border-border bg-bg" data-testid="checkout-header">
          <div className="mx-auto flex max-w-2xl items-center justify-between px-6 py-4">
            <SiteLogo />
            <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-fg-muted">
              <svg
                aria-hidden="true"
                className="size-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              Secure checkout
            </span>
          </div>
        </header>
        {/* The pay page provides its own <main id="main-content"> landmark. */}
        {children}
        <footer className="pb-8 text-center text-xs text-fg-subtle" data-testid="checkout-footer">
          Payments processed securely by Razorpay · {copyrightText}
        </footer>
      </>
    );
  }

  return (
    <>
      {/* Sticky marketing header with mega-menu */}
      <MarketingHeader
        logo={<SiteLogo />}
        navItems={navItems}
        bookSlotHref={BOOK_SLOT_HREF}
        data-testid="site-header"
      />

      {/* Main content landmark — skip-link target */}
      <main id="main-content" tabIndex={-1}>
        {children}
      </main>

      {/* Dark newsletter band (replaces the old in-footer "Stay updated" form) */}
      <NewsletterBand />

      {/* Site footer */}
      <MarketingFooter
        logo={<SiteLogo />}
        columns={footerColumns}
        legalLinks={legalLinks}
        certVerifyHref={CERT_VERIFY_HREF}
        copyrightText={copyrightText}
        contactText={contactText}
        data-testid="site-footer"
      />

      {/* WhatsApp click-to-chat FAB — always visible (below ConsentBanner z-index) */}
      <WhatsAppFab
        href={waHref}
        aria-label="Chat with a StimuliiQ counsellor on WhatsApp"
        data-testid="whatsapp-fab"
      />

      {/* DPDP consent banner — shown on first visit, gates analytics */}
      <ConsentBanner
        onAccept={handleConsentAccept}
        onReject={() => setAnalyticsConsent(false)}
        policyHref="/privacy"
        data-testid="consent-banner"
      />

      {/* Analytics — ONLY renders after consent is accepted (AC-34/35) */}
      <AnalyticsLoader enabled={analyticsConsent} />

      {/* Timed "book a slot" lead popup: a site-wide modal that opens once per
          session ~4s after the first page load and creates a CRM lead on submit.
          Replaces the old exit-intent modal so only one lead popup is in play. */}
      <TimedLeadPopupConnected />
    </>
  );
}
