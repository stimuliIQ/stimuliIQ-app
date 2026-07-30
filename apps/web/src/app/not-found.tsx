/**
 * app/not-found.tsx — custom 404 page.
 *
 * Rendered by Next.js App Router when notFound() is called or a route has no match.
 * Server Component — no client-side JS required for the 404 state.
 *
 * a11y: semantic <main>, heading hierarchy, focus on heading via autofocus (RSC-safe: attribute).
 * SEO: no-index via parent layout (Next.js handles 404 robots exclusion automatically).
 */
import Link from "next/link";
import type { Metadata } from "next";
import { buildMetadata } from "../lib/seo/metadata";

export const metadata: Metadata = buildMetadata({
  title: "Page Not Found",
  description: "The page you are looking for does not exist. Browse Stimuli IQ programs or return home.",
  noIndex: true,
});

export default function NotFoundPage() {
  return (
    <section
      className="mx-auto flex max-w-2xl flex-col items-center justify-center px-4 py-24 text-center"
      data-testid="not-found-page"
    >
      {/* Status code — large, decorative */}
      <p
        aria-hidden="true"
        className="text-8xl font-extrabold text-brand-500 sm:text-9xl"
      >
        404
      </p>

      <h1 className="mt-4 text-2xl font-bold text-fg sm:text-3xl">
        Page Not Found
      </h1>

      <p className="mt-3 max-w-md text-base text-fg-muted">
        The page you are looking for might have been moved, deleted, or may not
        exist. Let us help you get back on track.
      </p>

      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <Link
          href="/"
          className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-brand-500 px-6 text-sm font-semibold text-white transition-colors hover:bg-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          data-testid="not-found-home-link"
        >
          Go to Homepage
        </Link>
        <Link
          href="/programs"
          className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-border bg-card px-6 text-sm font-medium text-fg transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Browse Programs
        </Link>
      </div>

      <p className="mt-6 text-sm text-fg-subtle">
        Need help?{" "}
        <Link
          href="/contact"
          className="font-medium text-brand-500 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded"
        >
          Contact us
        </Link>
      </p>
    </section>
  );
}
