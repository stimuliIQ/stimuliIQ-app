// Left nav — docs/03-prd-crm.md §10, redesigned as an icon-rail + flyout.
//
// SHAPE. One column of top-level sections. A section that has children never
// expands *inside* the column any more: it opens a full-viewport-height panel
// flush against the column's right edge listing every child at once. The old
// inline accordion pushed the rest of the nav down, so opening Academics (8
// children) buried Admin below the fold and reading one section meant losing
// sight of the others. The panel is always the same height and in the same
// place, so the column itself never reflows.
//
// HOW IT OPENS. Hover, but only where hover exists: `(hover: hover) and
// (pointer: fine)`. A phone or an iPad reports `hover: none` / `pointer:
// coarse`, and a hover-only submenu there is simply unreachable — so on those
// devices the section's click handler is the only opener, and that handler is
// wired unconditionally, which means tap, click, Enter and Space all work
// everywhere. Keyboard adds ArrowRight/ArrowLeft and Escape.
//
// RESPONSIVE. Below `lg` the column is an off-canvas drawer over a scrim
// (opened by the topbar's menu button); at `lg` and up it is in-flow and can be
// collapsed to a 4rem rail. Every one of those layout decisions is made in CSS
// `lg:` variants rather than in JS, so a first paint that happens before
// `matchMedia` answers can never hide the nav. Below `md` there is no room for
// a 16rem panel *beside* a 16rem drawer, so the panel covers it instead and
// grows a back button.
//
// RBAC gating is unchanged: a section/leaf with a `permission` key only renders
// if `me.permissions` includes it — presentation only, see lib/permissions.ts;
// the API guard is the real enforcement.
import * as React from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, X } from "lucide-react";
import { cn, useFlyoutPosition } from "@repo/ui";
import type { MeResponse } from "@repo/types";

import { NAV_SECTIONS, type NavSection, type NavLeaf } from "../../lib/nav-config";
import { hasPermission, hasPermissionAtScope } from "../../lib/permissions";
import { useMediaQuery } from "../../hooks/use-media-query";
import { ComingSoonBadge } from "./coming-soon-badge";

// One focus-visible recipe for every interactive in the shell (docs/specs/
// crm-ui-consistency.md §8) — ring + offset, matching account-menu.
const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg";

// Shared row geometry, so a section button, a plain link and a disabled span
// are one object in three states rather than three lookalikes.
const ROW =
  "relative flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors duration-fast";
const ROW_IDLE = "text-fg-muted hover:bg-surface hover:text-fg";
// The active row gets a brand-tinted fill plus a left marker; the marker is a
// real element (see ActiveMarker) rather than a text decoration so it survives
// the collapsed rail, where there is no label to decorate.
const ROW_ACTIVE = "bg-brand-50 text-brand-700 dark:bg-surface dark:text-fg";
const ROW_DISABLED = "text-fg-subtle opacity-50";

// Leaving the button towards the panel crosses no gap (the panel is flush), but
// the pointer can still clip a neighbouring row for a frame; a short close
// delay absorbs that without making the panel feel sticky.
const CLOSE_DELAY_MS = 160;
// Hover intent. Without it, dragging the pointer down the column throws a
// third-of-the-screen panel at every section on the way past. It applies only to
// the FIRST open — once a panel is showing, moving to a neighbouring section
// switches instantly, because at that point the intent is not in doubt. Clicks
// and keystrokes never wait.
const OPEN_DELAY_MS = 120;

interface SidebarProps {
  me: MeResponse | undefined;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** Drawer state below `lg`; ignored at `lg` and up, where the nav is in-flow. */
  mobileOpen: boolean;
  /** Must be referentially stable — the route-change effect depends on it. */
  onCloseMobile: () => void;
}

function hasRole(me: MeResponse | undefined, role: string | undefined): boolean {
  if (!role) return true;
  return me?.roles?.includes(role) ?? false;
}

function isSectionVisible(section: NavSection, me: MeResponse | undefined): boolean {
  if (!hasRole(me, section.role)) return false;
  if (!section.permission) return true;
  return hasPermission(me?.permissions, section.permission);
}

export function isLeafVisible(leaf: NavLeaf, me: MeResponse | undefined): boolean {
  if (!hasRole(me, leaf.role)) return false;
  if (!leaf.permission) return true;
  // `permissionScopes` narrows the gate to the scopes the module can actually serve —
  // holding a key at a scope the API rejects is not the same as being able to use it.
  if (leaf.permissionScopes) {
    return hasPermissionAtScope(me?.permissions, leaf.permission, leaf.permissionScopes);
  }
  return hasPermission(me?.permissions, leaf.permission);
}

