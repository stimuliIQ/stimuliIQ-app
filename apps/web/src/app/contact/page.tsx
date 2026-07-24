/**
 * /contact — Contact page (black & white redesign).
 *
 * Layout: centered header → two columns — contact channels + trust signals on
 * the left, the message form in a card on the right → counselling CTA band.
 *
 * SSG + breadcrumbs + structured data. The form itself (ContactForm, T32) is
 * unchanged: zod-validated, captcha-gated submission via
 * client.public.contact.submit.
 *
 * a11y: one h1, labelled sections, ≥44px targets, decorative icons hidden.
 */
import type { Metadata } from "next";
import { Breadcrumbs } from "@repo/ui";
import { buildMetadata, SITE_URL } from "../../lib/seo/metadata";
import { buildBreadcrumbJsonLd } from "../../lib/seo/json-ld";
import { ContactForm } from "../../components/contact/contact-form";
import { BOOK_SLOT_HREF } from "../../components/shell/nav-config";

export const metadata: Metadata = buildMetadata({
  title: "Contact Us",
  description:
    "Get in touch with the StimuliiQ team. We are here to help you choose the right program and answer any questions.",
  canonicalPath: "/contact",
});

const BREADCRUMBS = [{ label: "Home", href: "/" }, { label: "Contact" }];

const WA_NUMBER = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? "919999999999";

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function MailIcon() {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
    >
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
    >
      <path d="M21 12a8 8 0 0 1-8 8H4l2.5-2.5A8 8 0 1 1 21 12Z" />
      <path d="M9 11h.01M12 11h.01M15 11h.01" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
    >
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3 10h18" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Channel card
// ---------------------------------------------------------------------------

function ChannelCard({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  action: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-4 rounded-2xl bg-card p-6 shadow-sm">
      <span
        aria-hidden="true"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface text-fg"
      >
        {icon}
      </span>
      <div className="min-w-0">
        <h3 className="text-base font-bold text-fg">{title}</h3>
        <p className="mt-1 text-sm leading-relaxed text-fg-muted">{description}</p>
        <p className="mt-2 text-sm font-medium">{action}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ContactPage() {
  const breadcrumbJsonLd = buildBreadcrumbJsonLd(BREADCRUMBS, SITE_URL);

  return (
    <>
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: escaped JSON-LD
        dangerouslySetInnerHTML={{ __html: breadcrumbJsonLd }}
      />

      <div className="mx-auto max-w-screen-xl px-4 pt-10 md:px-6">
        <Breadcrumbs items={BREADCRUMBS} className="mb-10" data-testid="contact-breadcrumbs" />

        {/* Header */}
        <header className="mx-auto max-w-2xl pb-12 text-center lg:pb-16">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-fg-muted">
            Contact us
          </p>
          <h1 className="mt-6 font-display text-4xl font-bold leading-[1.08] tracking-tight text-fg sm:text-5xl">
            Talk to a <span className="text-chart-3">human</span>.
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-fg-muted">
            Questions about a program, pricing, or your career path? Our
            counsellors reply within 24 hours — usually much faster.
          </p>
        </header>
      </div>

      {/* Channels + form */}
      <div className="border-t border-border bg-surface py-14 lg:py-16">
        <div className="mx-auto grid max-w-screen-xl grid-cols-1 gap-10 px-4 md:px-6 lg:grid-cols-[1fr_1.2fr] lg:gap-14">
          {/* Left: channels + trust */}
          <div className="flex flex-col gap-5">
            <ChannelCard
              icon={<MailIcon />}
              title="Email us"
              description="Best for detailed questions — attach anything you like."
              action={
                <a
                  href="mailto:hello@stimuliiq.com"
                  className="text-fg underline underline-offset-4 hover:text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded"
                >
                  hello@stimuliiq.com
                </a>
              }
            />
            <ChannelCard
              icon={<ChatIcon />}
              title="WhatsApp"
              description="Quickest way to reach a counsellor during working hours."
              action={
                <a
                  href={`https://wa.me/${WA_NUMBER}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-fg underline underline-offset-4 hover:text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded"
                >
                  +91 99999 99999
                </a>
              }
            />
            <ChannelCard
              icon={<CalendarIcon />}
              title="Free counselling session"
              description="A 30-minute call with a program advisor. No pressure, just clarity on the right path for you."
              action={
                <a
                  href={BOOK_SLOT_HREF}
                  className="inline-flex min-h-[44px] items-center justify-center rounded-full bg-brand-500 px-6 text-xs font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:bg-brand-600 active:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  Book free slot
                </a>
              }
            />

            {/* Hours + expectations */}
            <div className="flex items-start gap-4 rounded-2xl border border-border p-6">
              <span
                aria-hidden="true"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface text-fg"
              >
                <ClockIcon />
              </span>
              <div>
                <h3 className="text-base font-bold text-fg">Working hours</h3>
                <p className="mt-1 text-sm leading-relaxed text-fg-muted">
                  Monday–Saturday, 9 AM–7 PM IST.
                  <br />
                  Messages sent outside these hours are answered the next
                  working day. You can also check our{" "}
                  <a
                    href="/faq"
                    className="text-fg underline underline-offset-4 hover:text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded"
                  >
                    FAQ
                  </a>{" "}
                  — most questions are answered there.
                </p>
              </div>
            </div>
          </div>

          {/* Right: message form */}
          <div className="rounded-2xl bg-card p-7 shadow-sm md:p-9">
            <h2 className="text-xl font-bold text-fg">Send us a message</h2>
            <p className="mt-1 text-sm text-fg-muted">
              Fill this in and we&apos;ll get back to you within 24 hours.
            </p>
            <div className="mt-6">
              <ContactForm />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
