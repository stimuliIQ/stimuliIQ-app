// SignedOutGate — redirects signed-out visitors to /login instead of leaving them
// on an authenticated page's "You're signed out" empty state. Rendered inside
// LmsShell, which wraps every authenticated page — so one gate covers the whole
// authenticated surface. /login is NOT shelled, so the gate never fires on the
// page it redirects to (no loop). Mirrors FirstLoginGate.
//
// The per-page signed-out cards stay as a fallback for the single frame between
// the 401 surfacing and the redirect landing.
//
// `isSignedOut` is only true after the api-client's silent refresh attempt has
// failed (see lib/api-client.ts onUnauthorized) — a student with a valid rotating
// refresh cookie never sees this redirect.
"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";

import { useMe } from "../../hooks/use-me";

export function SignedOutGate(): null {
  const { isSignedOut } = useMe();
  const router = useRouter();
  const pathname = usePathname();

  React.useEffect(() => {
    if (!isSignedOut) return;
    // Carry the attempted destination so login can return the student there
    // (login/page.tsx safeNext). "/" is the default target — omit the param.
    const next =
      pathname && pathname !== "/" ? `?next=${encodeURIComponent(pathname)}` : "";
    router.replace(`/login${next}`);
  }, [isSignedOut, pathname, router]);

  return null;
}
