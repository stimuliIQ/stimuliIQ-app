/**
 * /blog — Blog listing page (black & white redesign).
 *
 * Layout: centered editorial header → featured (latest) post as a large
 * spotlight card → 3-column grid of remaining posts → newsletter band.
 *
 * SSG/ISR: fetched from the headless content API (`client.public.content.blog`,
 * T32, docs/plans/phase-9-completion.md) and revalidated hourly.
 * Posts arrive sorted by publish date descending (server-ordered).
 * SEO: per-page metadata + Breadcrumb JSON-LD.
 * loading/empty/error states: server component — ISR pre-renders, so no
 * loading state needed; empty/error handled inline below (testids preserved:
 * blog-post-list / blog-empty / blog-error).
 */
import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs, EmptyState } from "@repo/ui";
import { buildMetadata, SITE_URL } from "../../lib/seo/metadata";
import { buildBreadcrumbJsonLd } from "../../lib/seo/json-ld";
import { serverApiClient } from "../../lib/api-client";
import type { PublicBlogPostSummary } from "@repo/types";

export const revalidate = 3600; // ISR: revalidate every hour

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

export const metadata: Metadata = buildMetadata({
  title: "Blog — Career & Tech Insights for Students",
  description:
    "Career tips, tech tutorials, and internship guides for B.Tech, MCA, and MBA students from StimuliiQ mentors.",
  canonicalPath: "/blog",
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BREADCRUMBS = [{ label: "Home", href: "/" }, { label: "Blog" }];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function ArrowRightIcon() {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4 transition-transform duration-fast group-hover:translate-x-0.5"
    >
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

/** Featured (latest) post — large spotlight card. */
function FeaturedPostCard({ post }: { post: PublicBlogPostSummary }) {
  return (
    <article className="group relative flex flex-col justify-between gap-8 rounded-2xl bg-card p-8 shadow-sm transition-shadow motion-safe:hover:shadow-md md:p-12 lg:flex-row lg:items-end">
      <div className="max-w-2xl">
        <p className="flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.14em] text-fg-muted">
          <span className="rounded-full border border-border px-3 py-1 text-fg">
            Latest
          </span>
          {post.categoryName ? <span>{post.categoryName}</span> : null}
        </p>
        <h2 className="mt-5 font-display text-2xl font-bold leading-tight tracking-tight text-fg md:text-4xl">
          <Link
            href={`/blog/${post.slug}`}
            className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:rounded after:absolute after:inset-0"
          >
            {post.title}
          </Link>
        </h2>
        {post.excerpt ? (
          <p className="mt-4 text-base leading-relaxed text-fg-muted md:text-lg">
            {post.excerpt}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-4">
        {post.publishedAt ? (
          <span className="text-sm text-fg-subtle">{formatDate(post.publishedAt)}</span>
        ) : null}
        <span
          aria-hidden="true"
          className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-500 text-white"
        >
          <ArrowRightIcon />
        </span>
      </div>
    </article>
  );
}

/** Standard grid card. */
function PostCard({ post }: { post: PublicBlogPostSummary }) {
  return (
    <article className="group relative flex h-full flex-col rounded-2xl bg-card p-7 shadow-sm transition-shadow motion-safe:hover:shadow-md">
      {post.categoryName ? (
        <p className="mb-4 text-xs font-semibold uppercase tracking-[0.14em] text-fg-muted">
          {post.categoryName}
        </p>
      ) : null}

      <h2 className="text-lg font-bold leading-snug text-fg">
        <Link
          href={`/blog/${post.slug}`}
          className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:rounded after:absolute after:inset-0"
        >
          {post.title}
        </Link>
      </h2>

      {post.excerpt ? (
        <p className="mt-3 flex-1 text-sm leading-relaxed text-fg-muted line-clamp-3">
          {post.excerpt}
        </p>
      ) : (
        <span className="flex-1" />
      )}

      <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
        {post.publishedAt ? (
          <span className="text-xs text-fg-subtle">{formatDate(post.publishedAt)}</span>
        ) : (
          <span />
        )}
        <span
          aria-hidden="true"
          className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-fg"
        >
          Read
          <ArrowRightIcon />
        </span>
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function BlogListingPage() {
  let posts: PublicBlogPostSummary[] = [];
  let fetchError = false;

  try {
    const result = await serverApiClient.public.content.blog.list({ limit: 50 });
    posts = Array.isArray(result.items) ? result.items : [];
  } catch {
    fetchError = true;
  }

  const [featured, ...rest] = posts;
  const breadcrumbJsonLd = buildBreadcrumbJsonLd(BREADCRUMBS, SITE_URL);

  return (
    <>
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: escaped JSON-LD
        dangerouslySetInnerHTML={{ __html: breadcrumbJsonLd }}
      />

      <div className="mx-auto max-w-screen-xl px-4 pt-10 md:px-6">
        <Breadcrumbs items={BREADCRUMBS} className="mb-10" data-testid="blog-breadcrumbs" />

        {/* Editorial header */}
        <header className="mx-auto max-w-2xl pb-12 text-center lg:pb-16">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-fg-muted">
            The StimuliiQ Blog
          </p>
          <h1 className="mt-6 font-display text-4xl font-bold leading-[1.08] tracking-tight text-fg sm:text-5xl">
            Insights for your <span className="text-chart-3">career</span>.
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-fg-muted">
            Career tips, tech tutorials, and internship guides — written by the
            mentors who teach our programs.
          </p>
        </header>
      </div>

      {/* Posts — light-grey band for card contrast */}
      <div className="border-t border-border bg-surface py-14 lg:py-16">
        <div className="mx-auto max-w-screen-xl px-4 md:px-6">
          {fetchError ? (
            <EmptyState
              title="Unable to load blog posts"
              description="We couldn't fetch the latest articles. Please refresh or try again later."
              data-testid="blog-error"
            />
          ) : posts.length === 0 ? (
            <EmptyState
              title="No posts yet"
              description="Check back soon for articles from our mentors."
              data-testid="blog-empty"
            />
          ) : (
            <div className="flex flex-col gap-6" data-testid="blog-post-list">
              {featured ? <FeaturedPostCard post={featured} /> : null}

              {rest.length > 0 ? (
                <ul role="list" className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                  {rest.map((post) => (
                    <li key={post.id}>
                      <PostCard post={post} />
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          )}
        </div>
      </div>

      {/* Newsletter capture: the sitewide dark NewsletterBand (SiteShell) renders
          directly below this page — no page-local form needed. */}
    </>
  );
}
