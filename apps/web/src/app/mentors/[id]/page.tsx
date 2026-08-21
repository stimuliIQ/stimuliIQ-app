/**
 * /mentors/[id] — public mentor detail page (black & white take on the
 * reference "Mentor Details" layout).
 *
 * Layout: breadcrumbs → two-column hero (photo card + social links on the
 * left; name, headline, at-a-glance facts, biography, and expertise on the
 * right) → closing CTA.
 *
 * Data: bound to the CRM via GET /public/mentors/:id (active mentors only,
 * safe public projection — same fields as the /mentors grid). A
 * prospective/inactive/deleted/unknown id → 404 (notFound). Every value shown
 * is real CRM data; sections with no data (e.g. no expertise) are omitted
 * rather than filled with placeholder copy.
 *
 * ISR: revalidates hourly (CRM edits surface within the hour). SEO: per-mentor
 * metadata + Breadcrumb JSON-LD.
 */
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import type { PublicMentorCard } from "@repo/types";
import { buildMetadata, SITE_URL } from "../../../lib/seo/metadata";
import { buildBreadcrumbJsonLd } from "../../../lib/seo/json-ld";
import { serverApiClient } from "../../../lib/api-client";
import { BOOK_SLOT_HREF } from "../../../components/shell/nav-config";

export const revalidate = 3600; // ISR: CRM changes surface within the hour

interface PageProps {
  params: Promise<{ id: string }>;
}

// ---------------------------------------------------------------------------
// Inline social icons (lucide-react is not a web dependency — mirrors mentors-grid)
// ---------------------------------------------------------------------------

const SOCIAL_ICONS: Record<"linkedin" | "twitter" | "github" | "website", { label: string; path: ReactNode }> = {
  linkedin: {
    label: "LinkedIn",
    path: <path d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5ZM3 9h4v12H3V9Zm6 0h3.8v1.7h.05c.53-1 1.83-2.05 3.77-2.05 4.03 0 4.78 2.65 4.78 6.1V21h-4v-5.4c0-1.29-.02-2.95-1.8-2.95-1.8 0-2.08 1.4-2.08 2.85V21H9V9Z" />,
  },
  twitter: {
    label: "X",
    path: <path d="M18.244 2H21.5l-7.5 8.57L22.5 22h-6.9l-4.6-6.02L5.7 22H2.44l8.02-9.17L1.5 2h7.06l4.16 5.5L18.244 2Zm-1.21 18h1.8L7.04 3.9H5.1L17.03 20Z" />,
  },
  github: {
    label: "GitHub",
    path: <path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.89 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.56 9.56 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2Z" />,
  },
  website: {
    label: "Website",
    path: (
      <>
        <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M2 12h20M12 2c2.5 2.5 3.8 6 3.8 10S14.5 19.5 12 22c-2.5-2.5-3.8-6-3.8-10S9.5 4.5 12 2Z" fill="none" stroke="currentColor" strokeWidth="2" />
      </>
    ),
  },
};

