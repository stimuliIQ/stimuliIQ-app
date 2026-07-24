// Resolves a page-builder `*ImageKey` field into a previewable URL — docs/specs/
// phase-10-ui-polish-ux-audit.md PB-4 ("Images are raw storage paths with no preview").
// Mirrors apps/web/src/lib/media.ts's `resolveAssetUrl` convention so the SAME key
// resolves to the same place the public site will actually render it:
//   - the `/images/...` static-asset escape hatch resolves against the WEB app's own
//     origin (those files are shipped in apps/web/public/images/, never uploaded to
//     S3/R2 — see media.ts's doc comment point 1);
//   - anything else is treated as a bare storage object key and minted onto the CDN base.
//
// This is a PREVIEW-ONLY helper for an authenticated internal tool (CRM) — unlike `web`'s
// version, it does not need to defend against an attacker-controlled `src` reaching
// `next/image`'s remote-pattern allowlist (there is no `next/image` here, just a plain
// `<img>` with an `onError` fallback — see `image-key-field.tsx`). A malformed/unexpected
// value simply fails to load the thumbnail (the "image not found" warning), never a crash.
//
// Vite inlines `import.meta.env.VITE_*` at build time — never `process.env` in browser code.
const CDN_BASE = ((import.meta.env.VITE_ASSET_BASE_URL as string | undefined) ?? "https://cdn.stimuliiq.com").replace(
  /\/+$/,
  "",
);
const WEB_BASE = ((import.meta.env.VITE_WEB_APP_URL as string | undefined) ?? "http://localhost:3000").replace(
  /\/+$/,
  "",
);

/** Resolves a page-builder image-key field's raw value to a previewable URL, or `null` when
 *  there's nothing to preview yet (empty/untouched field). */
export function resolveBlockImageUrl(key: string | null | undefined): string | null {
  if (!key) return null;
  const trimmed = key.trim();
  if (!trimmed) return null;

  // Protocol-relative — ambiguous scheme; not worth resolving for a preview thumbnail.
  if (trimmed.startsWith("//")) return null;

  // The static-asset escape hatch (matches media.ts) — served by the web app itself.
  if (trimmed.startsWith("/images/")) return `${WEB_BASE}${trimmed}`;

  // Already an absolute URL (author pasted a full link) — preview it as-is.
  if (/^https?:\/\//i.test(trimmed)) return trimmed;

  // Bare storage object key — minted onto the CDN base.
  return `${CDN_BASE}/${trimmed.replace(/^\/+/, "")}`;
}
