/**
 * safeHref — shared CRM-authored-URL sanitizer for every surface that renders a
 * user/CMS-authored `href` into a public `<a>` (Wave 6 L2 finding, originally added to
 * `components/content/content-block-renderer.tsx`; extracted here so the Phase-10
 * page-builder block renderers reuse the exact same allow-list instead of re-deriving it).
 *
 * `@repo/types`'s `HrefSchema` already constrains stored `href` values server-side
 * (relative `/…`, in-page `#…`, `https://…`, or `mailto:…`) — this is defense-in-depth on
 * the render path, not the primary control.
 */
const SAFE_URL_SCHEMES = ["http", "https", "mailto", "tel"];
// Matches C0 control characters (\x00-\x1F) plus space — stripped before scheme detection
// so a smuggled `java\tscript:` can't slip past.
// eslint-disable-next-line no-control-regex -- deliberately matching C0 control chars
const CONTROL_AND_SPACE = /[\x00-\x20]/g;

export function safeHref(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  // Relative path / fragment / query / protocol-relative — no scheme, always safe.
  if (/^(\/|#|\?)/.test(trimmed)) return trimmed;
  const schemeMatch = trimmed.replace(CONTROL_AND_SPACE, "").toLowerCase().match(/^([a-z][a-z0-9+.-]*):/);
  if (!schemeMatch) return trimmed; // no scheme at all → relative link.
  return SAFE_URL_SCHEMES.includes(schemeMatch[1]!) ? trimmed : undefined;
}
