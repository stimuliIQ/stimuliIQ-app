// loading.tsx — Next.js Suspense boundary for the verify route.
// Shown while the RSC page is streaming / fetching data.
// Uses the same skeleton shape as VerifyPanel to prevent layout shift.
// (CLAUDE.md §4 DoD: "Loading / empty / error states implemented for every async UI")

import { VerifyPageSkeleton } from "../../../components/verify/verify-skeleton";

export default function VerifyLoading() {
  return (
    <main id="main-content" className="mx-auto max-w-xl px-4 py-12 sm:py-16">
      <header className="mb-10 text-center">
        <div className="mx-auto mb-2 h-3.5 w-24 animate-pulse rounded bg-surface" aria-hidden="true" />
        <div className="mx-auto h-8 w-64 animate-pulse rounded bg-surface" aria-hidden="true" />
        <div className="mx-auto mt-2 h-4 w-80 animate-pulse rounded bg-surface" aria-hidden="true" />
      </header>
      <VerifyPageSkeleton />
    </main>
  );
}
