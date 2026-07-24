// LMS Lesson Video Player — Wave 5b.
//
// This component owns the full "fetch signed URL → mount VideoPlayer → report progress
// → mark complete → handle error states" flow for a video-type lesson.
//
// WIRING SUMMARY (7-step seam documented in lesson-detail-content.tsx):
//   1. On mount (or explicit user "Play" trigger): calls useStreamUrl(lessonId).fetchStreamUrl().
//   2. Passes signed HLS url to <VideoPlayer src={url}>.
//   3. Throttled onTimeUpdate → useProgressReporting().handleTimeUpdate() (10 s interval).
//   4. onEnded → useProgressReporting().handleEnded() → POST /complete + cache invalidation.
//   5. watermark.text from stream-url response → VideoPlayer watermarkText prop (client overlay).
//   6. On onError (CDN 403 / expired URL) → re-calls fetchStreamUrl() to re-mint.
//   7. Resume: player seeks to startPositionS on loadedmetadata (built into VideoPlayer).
//
// ENGINE SEAM (B4 — RESOLVED):
//   createHlsEngine IS now wired to hls.js (./create-hls-engine), so adaptive HLS plays
//   on Chrome/Firefox/Android-Chrome, not just Safari/iOS. VideoPlayer uses native HLS
//   where the browser supports it and only calls this factory (attaching hls.js) where
//   it doesn't. See: packages/ui/src/components/video-player.tsx header.
//
// NOT-READY / PROVIDER-DOWN STATE:
//   If the backend returns 503 (NoopVideoProvider active or video still processing),
//   we show a clear "not available yet" state, NOT an error crash.
//   If the lesson is not enrolled (403/404 from stream-url), we show the forbidden state.
//
// CLAUDE.md §3: "no business logic in components — use hooks/services".
"use client";

import * as React from "react";
import { CheckCircle, RefreshCw, Lock, VideoOff } from "lucide-react";
import {
  VideoPlayer,
  Button,
  Card,
  CardFooter,
  CardHeader,
  CardTitle,
  CardDescription,
  EmptyState,
  Skeleton,
} from "@repo/ui";
import { createHlsEngine } from "./create-hls-engine";
import type { LessonDetailResponse } from "@repo/types";

import { OfflineDownloadButton } from "./offline-download-button";
import { useStreamUrl } from "../../hooks/use-stream-url";
import { useProgressReporting } from "../../hooks/use-progress-reporting";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LessonVideoPlayerProps {
  lesson: LessonDetailResponse;
  /**
   * Resume position in seconds — from the ?t= URL param or from
   * lesson.progress.lastPositionS. Passed to VideoPlayer.startPositionS.
   */
  initialTimeS: number;
}

// ---------------------------------------------------------------------------
// Loading skeleton (while fetching signed URL)
// ---------------------------------------------------------------------------

