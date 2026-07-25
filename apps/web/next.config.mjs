/**
 * next.config.mjs — apps/web Next.js configuration.
 *
 * Phase 5 (Task #6): adds MDX content layer + performance config.
 *   - @next/mdx with remark-frontmatter + remark-mdx-frontmatter + rehype-slug
 *   - pageExtensions: ["ts", "tsx", "mdx"] so MDX files in app/ are treated as routes
 *   - images.formats: AVIF + WebP (performance budget)
 *   - transpilePackages: UI, types, api-client (unchanged)
 *   - headers() for security headers (CSP, HSTS, nosniff, referrer — AC-45)
 *
 * Dependencies already installed (do NOT pnpm add):
 *   @next/mdx, @mdx-js/loader, @mdx-js/react, remark-frontmatter,
 *   remark-mdx-frontmatter, rehype-slug
 */
import createMdx from "@next/mdx";
import remarkFrontmatter from "remark-frontmatter";
import remarkMdxFrontmatter from "remark-mdx-frontmatter";
import rehypeSlug from "rehype-slug";
// Explicit import rather than the global `URL` constructor: packages/config/eslint's
// `*.config.mjs` override declares a closed Node-globals list (module/require/exports/
// __dirname/__filename/process) that does NOT include `URL`, so the bare global trips
// `no-undef` here. Node's global `URL` is the same binding as `node:url`'s named export,
// so this is behavior-identical — just lint-visible.
import { URL } from "node:url";

// ---------------------------------------------------------------------------
// MDX configuration
// ---------------------------------------------------------------------------

const withMDX = createMdx({
  options: {
    remarkPlugins: [
      // Parse YAML frontmatter blocks in MDX files
      remarkFrontmatter,
      // Expose frontmatter as a named export `frontmatter` from each MDX file
      remarkMdxFrontmatter,
    ],
    rehypePlugins: [
      // Auto-generate id attributes on headings (slug from text)
      rehypeSlug,
    ],
  },
});

// ---------------------------------------------------------------------------
// Security headers (AC-45)
// Defines the HTTP response headers for all routes.
// CSP is intentionally permissive in dev; tighten per-deploy in prod.
// ---------------------------------------------------------------------------

