// BookmarkButton — reusable bookmark toggle for lessons/forum threads.
// Phase 9 Completion, T36 (docs/plans/phase-9-completion.md, docs/02 §7.17
// "bookmarks across videos/resources/forum"). Wraps useBookmarkToggle so the
// same control works on the lesson page and the forum thread page.
// CLAUDE.md §3: "no business logic in components — use hooks/services".
"use client";

import * as React from "react";
import { Bookmark, BookmarkCheck } from "lucide-react";
import { Button, cn } from "@repo/ui";

import { useBookmarkToggle } from "../../hooks/use-bookmarks";

export interface BookmarkButtonProps {
  refType: string;
  refId: string;
  /** Human-readable label for the thing being bookmarked, used in the aria-label. */
  label: string;
  className?: string;
  "data-testid"?: string;
}

export function BookmarkButton({
  refType,
  refId,
  label,
  className,
  "data-testid": testId,
}: BookmarkButtonProps): React.JSX.Element {
  const { isBookmarked, isPending, toggle } = useBookmarkToggle(refType, refId);

  return (
    <Button
      type="button"
      variant={isBookmarked ? "primary" : "secondary"}
      size="sm"
      onClick={() => void toggle()}
      disabled={isPending}
      aria-pressed={isBookmarked}
      aria-label={isBookmarked ? `Remove bookmark: ${label}` : `Bookmark: ${label}`}
      data-testid={testId ?? "bookmark-button"}
      className={cn(className)}
    >
      {isBookmarked ? (
        <BookmarkCheck aria-hidden="true" className="size-4" />
      ) : (
        <Bookmark aria-hidden="true" className="size-4" />
      )}
      {isBookmarked ? "Bookmarked" : "Bookmark"}
    </Button>
  );
}
