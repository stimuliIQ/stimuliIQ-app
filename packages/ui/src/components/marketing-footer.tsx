import * as React from "react";

import { cn } from "../lib/cn";

/**
 * Footer — site footer for the `web` app, per docs/01-prd-website.md §7.1 and
 * docs/07-design-system.md §5/§12.
 *
 * Anatomy:
 * - Column groups (programs, company, legal) driven by `columns` prop.
 * - Social links row.
 * - Legal/contact bar (privacy, terms, refund, certificate verify link).
 * - Newsletter capture slot (caller renders the form; this component provides layout).
 *
 * SSR-safe: no window/document access. No "use client" required — purely presentational.
 *
 * Usage:
 *   <MarketingFooter
 *     logo={<img src="/logo.svg" alt="StimuliiQ" />}
 *     columns={[
 *       { heading: "Programs", links: [{ label: "Python", href: "/programs/python" }] },
 *       { heading: "Company", links: [{ label: "About", href: "/about" }] },
 *     ]}
 *     socialLinks={[{ label: "LinkedIn", href: "https://linkedin.com/...", icon: <LinkedInIcon /> }]}
 *     legalLinks={[{ label: "Privacy Policy", href: "/privacy" }]}
 *     certVerifyHref="/verify"
 *     newsletterSlot={<NewsletterForm />}
 *     copyrightText="© 2026 StimuliiQ Technologies"
 *   />
 */

export interface FooterLink {
  label: string;
  href: string;
}

export interface FooterColumn {
  heading: string;
  links: FooterLink[];
}

export interface SocialLink {
  label: string;
  href: string;
  /** Icon element — rendered at 20px, aria-hidden. */
  icon: React.ReactNode;
}

export interface MarketingFooterProps {
  logo: React.ReactNode;
  columns: FooterColumn[];
  socialLinks?: SocialLink[];
  legalLinks?: FooterLink[];
  certVerifyHref?: string;
  /** Newsletter capture slot; caller provides the <form> element. */
  newsletterSlot?: React.ReactNode;
  copyrightText?: string;
  contactText?: string;
  className?: string;
  "data-testid"?: string;
}

export function MarketingFooter({
  logo,
  columns,
  socialLinks,
  legalLinks,
  certVerifyHref,
  newsletterSlot,
  copyrightText,
  contactText,
  className,
  "data-testid": testId,
}: MarketingFooterProps): React.JSX.Element {
  return (
    <footer
      data-testid={testId ?? "marketing-footer"}
      aria-label="Site footer"
      className={cn("border-t border-border bg-surface text-fg", className)}
    >
      <div className="mx-auto max-w-screen-xl px-4 py-12 md:px-6 md:py-16">
        {/* Top section: logo + newsletter + columns */}
        <div className="grid grid-cols-1 gap-10 md:grid-cols-2 lg:grid-cols-[200px_1fr]">
          {/* Brand + newsletter */}
          <div className="flex flex-col gap-6">
            <a
              href="/"
              aria-label="StimuliiQ — home"
              className="inline-block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface rounded-sm"
            >
              {logo}
            </a>
            {contactText ? (
              <p className="text-sm text-fg-muted leading-relaxed">{contactText}</p>
            ) : null}
            {newsletterSlot ? (
              <div>
                <p className="mb-3 text-sm font-medium text-fg">Stay updated</p>
                {newsletterSlot}
              </div>
            ) : null}
          </div>

          {/* Link columns */}
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3 lg:grid-cols-4">
            {columns.map((col) => (
              <div key={col.heading}>
                <p className="mb-4 text-sm font-semibold text-fg">{col.heading}</p>
                <ul className="flex flex-col gap-2.5" role="list">
                  {col.links.map((link) => (
                    <li key={link.href}>
                      <a
                        href={link.href}
                        className={cn(
                          "text-sm text-fg-muted transition-colors hover:text-fg",
                          "focus-visible:outline-none focus-visible:underline focus-visible:decoration-ring",
                        )}
                      >
                        {link.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-10 flex flex-col gap-4 border-t border-border pt-8 md:flex-row md:items-center md:justify-between">
          {/* Legal links */}
          <nav aria-label="Legal links">
            <ul className="flex flex-wrap items-center gap-x-4 gap-y-2" role="list">
              {legalLinks?.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    className={cn(
                      "text-xs text-fg-muted transition-colors hover:text-fg",
                      "focus-visible:outline-none focus-visible:underline focus-visible:decoration-ring",
                    )}
                  >
                    {link.label}
                  </a>
                </li>
              ))}
              {certVerifyHref ? (
                <li>
                  <a
                    href={certVerifyHref}
                    className={cn(
                      "text-xs text-brand-500 font-medium transition-colors hover:text-brand-600",
                      "focus-visible:outline-none focus-visible:underline focus-visible:decoration-ring",
                    )}
                  >
                    Verify Certificate
                  </a>
                </li>
              ) : null}
            </ul>
          </nav>

          {/* Social + copyright */}
          <div className="flex flex-col items-start gap-4 md:items-end">
            {socialLinks && socialLinks.length > 0 ? (
              <nav aria-label="Social media links">
                <ul className="flex items-center gap-3" role="list">
                  {socialLinks.map((social) => (
                    <li key={social.href}>
                      <a
                        href={social.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={social.label}
                        className={cn(
                          "flex size-9 items-center justify-center rounded-md text-fg-muted",
                          "transition-colors hover:bg-card hover:text-fg",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        )}
                      >
                        <span aria-hidden="true" className="size-5 [&>svg]:size-5">
                          {social.icon}
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            ) : null}
            {copyrightText ? (
              <p className="text-xs text-fg-subtle">{copyrightText}</p>
            ) : null}
          </div>
        </div>
      </div>
    </footer>
  );
}

MarketingFooter.displayName = "MarketingFooter";
