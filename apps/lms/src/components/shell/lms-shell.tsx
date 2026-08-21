// LMS authenticated app shell — top bar + grouped side nav (desktop) + bottom
// tab bar with an overflow "More" drawer (mobile-first PWA).
//
// Per docs/02 §13 ("Persistent left nav desktop / bottom tab bar mobile") and
// docs/02 §14 (mobile-first PWA). The desktop side nav groups destinations into
// labelled sections (Coursework / Achievements / Resources) for scannability;
// the mobile bottom bar shows the three primary destinations plus a "More" drawer
// that surfaces every remaining destination (closing the earlier IA gap where
// several destinations had no mobile entry point).
//
// Account actions (profile, support, sign out) live in a top-bar avatar menu so
// they are reachable from every breakpoint, not buried at the foot of the nav.
//
// No business logic here: data fetching lives in hooks.
"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Award,
  BookOpen,
  CalendarDays,
  ChevronRight,
  ClipboardList,
  Download,
  FileQuestion,
  FolderGit2,
  Home,
  Library,
  LifeBuoy,
  LogOut,
  MessageSquare,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  TrendingUp,
  User,
} from "lucide-react";
import {
  cn,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerTrigger,
  NotificationBell,
  useFlyoutNav,
  useFlyoutPosition,
  type NotificationBellItem,
  type UseFlyoutNavResult,
} from "@repo/ui";

import {
  deriveNotificationBody,
  deriveNotificationTitle,
} from "../../lib/notification-copy";
import { useMe } from "../../hooks/use-me";
import { useLogout } from "../../hooks/use-logout";
import { useNotifications } from "../../hooks/use-notifications";
import { useMyProjects } from "../../hooks/use-my-projects";
import { useSidenavCollapsed } from "../../hooks/use-sidenav-collapsed";
import { FirstLoginGate } from "./first-login-gate";
import { SignedOutGate } from "./signed-out-gate";

// ---------------------------------------------------------------------------
// Nav model
//
// A single flat catalogue of destinations, arranged into labelled sections for
// the desktop side nav. The four PRIMARY hrefs also drive the mobile bottom tab
// bar; everything else lives behind the mobile "More" drawer.
// ---------------------------------------------------------------------------

interface NavItem {
  href: string;
  label: string;
  Icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;
  testId: string;
}

/**
 * A top-level entry in the desktop side nav.
 *
 * Either a DIRECT LINK (`item`) or a SECTION that opens a flyout (`items`), never both —
 * exactly the shape the CRM sidebar uses, so the two apps read as one product.
 *
 * `Icon` is required on a section because the collapsed rail shows nothing else.
 */
interface NavSection {
  /** Section heading, and the flyout's caption. `null` only for the unlabelled primary group. */
  label: string | null;
  Icon?: React.ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;
  /** Children shown in the flyout. Mutually exclusive with `directItems`. */
  items: NavItem[];
  /**
   * Rendered as top-level rows rather than behind a flyout. Home and My Courses are the two
   * places a student goes constantly, and putting them one hover deeper to satisfy a pattern
   * would cost a click on every visit.
   */
  direct?: boolean;
}

