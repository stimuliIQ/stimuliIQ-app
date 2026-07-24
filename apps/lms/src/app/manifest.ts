// PWA Web App Manifest — Wave 5b.
//
// Next.js App Router serves this at /manifest.webmanifest automatically
// (MetadataRoute.Manifest). Hand-written — NO next-pwa dependency (CLAUDE.md:
// ask before installing anything unspecified; docs/plans/phase-3.md §Risks).
//
// The student portal is installable (add-to-home-screen) and serves an offline
// app shell via a hand-written service worker (public/sw.js). Video streams and
// API responses are intentionally NEVER cached (signed short-TTL URLs + PII).
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "stimuliiq — Student Portal",
    short_name: "stimuliiq",
    description:
      "Your personal learning portal — courses, progress, and certificates.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#047857",
    icons: [
      {
        src: "/icon.svg",
        type: "image/svg+xml",
        sizes: "any",
        purpose: "any",
      },
      {
        src: "/icon-maskable.svg",
        type: "image/svg+xml",
        sizes: "any",
        purpose: "maskable",
      },
    ],
  };
}
