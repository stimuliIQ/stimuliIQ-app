/**
 * Enroll page — /enroll/[slug]
 *
 * The "Enroll Now" CTA from program detail pages links here.
 * This RSC fetches the public program detail and passes it to
 * the EnrollFunnelClient (client component).
 *
 * Non-public slug → notFound() (AC-25, inherited from program detail).
 *
 * Loading state: loading.tsx handles the skeleton.
 * Error state: the client component handles error+retry.
 *
 * Security:
 *   - programId comes from the API (server-fetched) — never from URL params
 *   - No secrets passed to the client component
 *   - pricePaise is passed as display data; the server re-derives it for orders
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { serverApiClient } from "../../../lib/api-client";
import { buildMetadata } from "../../../lib/seo/metadata";
import { formatPaiseDisplay, formatCompareAtDisplay, formatDiscountPercent } from "../../../lib/format";
import { buildWhatsAppHref } from "../../../lib/contact";
import { EnrollFunnelClient } from "./_components/enroll-funnel-client";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  try {
    const program = await serverApiClient.public.programs.getBySlug(slug);
    return buildMetadata({
      title: `Enroll in ${program.title} — Stimuli IQ`,
      description: `Enroll in ${program.title} and start your tech career journey with Stimuli IQ.`,
      canonicalPath: `/enroll/${slug}`,
      noIndex: true, // Enroll pages should not be indexed (funnel pages)
    });
  } catch {
    return buildMetadata({ title: "Enroll — Stimuli IQ", noIndex: true });
  }
}

export default async function EnrollPage({ params }: PageProps) {
  const { slug } = await params;

  let program: Awaited<ReturnType<typeof serverApiClient.public.programs.getBySlug>>;

  try {
    program = await serverApiClient.public.programs.getBySlug(slug);
  } catch {
    notFound();
  }

  if (!program) notFound();

  return (
    <main
      id="main-content"
      className="mx-auto max-w-lg px-4 pb-16 pt-8 md:pt-12"
      data-testid="enroll-page"
    >
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-fg">
          Enroll in {program.title}
        </h1>
        <p className="mt-2 text-fg-muted">
          {program.cardSummary ?? `Start your journey in ${program.domain}.`}
        </p>
        <div className="mt-3 flex items-baseline gap-3">
          <span className="text-xl font-bold text-fg">
            {formatPaiseDisplay(program.pricePaise)}
          </span>
          {formatCompareAtDisplay(program.compareAtPricePaise, program.pricePaise) ? (
            <>
              <span aria-hidden="true" className="text-base text-fg-subtle line-through">
                {formatCompareAtDisplay(program.compareAtPricePaise, program.pricePaise)}
              </span>
              <span className="sr-only">
                , reduced from {formatCompareAtDisplay(program.compareAtPricePaise, program.pricePaise)}
              </span>
            </>
          ) : null}
          {formatDiscountPercent(program.compareAtPricePaise, program.pricePaise) ? (
            <span className="rounded bg-success/10 px-2 py-0.5 text-sm font-bold text-success">
              {formatDiscountPercent(program.compareAtPricePaise, program.pricePaise)}
            </span>
          ) : null}
          {program.emiDisplay ? (
            <span className="text-sm text-fg-muted">{program.emiDisplay}</span>
          ) : null}
        </div>
      </div>

      {/* Client component: multi-step funnel */}
      <EnrollFunnelClient
        programId={program.id}
        programTitle={program.title}
        pricePaise={program.pricePaise}
        emiDisplay={program.emiDisplay ?? undefined}
        slug={slug}
      />

      <p className="mt-6 text-center text-xs text-fg-subtle">
        Questions?{" "}
        <a
          href={buildWhatsAppHref()}
          className="text-brand-500 underline hover:text-brand-600"
          target="_blank"
          rel="noopener noreferrer"
        >
          Chat with us on WhatsApp
        </a>
      </p>
    </main>
  );
}
