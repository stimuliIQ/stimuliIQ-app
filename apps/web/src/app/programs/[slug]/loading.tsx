/**
 * Loading skeleton for the program detail page.
 * Shown by Next.js App Router while the async page component resolves.
 * Matches the 2-column layout (content + sticky buy card).
 */
import { Skeleton } from "@repo/ui";

export default function ProgramDetailLoading() {
  return (
    <main
      id="main-content"
      className="mx-auto max-w-screen-xl px-4 py-10 md:px-6"
      aria-label="Loading program details"
      aria-live="polite"
      aria-busy="true"
    >
      {/* Breadcrumb */}
      <div className="mb-6 flex items-center gap-2">
        <Skeleton className="h-4 w-12 rounded" />
        <Skeleton className="h-4 w-4 rounded" />
        <Skeleton className="h-4 w-20 rounded" />
        <Skeleton className="h-4 w-4 rounded" />
        <Skeleton className="h-4 w-48 rounded" />
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_360px]">
        {/* Left content */}
        <div className="flex flex-col gap-8">
          {/* Hero */}
          <div className="flex flex-col gap-4">
            <Skeleton className="h-10 w-3/4 rounded-md" />
            <Skeleton className="h-6 w-full rounded-md" />
            <Skeleton className="h-6 w-2/3 rounded-md" />
            <div className="flex gap-3">
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="h-5 w-24 rounded-full" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
          </div>

          {/* Curriculum placeholder */}
          <div className="flex flex-col gap-3">
            <Skeleton className="h-7 w-48 rounded-md" />
            {Array.from({ length: 5 }).map((_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: skeleton
              <Skeleton key={i} className="h-14 w-full rounded-lg" />
            ))}
          </div>
        </div>

        {/* Right rail (desktop only) */}
        <div className="hidden lg:block">
          <Skeleton className="h-80 w-full rounded-xl" />
        </div>
      </div>
    </main>
  );
}
