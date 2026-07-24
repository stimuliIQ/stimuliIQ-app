// PWA (docs/04 §3.3): implemented in P3 Wave 5b WITHOUT next-pwa — a hand-written
// service worker (public/sw.js) + app/manifest.ts + ServiceWorkerRegister. No extra
// build config is required; Next serves public/sw.js and the generated manifest.
// Offline "downloads" of video are intentionally NOT implemented (signed short-TTL
// per-user HLS URLs must never be persisted); only an app-shell/offline fallback.

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@repo/ui", "@repo/types", "@repo/api-client"],
  // Tree-shake barrel imports per route. Every page imports named exports from
  // the large `@repo/ui` index barrel; without this, a single import can pull the
  // whole barrel (and heavy transitive deps like recharts/radix) into a route's
  // chunk. Next rewrites these to direct submodule imports at build time, so a
  // route only ships the primitives it actually uses. `lucide-react` is included
  // for the same reason (hundreds of icon modules behind one barrel).
  experimental: {
    optimizePackageImports: ["@repo/ui", "lucide-react"],
  },
  // isomorphic-dompurify pulls in `jsdom` for server-side sanitization (lib/sanitize.ts,
  // used by the forum/ticket render paths). jsdom ships a browser stylesheet asset
  // (lib/jsdom/browser/default-stylesheet.js -> default-stylesheet.css) that it loads
  // via a runtime `require()` relative to its own package directory — webpack's server
  // bundler doesn't carry that asset along when jsdom gets inlined into a shared chunk,
  // which fails "Collecting page data" with `ENOENT .../default-stylesheet.css` on
  // whichever route's chunk happens to include it first (pre-existing; reproduces on
  // main with zero lms changes). Marking both packages as server-external keeps them as
  // real `require()`s resolved by Node at runtime instead of bundled, which fixes it.
  serverExternalPackages: ["isomorphic-dompurify", "jsdom"],
};

export default nextConfig;
