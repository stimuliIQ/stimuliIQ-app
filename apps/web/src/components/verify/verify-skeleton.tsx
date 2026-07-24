// VerifyPageSkeleton — loading placeholder matching the VerifyPanel layout.
// Rendered by both loading.tsx (Next.js stream) and the Suspense fallback.
// No content text — screen readers will use the loading.tsx aria-label context.
// Uses Tailwind's animate-pulse (respects prefers-reduced-motion via the preset).

export function VerifyPageSkeleton() {
  return (
    <div
      className="flex flex-col items-center gap-8"
      role="status"
      aria-label="Loading certificate verification result"
      data-testid="verify-skeleton"
    >
      {/* Status badge placeholder */}
      <div className="flex w-full max-w-sm flex-col items-center gap-3 rounded-2xl border border-border px-8 py-6">
        <div className="size-12 animate-pulse rounded-full bg-surface" aria-hidden="true" />
        <div className="h-5 w-40 animate-pulse rounded bg-surface" aria-hidden="true" />
        <div className="h-4 w-56 animate-pulse rounded bg-surface" aria-hidden="true" />
      </div>

      {/* Detail rows placeholder */}
      <div className="w-full max-w-sm divide-y divide-border rounded-lg border border-border bg-card">
        {[1, 2, 3].map((n) => (
          <div key={n} className="flex items-start gap-3 px-4 py-3">
            <div className="mt-0.5 size-4 shrink-0 animate-pulse rounded bg-surface" aria-hidden="true" />
            <div className="flex flex-1 flex-col gap-1.5">
              <div className="h-3 w-16 animate-pulse rounded bg-surface" aria-hidden="true" />
              <div className="h-4 w-32 animate-pulse rounded bg-surface" aria-hidden="true" />
            </div>
          </div>
        ))}
      </div>

      <span className="sr-only">Loading certificate details…</span>
    </div>
  );
}
