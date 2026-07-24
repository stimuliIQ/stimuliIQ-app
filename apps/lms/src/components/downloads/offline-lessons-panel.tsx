// Offline lessons panel — the "watch without internet" surface (OTT model).
//
// Lists videos the student saved into the app's own storage (IndexedDB) and plays
// them from an ephemeral `blob:` URL. There is no file on disk to share, and the
// player's native Download button stays disabled, so an offline copy is for
// watching, not redistributing. See lib/offline-video-store.ts for the (honest)
// security boundary — this is friction, not DRM.
//
// CLAUDE.md §3: all storage logic lives in lib/offline-video-store.ts.
"use client";

import * as React from "react";
import Link from "next/link";
import { HardDrive, Play, Trash2, WifiOff, X } from "lucide-react";
import { Button, ConfirmDialog, EmptyState, VideoPlayer } from "@repo/ui";

import { useMe } from "../../hooks/use-me";
import {
  daysUntilExpiry,
  formatBytes,
  getOfflineLessonUrl,
  getOfflineUsage,
  listOfflineLessons,
  removeOfflineLesson,
  type OfflineLessonMeta,
} from "../../lib/offline-video-store";

function formatDuration(durationS: number | null): string {
  if (!durationS) return "";
  const m = Math.floor(durationS / 60);
  const s = durationS % 60;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

export function OfflineLessonsPanel(): React.JSX.Element {
  const [items, setItems] = React.useState<OfflineLessonMeta[] | null>(null);
  const [usage, setUsage] = React.useState<{ usedBytes: number; quotaBytes: number } | null>(null);
  const [playing, setPlaying] = React.useState<{ meta: OfflineLessonMeta; url: string } | null>(null);
  const [pendingRemove, setPendingRemove] = React.useState<OfflineLessonMeta | null>(null);

  // Downloads are per-student: another account on this device sees an empty library.
  const { me } = useMe();
  const userId = me?.user.id;

  const refresh = React.useCallback(async () => {
    if (!userId) {
      setItems([]);
      return;
    }
    setItems(await listOfflineLessons(userId));
    setUsage(await getOfflineUsage());
  }, [userId]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  // Object URLs pin the entire blob in memory — always revoke when the player closes.
  React.useEffect(() => {
    const url = playing?.url;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [playing?.url]);

  async function play(meta: OfflineLessonMeta): Promise<void> {
    if (!userId) return;
    const url = await getOfflineLessonUrl(meta.lessonId, userId);
    if (url) {
      setPlaying({ meta, url });
      return;
    }
    // Licence lapsed or the copy was unreadable — the store already purged it.
    await refresh();
  }

  async function confirmRemove(): Promise<void> {
    if (!pendingRemove) return;
    await removeOfflineLesson(pendingRemove.lessonId);
    setPendingRemove(null);
    await refresh();
  }

  if (items === null) return <></>;

  return (
    <section aria-labelledby="offline-heading" data-testid="offline-lessons-panel">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="offline-heading" className="flex items-center gap-2 text-base font-semibold text-fg">
          <span aria-hidden="true" className="h-4 w-1 rounded-full bg-brand-500" />
          Saved for offline
        </h2>
        {usage && usage.quotaBytes > 0 ? (
          <p className="inline-flex items-center gap-1.5 text-xs text-fg-subtle" data-testid="offline-usage">
            <HardDrive aria-hidden="true" className="size-3.5" />
            {formatBytes(usage.usedBytes)} used
          </p>
        ) : null}
      </div>

      {items.length === 0 ? (
        <EmptyState
          title="No lessons saved for offline yet"
          description="Open a video lesson and choose “Save offline” to watch it here without a connection. Saved lessons stay inside the app — they aren't downloaded as files."
          action={
            <Button asChild variant="secondary" size="sm">
              <Link href="/courses">Go to My Courses</Link>
            </Button>
          }
          data-testid="offline-empty"
        />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {items.map((meta) => (
            <li
              key={meta.lessonId}
              className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:bg-surface"
              data-testid="offline-lesson-row"
            >
              <span
                aria-hidden="true"
                className="flex size-10 shrink-0 items-center justify-center rounded-md bg-surface text-fg-muted"
              >
                <Play className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-fg">{meta.title}</span>
                <span className="text-xs text-fg-muted">
                  {meta.programTitle}
                  {meta.durationS ? ` · ${formatDuration(meta.durationS)}` : ""} · {formatBytes(meta.sizeBytes)}
                  {" · "}
                  {/* Licence countdown, like an OTT download. Re-saving while online renews it. */}
                  <span className={daysUntilExpiry(meta.expiresAt) <= 3 ? "text-warning" : undefined}>
                    {daysUntilExpiry(meta.expiresAt) === 0
                      ? "expires today"
                      : `${daysUntilExpiry(meta.expiresAt)} days left`}
                  </span>
                </span>
              </span>
              <Button variant="secondary" size="sm" onClick={() => void play(meta)} data-testid="offline-play">
                <Play aria-hidden="true" className="size-4" />
                Watch
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setPendingRemove(meta)}
                aria-label={`Remove offline copy of ${meta.title}`}
                data-testid="offline-remove"
              >
                <Trash2 aria-hidden="true" className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {/* Offline player — plays straight from the stored blob, no network needed. */}
      {playing ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Offline playback: ${playing.meta.title}`}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4"
          onClick={() => setPlaying(null)}
          data-testid="offline-player-modal"
        >
          <div
            className="w-full max-w-3xl overflow-hidden rounded-xl bg-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-fg">{playing.meta.title}</p>
                <p className="inline-flex items-center gap-1 text-xs text-fg-muted">
                  <WifiOff aria-hidden="true" className="size-3" />
                  Playing offline
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPlaying(null)}
                aria-label="Close offline player"
                className="rounded-md p-1.5 text-fg-muted transition-colors hover:bg-surface hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                data-testid="offline-player-close"
              >
                <X aria-hidden="true" className="size-5" />
              </button>
            </div>
            {/* Same hardened player as online playback (nodownload, no context menu). */}
            <VideoPlayer src={playing.url} aria-label={playing.meta.title} data-testid="offline-video-player" />
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={Boolean(pendingRemove)}
        onOpenChange={(open) => !open && setPendingRemove(null)}
        title="Remove offline copy?"
        description={`"${pendingRemove?.title ?? ""}" will no longer be watchable without a connection.`}
        confirmLabel="Remove"
        onConfirm={() => void confirmRemove()}
        data-testid="offline-remove-confirm"
      />
    </section>
  );
}
