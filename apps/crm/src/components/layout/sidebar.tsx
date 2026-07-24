// Collapsible left nav — docs/03-prd-crm.md §10. Renders the full nav tree;
// items the route doesn't support yet (`comingSoon`) render disabled with a
// visible "Soon" badge so the IA reads complete without dead links. RBAC
// gating: a section/leaf with a `permission` key only renders if `me.permissions`
// includes it — this is presentation-only, see lib/permissions.ts; the API
// guard is the real enforcement.
import * as React from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { ChevronDown, ChevronsLeft, ChevronsRight } from "lucide-react";
import { cn } from "@repo/ui";
import type { MeResponse } from "@repo/types";

import { NAV_SECTIONS, type NavSection } from "../../lib/nav-config";
import { hasPermission } from "../../lib/permissions";
import { ComingSoonBadge } from "./coming-soon-badge";

// One focus-visible recipe for every interactive in the shell (docs/specs/
// crm-ui-consistency.md §8) — ring + offset, matching account-menu.
const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg";

interface SidebarProps {
  me: MeResponse | undefined;
  collapsed: boolean;
  onToggleCollapsed: () => void;
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

function isLeafVisible(leaf: { permission?: string; role?: string }, me: MeResponse | undefined): boolean {
  if (!hasRole(me, leaf.role)) return false;
  if (!leaf.permission) return true;
  return hasPermission(me?.permissions, leaf.permission);
}

export function Sidebar({ me, collapsed, onToggleCollapsed }: SidebarProps): React.JSX.Element {
  const location = useLocation();
  const [openSections, setOpenSections] = React.useState<Set<string>>(() => new Set(["Students", "Academics"]));

  const toggleSection = (label: string) => {
    setOpenSections((current) => {
      const next = new Set(current);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  return (
    <aside
      data-testid="crm-sidebar"
      aria-label="Primary"
      className={cn(
        "flex h-screen flex-col border-r border-border bg-card transition-[width] duration-base ease-out",
        collapsed ? "w-16" : "w-64",
      )}
    >
      <div className="flex h-14 items-center border-b border-border px-3">
        {collapsed ? null : (
          <img src="/stimuliiq-logo.png" alt="stimuliiq" className="h-5 w-auto dark:brightness-0 dark:invert" />
        )}
        {/* `ml-auto` (not `justify-between` on the parent) keeps the toggle
            anchored to the same edge whether or not the logo is rendered, so
            it doesn't jump position across the collapse transition. */}
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          data-testid="sidebar-toggle"
          className={cn(
            "ml-auto rounded-md p-1.5 text-fg-subtle transition-colors duration-fast hover:bg-surface hover:text-fg",
            FOCUS_RING,
          )}
        >
          {collapsed ? <ChevronsRight className="size-4" aria-hidden="true" /> : <ChevronsLeft className="size-4" aria-hidden="true" />}
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto p-2" aria-label="CRM sections">
        <ul className="flex flex-col gap-0.5">
          {NAV_SECTIONS.filter((section) => isSectionVisible(section, me)).map((section) => {
            const Icon = section.icon;
            const hasChildren = Boolean(section.children?.length);
            const sectionOpen = openSections.has(section.label);
            const visibleChildren = section.children?.filter((child) => isLeafVisible(child, me)) ?? [];

            if (!hasChildren) {
              const isActive = section.to === location.pathname;
              const title = collapsed ? section.label : undefined;
              return (
                <li key={section.label}>
                  {section.comingSoon || !section.to ? (
                    <span
                      aria-disabled="true"
                      title={title}
                      data-testid={`nav-item-${section.label.toLowerCase()}`}
                      className="flex items-center gap-2 rounded-md px-2.5 py-2 text-sm font-medium text-fg-subtle opacity-50"
                    >
                      <Icon className="size-4 shrink-0" aria-hidden="true" />
                      {collapsed ? null : <span className="truncate">{section.label}</span>}
                      {!collapsed && section.comingSoon ? <ComingSoonBadge className="ml-auto" /> : null}
                    </span>
                  ) : (
                    <Link
                      to={section.to}
                      title={title}
                      data-testid={`nav-item-${section.label.toLowerCase()}`}
                      aria-current={isActive ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-2 rounded-md px-2.5 py-2 text-sm font-medium text-fg-muted transition-colors duration-fast",
                        "hover:bg-surface hover:text-fg",
                        FOCUS_RING,
                        isActive && "bg-surface text-fg",
                      )}
                    >
                      <Icon className="size-4 shrink-0" aria-hidden="true" />
                      {collapsed ? null : <span className="truncate">{section.label}</span>}
                    </Link>
                  )}
                </li>
              );
            }

            // Highlight the parent section whenever one of its (visible) child
            // routes is the active route — matches how a direct-link section
            // already highlights itself, applied in both collapsed and
            // expanded states (docs/specs/crm-ui-consistency.md §8).
            const parentActive = visibleChildren.some((child) => child.to === location.pathname);

            return (
              <li key={section.label}>
                <button
                  type="button"
                  onClick={() => toggleSection(section.label)}
                  aria-expanded={sectionOpen}
                  title={collapsed ? section.label : undefined}
                  data-testid={`nav-section-${section.label.toLowerCase()}`}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm font-medium text-fg-muted transition-colors duration-fast",
                    "hover:bg-surface hover:text-fg",
                    FOCUS_RING,
                    parentActive && "bg-surface text-fg",
                  )}
                >
                  <Icon className="size-4 shrink-0" aria-hidden="true" />
                  {collapsed ? null : (
                    <>
                      <span className="truncate">{section.label}</span>
                      <ChevronDown
                        aria-hidden="true"
                        className={cn("ml-auto size-4 transition-transform duration-fast", sectionOpen && "rotate-180")}
                      />
                    </>
                  )}
                </button>
                {!collapsed && sectionOpen ? (
                  <ul className="ml-6 mt-0.5 flex flex-col gap-0.5 border-l border-border pl-2">
                    {visibleChildren
                      .map((child) => {
                        const isActive = child.to === location.pathname;
                        return (
                          <li key={child.label}>
                            {child.comingSoon || !child.to ? (
                              <span
                                aria-disabled="true"
                                data-testid={`nav-leaf-${child.label.toLowerCase().replace(/\s+/g, "-")}`}
                                className="flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-sm text-fg-subtle opacity-50"
                              >
                                <span className="truncate">{child.label}</span>
                                <ComingSoonBadge />
                              </span>
                            ) : (
                              <Link
                                to={child.to}
                                aria-current={isActive ? "page" : undefined}
                                data-testid={`nav-leaf-${child.label.toLowerCase().replace(/\s+/g, "-")}`}
                                className={cn(
                                  "flex items-center rounded-md px-2.5 py-1.5 text-sm text-fg-muted transition-colors duration-fast",
                                  "hover:bg-surface hover:text-fg",
                                  FOCUS_RING,
                                  isActive && "bg-surface text-fg",
                                )}
                              >
                                <span className="truncate">{child.label}</span>
                              </Link>
                            )}
                          </li>
                        );
                      })}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
