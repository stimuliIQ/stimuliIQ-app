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