function initialsOf(fullName: string): string {
  return fullName
    .split(/\s+/)
    .filter((part) => /^[a-z]/i.test(part))
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  try {
    const mentor = await serverApiClient.public.mentors.get(id);
    const role = mentor.title ?? mentor.expertise[0] ?? "Industry Mentor";
    return buildMetadata({
      title: `${mentor.fullName} | ${role}`,
      description:
        mentor.bio ??
        `${mentor.fullName} is a mentor at Stimuli IQ, hired from ${mentor.externalInstitute}. Learn from active industry experts on project-based internship programs.`,
      canonicalPath: `/mentors/${id}`,
    });
  } catch {
    return buildMetadata({ title: "Mentor", canonicalPath: `/mentors/${id}` });
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function MentorDetailPage({ params }: PageProps) {
  const { id } = await params;

  let mentor: PublicMentorCard;
  try {
    mentor = await serverApiClient.public.mentors.get(id);
  } catch {
    notFound();
  }
  if (!mentor) notFound();

  const role = mentor.title ?? mentor.expertise[0] ?? "Industry Mentor";
  const breadcrumbs = [
    { label: "Home", href: "/" },
    { label: "Mentors", href: "/mentors" },
    { label: mentor.fullName },
  ];
  const breadcrumbJsonLd = buildBreadcrumbJsonLd(breadcrumbs, SITE_URL);

  const socialKeys = mentor.socialLinks
    ? (Object.keys(SOCIAL_ICONS) as Array<keyof typeof SOCIAL_ICONS>).filter((k) => mentor.socialLinks?.[k])
    : [];

  // "At a glance" facts — only the ones we actually hold.
  const facts: { label: string; value: string }[] = [
    { label: "Institute", value: mentor.externalInstitute },
    ...(typeof mentor.yearsExperience === "number"
      ? [{ label: "Experience", value: `${mentor.yearsExperience}+ years` }]
      : []),
    ...(mentor.expertise.length > 0
      ? [{ label: "Specialty", value: mentor.expertise.join(", ") }]
      : []),
  ];

  return (
    <>
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: escaped JSON-LD
        dangerouslySetInnerHTML={{ __html: breadcrumbJsonLd }}
      />

      <div className="mx-auto max-w-screen-xl px-4 pt-10 md:px-6">
        {/* Splits at md with a 16rem photo rail (20rem from lg). Stacked, the square photo
            ran the full tablet width — ~780px of portrait before the name even appeared. */}
        <div className="grid grid-cols-1 gap-10 pb-16 md:grid-cols-[minmax(0,16rem)_1fr] md:gap-10 lg:grid-cols-[minmax(0,20rem)_1fr] lg:gap-16 lg:pb-24">
          {/* ── Left: photo + socials ── */}
          <div className="md:sticky md:top-24 md:self-start">
            <div className="aspect-square w-full overflow-hidden rounded-2xl bg-surface">
              {mentor.photoUrl ? (
                // plain <img>: remote CDN host, avoids next/image remotePatterns config.
                <img
                  src={mentor.photoUrl}
                  alt={mentor.fullName}
                  className="size-full object-cover"
                  data-testid="mentor-detail-photo"
                />
              ) : (
                <div className="flex size-full items-center justify-center">
                  <span aria-hidden="true" className="font-display text-6xl font-bold text-fg-subtle">
                    {initialsOf(mentor.fullName) || "M"}
                  </span>
                </div>
              )}
            </div>

            {socialKeys.length > 0 ? (
              <div className="mt-5 flex justify-center gap-3" data-testid="mentor-detail-socials">
                {socialKeys.map((key) => (
                  <a
                    key={key}
                    href={mentor.socialLinks![key]}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`${mentor.fullName} on ${SOCIAL_ICONS[key].label}`}
                    className="flex h-10 w-10 items-center justify-center rounded-full border border-border text-fg-muted transition-colors hover:border-fg hover:bg-fg hover:text-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4" aria-hidden="true">
                      {SOCIAL_ICONS[key].path}
                    </svg>
                  </a>
                ))}
              </div>
            ) : null}
          </div>

          {/* ── Right: identity + biography + expertise ── */}
          <div>
            <h1 className="font-display text-4xl font-bold tracking-tight text-fg sm:text-5xl">
              {mentor.fullName}
            </h1>
            <p className="mt-2 text-lg text-fg-muted">{role}</p>

            {/* At a glance */}
            <dl className="mt-8 grid grid-cols-1 gap-x-8 gap-y-4 border-y border-border py-6 sm:grid-cols-2">
              {facts.map((fact) => (
                <div key={fact.label}>
                  <dt className="text-xs font-semibold uppercase tracking-wider text-fg-subtle">{fact.label}</dt>
                  <dd className="mt-1 text-sm text-fg">{fact.value}</dd>
                </div>
              ))}
            </dl>

            {/* Biography */}
            <section aria-label="Biography" className="mt-10">
              <h2 className="font-display text-2xl font-bold text-fg">Biography</h2>
              <p className="mt-3 whitespace-pre-line text-base leading-relaxed text-fg-muted">
                {mentor.bio
                  ? mentor.bio
                  : `${mentor.fullName} is an industry mentor hired from ${mentor.externalInstitute}, guiding Stimuli IQ students through hands-on, project-based internship training.`}
              </p>
            </section>

            {/* Expertise */}
            {mentor.expertise.length > 0 ? (
              <section aria-label="Expertise" className="mt-10">
                <h2 className="font-display text-2xl font-bold text-fg">Expertise</h2>
                <ul className="mt-4 flex flex-wrap gap-2" role="list">
                  {mentor.expertise.map((skill) => (
                    <li
                      key={skill}
                      className="rounded-full border border-border bg-card px-4 py-1.5 text-sm font-medium text-fg"
                    >
                      {skill}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {/* CTA */}
            <div className="mt-12 flex flex-wrap gap-3">
              <a
                href="/programs"
                className="inline-flex min-h-[48px] items-center justify-center rounded-full bg-brand-500 px-8 text-sm font-semibold text-white transition-colors hover:bg-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                Explore programs
              </a>
              <a
                href={BOOK_SLOT_HREF}
                className="inline-flex min-h-[48px] items-center justify-center rounded-full border border-fg px-8 text-sm font-semibold text-fg transition-colors hover:bg-fg hover:text-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                Book a free slot
              </a>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
