# ADR 0021: Signed short-TTL per-user HLS delivery

## Status
Accepted

## Context
`docs/02-prd-lms.md` and `docs/05-database-design.md §7` require that video content
is never served via open URLs. Exposing a CDN manifest URL directly to the client would
allow an enrolled student to share the URL with non-enrolled parties, allow caching of
the URL in browser history/DevTools/proxies for an extended period, and would leak the
`provider_asset_id` (the internal CDN asset identifier), which could be used to probe
the video provider directly.

The `VideoProvider` interface introduced in Phase 3 must mint access URLs after a
server-side RBAC + enrollment gate has passed. The URL must expire and must not be
re-usable across users.

Two video providers are supported (Cloudflare Stream, Mux). Both support JWT-signed
per-viewer manifests; the signing key must never leave the server.

## Decision

`VideoProvider.getSignedUrl(userId, lessonId, options)` returns a short-lived signed
HLS manifest URL with the following invariants:

- **The raw manifest URL and `providerAssetId` are never sent to the client.** The
  provider resolves the asset identifier server-side; only the signed URL is returned
  in the `LessonStreamUrlDto`.
- **RS256 JWT signing via `jose`**, using a keypair stored exclusively in the
  environment — per provider: `CLOUDFLARE_STREAM_SIGNING_KEY_ID` /
  `CLOUDFLARE_STREAM_SIGNING_KEY_PEM` for Cloudflare Stream, or `MUX_SIGNING_KEY_ID` /
  `MUX_SIGNING_KEY_PRIVATE` for Mux. The signing operation happens inside the provider
  adapter; the private key is never forwarded to a feature module.
- **TTL is `DEFAULT_HLS_TTL_SECONDS` (default: 300 seconds).** This is short enough
  that a leaked URL is useless within minutes, long enough for the HLS player to
  negotiate the initial segment. The value is configurable via env.
- **Per-user watermark** derived server-side from `userId` (e.g. email/name injected
  as a Cloudflare Stream `accessRules` sub-restriction or Mux playback restriction).
  The watermark is not a client-supplied value; the client never touches the watermark
  parameter.
- **The client must not cache or persist the signed URL.** The LMS lesson player
  fetches a fresh signed URL on every mount via a server action or API call protected
  by the enrollment gate. No signed URL is stored in browser storage,
  `localStorage`, `sessionStorage`, or cookies.
- **Noop adapter for dev/CI**: `NoopVideoProvider` returns a deterministic fake `.m3u8`
  URL (no signing keys needed) so the full stack runs in dev/CI without provider
  credentials.

### Mint endpoint
`GET /api/v1/lms/lessons/:lessonId/stream-url` (authenticated, enrollment-scoped):
1. Resolves the enrollment via `resolveEnrollmentForLesson` (see ADR-0022).
2. Calls `videoProvider.getSignedUrl(userId, lesson.video, { ttlSeconds })`.
3. Returns `{ url, expiresAt }` — never the asset ID, provider name (for Noop the
   provider field is omitted), or manifest path.

The signed URL is minted on each request; the response has `Cache-Control: no-store`.

## Consequences
- A stolen or sniffed signed URL expires in ≤300 s and is only valid from the context
  the provider token was minted for (per-user watermark / viewer token).
- Leaked `providerAssetId` risk is eliminated — the client never sees it.
- Switching video providers requires only a new `VideoProvider` adapter and a DI
  binding change; no change to `LmsService` or the lesson player.
- The 300 s TTL means the player must call `stream-url` again after seeking past the
  end of the initial segment window if the session is long. The player handles this
  with a lazy re-fetch on error (HTTP 401 from the CDN edge triggers a retry of the
  stream-url endpoint).
- Offline video download is intentionally unsupported. Signed short-TTL per-user
  URLs must never be persisted; the PWA service worker explicitly skips all video
  requests (see ADR-0025).

## Alternatives considered
- **Long-TTL signed CDN URLs (e.g. 24 h)**: simpler to implement but creates a
  meaningful sharing window. Rejected — short TTL is a hard requirement per
  `docs/02-prd-lms.md`.
- **Proxy the video stream through the API**: fully eliminates URL leakage but
  multiplies bandwidth cost by 2× and adds latency. Rejected — provider-side signing
  is the industry standard for HLS DRM-lite; the signing key stays server-side, which
  achieves the same access control.
- **Return the raw manifest and sign at the CDN edge via signed cookies**: supported
  by Cloudflare Stream but ties the signing model to a single provider and requires
  cookie domain alignment across origins. Rejected — JWT-per-request is provider-
  agnostic and consistent with the `VideoProvider` interface pattern.
- **HMAC-SHA256 signing instead of RS256**: symmetric key sharing between signer and
  verifier risks key leakage if the verifier (CDN edge worker) is compromised.
  Rejected — RS256 asymmetric signing is the Cloudflare Stream and Mux recommendation.