function testId(label: string): string {
  return label.toLowerCase().replace(/\s+/g, "-");
}

/** The brand bar on the active row — visible in the rail, where labels are not. */
function ActiveMarker(): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      className="absolute inset-y-1.5 -left-2.5 w-[3px] rounded-r-full bg-brand-500"
    />
  );
}

export function Sidebar({
  me,
  collapsed,
  onToggleCollapsed,
  mobileOpen,
  onCloseMobile,
}: SidebarProps): React.JSX.Element {
  const location = useLocation();
  // Capability, not viewport: an iPad at 1024px is wide enough for the desktop
  // layout and still has no hover state.
  const canHover = useMediaQuery("(hover: hover) and (pointer: fine)");
  // Below `md` there is no room for a card BESIDE a 16rem drawer on a 360px phone, so the
  // panel covers it instead. This is the one piece of nav layout JS has to decide: the
  // floating card is positioned from a MEASURED row offset, which CSS cannot compute.
  const canFloatPanel = useMediaQuery("(min-width: 768px)");

  const [openLabel, setOpenLabel] = React.useState<string | null>(null);
  const asideRef = React.useRef<HTMLElement | null>(null);
  const closeTimer = React.useRef<number | null>(null);
  const openTimer = React.useRef<number | null>(null);

  const cancelClose = React.useCallback(() => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const cancelOpen = React.useCallback(() => {
    if (openTimer.current !== null) {
      window.clearTimeout(openTimer.current);
      openTimer.current = null;
    }
  }, []);

  const cancelTimers = React.useCallback(() => {
    cancelClose();
    cancelOpen();
  }, [cancelClose, cancelOpen]);

  /** Immediate — clicks, taps and keystrokes are already an expression of intent. */
  const openSection = React.useCallback(
    (label: string) => {
      cancelTimers();
      setOpenLabel(label);
    },
    [cancelTimers],
  );

  const closeSection = React.useCallback(() => {
    cancelTimers();
    setOpenLabel(null);
  }, [cancelTimers]);

  /** Deferred — see OPEN_DELAY_MS. Switching between sections stays immediate. */
  const hoverOpen = React.useCallback(
    (label: string) => {
      cancelTimers();
      if (openLabel !== null) {
        setOpenLabel(label);
        return;
      }
      openTimer.current = window.setTimeout(() => setOpenLabel(label), OPEN_DELAY_MS);
    },
    [cancelTimers, openLabel],
  );

  const scheduleClose = React.useCallback(() => {
    cancelTimers();
    closeTimer.current = window.setTimeout(() => setOpenLabel(null), CLOSE_DELAY_MS);
  }, [cancelTimers]);

  React.useEffect(() => cancelTimers, [cancelTimers]);

  // Navigating ends the interaction: drop the panel and, on mobile, the whole
  // drawer — otherwise the destination page opens behind a scrim.
  React.useEffect(() => {
    cancelTimers();
    setOpenLabel(null);
    onCloseMobile();
  }, [location.pathname, cancelTimers, onCloseMobile]);

  // Escape closes the panel first and the drawer second, so one keypress never
  // yanks away two layers at once.
  React.useEffect(() => {
    if (!openLabel && !mobileOpen) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      if (openLabel) closeSection();
      else onCloseMobile();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [openLabel, mobileOpen, closeSection, onCloseMobile]);

  // Pointer-down outside the nav dismisses the panel. The panel is a DOM
  // descendant of the aside, so one `contains` check covers both.
  React.useEffect(() => {
    if (!openLabel) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (!asideRef.current?.contains(event.target as Node)) setOpenLabel(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [openLabel]);

  const sections = NAV_SECTIONS.filter((section) => isSectionVisible(section, me));

  // A section without its own `group` continues the previous one (Mentor
  // Dashboard sits under Overview), so a caption only prints on a real change.
  const captions: (string | null)[] = [];
  let seenGroup: string | undefined;
  for (const section of sections) {
    if (section.group && section.group !== seenGroup) {
      captions.push(section.group);
      seenGroup = section.group;
    } else {
      captions.push(null);
    }
  }

  const railClasses = collapsed ? "lg:w-16" : "lg:w-64";
  // Where the flyout's left edge sits, i.e. the column's own width at each
  // breakpoint. Deliberately plain `left-*` utilities rather than a CSS custom
  // property: Tailwind 3.4 emits an arbitrary PROPERTY under a responsive variant
  // WITHOUT its media query, so the collapsed rail's 4rem would have leaked down
  // to tablet widths and the panel would have overlapped the 16rem drawer. Caught
  // by reading the built CSS, not by any test — hence this note.
  //   <md   the panel covers the drawer (no room to sit beside it on a phone)
  //   md+   flush against the 16rem drawer
  //   lg+   flush against the in-flow column, 4rem of it when collapsed
  // `left-0` on a phone (the panel covers the drawer); at md+ it clears the column with a
  // hair of a gap, which is what makes the card read as floating rather than welded on.
  const panelOffset = collapsed
    ? "left-0 md:left-[16.5rem] lg:left-[4.5rem]"
    : "left-0 md:left-[16.5rem] lg:left-[16.5rem]";
  /** Hidden in the collapsed rail; always shown below `lg`, where there is no rail. */
  const labelHidden = collapsed ? "lg:hidden" : undefined;
  /** The mirror of `labelHidden` — rail-only chrome. */
  const railOnly = collapsed ? "lg:block" : undefined;
  /** With the label and chevron gone, the lone icon should sit in the middle of the rail. */
  const railCenter = collapsed ? "lg:justify-center" : undefined;

  return (
    <>
      {/* Scrim. Below `lg` only, and only while the drawer is out. */}
      <div
        aria-hidden="true"
        data-testid="crm-sidebar-scrim"
        onClick={onCloseMobile}
        className={cn(
          "fixed inset-0 z-30 bg-fg/40 transition-opacity duration-base lg:hidden",
          mobileOpen ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />

      <aside
        ref={asideRef}
        id="crm-sidebar"
        data-testid="crm-sidebar"
        aria-label="Primary"
        // Animated with `left`, not `translate-x`: a transformed ancestor becomes
        // the containing block for `position: fixed` descendants, which would trap
        // the flyout panel inside the drawer and break its full-height anchor.
        className={cn(
          "fixed inset-y-0 z-40 flex w-64 flex-col border-r border-border bg-card",
          "transition-[left,width] duration-base ease-out",
          mobileOpen ? "left-0 shadow-md" : "-left-64",
          "lg:static lg:left-0 lg:h-screen lg:shadow-none",
          railClasses,
        )}
      >
        {/* The brand IS the collapse control, which is how a 4rem rail affords one at
            all — there is no room on a 56px row for a mark AND a separate button.
            Expanded: the full wordmark, with the collapse chevron at the far end.
            Collapsed: the mark itself is the button, swapping to an expand chevron
            under the pointer or the focus ring. Same control, same corner, both ways. */}
        <div
          className={cn(
            "flex h-14 shrink-0 items-center gap-2 border-b border-border px-3",
            collapsed && "lg:justify-center lg:px-0",
          )}
        >
          <img
            src="/stimuliiq-logo.png"
            alt="stimuliiq"
            className={cn("h-5 w-auto dark:brightness-0 dark:invert", labelHidden)}
          />

          {/* Rail: mark-as-button. `group` drives the icon swap in CSS, so the hover
              state isn't duplicated in React (and works before hydration). */}
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label="Expand sidebar"
            title="Expand sidebar"
            data-testid="sidebar-toggle-rail"
            className={cn(
              "group relative hidden size-9 shrink-0 items-center justify-center rounded-md transition-colors duration-fast hover:bg-surface",
              collapsed && "lg:flex",
              FOCUS_RING,
            )}
          >
            <img
              src="/icon-192.png"
              alt=""
              aria-hidden="true"
              className="size-7 rounded-md object-contain transition-opacity duration-fast group-hover:opacity-0 group-focus-visible:opacity-0"
            />
            <ChevronsRight
              aria-hidden="true"
              className="absolute size-4 text-fg-muted opacity-0 transition-opacity duration-fast group-hover:opacity-100 group-focus-visible:opacity-100"
            />
          </button>

          {/* Close, below `lg` only — a drawer needs a visible way out that isn't
              "guess that the scrim is tappable". */}
          <button
            type="button"
            onClick={onCloseMobile}
            aria-label="Close menu"
            data-testid="sidebar-close-mobile"
            className={cn(
              "ml-auto rounded-md p-1.5 text-fg-subtle transition-colors duration-fast hover:bg-surface hover:text-fg lg:hidden",
              FOCUS_RING,
            )}
          >
            <X className="size-4" aria-hidden="true" />
          </button>

          {/* Expanded: the ordinary collapse control, top corner. */}
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
            data-testid="sidebar-toggle"
            className={cn(
              "ml-auto hidden shrink-0 rounded-md p-1.5 text-fg-subtle transition-colors duration-fast hover:bg-surface hover:text-fg lg:block",
              labelHidden,
              FOCUS_RING,
            )}
          >
            <ChevronsLeft className="size-4" aria-hidden="true" />
          </button>
        </div>

        <nav className="nav-scroll flex-1 overflow-y-auto p-2" aria-label="CRM sections">
          <ul className="flex flex-col gap-0.5">
            {sections.map((section, index) => (
              <React.Fragment key={section.label}>
                {captions[index] ? (
                  <>
                    <li
                      aria-hidden="true"
                      className={cn("mx-2 mb-1 mt-3 hidden h-px bg-border first:mt-1", railOnly)}
                    />
                    <li
                      className={cn(
                        "px-2.5 pb-1 pt-4 text-[0.6875rem] font-semibold uppercase tracking-wider text-fg-subtle first:pt-1",
                        labelHidden,
                      )}
                    >
                      {captions[index]}
                    </li>
                  </>
                ) : null}
                <SidebarSection
                  section={section}
                  me={me}
                  collapsed={collapsed}
                  panelOffset={panelOffset}
                  canFloatPanel={canFloatPanel}
                  railCenter={railCenter}
                  canHover={canHover}
                  isOpen={openLabel === section.label}
                  onOpen={openSection}
                  onHoverOpen={hoverOpen}
                  onClose={closeSection}
                  onScheduleClose={scheduleClose}
                  onCancelClose={cancelClose}
                  labelHidden={labelHidden}
                  currentPath={location.pathname}
                />
              </React.Fragment>
            ))}
          </ul>
        </nav>

      </aside>
    </>
  );
}

interface SidebarSectionProps {
  section: NavSection;
  me: MeResponse | undefined;
  collapsed: boolean;
  canHover: boolean;
  /** Pre-resolved `left-*` classes for the flyout — see the caller. */
  panelOffset: string;
  /** md+: the flyout floats as a card. Below that it covers the drawer. */
  canFloatPanel: boolean;
  railCenter: string | undefined;
  isOpen: boolean;
  onOpen: (label: string) => void;
  onHoverOpen: (label: string) => void;
  onClose: () => void;
  onScheduleClose: () => void;
  onCancelClose: () => void;
  labelHidden: string | undefined;
  currentPath: string;
}

function SidebarSection({
  section,
  me,
  collapsed,
  canHover,
  panelOffset,
  canFloatPanel,
  railCenter,
  isOpen,
  onOpen,
  onHoverOpen,
  onClose,
  onScheduleClose,
  onCancelClose,
  labelHidden,
  currentPath,
}: SidebarSectionProps): React.JSX.Element {
  const Icon = section.icon;
  const buttonRef = React.useRef<HTMLButtonElement | null>(null);
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const rowRef = React.useRef<HTMLLIElement | null>(null);
  const panelId = `nav-panel-${testId(section.label)}`;

  // Vertical anchor for the rail tooltip, in viewport coordinates. Measured on
  // open rather than tracked continuously: the row cannot move while the pointer
  // is resting on it, and the nav closes the tooltip on scroll-driven mouseleave
  // anyway. `null` until measured, so the first paint is never in the wrong place.
  // Where the floating card sits. The shared hook SLIDES THE CARD UP when it would overhang
  // the bottom, instead of squeezing its height — a section low in the column used to get a
  // sliver of card with its own scrollbar, which defeats the point of showing the whole
  // submenu at once. `top: null` means "not floating": the panel covers the drawer instead.
  const { top: floatTop, maxHeight: floatMaxHeight } = useFlyoutPosition({
    enabled: canFloatPanel && isOpen,
    rowRef,
    panelRef,
  });

  const [tooltipTop, setTooltipTop] = React.useState<number | null>(null);
  React.useLayoutEffect(() => {
    if (!collapsed || !isOpen || !rowRef.current) {
      setTooltipTop(null);
      return;
    }
    const rect = rowRef.current.getBoundingClientRect();
    setTooltipTop(rect.top + rect.height / 2);
  }, [collapsed, isOpen]);

  const visibleChildren = section.children?.filter((child) => isLeafVisible(child, me)) ?? [];
  const hasChildren = Boolean(section.children?.length);

  // Hover intent covers the row AND its panel. Because the panel is a DOM
  // descendant of this `<li>`, `mouseleave` does not fire while the pointer is
  // inside the panel, so there is no diagonal-travel dead zone to paper over.
  const hoverProps = canHover
    ? { onMouseEnter: () => onHoverOpen(section.label), onMouseLeave: onScheduleClose }
    : {};

  if (!hasChildren) {
    const isActive = section.to === currentPath;
    const disabled = section.comingSoon || !section.to;
    return (
      <li
        ref={rowRef}
        className="relative"
        {...(collapsed ? hoverProps : {})}
        // Keyboard reaches the rail too, and a tooltip nobody can tab to is a
        // label that only mouse users get.
        {...(collapsed
          ? { onFocus: () => onOpen(section.label), onBlur: onScheduleClose }
          : {})}
      >
        {disabled ? (
          <span
            aria-disabled="true"
            data-testid={`nav-item-${section.label.toLowerCase()}`}
            className={cn(ROW, ROW_DISABLED, railCenter)}
          >
            <Icon className="size-4 shrink-0" aria-hidden="true" />
            <span className={cn("truncate", labelHidden)}>{section.label}</span>
            {section.comingSoon ? <ComingSoonBadge className={cn("ml-auto", labelHidden)} /> : null}
          </span>
        ) : (
          <Link
            to={section.to}
            data-testid={`nav-item-${section.label.toLowerCase()}`}
            aria-current={isActive ? "page" : undefined}
            className={cn(ROW, isActive ? ROW_ACTIVE : ROW_IDLE, railCenter, FOCUS_RING)}
          >
            {isActive ? <ActiveMarker /> : null}
            <Icon className="size-4 shrink-0" aria-hidden="true" />
            <span className={cn("truncate", labelHidden)}>{section.label}</span>
          </Link>
        )}

        {/* Rail label — puts back the word the collapse took away.
            It has to be `fixed` (the nav clips horizontally: an `overflow-y` of
            `auto` forces `overflow-x` to `auto` too, so an absolutely-positioned
            tooltip would be cut off at the rail's edge). `fixed` with no `top`
            falls back to the element's static position, which is the BOTTOM of the
            row — hence the measured `top` below, centred on the row it labels and
            correct however far the nav has been scrolled. */}
        {collapsed && isOpen && tooltipTop !== null ? (
          <span
            role="tooltip"
            data-testid={`nav-tooltip-${testId(section.label)}`}
            style={{ top: tooltipTop }}
            className="pointer-events-none fixed left-[4.5rem] z-40 hidden -translate-y-1/2 whitespace-nowrap rounded-md border border-border bg-fg px-2.5 py-1.5 text-sm font-medium text-bg shadow-md lg:block"
          >
            {section.label}
          </span>
        ) : null}
      </li>
    );
  }

  // Highlight the parent section whenever one of its (visible) child routes is
  // the active route — matches how a direct-link section already highlights
  // itself, in both the rail and the expanded column.
  const parentActive = visibleChildren.some((child) => child.to === currentPath);

  const onButtonKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key !== "ArrowRight") return;
    event.preventDefault();
    onOpen(section.label);
    // The panel mounts in this same commit; focus its first link once it has.
    window.requestAnimationFrame(() => {
      panelRef.current?.querySelector<HTMLAnchorElement>("a[href]")?.focus();
    });
  };

  const onPanelKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "ArrowLeft") return;
    event.preventDefault();
    onClose();
    buttonRef.current?.focus();
  };

  return (
    // `rowRef` is what the floating panel measures its top from. Without it here the
    // measurement only ever ran for the CHILDLESS branch above, i.e. for the rows that
    // never open a panel at all.
    <li ref={rowRef} className="relative" {...hoverProps}>
      <button
        ref={buttonRef}
        type="button"
        // Wired unconditionally: this is the ONLY opener on a touch device, and
        // on a mouse it doubles as pin/unpin for people who would rather click.
        onClick={() => (isOpen ? onClose() : onOpen(section.label))}
        onKeyDown={onButtonKeyDown}
        aria-expanded={isOpen}
        aria-haspopup="true"
        aria-controls={isOpen ? panelId : undefined}
        data-testid={`nav-section-${section.label.toLowerCase()}`}
        className={cn(ROW, parentActive || isOpen ? ROW_ACTIVE : ROW_IDLE, railCenter, FOCUS_RING)}
      >
        {parentActive ? <ActiveMarker /> : null}
        <Icon className="size-4 shrink-0" aria-hidden="true" />
        <span className={cn("truncate", labelHidden)}>{section.label}</span>
        <ChevronRight
          aria-hidden="true"
          className={cn(
            "ml-auto size-4 shrink-0 text-fg-subtle transition-transform duration-fast",
            isOpen && "translate-x-0.5",
            labelHidden,
          )}
        />
      </button>

      {isOpen ? (
        <div
          ref={panelRef}
          id={panelId}
          onKeyDown={onPanelKeyDown}
          onMouseEnter={canHover ? onCancelClose : undefined}
          data-testid={`nav-panel-${testId(section.label)}`}
          // TWO SHAPES, ONE ELEMENT:
          //   <md  it COVERS the drawer, full height, square-edged. A floating card beside
          //        a 16rem drawer leaves nothing usable on a 360px phone, so on a phone the
          //        panel is the second screen of a drill-down and carries a back button.
          //   md+  a floating card: offset from the column by a hair, rounded, shadowed, and
          //        only as tall as its contents. `top` is measured from the row it belongs
          //        to (CSS cannot compute that), and `maxHeight` runs to the bottom of the
          //        viewport so a long section scrolls inside the card instead of off-screen.
          style={canFloatPanel ? { top: floatTop ?? 0, maxHeight: floatMaxHeight } : undefined}
          className={cn(
            "fixed z-40 flex w-64 flex-col bg-card shadow-md",
            !canFloatPanel ? "inset-y-0 border-r border-border" : "rounded-lg border border-border",
            panelOffset,
          )}
        >
          {/* Phone: a titled header with a way back. Desktop: just the caption, matching the
              section label above the list in the reference design. */}
          <div
            className={cn(
              "flex shrink-0 items-center gap-1.5 px-3",
              !canFloatPanel ? "h-14 border-b border-border" : "pb-1 pt-3",
            )}
          >
            {!canFloatPanel ? (
              <>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label={`Back to menu, close ${section.label}`}
                  data-testid={`nav-panel-back-${testId(section.label)}`}
                  className={cn(
                    "-ml-1 rounded-md p-1.5 text-fg-subtle transition-colors duration-fast hover:bg-surface hover:text-fg",
                    FOCUS_RING,
                  )}
                >
                  <ChevronLeft className="size-4" aria-hidden="true" />
                </button>
                <Icon className="size-4 shrink-0 text-fg-subtle" aria-hidden="true" />
                <h2 className="truncate text-sm font-semibold text-fg">{section.label}</h2>
              </>
            ) : (
              <h2 className="truncate text-[0.6875rem] font-semibold uppercase tracking-wider text-fg-subtle">
                {section.label}
              </h2>
            )}
          </div>

          <ul className="min-h-0 flex-1 overflow-y-auto p-2" aria-label={section.label}>
            {visibleChildren.length === 0 ? (
              <li className="px-2.5 py-2 text-sm text-fg-subtle">Nothing here for your role.</li>
            ) : (
              visibleChildren.map((child) => {
                const ChildIcon = child.icon;
                const isActive = child.to === currentPath;
                const disabled = child.comingSoon || !child.to;
                return (
                  <li key={child.label} className="relative">
                    {disabled ? (
                      <span
                        aria-disabled="true"
                        data-testid={`nav-leaf-${testId(child.label)}`}
                        className={cn(ROW, ROW_DISABLED)}
                      >
                        <ChildIcon className="size-4 shrink-0" aria-hidden="true" />
                        <span className="truncate">{child.label}</span>
                        <ComingSoonBadge className="ml-auto" />
                      </span>
                    ) : (
                      <Link
                        to={child.to}
                        aria-current={isActive ? "page" : undefined}
                        data-testid={`nav-leaf-${testId(child.label)}`}
                        className={cn(ROW, isActive ? ROW_ACTIVE : ROW_IDLE, FOCUS_RING)}
                      >
                        <ChildIcon
                          className={cn("size-4 shrink-0", isActive ? "text-brand-600" : "text-fg-subtle")}
                          aria-hidden="true"
                        />
                        <span className="truncate">{child.label}</span>
                      </Link>
                    )}
                  </li>
                );
              })
            )}
          </ul>
        </div>
      ) : null}
    </li>
  );
}