/** @type {import('next').NextConfig['headers']} */
async function headers() {
  const isDev = process.env.NODE_ENV !== "production";

  // Public API origin — resolved at build time from env.
  // In dev this is http://localhost:4000; in prod it is the deployed API URL.
  // Used in connect-src so the browser can reach the NestJS API.
  const apiOrigin =
    process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "http://localhost:4000";

  // CSP — allow self + analytics domains after consent + Turnstile + Razorpay + API.
  //
  // script-src:
  //   dev  → unsafe-inline + unsafe-eval to keep Next.js HMR working.
  //   prod → allow-list + 'unsafe-inline'. Next.js App Router hydrates via INLINE
  //          <script> bootstrap tags (self.__next_f.push(...)); a strict
  //          `script-src 'self'` with no nonce/hash blocks them and the app renders a
  //          blank page. A per-request nonce + 'strict-dynamic' (via middleware) is the
  //          stricter alternative and is tracked as a hardening follow-up; 'unsafe-inline'
  //          alongside the explicit host allow-list is the shippable posture for launch.
  //          GTM (*.googletagmanager.com) is loaded post-consent only (AnalyticsLoader).
  //          Razorpay checkout.js is loaded when the enroll funnel opens.
  //          Turnstile challenge script is loaded by the widget.
  //
  // connect-src:
  //   Must include the API origin so fetch() calls to the NestJS backend succeed.
  //   Must include Turnstile siteverify (widget JS pings *.cloudflare.com).
  //   Must include GA4/GTM endpoints (post-consent analytics).
  //
  // frame-src:
  //   Razorpay checkout opens in an iframe.
  //   Turnstile challenge runs in a cross-origin iframe.
  //
  // img-src:
  //   "https:" permits Next.js image optimisation (remote OG / program images).
  //   data: / blob: for inline SVGs and canvas exports.
  //   In dev the API serves uploaded images (mentor/faculty photos, blog covers) over
  //   plain http://localhost:4000 via the "local" StorageProvider, so the API origin is
  //   added to img-src for dev only. In prod those images come from the HTTPS CDN, already
  //   covered by "https:".
  const imgSrc = `img-src 'self' data: blob: https:${isDev ? ` ${apiOrigin}` : ""}`;

  const scriptSrc = isDev
    ? [
        "'self'",
        "'unsafe-inline'",
        "'unsafe-eval'",
        "https://checkout.razorpay.com",
        "https://*.razorpay.com",
        "https://*.googletagmanager.com",
        "https://*.google-analytics.com",
        "https://challenges.cloudflare.com",
      ].join(" ")
    : [
        "'self'",
        // Required for Next.js App Router inline hydration scripts (see note above).
        "'unsafe-inline'",
        "https://checkout.razorpay.com",
        "https://*.razorpay.com",
        "https://*.googletagmanager.com",
        "https://*.google-analytics.com",
        "https://challenges.cloudflare.com",
      ].join(" ");

  const csp = [
    `default-src 'self'`,
    `script-src ${scriptSrc}`,
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
    `font-src 'self' data: https://fonts.gstatic.com`,
    imgSrc,
    // connect-src: self + API origin + analytics + Turnstile endpoints
    `connect-src 'self' ${apiOrigin} https://*.google-analytics.com https://*.analytics.google.com https://stats.g.doubleclick.net https://challenges.cloudflare.com https://*.razorpay.com`,
    // frame-src: Razorpay checkout iframe + Turnstile challenge iframe
    `frame-src https://checkout.razorpay.com https://*.razorpay.com https://challenges.cloudflare.com`,
    `frame-ancestors 'none'`,
    // media-src: the free-preview player on program pages streams lesson video from a
    // short-TTL signed URL. In prod that's the HTTPS CDN; in dev the "local" storage
    // provider serves it from the API origin over plain http, so the API origin is
    // added for dev only (same shape as img-src above). Without this the browser
    // blocks playback with "Media load rejected by URL safety check".
    `media-src 'self' blob: https:${isDev ? ` ${apiOrigin}` : ""}`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
  ].join("; ");

  // HSTS — only sent over HTTPS (prod). Including it over plain HTTP (dev/localhost)
  // would lock the browser to HTTPS on localhost which breaks local dev.
  // preload is intentionally omitted until the domain is submitted to the HSTS preload list.
  const hstsHeader = isDev
    ? null
    : {
        key: "Strict-Transport-Security",
        value: "max-age=31536000; includeSubDomains",
      };

  const securityHeaders = [
    {
      key: "Content-Security-Policy",
      value: csp,
    },
    {
      key: "X-Content-Type-Options",
      value: "nosniff",
    },
    {
      key: "Referrer-Policy",
      value: "strict-origin-when-cross-origin",
    },
    {
      key: "X-Frame-Options",
      value: "DENY",
    },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=()",
    },
    ...(hstsHeader ? [hstsHeader] : []),
  ];

  return [
    {
      source: "/(.*)",
      headers: securityHeaders,
    },
  ];
}

