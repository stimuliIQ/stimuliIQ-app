# ADR 0026: VideoPlayer engine seam — native HLS only in P3

## Status
Accepted

## Context
HLS (HTTP Live Streaming) is not natively supported by all browsers:

- **Safari (macOS + iOS)**: natively supports HLS via `<video src="...m3u8">`.
- **Chrome and Firefox (desktop + Android)**: do not support HLS natively. HLS
  playback in these browsers requires a JavaScript library such as `hls.js` that
  implements an HLS demuxer and feeds segments to the browser's Media Source Extensions
  (MSE) API.

The LMS lesson player (`apps/lms/src/components/lesson-player.tsx`) needs to handle
both cases. The standard pattern is to inject a "HLS engine" factory that the player
can call when the browser cannot play HLS natively:

```ts
<VideoPlayer
  src={signedUrl}
  createHlsEngine={hlsEngineFactory}   // undefined in P3
/>
```

Installing `hls.js` (or an equivalent such as `video.js`, `plyr`, or `Shaka Player`)
requires a dependency-approval decision: the package is ~500 KB (unminified), has its
own update cycle, and is a meaningful supply-chain addition to the LMS bundle.

## Decision
In Phase 3, the `createHlsEngine` prop is **left unwired** (`undefined`). The
`VideoPlayer` component detects HLS support via `video.canPlayType('application/vnd.apple.mpegurl')`
and plays natively when supported. When native HLS is not supported and no
`createHlsEngine` factory is provided, the player renders a graceful "browser not
supported" fallback UI (rather than crashing).

This means:
- **Safari and iOS**: full HLS playback with real provider keys.
- **Chrome and Firefox**: video playback is not available until `hls.js` is wired.
  The fallback UI is displayed.

The `createHlsEngine` seam is preserved in the component interface exactly as
designed, so wiring `hls.js` in P4 (or sooner if the dependency is approved) requires:
1. `pnpm add hls.js` (user approval required before installing).
2. A three-line factory function passed to `<VideoPlayer createHlsEngine={...} />`.
3. No changes to the player component itself.

## Consequences
- P3 ships a working video player for Safari/iOS without any new npm dependency.
- Chrome/Firefox users see a "browser not supported" message until `hls.js` is wired.
  For the MVP this is acceptable because the primary student device profile (India
  mobile) skews heavily toward mobile Safari and Chrome for Android (which can be
  served via native HLS on some Android versions or via `hls.js` once wired).
- The seam ensures no rework when `hls.js` is introduced; the interface is stable.
- **The `hls.js` dependency installation requires explicit user approval** before
  `pnpm add hls.js` is run in the repo. Do not install it silently as part of a
  build or setup script.

## Alternatives considered
- **Install `hls.js` in P3**: eliminates the Chrome/Firefox gap immediately, but the
  dependency-approval process was not completed during P3. Deferred to P4.
- **Use a CDN-hosted `hls.js` loaded dynamically**: avoids a local dependency but
  adds a CDN as a runtime availability dependency and requires a CSP `script-src`
  exception for the CDN host. Rejected as architecturally messier than a local install.
- **Use `video.js` (includes HLS support)**: full-featured media player, but larger
  bundle (~1 MB) and opinionated styling that conflicts with the design system.
  Rejected for MVP.
- **Use Mux's `@mux/mux-player` web component**: zero-config, includes HLS via
  `hls.js` under the hood, Mux-provider-specific. Deferred — if Mux becomes the
  primary video provider it is a compelling option; the `VideoProvider` abstraction
  means the player can be swapped without touching the backend.