const NAV = {
  home: { href: "/", label: "Home", Icon: Home, testId: "nav-home" },
  courses: { href: "/courses", label: "My Courses", Icon: BookOpen, testId: "nav-courses" },
  assignments: { href: "/assignments", label: "Assignments", Icon: ClipboardList, testId: "nav-assignments" },
  // CONDITIONAL: only rendered when the student actually has project work (see
  // useMyProjects). A program without a project issues the certificate straight
  // after completion — an always-empty Projects tab would imply an outstanding
  // requirement that doesn't exist.
  projects: { href: "/projects", label: "Projects", Icon: FolderGit2, testId: "nav-projects" },
  assessments: { href: "/assessments", label: "Assessments", Icon: FileQuestion, testId: "nav-assessments" },
  progress: { href: "/progress", label: "Progress", Icon: TrendingUp, testId: "nav-progress" },
  certificates: { href: "/certificates", label: "Certificates", Icon: Award, testId: "nav-certificates" },
  calendar: { href: "/calendar", label: "Calendar", Icon: CalendarDays, testId: "nav-calendar" },
  downloads: { href: "/downloads", label: "Downloads", Icon: Download, testId: "nav-downloads" },
  forum: { href: "/forum", label: "Forum", Icon: MessageSquare, testId: "nav-forum" },
  support: { href: "/support", label: "Support", Icon: LifeBuoy, testId: "nav-support" },
  profile: { href: "/profile", label: "Profile", Icon: User, testId: "nav-profile" },
} satisfies Record<string, NavItem>;

// Desktop side-nav layout: a primary group (unlabelled) plus three themed
// sections. `buildSections` drops the conditional Projects item when the student
// has none.
function buildSections(hasProjects: boolean): NavSection[] {
  const coursework = hasProjects
    ? [NAV.assignments, NAV.projects, NAV.assessments]
    : [NAV.assignments, NAV.assessments];
  return [
    // Direct rows: the two destinations a student opens on nearly every visit. Putting them
    // behind a flyout to satisfy the pattern would cost a click every single time.
    { label: null, items: [NAV.home, NAV.courses], direct: true },
    { label: "Coursework", Icon: ClipboardList, items: coursework },
    { label: "Achievements", Icon: Award, items: [NAV.progress, NAV.certificates] },
    { label: "Resources", Icon: Library, items: [NAV.calendar, NAV.downloads, NAV.forum, NAV.support] },
  ];
}

// Mobile bottom tab bar: three primary destinations + a "More" overflow drawer.
const MOBILE_PRIMARY: NavItem[] = [NAV.home, NAV.courses, NAV.assignments];
// Hrefs owned by the primary tabs — used to decide when the "More" tab should
// read as active (i.e. the current route is a secondary destination).
const PRIMARY_HREFS = new Set(MOBILE_PRIMARY.map((i) => i.href));

function isItemActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

// ---------------------------------------------------------------------------
// Avatar
// ---------------------------------------------------------------------------

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  return (first + last).toUpperCase() || "?";
}

