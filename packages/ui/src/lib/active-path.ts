/**
 * Active-nav path matching — pure, router-agnostic.
 *
 * `@repo/ui` must not import `next/navigation` (it is consumed by the Vite `crm`
 * SPA too), so components take the current path as a plain prop and use this
 * helper to decide which nav entry owns it.
 */

/** Drop the query/hash and any trailing slash so "/about/?x=1" and "/about" compare equal. */
function normalize(path: string): string {
  const bare = path.split(/[?#]/)[0] ?? "";
  return bare.length > 1 && bare.endsWith("/") ? bare.slice(0, -1) : bare;
}

/**
 * Does `currentPath` fall inside the section that `href` owns?
 *
 * - Only app-internal paths participate: "https://…", "mailto:…" and "#anchor"
 *   never match (an external nav link has no "current page" state).
 * - "/" matches ONLY "/" — a prefix rule would light the home link up everywhere.
 * - Every other href owns itself plus its descendants: "/blog" matches "/blog" and
 *   "/blog/my-post", but NOT "/blogging" (the boundary is a path separator, not a
 *   bare string prefix).
 */
export function isPathActive(
  href: string | null | undefined,
  currentPath: string | null | undefined,
): boolean {
  if (!href || !currentPath || !href.startsWith("/")) return false;

  const target = normalize(href);
  const current = normalize(currentPath);
  if (!target) return false;
  if (target === "/") return current === "/";

  return current === target || current.startsWith(`${target}/`);
}
