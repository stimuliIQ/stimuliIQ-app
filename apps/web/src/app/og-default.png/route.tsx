/**
 * `/og-default.png` — the sitewide Open Graph / Twitter card image.
 *
 * WHY THIS IS A ROUTE AND NOT A FILE IN `public/`.
 * `DEFAULT_OG_IMAGE` in `lib/seo/metadata.ts` has always pointed at `/og-default.png`, and
 * every page on the site advertises that URL in its `og:image` and `twitter:image` tags.
 * The file was never added to `public/`, so the URL returned 404: every link shared to
 * WhatsApp, LinkedIn, X or Slack rendered as a bare text link, and the CMS-editable
 * `seo.defaults.defaultOgImagePath` defaulted to the same dead path. Serving the image from
 * the URL that is already published everywhere fixes it without touching the metadata
 * helper, the seeded site settings, or any link already shared.
 *
 * It is generated rather than checked in because nothing in this repo can author a PNG:
 * there is no image toolchain here, and `next/og` is already part of Next. The response is
 * immutable and cached at the edge, so it is rendered rarely in practice.
 *
 * CONSTRAINTS worth knowing before editing the markup below:
 *   - Satori (what `ImageResponse` renders with) supports flexbox only, no grid, and any
 *     element with more than one child needs an explicit `display: "flex"`.
 *   - The bundled default face is Noto Sans REGULAR — the only weight available. Hierarchy
 *     here therefore comes from size, colour and spacing, never from `fontWeight`, which
 *     would silently render at regular anyway.
 *   - No local files are read and nothing is fetched. An OG image that depends on the file
 *     tracer having picked up `public/logo.png` fails as a 500 in production and as a
 *     working image locally, which is the worst way for this to break.
 *
 * 1200x630 is the size Open Graph, Twitter `summary_large_image` and LinkedIn all expect,
 * and matches the width/height already declared in `buildMetadata`.
 */
import { ImageResponse } from "next/og";

import { SITE_NAME } from "../../lib/seo/metadata";

// Cache hard: the image is static for a given deployment. Without this the route is treated
// as dynamic and re-rendered per request, which is pure cost for a byte-identical result.
export const dynamic = "force-static";

// Brand green (`--brand-500`, #047857) and its pressed shade (`--brand-700`, #024A37) from
// `globals.css`. Duplicated as literals because Satori resolves no CSS variables.
const BRAND = "#047857";
const BRAND_DEEP = "#024A37";

export function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: BRAND_DEEP,
          backgroundImage: `linear-gradient(135deg, ${BRAND} 0%, ${BRAND_DEEP} 100%)`,
          padding: "72px 80px",
          color: "#FFFFFF",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 76,
              height: 76,
              borderRadius: 20,
              backgroundColor: "#FFFFFF",
              color: BRAND,
              fontSize: 34,
              letterSpacing: -1,
            }}
          >
            IQ
          </div>
          <div style={{ marginLeft: 24, fontSize: 40, letterSpacing: -0.5 }}>{SITE_NAME}</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 68, lineHeight: 1.15, letterSpacing: -2 }}>
            Healthcare training and
          </div>
          <div style={{ fontSize: 68, lineHeight: 1.15, letterSpacing: -2 }}>
            internships in India
          </div>
          <div
            style={{
              marginTop: 28,
              fontSize: 30,
              lineHeight: 1.4,
              color: "rgba(255, 255, 255, 0.85)",
            }}
          >
            Psychology, clinical practice and allied health. Mentors who work in
            the field, real case work, and a verifiable certificate.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            fontSize: 26,
            color: "rgba(255, 255, 255, 0.75)",
          }}
        >
          www.stimuliiq.com
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
