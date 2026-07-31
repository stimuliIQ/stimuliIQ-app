/**
 * Program detail page — /programs/[slug]
 *
 * ISR: revalidate = 3600 (1 hour). Pages are pre-rendered at build time for known slugs
 * and revalidated on demand. Unknown slugs → generated on first request, then cached.
 *
 * SEO structured data emitted (AC-28, AC-29, AC-33):
 *   - Course JSON-LD (name, description, provider, offers, aggregateRating)
 *   - Review/AggregateRating within Course (not a separate Review type per schema.org best practice)
 *   - FAQPage JSON-LD (if FAQ entries present)
 *   - BreadcrumbList JSON-LD
 *
 * Key UX (docs/01 §7.4):
 *   - Desktop: 2-column (content left + StickyBuyCard right rail)
 *   - Mobile: single column + MobileBuyBar (fixed bottom)
 *   - Primary CTA: "Enroll Now" → /enroll/[slug] (Task #8 owns that route)
 *   - Secondary CTA: "Book Free Slot" → /book-free-slot
 *
 * Non-public slug → notFound() → Next.js 404 (AC-25).
 * No draft/internal fields in this file (all come from the public SDK).
 *
 * a11y: heading hierarchy, landmark sections, aria-label on aside, keyboard accordion.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { buildMetadata, SITE_URL } from "../../../lib/seo/metadata";
import { buildCourseJsonLd, buildFaqJsonLd, buildBreadcrumbJsonLd } from "../../../lib/seo/json-ld";
import { serverApiClient } from "../../../lib/api-client";
import {
  StickyBuyCard,
  MobileBuyBar,
  FaqAccordion,
  ProgramCard,
  TestimonialCard,
} from "@repo/ui";
import { formatPaiseDisplay, formatCompareAtDisplay, formatRating, formatMode } from "../../../lib/format";
import { BOOK_SLOT_HREF } from "../../../components/shell/nav-config";
import { buildWhatsAppHref } from "../../../lib/contact";
import { StickyLeadBarConnected } from "../../../components/leads/sticky-lead-bar-connected";
import { CurriculumPreview } from "../_components/curriculum-preview";
import type { PublicProgramDetail } from "@repo/types";

// ---------------------------------------------------------------------------
// WhatsApp per-program context — prefilled message including the program title
// (T33: docs/plans/phase-9-completion.md). Distinct from the sitewide FAB
// (site-shell.tsx), which carries a generic prefilled message.
// ---------------------------------------------------------------------------

function buildProgramWhatsAppHref(programTitle: string): string {
  return buildWhatsAppHref(
    `Hi, I'm interested in the ${programTitle} program at Stimuli IQ. Can you share more details?`,
  );
}

// ---------------------------------------------------------------------------
// ISR
// ---------------------------------------------------------------------------

export const revalidate = 3600;

// ---------------------------------------------------------------------------
// generateStaticParams — pre-render known public program slugs at build time
// ---------------------------------------------------------------------------

export async function generateStaticParams(): Promise<{ slug: string }[]> {
  try {
    const result = await serverApiClient.public.programs.list({ limit: 50 });
    return result.items.map((p) => ({ slug: p.slug }));
  } catch {
    // Build proceeds; unknown slugs are generated on-demand (ISR)
    return [];
  }
}

// ---------------------------------------------------------------------------
// generateMetadata — per-page SEO (AC-32)
// ---------------------------------------------------------------------------

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;

  try {
    const program = await serverApiClient.public.programs.getBySlug(slug);
    return buildMetadata({
      title: program.seoTitle ?? program.title,
      description:
        program.seoDescription ??
        program.cardSummary ??
        `Learn ${program.title} — project-based program with verifiable certificate.`,
      canonicalPath: `/programs/${slug}`,
      ogImage: program.ogImageUrl ?? undefined,
      ogImageAlt: `${program.title} — Stimuli IQ`,
    });
  } catch {
    // If program not found, metadata falls back to defaults; notFound() in the page component
    return buildMetadata({
      title: "Program Not Found",
      noIndex: true,
    });
  }
}

// ---------------------------------------------------------------------------
// JSON-LD builders
// ---------------------------------------------------------------------------

function buildCourseStructuredData(program: PublicProgramDetail): string {
  return buildCourseJsonLd({
    name: program.title,
    description:
      program.seoDescription ??
      program.cardSummary ??
      `${program.title} — online training program by Stimuli IQ`,
    url: `${SITE_URL}/programs/${program.slug}`,
    imageUrl: program.ogImageUrl ?? undefined,
    pricePaise: program.pricePaise,
    duration: program.durationWeeks ? `${program.durationWeeks} weeks` : undefined,
    ratingValue: program.ratingAvg != null ? program.ratingAvg / 10 : undefined,
    ratingCount: program.ratingCount ?? undefined,
  });
}

function buildFaqStructuredData(
  items: Array<{
    id: string;
    question: string;
    answer: string | React.ReactNode;
    answerText?: string;
  }>,
): string | null {
  if (items.length === 0) return null;
  return buildFaqJsonLd(
    items.map((item) => ({
      question: item.question,
      answerText: item.answerText ?? (typeof item.answer === "string" ? item.answer : ""),
    })),
  );
}

// Bring in React for React.ReactNode type
import * as React from "react";

// ---------------------------------------------------------------------------
// Sub-components (server, no business logic)
// ---------------------------------------------------------------------------

function ProgramHero({ program }: { program: PublicProgramDetail }) {
  const price = formatPaiseDisplay(program.pricePaise);
  const wasPrice = formatCompareAtDisplay(program.compareAtPricePaise, program.pricePaise);
  const ratingDisplay = program.ratingAvg != null ? formatRating(program.ratingAvg) : null;

  return (
    // Two-column hero when an image exists (md+): compact 16:9 image left,
    // title/summary/meta right — keeps the course name above the fold instead
    // of pushing it below a full-width banner. Stacks on mobile; single
    // column when there's no image.
    <header
      className={
        program.ogImageUrl
          ? "grid grid-cols-1 items-start gap-6 md:grid-cols-[minmax(0,380px)_1fr] lg:grid-cols-[minmax(0,420px)_1fr]"
          : "flex flex-col gap-4"
      }
    >
      {/* Course image (16:9) with the scholarship ribbon, when set in the CRM */}
      {program.ogImageUrl ? (
        <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-border bg-surface">
          {/* plain <img>: remote CDN host is not allowlisted in next.config images */}
          <img src={program.ogImageUrl} alt="" className="size-full object-cover" />
          {program.scholarshipAvailable ? (
            <span className="absolute right-0 top-3 bg-danger px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-white shadow-sm">
              Scholarship available
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="flex min-w-0 flex-col gap-4">
        <h1 className="text-3xl font-bold text-fg leading-tight md:text-4xl">{program.title}</h1>

        {program.cardSummary ? (
          <p className="text-lg text-fg-muted leading-relaxed">{program.cardSummary}</p>
        ) : null}

        {/* Scholarship badge (no-image fallback) + link to the programme page */}
        {program.scholarshipAvailable && !program.ogImageUrl ? (
          <a
            href="/scholarship"
            className="inline-flex w-fit items-center gap-2 rounded-full bg-danger px-3 py-1 text-xs font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            Scholarship available — check eligibility
          </a>
        ) : null}

        {/* Rating row */}
        {ratingDisplay != null && program.ratingCount ? (
          <div
            className="flex items-center gap-2 text-sm"
            aria-label={`Rated ${ratingDisplay} out of 5 based on ${program.ratingCount} reviews`}
          >
            <span aria-hidden="true" className="text-warning font-semibold">
              ★ {ratingDisplay}
            </span>
            <span className="text-fg-muted">
              ({program.ratingCount.toLocaleString("en-IN")} reviews)
            </span>
          </div>
        ) : null}

        {/* Price + EMI */}
        <div className="flex items-baseline gap-3">
          <span className="text-2xl font-bold text-fg">{price}</span>
          {wasPrice ? (
            <>
              <span aria-hidden="true" className="text-lg text-fg-subtle line-through">{wasPrice}</span>
              <span className="sr-only">, reduced from {wasPrice}</span>
            </>
          ) : null}
          {program.emiDisplay ? (
            <span className="text-sm text-fg-muted">{program.emiDisplay}</span>
          ) : null}
        </div>

        {/* Hero CTAs (mobile — visible at top; desktop uses StickyBuyCard).
            When enrollment is closed (CRM toggle) the Enroll CTA is dropped and
            "Book Free Slot" is promoted to the primary style so the section still has
            exactly one clear action rather than a lone outlined button. */}
        <div className="flex flex-col gap-3 sm:flex-row lg:hidden">
          {program.enrollmentEnabled ? (
            <a
              href={`/enroll/${program.slug}`}
              className="flex min-h-[44px] items-center justify-center rounded-md bg-brand-500 px-6 text-base font-semibold text-white transition-colors hover:bg-brand-600 active:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Enroll Now
            </a>
          ) : null}
          <a
            href={BOOK_SLOT_HREF}
            className={
              program.enrollmentEnabled
                ? "flex min-h-[44px] items-center justify-center rounded-md border border-border px-6 text-base font-medium text-fg transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                : "flex min-h-[44px] items-center justify-center rounded-md bg-brand-500 px-6 text-base font-semibold text-white transition-colors hover:bg-brand-600 active:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            }
          >
            Book Free Slot
          </a>
        </div>

        {/* Brochure download — only when staff uploaded one in the CRM (no dead link
            otherwise). Outside the lg:hidden CTA row on purpose: this is useful at every
            breakpoint, unlike the mobile-only Enroll/Book pair which the sticky card
            replaces on desktop. `download` asks the browser to save rather than navigate. */}
        {program.brochureUrl ? (
          <a
            href={program.brochureUrl}
            download
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-fit min-h-[44px] items-center gap-2 rounded-md border border-border px-5 text-sm font-semibold text-fg transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            data-testid="program-brochure-download"
          >
            <span aria-hidden="true">📄</span>
            Download brochure (PDF)
          </a>
        ) : null}
      </div>
    </header>
  );
}

function OutcomesSection({ outcomes }: { outcomes: string[] }) {
  if (outcomes.length === 0) return null;
  return (
    <section aria-label="Learning outcomes" data-testid="program-outcomes">
      <h2 className="mb-4 text-xl font-semibold text-fg">What you'll Learn</h2>
      <ul role="list" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {outcomes.map((outcome) => (
          <li key={outcome} className="flex items-start gap-2 text-sm text-fg-muted">
            <span
              aria-hidden="true"
              className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-success/20 text-success text-xs font-bold"
            >
              ✓
            </span>
            {outcome}
          </li>
        ))}
      </ul>
    </section>
  );
}

function MentorsSection({ mentors }: { mentors: PublicProgramDetail["mentorBios"] }) {
  if (mentors.length === 0) return null;
  return (
    <section aria-label="Program mentors" data-testid="program-mentors">
      <h2 className="mb-6 text-xl font-semibold text-fg">Your Mentors</h2>
      <ul role="list" className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        {mentors.map((mentor) => (
          <li
            key={mentor.id}
            className="flex items-start gap-4 rounded-xl border border-border bg-card p-4"
          >
            {mentor.avatarUrl ? (
              <img
                src={mentor.avatarUrl}
                alt={`${mentor.name} — mentor`}
                className="size-14 shrink-0 rounded-full object-cover"
                loading="lazy"
                decoding="async"
              />
            ) : (
              <div
                aria-hidden="true"
                className="flex size-14 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xl font-bold text-brand-600"
              >
                {mentor.name.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="flex flex-col gap-1">
              <p className="font-semibold text-fg">{mentor.name}</p>
              {mentor.title || mentor.company ? (
                <p className="text-sm text-fg-muted">
                  {[mentor.title, mentor.company].filter(Boolean).join(" @ ")}
                </p>
              ) : null}
              {mentor.expertise.length > 0 ? (
                <div className="flex flex-wrap gap-1 mt-1">
                  {mentor.expertise.map((skill) => (
                    <span
                      key={skill}
                      className="rounded-full bg-surface border border-border px-2 py-0.5 text-xs text-fg-muted"
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ReviewsSection({ reviews }: { reviews: PublicProgramDetail["reviewsSummary"] }) {
  if (reviews.count === 0) return null;

  const avgDisplay = (reviews.avgTimes10 / 10).toFixed(1);

  return (
    <section aria-label="Student reviews" data-testid="program-reviews">
      <h2 className="mb-4 text-xl font-semibold text-fg">Student Reviews</h2>

      {/* Aggregate rating */}
      <div
        className="mb-6 flex items-center gap-4 rounded-xl border border-border bg-surface p-4"
        aria-label={`Average rating: ${avgDisplay} out of 5 from ${reviews.count} reviews`}
      >
        <div className="flex flex-col items-center">
          <span className="text-5xl font-bold text-fg tabular-nums">{avgDisplay}</span>
          <div aria-hidden="true" className="flex text-warning">
            {"★".repeat(Math.round(reviews.avgTimes10 / 10))}
            {"☆".repeat(5 - Math.round(reviews.avgTimes10 / 10))}
          </div>
          <span className="text-xs text-fg-muted">
            {reviews.count.toLocaleString("en-IN")} review{reviews.count === 1 ? "" : "s"}
          </span>
        </div>
      </div>

      {/* Review excerpts */}
      {reviews.excerpts.length > 0 ? (
        <ul role="list" className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {reviews.excerpts.map((r, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: review excerpts have no stable ID
            <li key={i}>
              <TestimonialCard
                quote={r.excerpt}
                studentName={r.firstName}
                college={r.college ?? undefined}
                ratingStars={r.rating}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function CertificateSection({ programTitle }: { programTitle: string }) {
  return (
    <section
      aria-label="Certificate"
      data-testid="program-certificate"
      className="rounded-xl border border-border bg-surface p-6"
    >
      <h2 className="mb-3 text-xl font-semibold text-fg">Earn a Verifiable Certificate</h2>
      <p className="text-sm text-fg-muted leading-relaxed">
        Upon successful completion of {programTitle}, you'll receive a digitally-signed certificate
        with a unique ID. Employers can verify its authenticity instantly on our platform.
      </p>
      <a
        href="/verify"
        className="mt-4 inline-flex items-center text-sm font-medium text-brand-500 hover:text-brand-600 focus-visible:outline-none focus-visible:underline"
      >
        See how verification works →
      </a>
    </section>
  );
}

function RelatedProgramsSection({
  programs,
}: {
  programs: PublicProgramDetail["relatedPrograms"];
}) {
  if (programs.length === 0) return null;
  return (
    <section aria-label="Related programs" data-testid="program-related">
      <h2 className="mb-6 text-xl font-semibold text-fg">You May Also Like</h2>
      <ul role="list" className="grid grid-cols-1 gap-5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {programs.map((p) => (
          <li key={p.id}>
            <ProgramCard
              title={p.title}
              priceDisplay={formatPaiseDisplay(p.pricePaise)}
              originalPriceDisplay={formatCompareAtDisplay(p.compareAtPricePaise, p.pricePaise)}
              ctaLabel="View Program"
              ctaHref={`/programs/${p.slug}`}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Program FAQ (static fallback — program-specific FAQ would come from backend)
// ---------------------------------------------------------------------------

function buildProgramFaqItems(program: PublicProgramDetail) {
  return [
    {
      id: "pq-1",
      question: `Who is this ${program.title} program for?`,
      answer: `This program is designed for students and early professionals looking to build practical skills in ${program.domain}. ${program.level ? `It is ${program.level} level.` : ""}`,
      answerText: `This program is designed for students and early professionals looking to build practical skills in ${program.domain}.`,
    },
    {
      id: "pq-2",
      question: "What is the format?",
      answer: `The program runs for ${program.durationWeeks ? `${program.durationWeeks} weeks` : "a defined period"} in ${formatMode(program.mode)} mode. You'll get live sessions, recorded videos, and hands-on projects.`,
      answerText: `The program runs in ${formatMode(program.mode)} mode with live sessions, recorded videos, and hands-on projects.`,
    },
    {
      id: "pq-3",
      question: "Will I get a certificate?",
      answer:
        "Yes. Upon completion and assessment, you'll receive a digitally-signed, employer-verifiable certificate with a unique ID.",
      answerText:
        "Yes. Upon completion and assessment, you'll receive a digitally-signed, employer-verifiable certificate.",
    },
    {
      id: "pq-4",
      question: "What payment options are available?",
      answer: program.emiDisplay
        ? `You can pay the full amount (${formatPaiseDisplay(program.pricePaise)}) or choose our EMI option: ${program.emiDisplay}.`
        : `The program price is ${formatPaiseDisplay(program.pricePaise)}. Pay securely via Razorpay (UPI, cards, net banking).`,
      answerText: `The program price is ${formatPaiseDisplay(program.pricePaise)}. Secure payment via Razorpay.`,
    },
  ];
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function ProgramDetailPage({ params }: PageProps) {
  const { slug } = await params;

  let program: PublicProgramDetail;

  try {
    program = await serverApiClient.public.programs.getBySlug(slug);
  } catch {
    // API returns 404 for non-public/non-published programs (AC-25)
    notFound();
  }

  // Double-check: if the API returned something unexpected, still 404
  // (defensive — the backend enforces is_public + published server-side)
  if (!program) notFound();

  const price = formatPaiseDisplay(program.pricePaise);
  const wasPrice = formatCompareAtDisplay(program.compareAtPricePaise, program.pricePaise);
  const enrollHref = `/enroll/${program.slug}`;
  const faqItems = buildProgramFaqItems(program);

  // Build JSON-LD (AC-28, AC-29, AC-33)
  const courseJsonLd = buildCourseStructuredData(program);
  const faqJsonLd = buildFaqStructuredData(faqItems);
  const breadcrumbJsonLd = buildBreadcrumbJsonLd(
    [
      { label: "Home", href: "/" },
      { label: "Programs", href: "/programs" },
      { label: program.title },
    ],
    SITE_URL,
  );

  return (
    <>
      {/* JSON-LD structured data — injected server-side (AC-28, AC-29, AC-33) */}
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD; content escaped via escapeJsonLd()
        dangerouslySetInnerHTML={{ __html: courseJsonLd }}
      />
      {faqJsonLd ? (
        <script
          type="application/ld+json"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD; content escaped via escapeJsonLd()
          dangerouslySetInnerHTML={{ __html: faqJsonLd }}
        />
      ) : null}
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD; content escaped via escapeJsonLd()
        dangerouslySetInnerHTML={{ __html: breadcrumbJsonLd }}
      />

      <main
        id="main-content"
        className="mx-auto max-w-screen-xl px-4 pb-24 pt-6 md:px-6 lg:pb-10"
        data-testid="program-detail"
      >
        {/* 2-column layout: content + sticky buy card */}
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-[1fr_360px] lg:items-start">
          {/* Left: Main content */}
          <div className="flex flex-col gap-12">
            {/* Hero */}
            <ProgramHero program={program} />

            {/* WhatsApp — per-program context (T33): prefilled message includes the
                program title, distinct from the sitewide FAB's generic message. */}
            <a
              href={buildProgramWhatsAppHref(program.title)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex w-fit min-h-[40px] items-center gap-2 rounded-md border border-success/40 bg-success/10 px-4 text-sm font-medium text-success transition-colors hover:bg-success/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              data-testid="program-whatsapp-cta"
            >
              <span aria-hidden="true">💬</span>
              Ask about {program.title} on WhatsApp
            </a>

            {/* Outcomes */}
            {program.outcomes && program.outcomes.length > 0 ? (
              <OutcomesSection outcomes={program.outcomes} />
            ) : null}

            {/*
              Curriculum — outline-only projection (no lesson content), now with
              WATCH-BEFORE-YOU-PAY: lessons the CRM flagged as a free preview play
              inline; the rest show a lock. The server re-checks the preview flag on
              every playback request, so the lock is presentation, not the gate.
            */}
            {program.curriculumOutline.length > 0 ? (
              <div data-testid="program-curriculum">
                <CurriculumPreview
                  programSlug={program.slug}
                  outline={program.curriculumOutline}
                  enrollHref={program.enrollmentEnabled ? enrollHref : BOOK_SLOT_HREF}
                  enrollCtaLabel={program.enrollmentEnabled ? "Enrol now" : "Book a free slot"}
                />
              </div>
            ) : null}

            {/* Mentors */}
            <MentorsSection mentors={program.mentorBios} />

            {/* Certificate */}
            <CertificateSection programTitle={program.title} />

            {/* Reviews */}
            <ReviewsSection reviews={program.reviewsSummary} />

            {/* FAQ */}
            <section aria-label="Frequently asked questions" data-testid="program-faq">
              <h2 className="mb-4 text-xl font-semibold text-fg">Frequently Asked Questions</h2>
              <FaqAccordion items={faqItems} />
            </section>

            {/* Related programs */}
            <RelatedProgramsSection programs={program.relatedPrograms} />
          </div>

          {/* Right rail: StickyBuyCard (desktop only) */}
          <div className="hidden lg:block lg:sticky lg:top-24" aria-label="Program enrollment">
            <StickyBuyCard
              priceDisplay={price}
              originalPriceDisplay={wasPrice}
              emiDisplay={program.emiDisplay ?? undefined}
              // Enrollment closed → "Book Free Slot" becomes the card's PRIMARY action and
              // there is no secondary, so the card never renders a dead-end.
              primaryCtaLabel={program.enrollmentEnabled ? "Enroll Now" : "Book Free Slot"}
              primaryCtaHref={program.enrollmentEnabled ? enrollHref : BOOK_SLOT_HREF}
              secondaryCtaLabel={program.enrollmentEnabled ? "Book Free Slot" : undefined}
              secondaryCtaHref={program.enrollmentEnabled ? BOOK_SLOT_HREF : undefined}
              included={[
                program.durationWeeks
                  ? `${program.durationWeeks} weeks of training`
                  : "Full program access",
                `${formatMode(program.mode)} learning mode`,
                "Industry mentor support",
                "Verifiable certificate",
                "Placement assistance",
              ]}
              data-testid="sticky-buy-card"
            />
          </div>
        </div>
      </main>

      {/* MobileBuyBar — fixed bottom, mobile only (ac-14: tap targets ≥44px) */}
      <MobileBuyBar
        priceDisplay={price}
        originalPriceDisplay={wasPrice}
        primaryCtaLabel={program.enrollmentEnabled ? "Enroll Now" : "Book Free Slot"}
        primaryCtaHref={program.enrollmentEnabled ? enrollHref : BOOK_SLOT_HREF}
        data-testid="mobile-buy-bar"
      />

      {/* StickyLeadBarConnected (T32/R4) — desktop-only fixed bottom bar; MobileBuyBar
          already owns the fixed-bottom slot on mobile/tablet (lg:hidden), so this only
          renders at lg+ to avoid overlapping it. High-intent page = program detail. */}
      <StickyLeadBarConnected
        source="web-program-detail"
        label={`Questions about ${program.title}? Get a free callback`}
        programInterestId={program.id}
        position="bottom"
        className="hidden lg:block"
      />
    </>
  );
}
