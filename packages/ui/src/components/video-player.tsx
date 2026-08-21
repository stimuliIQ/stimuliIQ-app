"use client";

/**
 * VideoPlayer — protected HLS lesson player for the LMS student portal.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * P3 HLS playback strategy
 * ──────────────────────────────────────────────────────────────────────────────
 * P3 ships TWO modes and a pluggable seam:
 *
 * 1. NATIVE HLS (Safari, iOS): when
 *    `video.canPlayType('application/vnd.apple.mpegurl')` returns a truthy string,
 *    the browser's built-in HLS decoder is used — simply set `video.src = src`.
 *
 * 2. INJECTED HLS ENGINE SEAM: for Chrome / Firefox (which require MSE + hls.js),
 *    P3 does NOT bundle hls.js (no dependency approved yet). Instead the component
 *    accepts an optional `createHlsEngine` prop:
 *
 *      createHlsEngine?: (video: HTMLVideoElement, src: string) => { destroy(): void }
 *
 *    The consuming app (or a future wave once hls.js is dependency-approved) injects:
 *
 *      import Hls from 'hls.js';
 *      function createHlsEngine(video, src) {
 *        const hls = new Hls();
 *        hls.loadSource(src);
 *        hls.attachMedia(video);
 *        return { destroy: () => hls.destroy() };
 *      }
 *      <VideoPlayer src={signedUrl} createHlsEngine={createHlsEngine} />
 *
 *    Without an injected engine and without native HLS support the component renders
 *    an accessible error/fallback state (not a crash).
 *
 * DEFERRED (tracked follow-up):
 *   Cross-browser (Chrome/Firefox) HLS playback via hls.js is intentionally NOT
 *   bundled in P3 — dependency approval is pending. Once approved, inject via
 *   `createHlsEngine`. This is tracked in docs/phase-3-followups.md.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * Props contract
 * ──────────────────────────────────────────────────────────────────────────────
 * - `src` (required): a SHORT-LIVED SIGNED HLS manifest URL minted by the backend's
 *   VideoProvider per docs/04 §2.12. This component NEVER fetches, signs, or caches
 *   URLs itself. The caller (lesson page) is responsible for re-minting on expiry.
 * - `poster?`: cover image shown while video loads.
 * - `captions?`: VTT track URL list (for <track> elements); each entry:
 *   `{ src, srclang, label, default? }`.
 * - `watermarkText?`: per-user overlay text (name + student ID) — decorative,
 *   aria-hidden, semi-transparent. Client-side overlay only in P3; provider-side
 *   forensic watermark is a tracked follow-up (docs/phase-3-followups.md).
 * - `startPositionS?`: seek to this position (seconds) on `onReady`. Used for resume.
 *   Resume accuracy ±2s as per docs/02 §21 — seeking is best-effort after metadata.
 * - `onTimeUpdate(currentSeconds)`: fired on the native `timeupdate` event. Throttling
 *   (e.g. 5 s intervals) is the CALLER's responsibility — typically via a hook that
 *   debounces before `PUT /me/lessons/:id/progress`. See a comment in the handler.
 * - `onEnded()`: fired when playback ends — caller marks lesson complete.
 * - `onReady()`: fired when `loadedmetadata` fires and the `startPositionS` seek (if any)
 *   has been applied — caller may start progress polling at this point.
 * - `onError(detail)`: fired on `error` event — caller may surface a retry UI.
 * - `createHlsEngine?`: optional factory for cross-browser HLS (see seam above).
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * a11y
 * ──────────────────────────────────────────────────────────────────────────────
 * - Native `controls` attribute: keyboard-operable for free (Space/K play-pause,
 *   Left/Right seek, Up/Down volume, M mute, F fullscreen) and screen-reader announced.
 * - captions via <track kind="captions"> per docs/02 §7.3 / docs/07 §11.
 * - Watermark div is aria-hidden="true" (decorative, non-interactive).
 * - Error state renders an accessible region with role="alert".
 * - Loading state renders an accessible skeleton with role="presentation" aria-busy.
 * - Context menu disabled via onContextMenu to prevent easy download.
 */

import * as React from "react";
import { AlertCircle, Loader2 } from "lucide-react";

