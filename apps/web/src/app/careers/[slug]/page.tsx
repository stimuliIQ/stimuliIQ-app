/**
 * /careers/[slug] — one role's full advert (ADR-0066).
 *
 * A server component: it fetches the opening, sets metadata and emits JSON-LD. Everything
 * interactive (the two Apply buttons and the dialog they open) lives in `JobDetailView`.
 *
 * ISR at 5 minutes, matching /careers itself. A job advert changes rarely but must be able
 * to come DOWN promptly — closing a filled role and having it linger for an hour is how
 * people apply for jobs that no longer exist.
 *
 * A closed, lapsed or draft role 404s: the API refuses to serve it, and `notFound()` is the
 * honest answer for a candidate following a stale link. `generateStaticParams` pre-renders
 * the currently-live slugs; anything else renders on demand.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { PublicJobOpening } from "@repo/types";
import { buildMetadata, SITE_URL } from "../../../lib/seo/metadata";
import { buildBreadcrumbJsonLd } from "../../../lib/seo/json-ld";
import { serverApiClient } from "../../../lib/api-client";
import { JobDetailView } from "../../../components/careers/job-detail-view";

export const revalidate = 300;

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams(): Promise<Array<{ slug: string }>> {
  try {
    const openings = await serverApiClient.public.careers.listOpenings({ limit: 60 });
    return openings.map((opening) => ({ slug: opening.slug }));
  } catch {
    // Build proceeds even if the API is unreachable — every slug then renders on demand.
    return [];
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  try {
    const opening = await serverApiClient.public.careers.getOpening(slug);
    return buildMetadata({
      title: `${opening.title} — Careers at Stimuli IQ`,
      description: opening.summary,
      canonicalPath: `/careers/${opening.slug}`,
    });
  } catch {
    // A filled role should stop being indexed, not keep ranking for people who cannot apply.
    return buildMetadata({ title: "Role not found", noIndex: true });
  }
}

/**
 * schema.org JobPosting — what Google Jobs and similar aggregators read.
 *
 * Only fields we actually hold are emitted. `validThrough` is set from `closesOn` when there
 * is one; a fabricated expiry would be worse than none, since aggregators use it to decide
 * when to stop showing the listing.
 */
function buildJobPostingJsonLd(opening: PublicJobOpening): string {
  const payload: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: opening.title,
    description: [opening.summary, opening.description].filter(Boolean).join("\n\n"),
    datePosted: opening.postedAt,
    employmentType: opening.employmentType,
    hiringOrganization: {
      "@type": "Organization",
      name: "Stimuli IQ",
      sameAs: SITE_URL,
    },
    jobLocation: {
      "@type": "Place",
      address: { "@type": "PostalAddress", addressLocality: opening.location, addressCountry: "IN" },
    },
    directApply: true,
  };
  if (opening.closesOn) payload["validThrough"] = opening.closesOn;
  if (opening.department) payload["occupationalCategory"] = opening.department;
  if (opening.workMode === "remote") {
    payload["jobLocationType"] = "TELECOMMUTE";
  }
  // JSON.stringify escapes the content; the closing-tag guard stops a "</script>" inside any
  // authored field from breaking out of the script element.
  return JSON.stringify(payload).replace(/</g, "\\u003c");
}

export default async function JobOpeningPage({ params }: PageProps) {
  const { slug } = await params;

  let opening: PublicJobOpening;
  try {
    opening = await serverApiClient.public.careers.getOpening(slug);
  } catch {
    notFound();
  }

  const breadcrumbJsonLd = buildBreadcrumbJsonLd(
    [{ label: "Home", href: "/" }, { label: "Careers", href: "/careers" }, { label: opening.title }],
    SITE_URL,
  );

  return (
    <>
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: escaped JSON-LD
        dangerouslySetInnerHTML={{ __html: breadcrumbJsonLd }}
      />
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: escaped JSON-LD
        dangerouslySetInnerHTML={{ __html: buildJobPostingJsonLd(opening) }}
      />
      <JobDetailView opening={opening} />
    </>
  );
}
