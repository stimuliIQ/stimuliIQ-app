/**
 * resolveAssetUrl — converts a raw S3/R2 object key (as stored in Phase-10 page-builder
 * block fields, e.g. `hero.backgroundImageKey`, `media_gallery.items[].imageKey`) into a
 * public asset URL, mirroring the API's own `mintCdnUrl` convention
 * (apps/api/src/modules/content/content.util.ts) so the same key resolves to the same URL
 * on both sides.
 *
 * Unlike `PublicProgramSummary.ogImageUrl` / `PublicTestimonial.studentPhotoUrl` (minted
 * server-side, delivered as a ready `*Url` field), the page-builder block schemas
 * deliberately keep `*ImageKey` fields as raw object keys even in the RESOLVED/public wire
 * shape (docs/specs/phase-10-page-builder.md "Shared conventions" — object keys, never raw
 * URLs, are the stored contract). `web` is therefore responsible for minting the URL at
 * render time — this helper is that single conversion point for all page-builder blocks.
 *
 * Env: `PUBLIC_ASSET_BASE_URL` (server-only, matches the API's own env var name so ops
 * only sets one CDN base per environment) falling back to the public-bundle
 * `NEXT_PUBLIC_ASSET_BASE_URL`, falling back to the same production default the API uses.
 *
 * SECURITY (M1b, security review): `*ImageKey` fields are validated server-side only as
 * `ObjectKeySchema` (`z.string().min(1).max(500)`, no format/host restriction) — a
 * builder-authored value is NOT guaranteed to actually be a bare storage key. This
 * function must never blindly hand an attacker-controlled absolute/protocol-relative URL
 * to `next/image`'s `src` (that's exactly the open-image-proxy surface next.config.mjs's
 * `images.remotePatterns` allowlist exists to close — see that file's M1a comment).
 * Contract, tightened:
 *   1. The literal `/images/...` prefix passes through unchanged — and ONLY that prefix,
 *      not any leading `/` (the previous, too-broad check). This is the one deliberate
 *      escape hatch: the 6 migrated pages' seed fixtures reference the EXACT static files
 *      shipped in apps/web/public/images/ (never uploaded to S3/R2), so AC 10 ("image
 *      sources ... equivalent to the pre-migration hardcoded version") holds.
 *   2. Protocol-relative ("//host/path") is REJECTED (returns null), never passed
 *      through. `"//evil.com/x".startsWith("/")` is true, which was the exact bug in the
 *      previous "any leading slash" check — a protocol-relative value is an absolute URL
 *      in disguise (the browser resolves it against the current page's scheme).
 *   3. An absolute `http(s)://` URL is passed through ONLY when its host is on the SAME
 *      allowlist as next.config.mjs's `images.remotePatterns` (`*.stimuliiq.com`,
 *      `*.r2.cloudflarestorage.com`, plus `localhost` in dev). Any other host — including
 *      a syntactically valid but off-CDN URL — is rejected (null), never rendered.
 *   4. Everything else (a bare key, or any other slash-prefixed string) is treated as a
 *      storage object key and minted onto the CDN base, exactly as before.
 * A rejected (`null`) value means the caller's `<Image>`/block simply doesn't render that
 * image — never a 500, never an attacker-chosen origin reached.
 */
const DEFAULT_ASSET_BASE = "https://cdn.stimuliiq.com";

/** Same allowlist as next.config.mjs's `images.remotePatterns` — keep these in sync. */
function isAllowedAbsoluteHost(hostname: string): boolean {
  if (hostname.endsWith(".stimuliiq.com") || hostname.endsWith(".r2.cloudflarestorage.com")) return true;
  if (process.env.NODE_ENV !== "production" && hostname === "localhost") return true;
  const configuredBase = process.env.PUBLIC_ASSET_BASE_URL ?? process.env.NEXT_PUBLIC_ASSET_BASE_URL;
  if (configuredBase) {
    try {
      if (new URL(configuredBase).hostname === hostname) return true;
    } catch {
      // malformed env var — ignore, falls through to false
    }
  }
  return false;
}

export function resolveAssetUrl(key: string | null | undefined): string | null {
  if (!key) return null;
  const trimmed = key.trim();
  if (!trimmed) return null;

  // Protocol-relative URL — an absolute URL in disguise. Reject outright (see doc
  // comment point 2) rather than letting it fall into the "/images/" or bare-key paths.
  if (trimmed.startsWith("//")) return null;

  // The one deliberate static-asset escape hatch (see doc comment point 1).
  if (trimmed.startsWith("/images/")) return trimmed;

  // Absolute http(s) URL — only pass through when on the CDN allowlist.
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      if (url.protocol === "https:" && isAllowedAbsoluteHost(url.hostname)) return trimmed;
      if (url.protocol === "http:" && process.env.NODE_ENV !== "production" && url.hostname === "localhost") return trimmed;
    } catch {
      // malformed URL — fall through to reject below.
    }
    return null;
  }

  // Bare storage object key (or any other slash-prefixed string, e.g. a stray
  // "/foo/bar.png" outside the "/images/" escape hatch) — minted onto the CDN base.
  const base = (
    process.env.PUBLIC_ASSET_BASE_URL ??
    process.env.NEXT_PUBLIC_ASSET_BASE_URL ??
    DEFAULT_ASSET_BASE
  ).replace(/\/+$/, "");
  return `${base}/${trimmed.replace(/^\/+/, "")}`;
}
