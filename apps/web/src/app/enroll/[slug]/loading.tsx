/**
 * Loading skeleton for the enroll page.
 * Shown while the RSC fetches the program data.
 */
export default function EnrollLoading() {
  return (
    <main
      className="mx-auto max-w-lg px-4 pb-16 pt-8 md:pt-12"
      aria-busy="true"
      aria-label="Loading enrollment page"
    >
      {/* Breadcrumb skeleton */}
      <div className="mb-6 flex gap-2">
        {[60, 80, 120, 60].map((w, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders
          <div key={i} className="flex items-center gap-2">
            <div className={`h-4 w-${w/4} animate-pulse rounded bg-surface`} />
            {i < 3 ? <span className="text-fg-subtle">/</span> : null}
          </div>
        ))}
      </div>

      {/* Heading skeleton */}
      <div className="mb-8 flex flex-col gap-3">
        <div className="h-7 w-3/4 animate-pulse rounded bg-surface" />
        <div className="h-4 w-full animate-pulse rounded bg-surface" />
        <div className="h-6 w-1/3 animate-pulse rounded bg-surface" />
      </div>

      {/* Form skeleton */}
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm md:p-8">
        <div className="flex flex-col gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex flex-col gap-1.5">
              <div className="h-4 w-1/4 animate-pulse rounded bg-surface" />
              <div className="h-11 w-full animate-pulse rounded bg-surface" />
            </div>
          ))}
          <div className="h-11 w-full animate-pulse rounded bg-brand-100" />
        </div>
      </div>
    </main>
  );
}
