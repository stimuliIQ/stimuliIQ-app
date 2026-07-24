// Desktop side-nav collapse state for the LMS shell.
//
// Behaviour (see LmsShell): below `md` the side nav is not rendered at all — the
// bottom tab bar takes over — so this hook only matters at md+.
//   - md..lg (768–1023px): the nav shows as an icon rail, because a 224px nav
//     leaves too little room for content in that band.
//   - lg+ (1024px+): expanded.
//
// IMPORTANT: that automatic behaviour is deliberately NOT driven from this hook.
// It is expressed as plain Tailwind `lg:` variants in the shell, so the first
// server-rendered paint is already correct. Deriving it from `matchMedia` in an
// effect made the nav hydrate expanded and then snap to the rail — a visible
// layout shift on every tablet-width load.
//
// This hook owns only the *explicit user preference*, which by definition cannot
// exist until the user clicks. `preference === null` means "no choice yet — let
// CSS decide".
"use client";

import * as React from "react";

const STORAGE_KEY = "lms:sidenav-collapsed";

/** Viewport at/above which the nav auto-expands. Must match `lg:` in the shell. */
const EXPAND_QUERY = "(min-width: 1024px)";

function readStoredPreference(): boolean | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === "1") return true;
    if (raw === "0") return false;
    return null;
  } catch {
    // localStorage can throw in private-mode / blocked-cookie browsers. Treat as
    // "no preference" and let the CSS default apply.
    return null;
  }
}

function writeStoredPreference(collapsed: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
  } catch {
    // Non-fatal — the toggle still works for this session.
  }
}

export interface UseSidenavCollapsed {
  /**
   * Explicit user choice, or `null` when the user hasn't chosen and the
   * viewport-driven CSS default is in effect. Drives the layout classes.
   */
  preference: boolean | null;
  /**
   * Best-effort "is it collapsed right now", resolving `null` against the
   * viewport. Only for things CSS can't express — the toggle's `aria-expanded`
   * and its icon. Never use it for layout, or the hydration flash comes back.
   */
  effectiveCollapsed: boolean;
  toggle: () => void;
}

export function useSidenavCollapsed(): UseSidenavCollapsed {
  const [preference, setPreference] = React.useState<boolean | null>(null);
  // Server and first client render assume the wide (expanded) case; the effect
  // corrects it. This only affects aria/icon, never geometry.
  const [isWideViewport, setIsWideViewport] = React.useState(true);

  React.useEffect(() => {
    setPreference(readStoredPreference());

    const mql = window.matchMedia(EXPAND_QUERY);
    setIsWideViewport(mql.matches);
    const onChange = (event: MediaQueryListEvent): void => setIsWideViewport(event.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  const effectiveCollapsed = preference ?? !isWideViewport;

  const toggle = React.useCallback(() => {
    setPreference((prev) => {
      // Resolve `null` against what the user can currently see, so the first
      // click always flips what's on screen rather than jumping to a default.
      const current = prev ?? !window.matchMedia(EXPAND_QUERY).matches;
      const next = !current;
      writeStoredPreference(next);
      return next;
    });
  }, []);

  return { preference, effectiveCollapsed, toggle };
}
