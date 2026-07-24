// apps/lms/src/components/lessons/create-hls-engine.ts
//
// Cross-browser adaptive-HLS engine for the LMS video player (go-live blocker B4).
//
// The @repo/ui VideoPlayer plays HLS natively where the browser supports it (Safari /
// iOS via `application/vnd.apple.mpegurl`). Chrome, Firefox and Android Chrome do NOT
// support HLS natively — the VideoPlayer exposes a `createHlsEngine` seam so the app
// can inject an MSE-based engine. This wires hls.js into that seam so adaptive HLS
// plays everywhere, not just Safari.
//
// Returns an HlsEngineHandle whose destroy() tears the engine down on unmount / src
// change. When the browser has native HLS, VideoPlayer uses that and never calls this
// factory, so hls.js is only ever attached where it is actually needed.

import Hls from "hls.js";
import type { CreateHlsEngine, HlsEngineHandle } from "@repo/ui";

export const createHlsEngine: CreateHlsEngine = (
  video: HTMLVideoElement,
  src: string,
): HlsEngineHandle => {
  // Defensive: if this ever runs where hls.js isn't supported (very old browser), fall
  // back to setting src directly so behaviour degrades rather than throwing.
  if (!Hls.isSupported()) {
    video.src = src;
    return { destroy: () => void 0 };
  }

  const hls = new Hls({
    // Keep the buffer modest — signed HLS URLs are short-TTL, and students on
    // mid/low-tier Android benefit from not over-buffering.
    maxBufferLength: 30,
    // Start at a conservative level and let ABR climb, so playback starts fast on
    // slower Indian mobile connections.
    startLevel: -1,
    enableWorker: true,
  });

  hls.loadSource(src);
  hls.attachMedia(video);

  return {
    destroy: () => {
      hls.destroy();
    },
  };
};
