// Global search content — Phase 9 Completion, T36 (docs/plans/phase-9-completion.md,
// docs/02 §7.17 "Global search (lessons, resources, forum), filters per list,
// bookmarks across videos/resources/forum").
// CLAUDE.md §3: "no business logic in components — use hooks/services".
"use client";

import * as React from "react";
import Link from "next/link";
import { Bookmark as BookmarkIcon, BookOpen, MessageSquare, Search as SearchIcon, Trash2 } from "lucide-react";
import {
  Button,
  DataFilterBar,
  EmptyState,
  PageHeader,
  Skeleton,
  StatusChip,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@repo/ui";
import type { SearchResultItem, SearchResultType, Bookmark } from "@repo/types";

import { useGlobalSearch } from "../../hooks/use-search";
import { useBookmarks } from "../../hooks/use-bookmarks";

// ---------------------------------------------------------------------------
// Result type -> icon / href / label
// ---------------------------------------------------------------------------

const TYPE_LABEL: Record<SearchResultType, string> = {
  lesson: "Lesson",
  resource: "Resource",
  forum_thread: "Forum",
};

function resultHref(result: SearchResultItem): string | null {
  if (result.type === "lesson") return `/lessons/${result.id}`;
  if (result.type === "forum_thread") return `/forum/threads/${result.id}`;
  return null; // resources have no direct deep-link yet (no lessonId on the search hit)
}

const ALL_TYPES: SearchResultType[] = ["lesson", "resource", "forum_thread"];

// ---------------------------------------------------------------------------
// Search tab
// ---------------------------------------------------------------------------

function SearchTab(): React.JSX.Element {
  const [query, setQuery] = React.useState("");
  const [activeTypes, setActiveTypes] = React.useState<SearchResultType[]>([]);
  const search = useGlobalSearch(query, { types: activeTypes.length > 0 ? activeTypes : undefined, limit: 30 });

  function toggleType(type: SearchResultType) {
    setActiveTypes((prev) => (prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]));
  }

  return (
    <div className="space-y-3">
      <DataFilterBar
        searchValue={query}
        onSearchChange={setQuery}
        searchLabel="Search lessons, resources, and forum posts"
        searchPlaceholder="Search everything…"
        chips={activeTypes.map((t) => ({
          id: t,
          label: TYPE_LABEL[t],
          onRemove: () => toggleType(t),
        }))}
        onClearAll={activeTypes.length > 0 ? () => setActiveTypes([]) : undefined}
        data-testid="search-filter-bar"
      >
        <div role="group" aria-label="Filter by type" className="flex flex-wrap gap-1.5">
          {ALL_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => toggleType(t)}
              aria-pressed={activeTypes.includes(t)}
              data-testid={`search-type-filter-${t}`}
              className={
                activeTypes.includes(t)
                  ? "rounded-full border border-brand-500 bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700 dark:bg-brand-500/20 dark:text-brand-300"
                  : "rounded-full border border-border px-3 py-1 text-xs font-medium text-fg-muted hover:bg-surface"
              }
            >
              {TYPE_LABEL[t]}
            </button>
          ))}
        </div>
      </DataFilterBar>

      {query.trim().length === 0 ? (
        <EmptyState
          data-testid="search-idle"
          icon={<SearchIcon className="size-10" strokeWidth={1.5} />}
          title="Search your courses"
          description="Find lessons, downloadable resources, and forum discussions across everything you're enrolled in."
        />
      ) : search.isLoading ? (
        <div aria-busy="true" aria-live="polite" role="status" aria-label="Searching" className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} shape="block" className="h-16 w-full rounded-md" />
          ))}
        </div>
      ) : search.isSignedOut ? (
        <p className="text-sm text-fg-muted">Sign in to search.</p>
      ) : search.isError ? (
        <p role="alert" className="text-sm text-danger" data-testid="search-error">
          {search.error?.problem.detail ?? "Couldn't search. Please try again."}
        </p>
      ) : search.results.length === 0 ? (
        <p className="text-sm text-fg-muted" data-testid="search-empty">
          No results for &ldquo;{query.trim()}&rdquo;.
        </p>
      ) : (
        <ul className="flex flex-col gap-2" aria-label="Search results" data-testid="search-results">
          {search.results.map((r) => {
            const href = resultHref(r);
            const Icon = r.type === "forum_thread" ? MessageSquare : BookOpen;
            const body = (
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-fg-subtle" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-fg line-clamp-1">{r.title}</p>
                  {r.programTitle ? <p className="text-xs text-fg-muted">{r.programTitle}</p> : null}
                  {r.snippet ? <p className="mt-1 text-xs text-fg-muted line-clamp-2">{r.snippet}</p> : null}
                </div>
                <StatusChip tone="neutral" label={TYPE_LABEL[r.type]} size="sm" />
              </div>
            );
            return (
              <li
                key={`${r.type}-${r.id}`}
                className="rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:bg-surface"
                data-testid="search-result-item"
              >
                {href ? (
                  <Link
                    href={href}
                    className="flex focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded-sm"
                  >
                    {body}
                  </Link>
                ) : (
                  body
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bookmarks tab
// ---------------------------------------------------------------------------

function bookmarkHref(bookmark: Bookmark): string | null {
  if (bookmark.refType === "lesson" || bookmark.refType === "video_timestamp") {
    return bookmark.timestampS ? `/lessons/${bookmark.refId}?t=${bookmark.timestampS}` : `/lessons/${bookmark.refId}`;
  }
  if (bookmark.refType === "forum_thread") return `/forum/threads/${bookmark.refId}`;
  return null;
}

function BookmarksTab(): React.JSX.Element {
  const { bookmarks, isLoading, isSignedOut, isError, remove, isRemoving } = useBookmarks({
    page: 1,
    pageSize: 50,
  });

  if (isSignedOut) {
    return <p className="text-sm text-fg-muted">Sign in to see your bookmarks.</p>;
  }

  if (isLoading) {
    return (
      <div aria-busy="true" aria-live="polite" role="status" aria-label="Loading bookmarks" className="space-y-2">
        {[0, 1].map((i) => (
          <Skeleton key={i} shape="block" className="h-16 w-full rounded-md" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <p role="alert" className="text-sm text-danger">
        Couldn&apos;t load your bookmarks.
      </p>
    );
  }

  if (bookmarks.length === 0) {
    return (
      <EmptyState
        data-testid="bookmarks-empty"
        title="No bookmarks yet"
        description="Bookmark a lesson or a forum thread and it will show up here."
      />
    );
  }

  return (
    <ul className="flex flex-col gap-2" aria-label="Your bookmarks" data-testid="bookmarks-list">
      {bookmarks.map((b) => {
        const href = bookmarkHref(b);
        return (
          <li
            key={b.id}
            className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:bg-surface"
            data-testid="bookmark-item"
          >
            <BookmarkIcon aria-hidden="true" className="size-4 shrink-0 text-fg-subtle" />
            <div className="min-w-0 flex-1">
              {href ? (
                <Link href={href} className="text-sm font-medium text-fg hover:underline line-clamp-1">
                  {b.refTitle ?? "Untitled"}
                </Link>
              ) : (
                <span className="text-sm font-medium text-fg line-clamp-1">{b.refTitle ?? "Untitled"}</span>
              )}
              {b.note ? <p className="mt-0.5 text-xs text-fg-muted line-clamp-1">{b.note}</p> : null}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void remove(b.id)}
              disabled={isRemoving}
              aria-label={`Remove bookmark: ${b.refTitle ?? "Untitled"}`}
              data-testid={`bookmark-remove-${b.id}`}
            >
              <Trash2 aria-hidden="true" className="size-4 text-fg-subtle" />
            </Button>
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// SearchContent
// ---------------------------------------------------------------------------

export function SearchContent(): React.JSX.Element {
  return (
    <div data-testid="search-content" className="space-y-6 md:space-y-8">
      <PageHeader
        title="Search"
        description="Find lessons, resources, and forum discussions across your courses."
      />
      <Tabs defaultValue="search">
        <TabsList aria-label="Search sections" className="mb-4">
          <TabsTrigger value="search" data-testid="search-tab-search">
            Search
          </TabsTrigger>
          <TabsTrigger value="bookmarks" data-testid="search-tab-bookmarks">
            My Bookmarks
          </TabsTrigger>
        </TabsList>
        <TabsContent value="search">
          <SearchTab />
        </TabsContent>
        <TabsContent value="bookmarks">
          <BookmarksTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