function PlayerFetchingSkeleton(): React.JSX.Element {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading video player"
      className="relative w-full aspect-video rounded-lg overflow-hidden"
      data-testid="player-fetching-skeleton"
    >
      <Skeleton shape="block" className="h-full w-full" />
      <div className="absolute inset-0 flex items-center justify-center">
        <p className="text-sm text-fg-muted">Loading video…</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LessonVideoPlayer
// ---------------------------------------------------------------------------

/**
 * LessonVideoPlayer — the full wired video player for a lesson.
 *
 * Handles:
 * - Lazy stream-url fetch (on mount of this component, which itself is mounted on
 *   demand — see VideoLesson in lesson-detail-content.tsx)
 * - All VideoPlayer states (loading, ready, error, unplayable)
 * - Progress reporting via useProgressReporting
 * - Mark-complete (onEnded + manual button)
 * - Resume via startPositionS
 * - Per-user watermark overlay
 * - Graceful states: video-not-ready, forbidden, error, unplayable (no-HLS)
 */
export function LessonVideoPlayer({
  lesson,
  initialTimeS,
}: LessonVideoPlayerProps): React.JSX.Element {
  const { state, fetchStreamUrl, streamUrl, watermarkText } = useStreamUrl(
    lesson.id,
  );

  // markComplete / isMarkingComplete are intentionally unused here — the manual
  // "Mark complete & continue" action lives in the lesson page's bottom action
  // bar (LessonActionBar). This instance only handles video-end auto-complete.
  const { handleTimeUpdate, handleEnded, isCompleted } = useProgressReporting({
    lessonId: lesson.id,
  });

  // Track the playerError state for CDN 403 / playback errors
  const [playerErrorCount, setPlayerErrorCount] = React.useState(0);

  // Fetch the signed URL on mount (this component mounts only when user reaches the lesson page)
  React.useEffect(() => {
    void fetchStreamUrl();
  }, [lesson.id, fetchStreamUrl]);

  // ── Handle VideoPlayer onError: re-mint URL on CDN 403 / playback failure ──
  const handlePlayerError = React.useCallback(
    (detail: string) => {
      setPlayerErrorCount((n) => n + 1);
      // If the error looks like an authorization/expiry issue, re-mint the URL.
      // We cap at 2 automatic remints to avoid loops on persistent errors.
      const isLikelyExpiry =
        detail.toLowerCase().includes("403") ||
        detail.toLowerCase().includes("forbidden") ||
        detail.toLowerCase().includes("unauthorized") ||
        detail.toLowerCase().includes("expired");

      if (isLikelyExpiry && playerErrorCount < 2) {
        void fetchStreamUrl();
      }
      // For other errors (codec, network), we let the VideoPlayer's built-in
      // error state render. The user can retry manually via the "Try again" button.
    },
    [fetchStreamUrl, playerErrorCount],
  );

  // ── Derive a resume position: ?t= param OR last_position_s from progress ──
  // Prefer the URL param (user deliberately clicked "Resume at X"), fall back to
  // stored progress (covers cross-device resume).
  const resumePositionS =
    initialTimeS > 0
      ? initialTimeS
      : (lesson.progress?.lastPositionS ?? 0);

  // ── Build caption track list from videoMeta.captionTracks ──
  // In P3, captionTracks is a list of language codes. Actual VTT track URLs would
  // come from the signed HLS manifest itself. We don't have explicit VTT URLs in
  // the DTO, so we pass no <track> elements here — captions are served inline in
  // the HLS stream (WebVTT segments). This is correct for HLS with embedded captions.
  // If the backend adds explicit VTT URLs in a future wave, add them here.
  const captions = undefined; // HLS-embedded captions — no explicit VTT URLs in P3

  // ── Render states ────────────────────────────────────────────────────────

  if (state.status === "idle" || state.status === "fetching") {
    return <PlayerFetchingSkeleton />;
  }

  if (state.status === "forbidden") {
    return (
      <EmptyState
        data-testid="player-forbidden"
        icon={<Lock className="size-10" strokeWidth={1.5} />}
        title="Access restricted"
        description="You need an active enrollment to watch this video. Preview lessons can be watched without enrollment."
      />
    );
  }

  if (state.status === "video-not-ready") {
    return (
      <Card data-testid="player-video-not-ready">
        <CardHeader>
          <div className="mb-2">
            <VideoOff aria-hidden="true" className="size-8 text-fg-subtle" />
          </div>
          <CardTitle>Video not available yet</CardTitle>
          <CardDescription>{state.message}</CardDescription>
        </CardHeader>
        <CardFooter>
          <Button
            variant="secondary"
            onClick={() => void fetchStreamUrl()}
            data-testid="player-not-ready-retry"
          >
            <RefreshCw aria-hidden="true" className="size-4" />
            Check again
          </Button>
        </CardFooter>
      </Card>
    );
  }

  if (state.status === "error") {
    return (
      <Card data-testid="player-error">
        <CardHeader>
          <CardTitle>Couldn&apos;t load video</CardTitle>
          <CardDescription>{state.message}</CardDescription>
        </CardHeader>
        <CardFooter>
          <Button
            variant="secondary"
            onClick={() => void fetchStreamUrl()}
            data-testid="player-error-retry"
          >
            <RefreshCw aria-hidden="true" className="size-4" />
            Try again
          </Button>
        </CardFooter>
      </Card>
    );
  }

  // state.status === "ready" — we have a signed URL
  return (
    <div className="space-y-3" data-testid="lesson-video-player">
      {/*
       * VideoPlayer from @repo/ui.
       *
       * createHlsEngine (B4): hls.js is now injected, so VideoPlayer plays adaptive HLS
       * on every browser — native HLS on Safari/iOS, hls.js (MSE) on Chrome/Firefox/
       * Android-Chrome. The factory is only invoked where native HLS is unavailable.
       *
       * The Noop provider returns a fake .m3u8 URL that won't produce real video;
       * onError is still handled gracefully (re-mint / retry state), no crash.
       */}
      <VideoPlayer
        src={streamUrl as string}
        createHlsEngine={createHlsEngine}
        watermarkText={watermarkText ?? undefined}
        startPositionS={resumePositionS > 0 ? resumePositionS : undefined}
        captions={captions}
        onTimeUpdate={handleTimeUpdate}
        onEnded={handleEnded}
        onError={handlePlayerError}
        data-testid="wired-video-player"
        aria-label={`Video: ${lesson.title}`}
      />

      {/* Player utilities — manual mark-complete lives in the page's bottom
          action bar (LessonActionBar), not here. */}
      <div className="flex items-center gap-3 pt-1" data-testid="player-actions">
        {isCompleted || lesson.progress?.status === "completed" ? (
          <div
            className="inline-flex items-center gap-1.5 text-sm font-medium text-success"
            data-testid="player-completed-indicator"
          >
            <CheckCircle aria-hidden="true" className="size-4" />
            Completed
          </div>
        ) : null}

        {/* Refresh URL — useful when the URL has expired mid-session */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void fetchStreamUrl()}
          aria-label="Refresh video if it stopped playing"
          data-testid="player-refresh-url-btn"
          className="text-fg-subtle"
        >
          <RefreshCw aria-hidden="true" className="size-3.5" />
          Refresh
        </Button>

        {/* Save-for-offline (OTT model): stores the video INSIDE the app for
            offline viewing instead of handing the student a shareable file. */}
        <div className="ml-auto">
          <OfflineDownloadButton
            lessonId={lesson.id}
            title={lesson.title}
            programTitle={lesson.programTitle}
            durationS={lesson.videoMeta?.durationS ?? null}
            enabled={lesson.videoMeta?.status === "ready"}
          />
        </div>
      </div>
    </div>
  );
}
