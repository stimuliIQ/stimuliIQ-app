"use client";

/**
 * SearchPageClient — global search UI (T33, docs/plans/phase-9-completion.md).
 *
 * Consumes `client.public.search.search()` (composed client-side over
 * public.programs + public.content.blog — see @repo/api-client/src/public/search.api.ts
 * for the documented composition/limitation). Search input + type/filter facets +
 * result list, synced to the `?q=`/`?types=` URL so results are shareable/bookmarkable.
 *
 * States: idle (no query yet), loading, empty (no results), error — all handled.
 * a11y: labelled search input, results announced via aria-live, facet toggles are
 * a labelled `role="group"` of pressed buttons.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { EmptyState, Skeleton } from "@repo/ui";
import { apiClient } from "../../../lib/api-client";
import type { PublicSearchResultType } from "@repo/types";

const TYPE_LABELS: Record<PublicSearchResultType, string> = {
  program: "Programs",
  blog_post: "Blog posts",
};

const ALL_TYPES: PublicSearchResultType[] = ["program", "blog_post"];

export function SearchPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const initialQuery = searchParams.get("q") ?? "";
  const initialTypesParam = searchParams.get("types");
  const initialTypes = initialTypesParam
    ? (initialTypesParam.split(",").filter((t): t is PublicSearchResultType =>
        ALL_TYPES.includes(t as PublicSearchResultType),
      ) as PublicSearchResultType[])
    : ALL_TYPES;

  const [inputValue, setInputValue] = useState(initialQuery);
  const [activeTypes, setActiveTypes] = useState<PublicSearchResultType[]>(
    initialTypes.length > 0 ? initialTypes : ALL_TYPES,
  );

  const submittedQuery = searchParams.get("q") ?? "";

  const syncUrl = useCallback(
    (q: string, types: PublicSearchResultType[]) => {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (types.length > 0 && types.length < ALL_TYPES.length) {
        params.set("types", types.join(","));
      }
      const qs = params.toString();
      router.push(qs ? `/search?${qs}` : "/search");
    },
    [router],
  );

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    syncUrl(inputValue, activeTypes);
  }

  function toggleType(type: PublicSearchResultType) {
    setActiveTypes((prev) => {
      const next = prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type];
      const resolved = next.length === 0 ? ALL_TYPES : next;
      syncUrl(inputValue, resolved);
      return resolved;
    });
  }

  // Keep the input in sync if the URL changes externally (e.g. back/forward nav).
  useEffect(() => {
    setInputValue(initialQuery);
  }, [initialQuery]);

  const typesParam = activeTypes.length < ALL_TYPES.length ? activeTypes.join(",") : undefined;

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["public-search", submittedQuery, typesParam],
    queryFn: () => apiClient.public.search.search({ q: submittedQuery, types: typesParam, limit: 20 }),
    enabled: submittedQuery.trim().length > 0,
  });

  const hasQuery = submittedQuery.trim().length > 0;
  const results = data?.results ?? [];

  return (
    <div className="flex flex-col gap-8">
      {/* Search input */}
      <form onSubmit={handleSubmit} role="search" className="flex flex-col gap-4">
        <label htmlFor="site-search-input" className="sr-only">
          Search programs and articles
        </label>
        <div className="flex gap-2">
          <input
            id="site-search-input"
            type="search"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Search programs, blog articles..."
            autoFocus
            className="h-12 w-full rounded-md border border-border bg-bg px-4 text-base text-fg placeholder:text-fg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            data-testid="search-input"
          />
          <button
            type="submit"
            className="h-12 shrink-0 rounded-md bg-brand-500 px-6 text-sm font-semibold text-white transition-colors hover:bg-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            data-testid="search-submit"
          >
            Search
          </button>
        </div>

        {/* Type facets */}
        <div role="group" aria-label="Filter by content type" className="flex flex-wrap gap-2">
          {ALL_TYPES.map((type) => {
            const pressed = activeTypes.includes(type);
            return (
              <button
                key={type}
                type="button"
                onClick={() => toggleType(type)}
                aria-pressed={pressed}
                className={[
                  "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  pressed
                    ? "border-brand-500 bg-brand-50 text-brand-700"
                    : "border-border text-fg-muted hover:bg-surface",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                ].join(" ")}
                data-testid={`search-filter-${type}`}
              >
                {TYPE_LABELS[type]}
              </button>
            );
          })}
        </div>
      </form>

      {/* Results */}
      <div aria-live="polite" data-testid="search-results-region">
        {!hasQuery ? (
          <EmptyState
            title="Search StimuliiQ"
            description="Find programs, blog articles, and more. Try 'Python', 'full stack', or 'internship'."
            data-testid="search-idle"
          />
        ) : isLoading ? (
          <div className="flex flex-col gap-3" aria-busy="true" aria-label="Searching" data-testid="search-loading">
            <Skeleton shape="line" />
            <Skeleton shape="line" />
            <Skeleton shape="line" className="w-2/3" />
          </div>
        ) : isError ? (
          <EmptyState
            title="Search failed"
            description="We couldn't complete your search. Please try again."
            action={
              <button
                type="button"
                onClick={() => refetch()}
                className="inline-flex min-h-[40px] items-center rounded-md bg-brand-500 px-5 text-sm font-semibold text-white hover:bg-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                Retry
              </button>
            }
            data-testid="search-error"
          />
        ) : results.length === 0 ? (
          <EmptyState
            title={`No results for "${submittedQuery}"`}
            description="Try a different search term or browse all programs."
            data-testid="search-empty"
          />
        ) : (
          <ul className="flex flex-col gap-3" role="list" data-testid="search-results-list">
            {results.map((result) => (
              <li key={`${result.type}-${result.id}`}>
                <Link
                  href={result.type === "program" ? `/programs/${result.slug}` : `/blog/${result.slug}`}
                  className="flex items-start gap-4 rounded-xl border border-border bg-card p-4 transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  data-testid={`search-result-${result.type}-${result.id}`}
                >
                  {result.imageUrl ? (
                    <img
                      src={result.imageUrl}
                      alt=""
                      aria-hidden="true"
                      className="size-16 shrink-0 rounded-lg object-cover"
                      loading="lazy"
                    />
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <span className="mb-1 inline-block rounded-full bg-surface px-2 py-0.5 text-xs font-medium text-fg-muted">
                      {TYPE_LABELS[result.type]}
                    </span>
                    <p className="font-semibold text-fg">{result.title}</p>
                    {result.snippet ? (
                      <p className="mt-1 text-sm text-fg-muted line-clamp-2">{result.snippet}</p>
                    ) : null}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

SearchPageClient.displayName = "SearchPageClient";
