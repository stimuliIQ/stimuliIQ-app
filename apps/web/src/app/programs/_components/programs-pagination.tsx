"use client";

/**
 * ProgramsPagination — cursor-based pagination controls for the programs listing.
 *
 * Uses the cursor from the API's meta.nextCursor to build a "Load more" link.
 * Cursor pagination is preferred over offset for the public catalog because it
 * is stable under concurrent writes (programs being published/unpublished).
 *
 * a11y:
 *  - "Load more" link has a descriptive aria-label.
 *  - Focus management: handled by the browser (link resolves to new page state).
 */
import { useSearchParams } from "next/navigation";

interface ProgramsPaginationProps {
  nextCursor: string | null;
  hasMore: boolean;
}

export function ProgramsPagination({ nextCursor, hasMore }: ProgramsPaginationProps) {
  const searchParams = useSearchParams();

  if (!hasMore || !nextCursor) return null;

  const params = new URLSearchParams(searchParams.toString());
  params.set("cursor", nextCursor);
  const nextHref = `/programs?${params.toString()}`;

  return (
    <div className="mt-10 flex justify-center" data-testid="programs-pagination">
      <a
        href={nextHref}
        aria-label="Load more programs"
        className="inline-flex min-h-[44px] items-center rounded-md border border-border px-8 text-base font-medium text-fg transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        Load more programs
      </a>
    </div>
  );
}
