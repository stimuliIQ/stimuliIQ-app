// Forum Batch Selector — Phase 6, Task #10.
//
// The forum is batch-scoped. This component fetches the student's enrolled batches
// (via useMyCourses), presents a selector, and renders ForumThreadListContent
// for the selected batch.
//
// IDOR (AC-55): Non-enrolled batch → 404 from the API; ForumThreadListContent handles that.
// The selector only shows batches the student IS enrolled in — they cannot manually
// construct a URL to access a batch they are not enrolled in because the API
// enforces enrollment before returning thread data.
//
// CLAUDE.md §3: "no business logic in components — use hooks/services".
"use client";

import * as React from "react";
import { RefreshCw } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Skeleton,
} from "@repo/ui";

import { useMyCourses } from "../../hooks/use-my-courses";
import { ForumThreadListContent } from "./forum-thread-list-content";

export function ForumBatchSelector(): React.JSX.Element {
  const { data, isLoading, isSignedOut, isError, refetch } = useMyCourses({
    page: 1,
    pageSize: 50,
  });

  const batches = data?.items ?? [];

  const [selectedBatchId, setSelectedBatchId] = React.useState<string | null>(null);

  // Auto-select the first active batch once data loads
  React.useEffect(() => {
    if (!selectedBatchId && batches.length > 0) {
      const firstActive = batches.find((b) => b.status === "active");
      if (firstActive) {
        setSelectedBatchId(firstActive.batchId);
      } else {
        const first = batches[0];
        if (first) setSelectedBatchId(first.batchId);
      }
    }
  }, [batches, selectedBatchId]);

  // ── Signed-out ────────────────────────────────────────────────────────────
  if (isSignedOut) {
    return (
      <Card data-testid="forum-batch-selector-signed-out">
        <CardHeader>
          <CardTitle>You&apos;re signed out</CardTitle>
          <CardDescription>Sign in to access the forum.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <a href="/login">Sign in</a>
          </Button>
        </CardContent>
      </Card>
    );
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div
        role="status"
        aria-busy="true"
        aria-label="Loading your batches"
        className="space-y-4"
        data-testid="forum-batch-loading"
      >
        <div className="flex gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} shape="block" className="h-8 w-32 rounded-full" />
          ))}
        </div>
        <Skeleton shape="block" className="h-48 w-full rounded-md" />
      </div>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <Card data-testid="forum-batch-error">
        <CardHeader>
          <CardTitle>Couldn&apos;t load your batches</CardTitle>
          <CardDescription>
            Something went wrong fetching your enrolled batches.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="secondary" onClick={refetch} data-testid="forum-batch-retry">
            <RefreshCw aria-hidden="true" className="mr-1.5 size-4" />
            Try again
          </Button>
        </CardContent>
      </Card>
    );
  }

  // ── Empty (no enrollments) ─────────────────────────────────────────────────
  if (batches.length === 0) {
    return (
      <EmptyState
        data-testid="forum-no-enrollments"
        title="No active batches"
        description="Enroll in a program to access the discussion forum."
      />
    );
  }

  const selectedBatch = batches.find((b) => b.batchId === selectedBatchId);

  return (
    <div className="space-y-4" data-testid="forum-batch-selector">
      {/* Batch tabs */}
      <div
        role="tablist"
        aria-label="Select a batch to view forum"
        className="flex flex-wrap gap-2"
        data-testid="forum-batch-tabs"
      >
        {batches.map((batch) => (
          <button
            key={batch.batchId}
            type="button"
            role="tab"
            aria-selected={batch.batchId === selectedBatchId}
            aria-controls="forum-panel"
            id={`forum-tab-${batch.batchId}`}
            onClick={() => setSelectedBatchId(batch.batchId)}
            className={
              batch.batchId === selectedBatchId
                ? "rounded-full px-4 py-1.5 text-sm font-medium bg-brand-500 text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                : "rounded-full px-4 py-1.5 text-sm font-medium border border-border text-fg-muted hover:border-brand-300 hover:text-fg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
            }
            data-testid={`forum-batch-tab-${batch.batchId}`}
          >
            <span className="max-w-[160px] truncate block">
              {batch.batchName}
            </span>
          </button>
        ))}
      </div>

      {/* Forum thread list for selected batch */}
      {selectedBatchId ? (
        <div
          id="forum-panel"
          role="tabpanel"
          aria-labelledby={`forum-tab-${selectedBatchId}`}
          data-testid="forum-thread-panel"
        >
          {selectedBatch?.status !== "active" ? (
            <p className="text-sm text-fg-muted mb-3" data-testid="forum-batch-inactive-notice">
              This batch is {selectedBatch?.status}. You can view threads but may not be
              able to post.
            </p>
          ) : null}
          <ForumThreadListContent batchId={selectedBatchId} />
        </div>
      ) : null}
    </div>
  );
}
