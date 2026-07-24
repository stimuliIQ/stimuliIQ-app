/**
 * /faculty — Faculty index page.
 *
 * ISR: fetched from the headless content API (`client.public.content.facultyBios`,
 * T32, docs/plans/phase-9-completion.md) — replaces the previous hardcoded array.
 * SSG + structured data.
 */
import type { Metadata } from "next";
import { Breadcrumbs, EmptyState } from "@repo/ui";
import { buildMetadata, SITE_URL } from "../../lib/seo/metadata";
import { buildBreadcrumbJsonLd } from "../../lib/seo/json-ld";
import { serverApiClient } from "../../lib/api-client";
import type { PublicFacultyBio } from "@repo/types";

export const revalidate = 3600;

export const metadata: Metadata = buildMetadata({
  title: "Our Faculty & Mentors",
  description:
    "Learn from industry-experienced mentors at StimuliiQ. Our faculty includes engineers from top product companies and data scientists with years of real-world experience.",
  canonicalPath: "/faculty",
});

const BREADCRUMBS = [
  { label: "Home", href: "/" },
  { label: "Faculty" },
];

export default async function FacultyPage() {
  let faculty: PublicFacultyBio[] = [];
  let fetchError = false;

  try {
    faculty = await serverApiClient.public.content.facultyBios.list();
  } catch {
    fetchError = true;
  }

  const breadcrumbJsonLd = buildBreadcrumbJsonLd(BREADCRUMBS, SITE_URL);

  return (
    <>
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: escaped JSON-LD
        dangerouslySetInnerHTML={{ __html: breadcrumbJsonLd }}
      />

      <div className="mx-auto max-w-5xl px-4 py-12 sm:py-16 md:px-6">
        <Breadcrumbs items={BREADCRUMBS} className="mb-8" data-testid="faculty-breadcrumbs" />

        <header className="mb-12">
          <h1 className="text-3xl font-bold text-fg sm:text-4xl">Our <span className="text-chart-3">Faculty &amp; Mentors</span></h1>
          <p className="mt-3 text-lg text-fg-muted">
            Learn from engineers and data scientists with real industry experience.
          </p>
        </header>

        {fetchError ? (
          <EmptyState
            title="Unable to load faculty"
            description="We couldn't fetch faculty profiles. Please refresh or try again later."
            data-testid="faculty-error"
          />
        ) : faculty.length === 0 ? (
          <EmptyState
            title="No faculty profiles yet"
            description="Faculty bios will appear here once published."
            data-testid="faculty-empty"
          />
        ) : (
          <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3" role="list" data-testid="faculty-list">
            {faculty.map((person) => (
              <li key={person.id}>
                <article className="rounded-xl border border-border bg-card p-6">
                  {/* Avatar */}
                  {person.photoUrl ? (
                    <img
                      src={person.photoUrl}
                      alt={`${person.name} — mentor`}
                      className="mb-4 size-14 rounded-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div
                      aria-hidden="true"
                      className="mb-4 flex size-14 items-center justify-center rounded-full bg-brand-100 text-xl font-bold text-brand-600"
                    >
                      {person.name.charAt(0)}
                    </div>
                  )}
                  <h2 className="text-base font-semibold text-fg">{person.name}</h2>
                  {person.title ? <p className="mt-0.5 text-sm text-brand-500">{person.title}</p> : null}
                  <p className="mt-3 text-sm text-fg-muted leading-relaxed">{person.bio}</p>
                  {person.socialLinks?.linkedin ? (
                    <a
                      href={person.socialLinks.linkedin}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-3 inline-block text-xs font-medium text-brand-500 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      LinkedIn profile →
                    </a>
                  ) : null}
                </article>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
