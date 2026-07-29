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
  ClipboardList,
  Download,
  FileQuestion,
  FolderGit2,
  Home,
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
  type NotificationBellItem,
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

interface NavSection {
  /** Section heading; `null` renders the primary group with no heading. */
  label: string | null;
  items: NavItem[];
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
    { label: null, items: [NAV.home, NAV.courses] },
    { label: "Coursework", items: coursework },
    { label: "Achievements", items: [NAV.progress, NAV.certificates] },
    { label: "Resources", items: [NAV.calendar, NAV.downloads, NAV.forum, NAV.support] },
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
          aria-label="stimuliiq — go to dashboard"
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

function SideNav({ pathname, preference, effectiveCollapsed }: SideNavProps): React.JSX.Element {
  const { hasProjects, pendingCount: pendingProjects } = useMyProjects();
  const sections = React.useMemo(() => buildSections(hasProjects), [hasProjects]);

  // Each variant resolves to a literal class string so Tailwind's scanner keeps
  // it. `null` (auto) carries both the rail classes and their `lg:` overrides,
  // which is what makes the first paint correct without JS.
  const railed = preference === true;
  const auto = preference === null;

  const widthClass = railed ? "w-16" : auto ? "w-16 lg:w-60" : "w-60";
  const navPadClass = railed ? "px-2" : auto ? "px-2 lg:px-3" : "px-3";
  const labelClass = railed ? "hidden" : auto ? "hidden truncate lg:inline" : "truncate";
  // Section headings hide whenever labels do; a centred divider stands in for
  // them in rail mode so the grouping still reads.
  const headingClass = railed ? "hidden" : auto ? "hidden lg:block" : "block";
  const railDividerClass = railed ? "block" : auto ? "block lg:hidden" : "hidden";

  const itemGeometry = railed
    ? "justify-center px-0"
    : auto
      ? "justify-center px-0 lg:justify-start lg:gap-3 lg:px-3"
      : "gap-3 px-3";

  return (
    <aside
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
          "flex flex-1 flex-col gap-1 overflow-y-auto overflow-x-hidden py-4",
          navPadClass,
        )}
        data-testid="lms-sidenav"
      >
        {sections.map((section, sectionIndex) => (
          <div
            key={section.label ?? "primary"}
            role="group"
            aria-label={section.label ?? "Primary"}
            className={sectionIndex > 0 ? "mt-4" : undefined}
          >
            {section.label ? (
              <>
                <p
                  className={cn(
                    "px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle",
                    headingClass,
                  )}
                >
                  {section.label}
                </p>
                <div
                  aria-hidden="true"
                  className={cn("mx-auto mb-1 h-px w-6 bg-border", railDividerClass)}
                />
              </>
            ) : null}

            {section.items.map(({ href, label, Icon, testId }) => {
              const isActive = isItemActive(pathname, href);
              // Outstanding project count — the one nav badge that maps to
              // something blocking (a required final project gates the cert).
              const badge = href === "/projects" && pendingProjects > 0 ? pendingProjects : null;
              return (
                <Link
                  key={href}
                  href={href}
                  data-testid={testId}
                  aria-current={isActive ? "page" : undefined}
                  aria-label={badge ? `${label}, ${badge} pending` : label}
                  title={label}
                  className={navLinkClass(isActive, itemGeometry)}
                >
                  {/* Left accent bar for the active item (hidden in rail mode). */}
                  {isActive ? (
                    <span
                      aria-hidden="true"
                      className={cn(
                        "absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-brand-500",
                        railed ? "hidden" : auto ? "hidden lg:block" : "block",
                      )}
                    />
                  ) : null}
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
                  <span className={labelClass}>{label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
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
 * Auth gating: SignedOutGate redirects signed-out visitors to /login (with a
 * ?next= return target); the per-page isSignedOut cards remain only as a
 * fallback for the frame before the redirect lands. The shell itself still
 * renders immediately to avoid flash while the session is being resolved.
 */
export function LmsShell({ children, wide = false }: LmsShellProps): React.JSX.Element {
  const pathname = usePathname();
  const { preference, effectiveCollapsed, toggle } = useSidenavCollapsed();

  return (
    <div className="min-h-screen bg-bg text-fg">
      {/* Signed-out visitors go straight to /login instead of an empty state. */}
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