function Avatar({ name, className }: { name: string; className?: string }): React.JSX.Element {
  // Initials-only avatar: zero external-image config (LMS next.config has no
  // images.remotePatterns), no request, no CLS. The brand-tinted disc doubles as
  // the account-menu anchor.
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex items-center justify-center rounded-full bg-brand-500 text-brand-foreground",
        "text-xs font-semibold leading-none select-none",
        className,
      )}
    >
      {initialsOf(name)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Account menu (top bar) — avatar trigger + dropdown.
// Mirrors NotificationBell's hand-rolled popover: local open state, click-outside
// + Escape to close, full aria wiring. No new dependency.
// ---------------------------------------------------------------------------

function AccountMenu(): React.JSX.Element | null {
  const { me } = useMe();
  const logout = useLogout();
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (!me) return null;
  const name = me.user.name;
  const email = me.user.email;

  const menuItemClass = cn(
    "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-fg-muted",
    "transition-colors duration-fast hover:bg-surface hover:text-fg",
    "focus-visible:outline-none focus-visible:bg-surface focus-visible:text-fg",
  );

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="account-menu"
        aria-label={`Account menu for ${name}`}
        data-testid="topbar-account-menu"
        className={cn(
          "flex items-center gap-2 rounded-full py-1 pl-1 pr-1 md:pr-2.5",
          "transition-colors duration-fast hover:bg-surface",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        <Avatar name={name} className="size-8" />
        <span
          data-testid="topbar-user-name"
          className="hidden max-w-[140px] truncate text-sm font-medium text-fg md:inline"
        >
          {name}
        </span>
      </button>

      {open ? (
        <div
          id="account-menu"
          role="menu"
          aria-label="Account"
          data-testid="account-menu"
          className={cn(
            "absolute right-0 top-full z-50 mt-2 w-64 origin-top-right rounded-lg border border-border bg-card p-1.5 shadow-md",
            "animate-in fade-in zoom-in-95 duration-fast",
          )}
        >
          {/* Identity header */}
          <div className="flex items-center gap-3 px-2.5 py-2">
            <Avatar name={name} className="size-9 shrink-0" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-fg">{name}</p>
              <p className="truncate text-xs text-fg-muted">{email}</p>
            </div>
          </div>
          <div className="my-1 h-px bg-border" aria-hidden="true" />
          <Link
            href="/profile"
            role="menuitem"
            data-testid="account-menu-profile"
            className={menuItemClass}
            onClick={() => setOpen(false)}
          >
            <User aria-hidden="true" className="size-4 shrink-0" />
            Profile &amp; settings
          </Link>
          <Link
            href="/support"
            role="menuitem"
            data-testid="account-menu-support"
            className={menuItemClass}
            onClick={() => setOpen(false)}
          >
            <LifeBuoy aria-hidden="true" className="size-4 shrink-0" />
            Help &amp; support
          </Link>
          <div className="my-1 h-px bg-border" aria-hidden="true" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              logout.mutate();
            }}
            disabled={logout.isPending}
            aria-busy={logout.isPending || undefined}
            data-testid="account-menu-logout"
            className={cn(menuItemClass, "disabled:cursor-not-allowed disabled:opacity-60")}
          >
            <LogOut aria-hidden="true" className="size-4 shrink-0" />
            {logout.isPending ? "Signing out…" : "Sign out"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top bar
// ---------------------------------------------------------------------------

interface TopBarProps {
  /** Resolved side-nav state, for the collapse toggle's aria/icon. */
  effectiveCollapsed: boolean;
  onToggleSidenav: () => void;
}

function TopBar({ effectiveCollapsed, onToggleSidenav }: TopBarProps): React.JSX.Element {
  const router = useRouter();
  const notifications = useNotifications();

  // Map NotificationDto[] → NotificationBellItem[] for the bell component.
  const bellItems: NotificationBellItem[] = notifications.items.map((n) => ({
    id: n.id,
    type: n.type as NotificationBellItem["type"],
    title: deriveNotificationTitle(n.type, n.payload),
    body: deriveNotificationBody(n.payload),
    timestamp: new Date(n.createdAt),
    isRead: Boolean(n.readAt),
  }));

  return (
    <header
      role="banner"
      className="fixed inset-x-0 top-0 z-40 flex h-14 items-center justify-between gap-3 border-b border-border bg-card/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-card/80 md:px-4"
      data-testid="lms-topbar"
    >
      {/* Left: side-nav collapse toggle (desktop only) + logo. */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onToggleSidenav}
          aria-expanded={!effectiveCollapsed}
          aria-controls="lms-sidenav"
          aria-label={effectiveCollapsed ? "Expand navigation" : "Collapse navigation"}
          title={effectiveCollapsed ? "Expand navigation" : "Collapse navigation"}
          data-testid="sidenav-toggle"
          className={cn(
            "hidden md:inline-flex size-9 items-center justify-center rounded-md",
            "text-fg-muted transition-colors duration-fast hover:bg-surface hover:text-fg",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          {effectiveCollapsed ? (
            <PanelLeftOpen aria-hidden="true" className="size-5" />
          ) : (
            <PanelLeftClose aria-hidden="true" className="size-5" />
          )}
        </button>

        <Link
          href="/"
          aria-label="stimuliiq, go to dashboard"
          className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {/* Black wordmark on a transparent PNG — flatten to white in dark theme. */}
          <Image
            src="/stimuliiq-logo.png"
            alt=""
            width={1506}
            height={355}
            priority
            className="h-6 w-auto dark:brightness-0 dark:invert"
          />
        </Link>
      </div>

      {/* Right: search + notifications + account. Search grows into a labelled
          pill on lg+ (more discoverable than a bare icon) and collapses to an
          icon button below. */}
      <div className="flex items-center gap-1.5 sm:gap-2">
        <Link
          href="/search"
          aria-label="Search lessons, resources, and forum"
          data-testid="topbar-search-link"
          className={cn(
            "flex items-center gap-2 rounded-md text-fg-muted transition-colors duration-fast",
            "hover:bg-surface hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            // Icon-only below lg; labelled bordered pill on lg+.
            "size-9 justify-center lg:h-9 lg:w-56 lg:justify-start lg:border lg:border-border lg:bg-surface lg:px-3",
          )}
        >
          <Search aria-hidden="true" className="size-5 lg:size-4" />
          <span className="hidden text-sm lg:inline">Search…</span>
        </Link>

        {!notifications.isSignedOut ? (
          <NotificationBell
            items={bellItems}
            newItemIds={notifications.newItemIds}
            onMarkRead={notifications.markRead}
            onMarkAllRead={notifications.markAllRead}
            onViewAll={() => router.push("/notifications")}
            loading={notifications.isLoading}
            data-testid="lms-notification-bell"
          />
        ) : null}

        <AccountMenu />
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Shared nav-link geometry + active treatment
// ---------------------------------------------------------------------------

/**
 * Active links get a brand-tinted pill, semibold brand text, and a rounded left
 * accent bar (the strongest hierarchy cue in the nav). The accent bar hides in
 * rail mode where the pill is centred.
 */
function navLinkClass(isActive: boolean, geometry: string): string {
  return cn(
    "group relative flex items-center rounded-md py-2.5 text-sm font-medium transition-colors duration-fast",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
    geometry,
    isActive
      ? "bg-brand-50 text-brand-500 font-semibold dark:bg-brand-500/10"
      : "text-fg-muted hover:bg-surface hover:text-fg",
  );
}

// ---------------------------------------------------------------------------
// Desktop side nav (md+ only)
// ---------------------------------------------------------------------------

interface SideNavProps {
  pathname: string;
  /**
   * Explicit user choice, or `null` to follow the viewport (rail below `lg`).
   * Tri-state so the automatic case stays pure CSS — see useSidenavCollapsed.
   */
  preference: boolean | null;
  /** Resolved state, for aria/icon only — never for geometry. */
  effectiveCollapsed: boolean;
}

/**
 * Exported for component tests only — `LmsShell` is the public surface and renders this
 * itself. Testing the nav through the whole shell would mean standing up the top bar, the
 * notification bell, the avatar menu and both auth gates to assert on a list of links.
 */
export function SideNav({ pathname, preference, effectiveCollapsed }: SideNavProps): React.JSX.Element {
  const { hasProjects, pendingCount: pendingProjects } = useMyProjects();
  const sections = React.useMemo(() => buildSections(hasProjects), [hasProjects]);

  // The interaction is shared with the CRM sidebar (@repo/ui useFlyoutNav): hover intent on
  // a mouse, click on touch, escape and outside-pointer to dismiss. Passing `pathname` as
  // `closeOn` means navigating closes the panel, so a student never lands on a page with the
  // menu they used still hanging over it.
  const flyout = useFlyoutNav({ closeOn: pathname });

  // Each variant resolves to a literal class string so Tailwind's scanner keeps
  // it. `null` (auto) carries both the rail classes and their `lg:` overrides,
  // which is what makes the first paint correct without JS.
  const railed = preference === true;
  const auto = preference === null;

  const widthClass = railed ? "w-16" : auto ? "w-16 lg:w-60" : "w-60";
  const navPadClass = railed ? "px-2" : auto ? "px-2 lg:px-3" : "px-3";
  const labelClass = railed ? "hidden" : auto ? "hidden truncate lg:inline" : "truncate";
  const chevronClass = railed ? "hidden" : auto ? "hidden lg:block" : "block";

  const rowGeometry = railed
    ? "justify-center px-0"
    : auto
      ? "justify-center px-0 lg:justify-start lg:gap-3 lg:px-3"
      : "gap-3 px-3";

  return (
    <aside
      ref={flyout.containerRef as React.RefObject<HTMLElement>}
      className={cn(
        "hidden md:flex md:flex-col shrink-0 sticky top-14 self-start h-[calc(100vh-3.5rem)]",
        "border-r border-border transition-[width] duration-200 motion-reduce:transition-none",
        widthClass,
      )}
      data-testid="lms-sidenav-container"
      data-collapsed={effectiveCollapsed ? "true" : "false"}
    >
      <nav
        id="lms-sidenav"
        role="navigation"
        aria-label="Primary"
        className={cn(
          "lms-nav-scroll flex flex-1 flex-col gap-1 overflow-y-auto py-4",
          navPadClass,
        )}
        data-testid="lms-sidenav"
      >
        <ul className="flex flex-col gap-1">
          {sections.map((section, sectionIndex) => {
            // The unlabelled primary group renders its items as top-level rows.
            if (section.direct || !section.label || !section.Icon) {
              return section.items.map((item) => (
                <DirectNavRow
                  key={item.href}
                  item={item}
                  pathname={pathname}
                  pendingProjects={pendingProjects}
                  labelClass={labelClass}
                  rowGeometry={rowGeometry}
                />
              ));
            }
            return (
              <FlyoutNavSection
                key={section.label}
                section={section}
                pathname={pathname}
                pendingProjects={pendingProjects}
                flyout={flyout}
                labelClass={labelClass}
                chevronClass={chevronClass}
                rowGeometry={rowGeometry}
                className={sectionIndex > 0 ? "mt-2" : undefined}
              />
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}

/** A top-level row that navigates directly (Home, My Courses). */
function DirectNavRow({
  item,
  pathname,
  pendingProjects,
  labelClass,
  rowGeometry,
}: {
  item: NavItem;
  pathname: string;
  pendingProjects: number;
  labelClass: string;
  rowGeometry: string;
}): React.JSX.Element {
  const isActive = isItemActive(pathname, item.href);
  const badge = item.href === "/projects" && pendingProjects > 0 ? pendingProjects : null;
  return (
    <li>
      <Link
        href={item.href}
        data-testid={item.testId}
        aria-current={isActive ? "page" : undefined}
        aria-label={badge ? `${item.label}, ${badge} pending` : item.label}
        title={item.label}
        className={navLinkClass(isActive, rowGeometry)}
      >
        <NavRowIcon Icon={item.Icon} badge={badge} />
        <span className={labelClass}>{item.label}</span>
      </Link>
    </li>
  );
}

/**
 * A top-level section whose children live in a flyout card.
 *
 * THE BADGE BUBBLES UP. The outstanding-project count is the one nav badge that maps to
 * something blocking (a required final project gates the certificate). Moving Projects into
 * a flyout would have hidden that count behind a hover, so the section row carries the sum
 * of its children's badges and the child keeps its own.
 */
function FlyoutNavSection({
  section,
  pathname,
  pendingProjects,
  flyout,
  labelClass,
  chevronClass,
  rowGeometry,
  className,
}: {
  section: NavSection;
  pathname: string;
  pendingProjects: number;
  flyout: UseFlyoutNavResult;
  labelClass: string;
  chevronClass: string;
  rowGeometry: string;
  className?: string;
}): React.JSX.Element {
  const key = section.label ?? "";
  const Icon = section.Icon!;
  const rowRef = React.useRef<HTMLLIElement | null>(null);
  const buttonRef = React.useRef<HTMLButtonElement | null>(null);
  const panelId = `lms-nav-panel-${key.toLowerCase()}`;
  const isOpen = flyout.isOpen(key);

  const childActive = section.items.some((item) => isItemActive(pathname, item.href));
  const sectionBadge = section.items.reduce(
    (sum, item) => sum + (item.href === "/projects" ? pendingProjects : 0),
    0,
  );

  // Where the floating card sits. The shared hook SLIDES THE CARD UP when it would overhang
  // the bottom rather than squeezing its height, so a section low in the column still shows
  // its whole submenu instead of growing an internal scrollbar.
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const { top: floatTop, maxHeight: floatMaxHeight } = useFlyoutPosition({
    enabled: isOpen,
    rowRef,
    panelRef,
  });

  return (
    <li ref={rowRef} className={cn("relative", className)} {...flyout.hoverProps(key)}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => (isOpen ? flyout.close() : flyout.open(key))}
        onKeyDown={(event) => {
          if (event.key !== "ArrowRight") return;
          event.preventDefault();
          flyout.open(key);
        }}
        aria-expanded={isOpen}
        aria-haspopup="true"
        aria-controls={isOpen ? panelId : undefined}
        aria-label={sectionBadge > 0 ? `${section.label}, ${sectionBadge} pending` : undefined}
        title={section.label ?? undefined}
        data-testid={`lms-nav-section-${key.toLowerCase()}`}
        className={navLinkClass(childActive || isOpen, cn(rowGeometry, "w-full"))}
      >
        <NavRowIcon Icon={Icon} badge={sectionBadge > 0 ? sectionBadge : null} />
        <span className={labelClass}>{section.label}</span>
        <ChevronRight
          aria-hidden="true"
          className={cn("ml-auto size-4 shrink-0 text-fg-subtle", chevronClass)}
        />
      </button>

      {isOpen ? (
        <div
          id={panelId}
          {...flyout.panelHoverProps}
          onKeyDown={(event) => {
            if (event.key !== "ArrowLeft") return;
            event.preventDefault();
            flyout.close();
            buttonRef.current?.focus();
          }}
          data-testid={`lms-nav-panel-${key.toLowerCase()}`}
          // A floating card offset from the column, only as tall as its contents, anchored
          // to the row that opened it. Same shape as the CRM sidebar's flyout.
          ref={panelRef}
          style={{ top: floatTop ?? 0, maxHeight: floatMaxHeight }}
          className="fixed left-[calc(100%+0.5rem)] z-40 flex w-56 flex-col rounded-lg border border-border bg-card shadow-md"
        >
          <h2 className="shrink-0 truncate px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">
            {section.label}
          </h2>
          <ul className="min-h-0 flex-1 overflow-y-auto p-2" aria-label={section.label ?? undefined}>
            {section.items.map((item) => {
              const isActive = isItemActive(pathname, item.href);
              const badge = item.href === "/projects" && pendingProjects > 0 ? pendingProjects : null;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    data-testid={item.testId}
                    aria-current={isActive ? "page" : undefined}
                    aria-label={badge ? `${item.label}, ${badge} pending` : item.label}
                    className={navLinkClass(isActive, "gap-3 px-3")}
                  >
                    <NavRowIcon Icon={item.Icon} badge={badge} />
                    <span className="truncate">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </li>
  );
}

/** An icon with the optional outstanding-work badge pinned to its corner. */
function NavRowIcon({
  Icon,
  badge,
}: {
  Icon: NavItem["Icon"];
  badge: number | null;
}): React.JSX.Element {
  return (
    <span className="relative shrink-0">
      <Icon aria-hidden="true" className="size-5" />
      {badge ? (
        <span
          aria-hidden="true"
          className="absolute -right-1.5 -top-1.5 flex min-w-4 items-center justify-center rounded-full bg-brand-500 px-1 text-[10px] font-semibold leading-4 text-white"
        >
          {badge}
        </span>
      ) : null}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Mobile "More" overflow drawer — surfaces every destination not on the bottom
// bar, plus sign out. Controlled so navigating a link closes it.
// ---------------------------------------------------------------------------

function MobileMoreMenu({ pathname }: { pathname: string }): React.JSX.Element {
  const { me } = useMe();
  const logout = useLogout();
  const { hasProjects, pendingCount: pendingProjects } = useMyProjects();
  const [open, setOpen] = React.useState(false);
  const sections = React.useMemo(() => buildSections(hasProjects), [hasProjects]);

  // The "More" tab reads as active whenever the current route isn't owned by one
  // of the four primary tabs (i.e. it lives inside this drawer).
  const onPrimary = Array.from(PRIMARY_HREFS).some((href) => isItemActive(pathname, href));
  const moreActive = !onPrimary;

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <button
          type="button"
          data-testid="nav-more"
          aria-label="More destinations"
          className={cn(
            "flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-xs transition-colors duration-fast",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
            moreActive ? "text-brand-500 font-semibold" : "text-fg-muted hover:text-fg",
          )}
        >
          <MoreHorizontal aria-hidden="true" className="size-5" />
          <span>More</span>
        </button>
      </DrawerTrigger>
      <DrawerContent
        position="side"
        size="sm"
        title="Menu"
        data-testid="mobile-more-menu"
      >
        <DrawerBody className="flex flex-col gap-4">
          {me ? (
            <div className="flex items-center gap-3 rounded-lg border border-border bg-surface p-3">
              <Avatar name={me.user.name} className="size-10 shrink-0 text-sm" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-fg">{me.user.name}</p>
                <p className="truncate text-xs text-fg-muted">{me.user.email}</p>
              </div>
            </div>
          ) : null}

          <nav aria-label="All destinations" className="flex flex-col gap-4">
            {sections.map((section) => (
              <div key={section.label ?? "primary"} role="group" aria-label={section.label ?? "Primary"}>
                {section.label ? (
                  <p className="px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">
                    {section.label}
                  </p>
                ) : null}
                <div className="flex flex-col gap-0.5">
                  {section.items.map(({ href, label, Icon, testId }) => {
                    const isActive = isItemActive(pathname, href);
                    const badge = href === "/projects" && pendingProjects > 0 ? pendingProjects : null;
                    return (
                      <Link
                        key={href}
                        href={href}
                        data-testid={`more-${testId}`}
                        aria-current={isActive ? "page" : undefined}
                        onClick={() => setOpen(false)}
                        className={navLinkClass(isActive, "gap-3 px-3")}
                      >
                        <Icon aria-hidden="true" className="size-5 shrink-0" />
                        <span className="flex-1 truncate">{label}</span>
                        {badge ? (
                          <span className="flex min-w-5 items-center justify-center rounded-full bg-brand-500 px-1.5 text-[11px] font-semibold text-white">
                            {badge}
                          </span>
                        ) : null}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>

          <div className="mt-auto border-t border-border pt-3">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                logout.mutate();
              }}
              disabled={logout.isPending}
              aria-busy={logout.isPending || undefined}
              data-testid="sidenav-logout"
              className={cn(
                navLinkClass(false, "gap-3 px-3"),
                "w-full disabled:cursor-not-allowed disabled:opacity-60",
              )}
            >
              <LogOut aria-hidden="true" className="size-5 shrink-0" />
              <span>{logout.isPending ? "Signing out…" : "Sign out"}</span>
            </button>
          </div>
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// Bottom tab bar (mobile, hidden on md+)
// ---------------------------------------------------------------------------

function BottomTabBar({ pathname }: { pathname: string }): React.JSX.Element {
  return (
    <nav
      role="navigation"
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 flex h-16 items-center justify-around border-t border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80 md:hidden"
      data-testid="lms-bottom-nav"
    >
      {MOBILE_PRIMARY.map(({ href, label, Icon, testId }) => {
        const isActive = isItemActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            data-testid={testId}
            aria-current={isActive ? "page" : undefined}
            aria-label={label}
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-xs transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
              isActive ? "text-brand-500 font-semibold" : "text-fg-muted hover:text-fg",
            )}
          >
            <Icon aria-hidden="true" className="size-5" />
            <span>{label}</span>
          </Link>
        );
      })}
      <MobileMoreMenu pathname={pathname} />
    </nav>
  );
}

// ---------------------------------------------------------------------------
// LmsShell — authenticated page wrapper
// ---------------------------------------------------------------------------

export interface LmsShellProps {
  children: React.ReactNode;
  /**
   * Widens the main content column (max-w-6xl instead of the default max-w-5xl).
   * Used by the course/lesson player pages that render a curriculum sidebar next
   * to the content (Udemy-style two-column layout).
   */
  wide?: boolean;
}

/**
 * LmsShell wraps authenticated LMS pages.
 * - Top bar: logo + search + notifications + account menu (all breakpoints)
 * - Desktop: grouped side nav (md+), collapsible to an icon rail; auto-rails md..lg
 * - Mobile: bottom tab bar (4 primary tabs + "More" drawer)
 * - Main: scrollable content area with padding to clear the fixed bars
 *
 * Auth gating, in two layers:
 *   1. `src/middleware.ts` redirects cookie-less visitors to /login at the edge, so
 *      they never receive this shell at all.
 *   2. This component refuses to paint the authenticated chrome until `/me` confirms
 *      a session — covering the case middleware can't judge, a cookie that is present
 *      but expired or revoked. Previously the shell rendered immediately "to avoid
 *      flash", which meant a signed-out visitor saw the whole side nav and tab bar
 *      around a "You're signed out" card until SignedOutGate's redirect landed.
 * `SignedOutGate` still performs the client-side redirect for layer 2; the per-page
 * isSignedOut cards remain as a last-resort fallback.
 */
export function LmsShell({ children, wide = false }: LmsShellProps): React.JSX.Element {
  const pathname = usePathname();
  const { preference, effectiveCollapsed, toggle } = useSidenavCollapsed();
  const { isLoading, isSignedOut } = useMe();

  // No session (or not yet known) -> no nav, no tab bar, no account menu. Rendered as
  // a bare status region rather than null so assistive tech isn't left on a silent
  // empty page while the redirect is in flight. NOTE: every hook above runs on both
  // paths, so this early return can't change hook order between renders.
  if (isSignedOut || isLoading) {
    return (
      <div className="min-h-screen bg-bg text-fg">
        <SignedOutGate />
        <div role="status" aria-live="polite" className="flex min-h-screen items-center justify-center px-4">
          <span className="sr-only">{isSignedOut ? "Redirecting to sign in" : "Loading your account"}</span>
          <span
            aria-hidden="true"
            className="size-6 animate-spin rounded-full border-2 border-border border-t-transparent"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg text-fg">
      {/* Layer-2 redirect for a present-but-invalid session (see doc comment). */}
      <SignedOutGate />
      {/* Forced first-login password change (lifecycle-redesign P3). */}
      <FirstLoginGate />
      <TopBar effectiveCollapsed={effectiveCollapsed} onToggleSidenav={toggle} />

      <div className="flex pt-14">
        <SideNav
          pathname={pathname}
          preference={preference}
          effectiveCollapsed={effectiveCollapsed}
        />

        <main
          id="main-content"
          tabIndex={-1}
          className={cn(
            "flex-1 min-w-0 px-4 py-6 pb-24 md:pb-8 md:px-8 md:py-8 mx-auto w-full",
            wide ? "max-w-6xl" : "max-w-5xl",
          )}
        >
          {children}
        </main>
      </div>

      <BottomTabBar pathname={pathname} />
    </div>
  );
}
