// VerifyPageSkeleton — loading placeholder matching the VerifyPanel layout.
// Rendered by both loading.tsx (Next.js stream) and the Suspense fallback.
// Mirrors the real panel's two-column (md+) seal-beside-details grid so the page
// does not jump when the result arrives.
// No content text — screen readers will use the loading.tsx aria-label context.
// Uses Tailwind's animate-pulse (respects prefers-reduced-motion via the preset).

export function VerifyPageSkeleton() {
  return (
    <div
      className="grid w-full items-stretch gap-5 md:grid-cols-2"
      role="status"
      aria-label="Loading certificate verification result"
      data-testid="verify-skeleton"
    >
      {/* Status seal placeholder */}
      <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-border px-6 py-10">
        <div className="size-20 animate-pulse rounded-full bg-surface" aria-hidden="true" />
        <div className="h-6 w-44 animate-pulse rounded bg-surface" aria-hidden="true" />
        <div className="h-5 w-16 animate-pulse rounded-full bg-surface" aria-hidden="true" />
        <div className="h-4 w-52 animate-pulse rounded bg-surface" aria-hidden="true" />
      </div>

      {/* Detail card placeholder */}
      <div className="w-full rounded-lg border border-border bg-card">
        <div className="border-b border-border px-5 py-3">
          <div className="h-3 w-28 animate-pulse rounded bg-surface" aria-hidden="true" />
        </div>
        <div className="divide-y divide-border">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="flex items-start gap-3 px-5 py-3.5">
              <div className="mt-0.5 size-4 shrink-0 animate-pulse rounded bg-surface" aria-hidden="true" />
              <div className="flex flex-1 flex-col gap-1.5">
                <div className="h-3 w-16 animate-pulse rounded bg-surface" aria-hidden="true" />
                <div className="h-4 w-32 animate-pulse rounded bg-surface" aria-hidden="true" />
              </div>
            </div>
          ))}
        </div>
      </div>

      <span className="sr-only">Loading certificate details…</span>
    </div>
  );
}
