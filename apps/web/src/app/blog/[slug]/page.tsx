/**
 * /blog/[slug] — Individual blog post page.
 *
 * ISR: fetched from the headless content API (`client.public.content.blog`, T32,
 * docs/plans/phase-9-completion.md) — replaces the previous in-repo MDX import.
 * `generateStaticParams` pre-renders known published slugs at build time; unknown
 * slugs are generated on-demand (ISR) and revalidated hourly.
 * JSON-LD: Article/BlogPosting + Breadcrumb (escaped via shared helper).
 * a11y: breadcrumbs, semantic article, heading hierarchy.
 *
 * `body` is raw authored HTML — rendered through `RenderSink` (@repo/ui), which
 * sanitizes via DOMPurify at the render sink (ADR-0045), never trusted raw.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Breadcrumbs, RenderSink } from "@repo/ui";
import { buildMetadata, SITE_URL } from "../../../lib/seo/metadata";
import { buildArticleJsonLd, buildBreadcrumbJsonLd } from "../../../lib/seo/json-ld";
import { serverApiClient } from "../../../lib/api-client";

export const revalidate = 3600; // ISR

// ---------------------------------------------------------------------------
// Static params (published posts, best-effort — build proceeds even if the
// API is unreachable at build time; unknown slugs render on-demand)
// ---------------------------------------------------------------------------

export async function generateStaticParams(): Promise<Array<{ slug: string }>> {
  try {
    const result = await serverApiClient.public.content.blog.list({ limit: 50 });
    return result.items.map((post) => ({ slug: post.slug }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;

  try {
    const post = await serverApiClient.public.content.blog.getBySlug(slug);
    return buildMetadata({
      title: post.seoTitle ?? post.title,
      description: post.seoDescription ?? post.excerpt ?? undefined,
      canonicalPath: `/blog/${post.slug}`,
      ogImage: post.coverImageUrl ?? undefined,
      ogType: "article",
      publishedAt: post.publishedAt ?? undefined,
      author: post.authorName ?? undefined,
    });
  } catch {
    return buildMetadata({
      title: "Post Not Found",
      noIndex: true,
    });
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function BlogPostPage({ params }: PageProps) {
  const { slug } = await params;

  let post: Awaited<ReturnType<typeof serverApiClient.public.content.blog.getBySlug>>;
  try {
    post = await serverApiClient.public.content.blog.getBySlug(slug);
  } catch {
    notFound();
  }

  const BREADCRUMBS = [
    { label: "Home", href: "/" },
    { label: "Blog", href: "/blog" },
    { label: post.title },
  ];

  const breadcrumbJsonLd = buildBreadcrumbJsonLd(BREADCRUMBS, SITE_URL);
  const articleJsonLd = buildArticleJsonLd({
    headline: post.title,
    description: post.seoDescription ?? post.excerpt ?? post.title,
    url: `${SITE_URL}/blog/${post.slug}`,
    imageUrl: post.coverImageUrl ?? undefined,
    authorName: post.authorName ?? undefined,
    publishedAt: post.publishedAt ?? new Date().toISOString(),
    type: "BlogPosting",
  });

  return (
    <>
      {/* Structured data */}
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: escaped JSON-LD
        dangerouslySetInnerHTML={{ __html: breadcrumbJsonLd }}
      />
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: escaped JSON-LD
        dangerouslySetInnerHTML={{ __html: articleJsonLd }}
      />

      <div className="mx-auto max-w-3xl px-4 py-12 sm:py-16 md:px-6">
        {/* Breadcrumbs */}
        <Breadcrumbs
          items={BREADCRUMBS}
          className="mb-8"
          data-testid="blog-post-breadcrumbs"
        />

        {/* Article header */}
        <header className="mb-10">
          {post.categoryName ? (
            <div className="mb-3 flex flex-wrap gap-2">
              <span className="inline-block rounded-full bg-brand-50 px-3 py-0.5 text-xs font-medium text-brand-600">
                {post.categoryName}
              </span>
            </div>
          ) : null}

          <h1 className="text-3xl font-bold leading-tight text-fg sm:text-4xl">
            {post.title}
          </h1>

          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-fg-muted">
            {post.authorName ? <span>By {post.authorName}</span> : null}
            {post.authorName && post.publishedAt ? <span aria-hidden="true">·</span> : null}
            {post.publishedAt ? (
              <time dateTime={post.publishedAt}>
                {new Date(post.publishedAt).toLocaleDateString("en-IN", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </time>
            ) : null}
          </div>
        </header>

        {/* Body — sanitized rich content (RenderSink applies DOMPurify at the sink) */}
        <article
          className="prose prose-lg max-w-none text-fg prose-headings:text-fg prose-a:text-brand-500 prose-a:no-underline hover:prose-a:underline"
          data-testid="blog-post-content"
        >
          <RenderSink html={post.body} data-testid="blog-post-body" />
        </article>

        {/* Back link */}
        <footer className="mt-12 border-t border-border pt-8">
          <a
            href="/blog"
            className="text-sm font-medium text-brand-500 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded"
          >
            ← Back to Blog
          </a>
        </footer>
      </div>
    </>
  );
}
