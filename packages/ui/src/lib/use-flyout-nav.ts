"use client";

import * as React from "react";

/**
 * The interaction behind a rail/column nav whose sections open a flyout panel.
 * Shared by the CRM sidebar and the LMS side nav so the two cannot drift.
 *
 * HEADLESS ON PURPOSE. It owns the open key, the timers and the dismissal listeners, and
 * returns plain props to spread. It renders nothing and knows nothing about layout, because
 * the two consumers differ in every visual respect (RBAC gating, a mobile drawer versus a
 * bottom tab bar, different `Link` components) and share only the *behaviour* — which is the
 * fiddly part, and therefore the part worth having exactly one copy of.
 *
 * WHAT IT GETS RIGHT, which is easy to get wrong twice:
 *
 *   HOVER ONLY WHERE HOVER EXISTS. Gated on `(hover: hover) and (pointer: fine)`. A phone or
 *   an iPad reports `hover: none`, and a hover-only submenu there is simply unreachable. The
 *   returned `sectionProps.onClick` is wired unconditionally, so tap, click, Enter and Space
 *   open the panel on every device.
 *
 *   HOVER INTENT. The FIRST open waits `openDelayMs`, so dragging the pointer down the column
 *   does not throw a panel at every section on the way past. Once a panel is showing, moving
 *   to a neighbour switches instantly — at that point the intent is not in doubt. Clicks and
 *   keystrokes never wait.
 *
 *   A CLOSE GRACE PERIOD. The pointer can clip a neighbouring row for a frame on its way into
 *   the panel, so leaving schedules a close rather than doing it immediately.
 *
 *   ESCAPE AND OUTSIDE-POINTER dismiss. Both are registered only while something is open.
 *
 * The consumer must attach `containerRef` to the element that encloses BOTH the section rows
 * and the panel, or an outside-pointer press will close the panel the moment you click inside
 * it. When the panel is rendered as a DOM descendant of its row (the usual arrangement),
 * `mouseleave` also does not fire while the pointer is inside the panel, so there is no
 * diagonal-travel dead zone to paper over.
 */
export interface UseFlyoutNavOptions {
  /** Hover-intent delay before the FIRST panel opens. */
  openDelayMs?: number;
  /** Grace period after the pointer leaves before the panel closes. */
  closeDelayMs?: number;
  /**
   * Changes to this value close any open panel. Pass the current pathname: navigating is the
   * end of the interaction, and a panel left open over the page you just opened is a bug.
   */
  closeOn?: unknown;
}

export interface UseFlyoutNavResult {
  /** The section whose panel is open, or null. */
  openKey: string | null;
  isOpen: (key: string) => boolean;
  /** Immediate — clicks, taps and keystrokes are already an expression of intent. */
  open: (key: string) => void;
  close: () => void;
  /** True when the device has a real hover state. */
  canHover: boolean;
  /** Attach to the element enclosing the rows AND the panels. */
  containerRef: React.MutableRefObject<HTMLElement | null>;
  /** Spread onto the row wrapper (the `<li>`): hover intent in, grace period out. */
  hoverProps: (key: string) => { onMouseEnter?: () => void; onMouseLeave?: () => void };
  /** Spread onto the panel: keeps it open while the pointer is inside. */
  panelHoverProps: { onMouseEnter?: () => void };
}

export function useFlyoutNav(options: UseFlyoutNavOptions = {}): UseFlyoutNavResult {
  const { openDelayMs = 120, closeDelayMs = 160, closeOn } = options;

  const [openKey, setOpenKey] = React.useState<string | null>(null);
  const [canHover, setCanHover] = React.useState(false);
  const containerRef = React.useRef<HTMLElement | null>(null);
  const openTimer = React.useRef<number | null>(null);
  const closeTimer = React.useRef<number | null>(null);

  // Capability, not viewport: an iPad at 1024px is wide enough for the desktop layout and
  // still has no hover state. Starts false, so a device that never answers is treated as
  // touch — the safe default, since the click handler works everywhere.
  React.useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(hover: hover) and (pointer: fine)");
    setCanHover(mq.matches);
    const handler = (event: MediaQueryListEvent): void => setCanHover(event.matches);
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    }
    // Safari < 14 only has the deprecated addListener; guard so an old iPad loses
    // hover-open rather than hard-crashing.
    mq.addListener(handler);
    return () => mq.removeListener(handler);
  }, []);

  const cancelTimers = React.useCallback(() => {
    if (openTimer.current !== null) {
      window.clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const open = React.useCallback(
    (key: string) => {
      cancelTimers();
      setOpenKey(key);
    },
    [cancelTimers],
  );

  const close = React.useCallback(() => {
    cancelTimers();
    setOpenKey(null);
  }, [cancelTimers]);

  const hoverOpen = React.useCallback(
    (key: string) => {
      cancelTimers();
      // Already showing one? Switch instantly — the intent is established.
      if (openKey !== null) {
        setOpenKey(key);
        return;
      }
      openTimer.current = window.setTimeout(() => setOpenKey(key), openDelayMs);
    },
    [cancelTimers, openKey, openDelayMs],
  );

  const scheduleClose = React.useCallback(() => {
    cancelTimers();
    closeTimer.current = window.setTimeout(() => setOpenKey(null), closeDelayMs);
  }, [cancelTimers, closeDelayMs]);

  React.useEffect(() => cancelTimers, [cancelTimers]);

  // Navigating ends the interaction.
  React.useEffect(() => {
    cancelTimers();
    setOpenKey(null);
  }, [closeOn, cancelTimers]);

  React.useEffect(() => {
    if (openKey === null) return;

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        cancelTimers();
        setOpenKey(null);
      }
    };
    const onPointerDown = (event: PointerEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) setOpenKey(null);
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [openKey, cancelTimers]);

  const hoverProps = React.useCallback(
    (key: string) =>
      canHover ? { onMouseEnter: () => hoverOpen(key), onMouseLeave: scheduleClose } : {},
    [canHover, hoverOpen, scheduleClose],
  );

  const panelHoverProps = React.useMemo(
    () => (canHover ? { onMouseEnter: cancelTimers } : {}),
    [canHover, cancelTimers],
  );

  const isOpen = React.useCallback((key: string) => openKey === key, [openKey]);

  return { openKey, isOpen, open, close, canHover, containerRef, hoverProps, panelHoverProps };
}
