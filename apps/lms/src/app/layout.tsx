import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import "@repo/ui/styles.css";
import "./globals.css";

// Self-hosted via next/font: no external request, no layout shift. The CSS
// variables feed the design tokens (--font-sans / --font-display) in globals.css,
// so every @repo/ui component picks the real typeface up automatically.
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  display: "swap",
  variable: "--font-jakarta",
});

import { Providers } from "./providers";
import { ServiceWorkerRegister } from "../components/pwa/service-worker-register";
import { THEME_INIT_SCRIPT } from "../lib/user-prefs";

export const metadata: Metadata = {
  title: "stimuliiq — Student Portal",
  description: "Your personal learning portal — courses, progress, and certificates.",
  // manifest is served by app/manifest.ts at /manifest.webmanifest
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "stimuliiq",
  },
  icons: {
    icon: "/icon.svg",
    apple: "/icon.svg",
  },
};

export const viewport: Viewport = {
  themeColor: "#047857",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jakarta.variable}`} suppressHydrationWarning>
      {/*
       * Skip-to-content link: screen readers and keyboard users land here first.
       * #main-content is set on every page's <main> inside LmsShell.
       */}
      <body>
        {/*
         * Theme init — runs synchronously before paint so a saved "dark" preference
         * (Profile & settings, T34) doesn't flash light-then-dark on load. See
         * ../lib/user-prefs.ts THEME_INIT_SCRIPT for the single source of truth.
         */}
        <script suppressHydrationWarning dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-card focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:shadow"
        >
          Skip to content
        </a>
        <Providers>{children}</Providers>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
