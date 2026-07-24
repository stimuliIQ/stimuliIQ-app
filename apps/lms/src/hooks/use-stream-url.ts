// LMS stream-url hook — Wave 5b.
//
// Fetches GET /api/v1/lessons/:id/stream-url LAZILY (only when the player requests it,
// not on mount or curriculum load). The signed HLS URL is SHORT-TTL (≤5 min) and
// PER-USER — it must NEVER be cached long-term, stored in localStorage, or logged.
//
// SECURITY RULES (from packages/api-client/src/lms/lessons.api.ts):
//   1. Only call getStreamUrl just before playback starts.
//   2. Monitor expiresAt; re-call before or on expiry (or on a CDN 403).
//   3. NEVER persist the url in localStorage, a Redux store, or TanStack Query's
//      persistent cache (gcTime=0 here enforces this).
//   4. NEVER log the url value.
//   5. Render watermark.text as a visible overlay on the player.
//
// STATE MACHINE:
//   idle → fetching → ready | error (video-not-ready/provider-down) | forbidden (403/404)
//
// ERRORS HANDLED:
//   - 409: lesson has no video yet, or the video is still processing
//          (status !== "ready") — the common post-upload case → "not available yet"
//   - 503: VideoProvider unconfigured or signed-URL mint failed → "not available yet"
//   - 403/404: not enrolled (enrollment gate on server) → forbidden state
//   - Other network / API errors → generic error with retry
//
// P3 LIMITATION: The Noop provider returns a deterministic fake .m3u8 URL. Without
// real Cloudflare/Mux keys the URL won't produce actual video — the VideoPlayer
// will emit onError which we surface as a graceful "unavailable" state.
//
// hls.js engine seam: intentionally left unwired (docs/plans/phase-3.md §Risks #2b).
// Safari/iOS native HLS will work once real provider keys are set.
// Tracked follow-up: wire hls.js via VideoPlayer.createHlsEngine for Chrome/Firefox.
//
// CLAUDE.md §3: "no business logic in components — use hooks/services".
"use client";

import * as React from "react";
import { ApiError } from "@repo/api-client";
import type { StreamUrlResponse } from "@repo/types";

import { apiClient } from "../lib/api-client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StreamUrlState =
  | { status: "idle" }
  | { status: "fetching" }
  | {
      status: "ready";
      data: StreamUrlResponse;
    }
  | { status: "video-not-ready"; message: string }
  | { status: "forbidden" }
  | { status: "error"; message: string };

export interface UseStreamUrlResult {
  state: StreamUrlState;
  /**
   * Call this just before starting playback (e.g. when the user presses play,
   * or when the VideoPlayer section mounts). NOT on page/curriculum load.
   *
   * Also call this to re-mint the URL on expiry or when the CDN returns 403.
   */
  fetchStreamUrl: () => Promise<void>;
  /** Convenience: true when state.status === "ready". */
  isReady: boolean;
  /** The signed HLS URL. Only populated when isReady = true. */
  streamUrl: string | null;
  /** The watermark text for the per-user overlay. Only populated when isReady = true. */
  watermarkText: string | null;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * useStreamUrl — lazy stream-url fetch for the lesson video player.
 *
 * Does NOT auto-fetch on mount. Call `fetchStreamUrl()` from the player
 * component when the user initiates playback.
 *
 * Sets up a timer to re-mint the URL ~30 s before it expires so long-running
 * sessions don't hit a CDN 403 mid-playback.
 */
export function useStreamUrl(lessonId: string | undefined): UseStreamUrlResult {
  const [state, setState] = React.useState<StreamUrlState>({ status: "idle" });

  // Timer ref for auto-remint before expiry
  const remintTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear any scheduled remint timer
  const clearRemintTimer = React.useCallback(() => {
    if (remintTimerRef.current !== null) {
      clearTimeout(remintTimerRef.current);
      remintTimerRef.current = null;
    }
  }, []);

  // Schedule a re-mint 30s before the URL expires
  const scheduleRemint = React.useCallback(
    (expiresAt: string, doFetch: () => Promise<void>) => {
      clearRemintTimer();
      const expiresMs = new Date(expiresAt).getTime();
      const nowMs = Date.now();
      const msUntilExpiry = expiresMs - nowMs;
      // Re-mint 30s before expiry (or immediately if already very close)
      const remintInMs = Math.max(0, msUntilExpiry - 30_000);
      remintTimerRef.current = setTimeout(() => {
        void doFetch();
      }, remintInMs);
    },
    [clearRemintTimer],
  );

  const fetchStreamUrl = React.useCallback(async () => {
    if (!lessonId) return;

    clearRemintTimer();
    setState({ status: "fetching" });

    try {
      // NEVER store the response URL in a persistent cache (gcTime=0 equivalent).
      // We deliberately do NOT use TanStack Query here to keep full control over
      // the cache lifecycle and prevent any accidental persistence.
      const data = await apiClient.lms.lessons.getStreamUrl(lessonId);

      // SECURITY: do not log data.url
      setState({ status: "ready", data });

      // Schedule auto-remint before expiry
      const currentFetch = async () => fetchStreamUrl();
      scheduleRemint(data.expiresAt, currentFetch);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 403 || err.status === 404) {
          setState({ status: "forbidden" });
          return;
        }
        if (err.status === 409 || err.status === 503) {
          // 409 (lms.video_not_ready): the lesson has no video yet, or the video
          //   is still processing (status !== "ready") — the common case right
          //   after an upload, before the transcode webhook flips it to "ready".
          // 503 (lms.video_provider_unavailable): VideoProvider unconfigured or
          //   the signed-URL mint failed (fail-closed).
          // Both surface the same graceful "not available yet" state rather than
          // the generic error card — see apps/api/.../lms.service.ts:mintStreamUrl.
          setState({
            status: "video-not-ready",
            message:
              "This video isn't available yet — it may still be processing or requires setup. Please check back later.",
          });
          return;
        }
      }
      setState({
        status: "error",
        message:
          err instanceof Error
            ? err.message
            : "Failed to load video. Please try again.",
      });
    }
  }, [lessonId, clearRemintTimer, scheduleRemint]);

  // Cleanup timer on unmount or lessonId change
  React.useEffect(() => {
    return () => clearRemintTimer();
  }, [clearRemintTimer]);

  // Reset state when lessonId changes
  React.useEffect(() => {
    setState({ status: "idle" });
    clearRemintTimer();
  }, [lessonId, clearRemintTimer]);

  const isReady = state.status === "ready";
  const streamUrl = isReady ? (state as { status: "ready"; data: StreamUrlResponse }).data.url : null;
  const watermarkText = isReady
    ? (state as { status: "ready"; data: StreamUrlResponse }).data.watermark.text
    : null;

  return {
    state,
    fetchStreamUrl,
    isReady,
    streamUrl,
    watermarkText,
  };
}
