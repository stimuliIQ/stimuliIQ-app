/**
 * /testimonials — Testimonials hub.
 *
 * ISR: fetched from the headless content API (`client.public.content.testimonials`,
 * T32, docs/plans/phase-9-completion.md) — replaces the previous hardcoded array.
 * SSG + structured data + loading/empty/error states.
 */
import type { Metadata } from "next";
import { Breadcrumbs, EmptyState } from "@repo/ui";
import { buildMetadata, SITE_URL } from "../../lib/seo/metadata";
import { buildBreadcrumbJsonLd } from "../../lib/seo/json-ld";
import { serverApiClient } from "../../lib/api-client";
import type { PublicTestimonial } from "@repo/types";

export const revalidate = 3600;

export const metadata: Metadata = buildMetadata({
  title: "Student Testimonials & Success Stories",
  description:
    "Hear from StimuliiQ alumni who landed their first tech jobs. Real stories, real outcomes from students across India.",
  canonicalPath: "/testimonials",
});

const BREADCRUMBS = [
  { label: "Home", href: "/" },
  { label: "Testimonials" },
];

function renderStars(ratingTimes10: number | null): string | null {
  if (ratingTimes10 == null) return null;
  const rounded = Math.round(ratingTimes10 / 10);
  return "★".repeat(rounded) + "☆".repeat(Math.max(0, 5 - rounded));
}

export default async function TestimonialsPage() {
  let testimonials: PublicTestimonial[] = [];
  let fetchError = false;

  try {
    testimonials = await serverApiClient.public.content.testimonials.list();
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
        <Breadcrumbs items={BREADCRUMBS} className="mb-8" data-testid="testimonials-breadcrumbs" />

        <header className="mb-12">
          <h1 className="text-3xl font-bold text-fg sm:text-4xl">Student <span className="text-chart-3">Success Stories</span></h1>
          <p className="mt-3 text-lg text-fg-muted">
            Our alumni are at Freshworks, Flipkart, Razorpay, and 150+ other companies.
          </p>
        </header>

        {fetchError ? (
          <EmptyState
            title="Unable to load testimonials"
            description="We couldn't fetch student stories. Please refresh or try again later."
            data-testid="testimonials-error"
          />
        ) : testimonials.length === 0 ? (
          <EmptyState
            title="No testimonials yet"
            description="Check back soon for student success stories."
            data-testid="testimonials-empty"
          />
        ) : (
          <ul className="grid gap-6 md:grid-cols-2 lg:grid-cols-3" role="list" data-testid="testimonials-list">
            {testimonials.map((t) => {
              const stars = renderStars(t.rating);
              return (
                <li key={t.id}>
                  <blockquote className="flex h-full flex-col rounded-xl border border-border bg-card p-6">
                    <p className="flex-1 text-sm text-fg-muted leading-relaxed">
                      &ldquo;{t.quote}&rdquo;
                    </p>
                    <footer className="mt-6 flex items-center gap-3 border-t border-border pt-4">
                      {t.studentPhotoUrl ? (
                        <img
                          src={t.studentPhotoUrl}
                          alt=""
                          aria-hidden="true"
                          className="size-10 shrink-0 rounded-full object-cover"
                          loading="lazy"
                        />
                      ) : null}
                      <div>
                        <p className="font-semibold text-fg">{t.studentName}</p>
                        {stars ? (
                          <p aria-label={`Rated ${(t.rating ?? 0) / 10} out of 5`} className="text-warning text-sm">
                            {stars}
                          </p>
                        ) : null}
                      </div>
                    </footer>
                  </blockquote>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