import { cn } from "../lib/cn";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HlsEngineHandle {
  destroy(): void;
}

/**
 * Factory to inject a cross-browser HLS engine (e.g. hls.js).
 * P3 ships native HLS + this seam; hls.js injection is a tracked follow-up.
 */
export type CreateHlsEngine = (
  video: HTMLVideoElement,
  src: string,
) => HlsEngineHandle;

export interface VideoCaption {
  /** VTT track URL. */
  src: string;
  /** BCP-47 language tag, e.g. "en", "hi". */
  srclang: string;
  /** Human-readable label shown in the browser's caption menu. */
  label: string;
  /** If true, this track is enabled by default. */
  default?: boolean;
}

export type VideoPlayerStatus = "loading" | "ready" | "error" | "unplayable";

export interface VideoPlayerProps {
  /**
   * Short-lived signed HLS manifest URL minted by the backend's VideoProvider.
   * Must NOT be a raw/unsigned CDN URL. This component never fetches or signs URLs.
   */
  src: string;
  /** Cover poster image displayed while the video is loading. */
  poster?: string;
  /** VTT caption tracks — rendered as <track kind="captions"> elements. */
  captions?: VideoCaption[];
  /**
   * Per-user watermark overlay text (e.g. "Priya Sharma · STU-001042").
   * Rendered as a semi-transparent decorative overlay; aria-hidden.
   * P3 = client-side overlay only. Provider-side forensic watermark: tracked follow-up.
   */
  watermarkText?: string;
  /**
   * Seek to this position (seconds) after `loadedmetadata`. Used for resume-where-you-left-off.
   * Accuracy: ±2s (browser seek is best-effort). Per docs/02 §21.
   */
  startPositionS?: number;
  /**
   * Fired on the native `timeupdate` event (approx every 250 ms while playing).
   * THROTTLING IS THE CALLER'S RESPONSIBILITY — wrap in a debounce/interval hook
   * before calling PUT /me/lessons/:id/progress, e.g. only send every 5 s.
   */
  onTimeUpdate?: (currentSeconds: number) => void;
  /** Fired when the video reaches its end — caller should mark the lesson complete. */
  onEnded?: () => void;
  /**
   * Fired when `loadedmetadata` resolves and the `startPositionS` seek has been applied.
   * Caller can begin progress polling at this point.
   */
  onReady?: () => void;
  /** Fired on a native video error or when the browser cannot play HLS without an engine. */
  onError?: (detail: string) => void;
  /**
   * Optional HLS engine factory for Chrome / Firefox (hls.js seam).
   * Example:
   *   import Hls from 'hls.js';
   *   const createHlsEngine = (video, src) => {
   *     const hls = new Hls(); hls.loadSource(src); hls.attachMedia(video);
   *     return { destroy: () => hls.destroy() };
   *   };
   * If omitted and native HLS is unavailable, the component renders an error state.
   * hls.js dependency is NOT bundled here — this is the approved seam for future injection.
   */
  createHlsEngine?: CreateHlsEngine;
  /** Additional className for the outer wrapper div. */
  className?: string;
  /** Test hook; defaults to "video-player" when omitted. */
  "data-testid"?: string;
  /** aria-label for the <video> element (defaults to "Video player"). */
  "aria-label"?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns true when the browser natively supports HLS (Safari / iOS / iPadOS). */
function supportsNativeHls(video: HTMLVideoElement): boolean {
  return !!video.canPlayType("application/vnd.apple.mpegurl");
}

/**
 * Escapes text for safe interpolation into SVG/XML markup. The watermark embeds a
 * user's display name, so characters like `&` and `<` must be entity-encoded or the
 * generated SVG is invalid XML and the browser drops the whole image.
 */
function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * True when `src` is an HLS manifest (needs native HLS or an hls.js engine).
 * Anything else. An mp4/webm/ogg URL, e.g. the signed source URL the local dev
 * video provider mints. Is progressive and plays via a plain `video.src`.
 * The check ignores the query string because signed URLs append `?sig=…&exp=…`.
 */
function isHlsSource(src: string): boolean {
  const pathname = src.split("?")[0] ?? src;
  return pathname.toLowerCase().endsWith(".m3u8");
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const VideoPlayer = React.forwardRef<HTMLDivElement, VideoPlayerProps>(
  (
    {
      src,
      poster,
      captions,
      watermarkText,
      startPositionS,
      onTimeUpdate,
      onEnded,
      onReady,
      onError,
      createHlsEngine,
      className,
      "data-testid": testId,
      "aria-label": ariaLabel = "Video player",
    },
    ref,
  ) => {
    const videoRef = React.useRef<HTMLVideoElement>(null);
    const engineRef = React.useRef<HlsEngineHandle | null>(null);
    const [status, setStatus] = React.useState<VideoPlayerStatus>("loading");
    const [errorMessage, setErrorMessage] = React.useState<string>("");

    // Notify parent of current state
    const handleError = React.useCallback(
      (detail: string) => {
        setStatus("error");
        setErrorMessage(detail);
        onError?.(detail);
      },
      [onError],
    );

    // Set up HLS on mount / when src changes
    React.useEffect(() => {
      const video = videoRef.current;
      if (!video) return;

      setStatus("loading");
      setErrorMessage("");

      // Tear down any previous engine
      if (engineRef.current) {
        engineRef.current.destroy();
        engineRef.current = null;
      }

      // Strategy 0: PROGRESSIVE source (mp4/webm/ogg), play it directly.
      // Only .m3u8 sources need an HLS engine; handing hls.js an MP4 makes it fail
      // with a manifest-parse error even though every browser plays MP4 natively.
      // The local/dev video provider serves source MP4s, so this branch is what
      // makes uploaded video playable without a transcode pipeline.
      if (!isHlsSource(src)) {
        video.src = src;
        return;
      }

      // Strategy 1: native HLS (Safari / iOS / iPadOS)
      if (supportsNativeHls(video)) {
        video.src = src;
        // loadedmetadata fires once the browser has read the manifest
        return;
      }

      // Strategy 2: injected HLS engine seam (e.g. hls.js, caller provides)
      if (createHlsEngine) {
        try {
          engineRef.current = createHlsEngine(video, src);
        } catch (err) {
          handleError(
            err instanceof Error ? err.message : "HLS engine initialization failed",
          );
        }
        return;
      }

      // Neither strategy available, render fallback
      setStatus("unplayable");
      const msg =
        "Your browser does not support HLS playback. " +
        "Please try Safari, or contact support.";
      setErrorMessage(msg);
      onError?.(msg);
    }, [src, createHlsEngine, handleError, onError]);

    // Clean up engine on unmount
    React.useEffect(() => {
      return () => {
        if (engineRef.current) {
          engineRef.current.destroy();
          engineRef.current = null;
        }
      };
    }, []);

    // Video event handlers
    const handleLoadedMetadata = React.useCallback(() => {
      const video = videoRef.current;
      if (!video) return;
      // Resume: seek to startPositionS (±2 s per docs/02 §21)
      if (startPositionS != null && startPositionS > 0) {
        video.currentTime = startPositionS;
      }
      setStatus("ready");
      onReady?.();
    }, [startPositionS, onReady]);

    const handleTimeUpdate = React.useCallback(() => {
      const video = videoRef.current;
      if (!video) return;
      // NOTE: Caller is responsible for throttling this callback.
      // A typical hook debounces to every 5 s before PUT /me/lessons/:id/progress.
      onTimeUpdate?.(video.currentTime);
    }, [onTimeUpdate]);

    const handleEnded = React.useCallback(() => {
      onEnded?.();
    }, [onEnded]);

    const handleVideoError = React.useCallback(() => {
      const video = videoRef.current;
      const detail =
        video?.error?.message ?? "Video playback error, please try again.";
      handleError(detail);
    }, [handleError]);

    const handleContextMenu = React.useCallback((e: React.MouseEvent) => {
      // Prevent right-click save/download per docs/02 §7.3.
      e.preventDefault();
    }, []);

    const isError = status === "error" || status === "unplayable";
    const isLoading = status === "loading";

    return (
      <div
        ref={ref}
        data-testid={testId ?? "video-player"}
        className={cn(
          "relative w-full overflow-hidden rounded-lg bg-black",
          "aspect-video",
          className,
        )}
      >
        {/* Loading overlay */}
        {isLoading ? (
          <div
            role="presentation"
            aria-busy="true"
            aria-label="Video loading"
            className="absolute inset-0 flex items-center justify-center bg-black/80 z-10"
          >
            <Loader2
              aria-hidden="true"
              className="size-10 animate-spin text-fg-subtle"
            />
          </div>
        ) : null}

        {/* Error / unplayable state */}
        {isError ? (
          <div
            role="alert"
            data-testid="video-player-error"
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/90 z-20 px-6 text-center"
          >
            <AlertCircle aria-hidden="true" className="size-10 text-danger" />
            <p className="text-sm font-medium text-fg-muted">{errorMessage}</p>
          </div>
        ) : null}

        {/* Native <video>. Always in the DOM so refs are stable */}
        <video
          ref={videoRef}
          data-testid="video-element"
          aria-label={ariaLabel}
          poster={poster}
          controls
          playsInline
          preload="metadata"
          /*
           * CONTENT PROTECTION (friction layer. NOT DRM, see component header).
           *
           * `nodownload` removes the browser's built-in "Download" item from the
           * player overflow menu (Chrome/Edge/Opera), which otherwise let a student
           * save the lesson MP4 straight to their device. `noremoteplayback` stops
           * casting the stream to an external receiver we can't watermark.
           *
           * This is deterrence, not prevention: a determined user can still reach the
           * bytes via devtools or screen-record the playback. Actual extraction-proof
           * protection requires DRM (Widevine/FairPlay via EME) from the video
           * provider. Tracked as a follow-up. Offline viewing is handled by the
           * app's own IndexedDB store (see lms lib/offline-video-store.ts), never by
           * handing the user a file.
           */
          controlsList="nodownload noremoteplayback"
          disableRemotePlayback
          className="h-full w-full"
          onLoadedMetadata={handleLoadedMetadata}
          onTimeUpdate={handleTimeUpdate}
          onEnded={handleEnded}
          onError={handleVideoError}
          onContextMenu={handleContextMenu}
          // Prevent keyboard shortcut for save in some browsers
          onKeyDown={(e) => {
            if (e.ctrlKey && (e.key === "s" || e.key === "S")) {
              e.preventDefault();
            }
          }}
        >
          {/* Caption tracks. Per docs/02 §7.3 / docs/07 §11 */}
          {captions?.map((track) => (
            <track
              key={track.srclang}
              kind="captions"
              src={track.src}
              srcLang={track.srclang}
              label={track.label}
              default={track.default}
            />
          ))}
        </video>

        {/* Per-user watermark overlay, decorative, aria-hidden, non-interactive.
            P3 = client-side only. Provider-side forensic watermark: tracked follow-up.

            TUNING (2026-07-18): deliberately LOW-CONTRAST and widely spaced. The point
            is forensic traceability of a leaked screen recording, not to nag the paying
            student. The mark only has to survive re-encoding, not be legible at a
            glance. Kept FULL-FRAME (tiled, not a corner badge) so cropping a recording
            can't remove it. Previously this rendered the text TWICE (a tiled background
            AND a solid centred copy at 25% opacity), which is what made it so intrusive
            on dark footage. */}
        {watermarkText ? (
          <div
            aria-hidden="true"
            data-testid="video-player-watermark"
            className="pointer-events-none absolute inset-0 z-30 select-none"
            style={{
              backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(
                `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="220">` +
                  `<text x="50%" y="50%" fill="rgba(255,255,255,0.07)" ` +
                  `font-family="Inter,sans-serif" font-size="13" ` +
                  `text-anchor="middle" dominant-baseline="middle" ` +
                  // escapeXmlText: the watermark carries a USER'S NAME, so it is
                  // untrusted text being interpolated into SVG markup — an unescaped
                  // "&" or "<" (e.g. "Ben & Co") produced invalid XML and the whole
                  // watermark silently vanished.
                  `transform="rotate(-25,210,110)">${escapeXmlText(watermarkText)}</text>` +
                  `</svg>`,
              )}")`,
              backgroundRepeat: "repeat",
              backgroundSize: "420px 220px",
            }}
          />
        ) : null}
      </div>
    );
  },
);
VideoPlayer.displayName = "VideoPlayer";
