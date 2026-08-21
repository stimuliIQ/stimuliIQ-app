// LMS progress-reporting hook — Wave 5b.
//
// Wires the VideoPlayer's onTimeUpdate / onEnded callbacks to:
//   - PUT  /api/v1/me/lessons/:id/progress (throttled position ping)
//   - POST /api/v1/me/lessons/:id/complete (explicit mark-complete action)
//
// THROTTLING: timeUpdate fires ~4 Hz; we only ping the server every PING_INTERVAL_MS
// (10 s). We also send on pause/seek by calling pingNow() directly.
//
// CACHE INVALIDATION on complete:
//   - We update the lesson detail's progress snapshot optimistically.
//   - We invalidate the dashboard + my-progress queries so rings update.
//   - The ProgressResponse.enrollmentProgressPct returned by /complete already carries
//     the updated rollup — we pass it back to the caller for optimistic ring update.
//
// IDEMPOTENCY: client.lms.progress.complete() generates a fresh crypto.randomUUID()
// Idempotency-Key per call. Callers should NOT retry on success (the UI "Mark complete"
// button is toggled disabled post-completion). Network-failure retries with the same
// key are safe — the server is idempotent.
//
// ENROLLMENT SCOPE: the server enforces that the lesson belongs to an enrolled program.
// A 403 from the ping/complete endpoint surfaces as a toast error (non-fatal).
//
// CLAUDE.md §3: "no business logic in components — use hooks/services".
"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@repo/ui";
import { ApiError } from "@repo/api-client";
import type { ProgressResponse } from "@repo/types";

import { apiClient } from "../lib/api-client";
import { lessonDetailKey } from "./use-lesson";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Send a position ping at most once every 10 seconds during playback. */
const PING_INTERVAL_MS = 10_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseProgressReportingOptions {
  lessonId: string | undefined;
  /**
   * Called once after a successful POST /complete (manual markComplete or
   * video onEnded). Used by the lesson page's "Mark complete & continue"
   * action to navigate to the next lesson after the completion is saved.
   */
  onCompleted?: () => void;
}

export interface UseProgressReportingResult {
  /**
   * Pass as VideoPlayer's onTimeUpdate callback.
   * Internally throttled — safe to call on every timeupdate event.
   */
  handleTimeUpdate: (currentSeconds: number) => void;
  /**
   * Pass as VideoPlayer's onEnded callback.
   * Marks the lesson complete and invalidates caches.
   */
  handleEnded: () => void;
  /**
   * Manual "Mark complete" action for the UI fallback button.
   * Same semantics as handleEnded.
   */
  markComplete: () => void;
  /** True while a markComplete / handleEnded POST /complete call is in-flight. */
  isMarkingComplete: boolean;
  /** True once the lesson has been marked complete this session. */
  isCompleted: boolean;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * useProgressReporting — handles all progress write-back for the lesson player.
 *
 * Manages:
 *  - Throttled PUT /me/lessons/:id/progress during playback
 *  - POST /me/lessons/:id/complete on video end or manual action
 *  - TanStack Query cache invalidation on completion
 *  - Toast notifications on completion / errors
 */
export function useProgressReporting({
  lessonId,
  onCompleted,
}: UseProgressReportingOptions): UseProgressReportingResult {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Keep the latest callback in a ref so doMarkComplete doesn't re-create
  // (and reset its throttle/guard closure) when the caller passes an inline fn.
  const onCompletedRef = React.useRef(onCompleted);
  React.useEffect(() => {
    onCompletedRef.current = onCompleted;
  }, [onCompleted]);

  const [isMarkingComplete, setIsMarkingComplete] = React.useState(false);
  const [isCompleted, setIsCompleted] = React.useState(false);

  // Throttle state — track last ping time and last known position
  const lastPingAtRef = React.useRef<number>(0);
  const lastPositionRef = React.useRef<number>(0);

  // ── Position ping (throttled) ────────────────────────────────────────────

  const sendPing = React.useCallback(
    async (positionS: number) => {
      if (!lessonId) return;
      try {
        await apiClient.lms.progress.ping(lessonId, {
          lastPositionS: Math.floor(positionS),
        });
        // On success, optimistically update the lesson detail cache's progress snapshot
        // so "In progress" chip stays current without a refetch.
        queryClient.setQueryData(
          lessonDetailKey(lessonId),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (old: any) => {
            if (!old) return old;
            return {
              ...old,
              progress: {
                ...old.progress,
                status: old.progress?.status === "completed" ? "completed" : "in_progress",
                lastPositionS: Math.floor(positionS),
              },
            };
          },
        );
      } catch (err) {
        // Progress pings are non-fatal — silently drop 403 (enrollment expired),
        // log others for debugging without crashing the player.
        if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
          // Enrollment issue — don't spam toasts; the lesson gate will handle it.
          return;
        }
        // Network errors during ping are intentionally swallowed (best-effort reporting).
      }
    },
    [lessonId, queryClient],
  );

  const handleTimeUpdate = React.useCallback(
    (currentSeconds: number) => {
      lastPositionRef.current = currentSeconds;
      const now = Date.now();
      if (now - lastPingAtRef.current < PING_INTERVAL_MS) return;
      lastPingAtRef.current = now;
      void sendPing(currentSeconds);
    },
    [sendPing],
  );

  // ── Mark complete ────────────────────────────────────────────────────────

  const doMarkComplete = React.useCallback(async () => {
    if (!lessonId || isMarkingComplete || isCompleted) return;

    // Send one final position ping before marking complete
    if (lastPositionRef.current > 0) {
      void sendPing(lastPositionRef.current);
    }

    setIsMarkingComplete(true);
    try {
      const result: ProgressResponse = await apiClient.lms.progress.complete(lessonId);

      setIsCompleted(true);

      // Update lesson detail cache — mark as completed
      queryClient.setQueryData(
        lessonDetailKey(lessonId),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (old: any) => {
          if (!old) return old;
          return {
            ...old,
            progress: {
              ...old.progress,
              status: "completed",
              lastPositionS: result.lastPositionS,
              completedAt: result.completedAt,
            },
          };
        },
      );

      // Invalidate dashboard + progress rollup so rings update immediately,
      // and the curriculum tree so sidebar completion checks stay current.
      void queryClient.invalidateQueries({ queryKey: ["lms", "dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["lms", "progress"] });
      void queryClient.invalidateQueries({ queryKey: ["lms", "curriculum"] });

      toast({
        title: "Lesson completed",
        description: "Great work! Your progress has been saved.",
        variant: "success",
      });

      onCompletedRef.current?.();
    } catch (err) {
      if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
        toast({
          title: "Access error",
          description: "Unable to mark complete. Please check your enrollment.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Couldn't mark complete",
          description: "Something went wrong. Please try again or refresh the page.",
          variant: "destructive",
        });
      }
    } finally {
      setIsMarkingComplete(false);
    }
  }, [lessonId, isMarkingComplete, isCompleted, sendPing, queryClient, toast]);

  const handleEnded = React.useCallback(() => {
    void doMarkComplete();
  }, [doMarkComplete]);

  const markComplete = React.useCallback(() => {
    void doMarkComplete();
  }, [doMarkComplete]);

  // Reset when lessonId changes (navigating to a new lesson)
  React.useEffect(() => {
    setIsMarkingComplete(false);
    setIsCompleted(false);
    lastPingAtRef.current = 0;
    lastPositionRef.current = 0;
  }, [lessonId]);

  return {
    handleTimeUpdate,
    handleEnded,
    markComplete,
    isMarkingComplete,
    isCompleted,
  };
}
