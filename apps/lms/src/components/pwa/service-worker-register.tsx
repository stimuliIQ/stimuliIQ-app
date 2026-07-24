// Service-worker registration — Wave 5b PWA.
//
// Registers public/sw.js on load. Rendered once from the root layout. Kept in a
// tiny client component so the layout itself stays a Server Component.
//
// Registration is intentionally best-effort and non-blocking: any failure (e.g.
// unsupported browser, insecure origin during local http) is swallowed — the app
// works fine without the service worker, it just loses offline capability.
"use client";

import { useEffect } from "react";

export function ServiceWorkerRegister(): null {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    // Only register in production builds — a SW caching a dev bundle causes
    // confusing stale-asset behavior during local development.
    if (process.env.NODE_ENV !== "production") return;

    const onLoad = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* best-effort — offline support is a progressive enhancement */
      });
    };

    window.addEventListener("load", onLoad);
    return () => window.removeEventListener("load", onLoad);
  }, []);

  return null;
}