// ---------------------------------------------------------------------------
// Base Next.js config
// ---------------------------------------------------------------------------

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Include .mdx as a page extension (content pages in app/ directory)
  pageExtensions: ["ts", "tsx", "mdx"],

  transpilePackages: ["@repo/ui", "@repo/types", "@repo/api-client"],

  // `@repo/ui`'s RenderSink (T19/T32, docs/plans/phase-9-completion.md) uses
  // isomorphic-dompurify, which pulls in jsdom for server-side sanitization
  // (blog/content-page bodies rendered during SSG/ISR). jsdom resolves internal
  // assets (e.g. its default stylesheet) via Node's normal module resolution;
  // letting webpack bundle it breaks that resolution (ENOENT on
  // "browser/default-stylesheet.css" during "Collecting page data"). Marking it
  // as a server-external package makes Next `require()` it natively instead.
  serverExternalPackages: ["isomorphic-dompurify", "jsdom", "dompurify"],

  // Belt-and-braces alongside `serverExternalPackages` above: force jsdom (and its
  // wrapper packages) to stay a runtime `require()` on the server compiler. Without
  // this, webpack inlines jsdom's internal relative requires (e.g.
  // living/css/helpers/computed-style.js's `path.resolve(__dirname, ...)` lookup of
  // its bundled default-stylesheet.css) and the rewritten `__dirname` no longer
  // points at the real jsdom package directory, throwing ENOENT at request time.
  webpack: (config, { isServer }) => {
    if (isServer) {
      const externalize = ({ request }, callback) => {
        if (request && /^(?:jsdom|isomorphic-dompurify|dompurify)(?:\/.*)?$/.test(request)) {
          return callback(null, `commonjs ${request}`);
        }
        callback();
      };
      config.externals = Array.isArray(config.externals)
        ? [...config.externals, externalize]
        : [config.externals, externalize].filter(Boolean);
    }
    return config;
  },

  // Image optimization: AVIF + WebP (performance budget — LCP<2s)
  //
  // SECURITY (M1a, security review): remotePatterns previously ended with an
  // `{protocol:"https", hostname:"**"}` catch-all — that let Next.js's image optimizer
  // proxy/fetch ANY attacker-supplied HTTPS host (open image-proxy / SSRF-adjacent
  // surface: a CMS-authored `*ImageKey`/`ogImageUrl`-shaped field pointing at an
  // arbitrary URL would be silently fetched server-side). Removed. The allowlist below
  // is exhaustive — every host the app actually loads via `next/image` was audited:
  //   - `**.stimuliiq.com`            — the CDN base every `mintCdnUrl`-minted URL uses
  //                                     (program/testimonial/partner/mentor images;
  //                                     `PUBLIC_ASSET_BASE_URL` default) plus
  //                                     `resolveAssetUrl()` (lib/media.ts) for Phase-10
  //                                     page-builder block images.
  //   - `**.r2.cloudflarestorage.com` — Cloudflare R2 direct (alternate CDN base).
  //   - `localhost` (http, dev only)  — the "local" StorageProvider dev fallback.
  // If a deployment sets `PUBLIC_ASSET_BASE_URL`/`NEXT_PUBLIC_ASSET_BASE_URL` to a host
  // outside `*.stimuliiq.com`, that exact hostname is added explicitly below (not a
  // wildcard) rather than reintroducing a catch-all.
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      // Dev only: the "local" StorageProvider serves uploaded/marketing images over
      // plain http://localhost:4000/api/v1/assets/... The CSP img-src above already
      // allows this origin in dev; next/image needs the matching remotePattern or it
      // 500s ("hostname localhost is not configured"). Never emitted in production
      // (there images come from the HTTPS CDN, covered by the https patterns below).
      ...(process.env.NODE_ENV !== "production"
        ? [{ protocol: "http", hostname: "localhost" }]
        : []),
      {
        // The API CDN (og_image_url, avatar_url, page-builder *ImageKey fields, etc.)
        protocol: "https",
        hostname: "**.stimuliiq.com",
      },
      {
        // Cloudflare R2 / S3 CDN
        protocol: "https",
        hostname: "**.r2.cloudflarestorage.com",
      },
      // Explicit, non-wildcard entry for a configured asset-base host that isn't
      // already covered above (e.g. a deployment-specific CDN domain) — never a "**".
      ...(() => {
        const configuredBase = process.env.PUBLIC_ASSET_BASE_URL ?? process.env.NEXT_PUBLIC_ASSET_BASE_URL;
        if (!configuredBase) return [];
        try {
          const { protocol, hostname } = new URL(configuredBase);
          if (protocol !== "https:" || hostname.endsWith(".stimuliiq.com") || hostname.endsWith(".r2.cloudflarestorage.com")) {
            return [];
          }
          return [{ protocol: "https", hostname }];
        } catch {
          return [];
        }
      })(),
    ],
  },

  // Security headers (AC-45)
  headers,

  // Experimental: React compiler (Next.js 15 opt-in)
  // experimental: { reactCompiler: true },
};

// Compose: withMDX wraps the base config
export default withMDX(nextConfig);
