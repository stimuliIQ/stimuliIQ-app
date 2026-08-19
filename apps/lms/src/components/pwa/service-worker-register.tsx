// Service-worker registration — Wave 5b PWA.
//
// Registers public/sw.js on load. Rendered once from the root layout. Kept in a
// tiny client component so the layout itself stays a Server Component.
//
// Registration is intentionally best-effort and non-blocking: any failure (e.g.
// unsupported browser, insecure origin during local http) is swallowed — the app
// works fine without the service worker, it just loses offline capability.
//
// DEV SELF-HEAL: in development this component does not merely decline to register
// — it actively tears down any service worker already controlling the origin. A
// registration left behind by an earlier production build on localhost survives
// `.next` clears and hard refreshes, and goes on serving cached prod
// `/_next/static/*` chunks to a dev runtime that expects fresh ones, which kills
// the client bundle ("Cannot read properties of undefined (reading 'call')") and
// leaves every <Link> inert. public/sw.js carries its own matching valve, but that
// one only fires once the browser gets round to re-fetching sw.js — which it does
// on navigation, the very thing the stale worker has broken. Cleaning up from the
// page side removes that deadlock.
"use client";

import { useEffect } from "react";

export function ServiceWorkerRegister(): null {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    // Development: unregister anything controlling this origin, drop its caches,
    // and reload once so the page comes back straight from the dev server.
    if (process.env.NODE_ENV !== "production") {
      void (async () => {
        try {
          const registrations = await navigator.serviceWorker.getRegistrations();
          // Nothing registered — the common case. Return without reloading, which
          // is also what stops this from looping after the reload below.
          if (registrations.length === 0) return;

          await Promise.all(registrations.map((registration) => registration.unregister()));
          if ("caches" in window) {
            const keys = await caches.keys();
            await Promise.all(keys.map((key) => caches.delete(key)));
          }
          window.location.reload();
        } catch {
          /* best-effort — a browser that denies these APIs is no worse off */
        }
      })();
      return;
    }

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
