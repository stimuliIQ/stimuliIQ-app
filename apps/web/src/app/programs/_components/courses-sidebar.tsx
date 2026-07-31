"use client";

/**
 * CoursesSidebar — left filter rail for the courses listing (/programs),
 * following the reference catalog layout: "Apply Filters (N courses)" header,
 * course-name search, a "Specialisation" checkbox list (All Courses + one per
 * domain from the live catalog), and a sort select.
 *
 * All changes update the URL search params (router.push) so the RSC page
 * re-renders server-side — the listing stays SSR-indexable (AC-24/AC-31),
 * e.g. /programs?domain=Python is a crawlable SEO page.
 *
 * Specialisation checkboxes are single-select (checking one replaces the
 * current selection; "All Courses" clears it) — the public API filters by one
 * domain at a time. No business logic here — URL state management only.
 *
 * a11y: role="search" landmark, visible labels, native checkboxes/inputs,
 * ≥44px touch rows, SR live region announcing the result count.
 */
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";

import type { CourseDomainFacet } from "../../../lib/course-facets";

export interface CoursesFilterState {
  q?: string;
  domain?: string;
  sort?: string;
}

const SORT_OPTIONS = [
  { value: "order", label: "Featured" },
  { value: "popularity", label: "Most popular" },
  { value: "price_asc", label: "Price: Low to high" },
  { value: "price_desc", label: "Price: High to low" },
  { value: "newest", label: "Newest" },
];

interface CoursesSidebarProps {
  domains: CourseDomainFacet[];
  current: CoursesFilterState;
  /** Count shown in the header; hasMore appends a "+" (page count, not total). */
  totalCount?: number;
  hasMore?: boolean;
}

export function CoursesSidebar({ domains, current, totalCount, hasMore }: CoursesSidebarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [searchText, setSearchText] = useState(current.q ?? "");

  const updateParams = useCallback(
    (patch: Record<string, string | undefined>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value) {
          params.set(key, value);
        } else {
          params.delete(key);
        }
      }
      // Any filter change restarts pagination.
      params.delete("cursor");
      const qs = params.toString();
      router.push(qs ? `/programs?${qs}` : "/programs");
    },
    [router, searchParams],
  );

  const checkboxRow =
    "flex min-h-[44px] cursor-pointer items-center gap-3 text-sm text-fg " +
    "hover:text-brand-600";

  return (
    <div
      role="search"
      aria-label="Filter and sort courses"
      // Below lg the listing page stacks this rail above the results, where it is the full
      // page width — as a vertical stack that cost ~470px of tablet screen before the first
      // course card. At md the three controls lay out as one row; at lg it is a rail again.
      className="flex flex-col gap-6 md:grid md:grid-cols-3 md:items-start md:gap-x-8 lg:flex lg:flex-col"
      data-testid="courses-sidebar"
    >
      {/* Header + count */}
      <div className="flex items-baseline justify-between gap-2 md:col-span-3 lg:col-span-1">
        <h2 className="text-lg font-bold text-fg">Apply Filters</h2>
        {totalCount != null ? (
          <span className="text-sm text-fg-muted" data-testid="courses-count">
            ({totalCount}
            {hasMore ? "+" : ""} course{totalCount === 1 && !hasMore ? "" : "s"})
          </span>
        ) : null}
      </div>

      {/* Search */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          updateParams({ q: searchText.trim() || undefined });
        }}
        className="flex flex-col gap-2"
      >
        <label htmlFor="courses-search" className="sr-only">
          Search course name
        </label>
        <div className="flex gap-2">
          <input
            id="courses-search"
            type="search"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Search course name…"
            className="h-[44px] w-full min-w-0 rounded-md border border-border bg-surface px-3 text-sm text-fg placeholder:text-fg-subtle transition-colors hover:border-brand-500 focus:outline-none focus:ring-2 focus:ring-ring"
            data-testid="courses-search-input"
          />
          <button
            type="submit"
            className="inline-flex h-[44px] shrink-0 items-center rounded-md bg-brand-500 px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            data-testid="courses-search-submit"
          >
            Go
          </button>
        </div>
        {current.q ? (
          <button
            type="button"
            onClick={() => {
              setSearchText("");
              updateParams({ q: undefined });
            }}
            className="self-start text-sm text-brand-500 underline hover:text-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="courses-search-clear"
          >
            Clear search “{current.q}”
          </button>
        ) : null}
      </form>

      {/* Specialisation */}
      <fieldset className="flex flex-col">
        <legend className="pb-2 text-base font-semibold text-fg">Specialisation</legend>
        <label className={checkboxRow}>
          <input
            type="checkbox"
            checked={!current.domain}
            onChange={() => updateParams({ domain: undefined })}
            className="h-4 w-4 accent-brand-500"
            aria-label="All Courses"
            data-testid="courses-filter-all"
          />
          All Courses
        </label>
        {domains.map((d) => (
          <label key={d.value} className={checkboxRow}>
            <input
              type="checkbox"
              checked={current.domain === d.value}
              onChange={(e) =>
                updateParams({ domain: e.target.checked ? d.value : undefined })
              }
              className="h-4 w-4 accent-brand-500"
              aria-label={`Filter by ${d.label}`}
            />
            {d.label}
          </label>
        ))}
      </fieldset>

      {/* Sort */}
      <div className="flex flex-col gap-1">
        <label htmlFor="courses-sort" className="text-base font-semibold text-fg">
          Sort by
        </label>
        <select
          id="courses-sort"
          value={current.sort ?? "order"}
          onChange={(e) => updateParams({ sort: e.target.value })}
          aria-label="Sort courses"
          className="h-[44px] w-full rounded-md border border-border bg-card px-3 text-sm text-fg transition-colors hover:border-brand-500 focus:outline-none focus:ring-2 focus:ring-ring"
          data-testid="courses-sort"
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Result count (SR live region) */}
      {totalCount != null ? (
        <div aria-live="polite" aria-atomic="true" className="sr-only">
          {`${totalCount} course${totalCount === 1 ? "" : "s"} found`}
        </div>
      ) : null}
    </div>
  );
}
