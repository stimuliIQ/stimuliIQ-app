// Offline-download state for one lesson (the OTT "save in the app" flow).
//
// Owns: is-it-saved lookup, the download itself (with progress), and removal.
// The bytes are fetched from a freshly minted SHORT-TTL signed URL — the same
// enrollment-gated endpoint playback uses — and stored in IndexedDB, never handed
// to the user as a file. See lib/offline-video-store.ts for the security boundary.
//
// CLAUDE.md §3: "no business logic in components — use hooks/services".
"use client";

import * as React from "react";

import { apiClient } from "../lib/api-client";
import { useMe } from "./use-me";
import {
  hasOfflineLesson,
  removeOfflineLesson,
  saveLessonOffline,
} from "../lib/offline-video-store";

export type OfflineLessonStatus = "checking" | "not-saved" | "downloading" | "saved" | "error";

export interface UseOfflineLessonResult {
  status: OfflineLessonStatus;
  /** 0–1 while downloading; null when the server gives no Content-Length. */
  progress: number | null;
  error: string | null;
  download: () => Promise<void>;
  remove: () => Promise<void>;
  cancel: () => void;
}

export interface UseOfflineLessonOptions {
  lessonId: string;
  title: string;
  programTitle: string;
  durationS: number | null;
  /** Only video lessons with a ready asset can be saved. */
  enabled: boolean;
}

export function useOfflineLesson({
  lessonId,
  title,
  programTitle,
  durationS,
  enabled,
}: UseOfflineLessonOptions): UseOfflineLessonResult {
  const [status, setStatus] = React.useState<OfflineLessonStatus>("checking");
  const [progress, setProgress] = React.useState<number | null>(0);
  const [error, setError] = React.useState<string | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);

  // Offline copies are bound to the student who saved them (see offline-video-store):
  // another account on the same device can neither see nor decrypt them.
  const { me } = useMe();
  const userId = me?.user.id;

  // Resolve saved-state on mount / lesson change.
  React.useEffect(() => {
    let cancelled = false;
    if (!enabled || !userId) {
      setStatus("not-saved");
      return;
    }
    setStatus("checking");
    void hasOfflineLesson(lessonId, userId).then((saved) => {
      if (!cancelled) setStatus(saved ? "saved" : "not-saved");
    });
    return () => {
      cancelled = true;
    };
  }, [lessonId, enabled, userId]);

  // Abort an in-flight download if the student navigates away.
  React.useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const download = React.useCallback(async () => {
    if (!userId) return;
    setError(null);
    setProgress(0);
    setStatus("downloading");
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      // Mint a fresh signed URL for THIS download. Re-using the player's URL would
      // risk an expiry mid-transfer, and the endpoint re-checks the enrollment gate
      // — a student can only ever save a lesson they're entitled to watch.
      const stream = await apiClient.lms.lessons.getStreamUrl(lessonId);
      await saveLessonOffline(
        { lessonId, userId, title, programTitle, durationS },
        stream.url,
        setProgress,
        controller.signal,
      );
      setStatus("saved");
    } catch (err) {
      if (controller.signal.aborted) {
        setStatus("not-saved");
        return;
      }
      setError(err instanceof Error ? err.message : "Couldn't save this lesson offline.");
      setStatus("error");
    } finally {
      abortRef.current = null;
    }
  }, [lessonId, userId, title, programTitle, durationS]);

  const remove = React.useCallback(async () => {
    await removeOfflineLesson(lessonId);
    setStatus("not-saved");
    setProgress(0);
  }, [lessonId]);

  const cancel = React.useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { status, progress, error, download, remove, cancel };
}
