// "Save offline" control for a lesson — the OTT download model.
//
// Deliberately NOT a file download: the bytes go into the app's own IndexedDB and
// are playable from Downloads without a connection. The student never receives a
// shareable file, and the player's native Download button is disabled
// (VideoPlayer controlsList="nodownload").
//
// CLAUDE.md §3: state/business logic lives in useOfflineLesson.
"use client";

import * as React from "react";
import { Check, Download, Loader2, Trash2, WifiOff } from "lucide-react";
import { Button, ConfirmDialog } from "@repo/ui";

import { useOfflineLesson } from "../../hooks/use-offline-lesson";

interface OfflineDownloadButtonProps {
  lessonId: string;
  title: string;
  programTitle: string;
  durationS: number | null;
  /** Only offer this for video lessons whose asset is ready. */
  enabled: boolean;
}

export function OfflineDownloadButton({
  lessonId,
  title,
  programTitle,
  durationS,
  enabled,
}: OfflineDownloadButtonProps): React.JSX.Element | null {
  const { status, progress, error, download, remove, cancel } = useOfflineLesson({
    lessonId,
    title,
    programTitle,
    durationS,
    enabled,
  });
  const [confirmRemove, setConfirmRemove] = React.useState(false);

  if (!enabled || status === "checking") return null;

  if (status === "downloading") {
    const pct = progress != null ? Math.round(progress * 100) : null;
    return (
      <div className="flex items-center gap-2" data-testid="offline-downloading">
        <Button variant="secondary" size="sm" onClick={cancel} aria-label="Cancel offline download">
          <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          {pct != null ? `Saving ${pct}%` : "Saving…"}
        </Button>
        {/* aria-live so screen-reader users hear completion, not just sighted ones. */}
        <span className="sr-only" role="status" aria-live="polite">
          {pct != null ? `Saving for offline, ${pct} percent` : "Saving for offline"}
        </span>
      </div>
    );
  }

  if (status === "saved") {
    return (
      <>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setConfirmRemove(true)}
          className="text-success"
          aria-label={`${title} is available offline. Remove the offline copy.`}
          data-testid="offline-saved"
        >
          <Check aria-hidden="true" className="size-4" />
          Available offline
        </Button>
        <ConfirmDialog
          open={confirmRemove}
          onOpenChange={setConfirmRemove}
          title="Remove offline copy?"
          description={`"${title}" will no longer be watchable without a connection. You can save it again any time.`}
          confirmLabel="Remove"
          onConfirm={() => void remove()}
          data-testid="offline-remove-confirm"
        />
      </>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <Button
        variant="secondary"
        size="sm"
        onClick={() => void download()}
        aria-label={`Save ${title} for offline viewing inside the app`}
        data-testid="offline-download-btn"
      >
        {status === "error" ? (
          <Trash2 aria-hidden="true" className="size-4" />
        ) : (
          <Download aria-hidden="true" className="size-4" />
        )}
        {status === "error" ? "Try again" : "Save offline"}
      </Button>
      {status === "error" && error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : (
        <p className="inline-flex items-center gap-1 text-xs text-fg-subtle">
          <WifiOff aria-hidden="true" className="size-3" />
          Watch in Downloads without internet
        </p>
      )}
    </div>
  );
}
