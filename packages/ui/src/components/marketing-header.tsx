"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as AccordionPrimitive from "@radix-ui/react-accordion";
import { ChevronDown, Menu, X } from "lucide-react";

import { cn } from "../lib/cn";
import { isPathActive } from "../lib/active-path";

/**
 * MarketingHeader + MegaMenu — sticky site header for the `web` app, per
 * docs/07-design-system.md §5/§6/§12 (web "warm, spacious" personality) and
 * docs/01-prd-website.md §7.1/§10/§14/§15.
 *
 * a11y:
 * - Semantic <header> with role="banner" (implicit).
 * - <nav> with aria-label for the primary nav.
 * - MegaMenu is a Radix Dialog so it is focus-trapped on mobile (accordion mode).
 * - Desktop mega-menu panel: aria-expanded on trigger, focus-managed via keyboard.
 * - Escape key closes the mega-menu from any position inside it.
 * - Skip-to-content link is rendered by the app layout (not here) — slot respected.
 * - "Book Free Slot" CTA and WhatsApp float are always present (prop-driven).
 *
 * SSR-safety: no window/document at module scope; useEffect guards client-only behaviour
 * (scroll listener). `"use client"` because this mounts scroll listeners and manages open
 * state.
 *
 * Usage:
 *   <MarketingHeader
 *     logo={<img src="/logo.svg" alt="StimuliiQ" />}
 *     navItems={[
 *       {
 *         label: "Programs",
 *         megaMenu: {
 *           sections: [
 *             { heading: "Data", items: [{ label: "Python", href: "/programs/python" }] },
 *           ],
 *         },
 *       },
 *       { label: "About", href: "/about" },
 *     ]}
 *     bookSlotHref="/book-free-slot"
 *     onBookSlotClick={() => {}}
 *   />
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A marketing badge on a mega-menu row, pre-resolved by the caller (web's
 * `resolveMarketingBadge`). The colour arrives as an inline style rather than a token
 * because staff pick it freely in the CRM — same contract as `ProgramCard.badgeStyle`.
 */
export interface MegaMenuItemBadge {
  label: string;
  style: React.CSSProperties;
}

export interface MegaMenuSection {
  heading: string;
  items: Array<{
    label: string;
    href: string;
    description?: string;
    /** Optional chip after the label, e.g. the program's "New" badge. */
    badge?: MegaMenuItemBadge;
  }>;
}

export interface MegaMenuConfig {
  sections: MegaMenuSection[];
  /** Optional footer CTA strip rendered below the columns. */
  footer?: React.ReactNode;
}

export interface NavItem {
  label: string;
  /** Plain link href — used when this item has no mega-menu. */
  href?: string;
  /** Mega-menu config; when present this item behaves as a popover trigger. */
  megaMenu?: MegaMenuConfig;
  /**
   * Extra paths this item owns for ACTIVE-STATE matching only — never rendered as a
   * link. Needed when `href` can't express it: a mega-menu entry renders as a button
   * with no href of its own, so the "Courses" item carries `activeMatch: ["/programs"]`
   * to light up on the catalog page as well as on each program inside its panel.
   */
  activeMatch?: string[];
}

export interface MarketingHeaderProps {
  /** Logo slot — typically an <img> or a Next.js Image. */
  logo: React.ReactNode;
  /** Primary navigation items. */
  navItems: NavItem[];
  /** href for the persistent "Book Free Slot" CTA. */
  bookSlotHref: string;
  /**
   * Current pathname (Next: `usePathname()`). The nav item that owns it renders in the
   * active style and carries `aria-current`. Optional so this package stays
   * router-agnostic — omitted, nothing is marked active.
   */
  activePath?: string;
  /** Called when the CTA button is clicked (optional — href still works). */
  onBookSlotClick?: () => void;
  /** Additional className on the outer <header>. */
  className?: string;
  /** Test hook; defaults to "marketing-header". */
  "data-testid"?: string;
}

// ---------------------------------------------------------------------------
// Active state
// ---------------------------------------------------------------------------

/**
 * Underline bar under the active desktop nav item. An underline rather than a filled
 * pill because the header's whole visual language is "background stays white, only the
 * text colour moves" (see the trigger className below) — a pill would be the only solid
 * shape in the bar. Rendered as an ::after so it costs no extra DOM node and can't be
 * picked up by the accessibility tree.
 */
const ACTIVE_UNDERLINE =
  "after:absolute after:inset-x-3 after:bottom-1 after:h-0.5 after:rounded-full after:bg-brand-500 after:content-['']";

/**
 * Active row in the mobile sheet. The rows are full-width blocks stacked on a divided
 * list, so the desktop underline reads as a divider there — a leading brand bar plus a
 * tinted row is the equivalent that survives the different layout. `pl` compensates for
 * the 2px border so the labels stay optically aligned with the inactive rows.
 */
const MOBILE_ACTIVE =
  "border-l-2 border-brand-500 bg-brand-50 pl-[calc(1rem_-_2px)] text-brand-700";

/**
 * Does this nav entry own the current path? Checked in cost order:
 * its own href → its declared `activeMatch` paths → any destination inside its
 * mega-menu panel (so a program detail page lights up "Courses" without the caller
 * having to enumerate every slug).
 */
function isNavItemActive(item: NavItem, activePath?: string): boolean {
  if (!activePath) return false;
  if (isPathActive(item.href, activePath)) return true;
  if (item.activeMatch?.some((href) => isPathActive(href, activePath))) return true;
  return (
    item.megaMenu?.sections.some((section) =>
      section.items.some((link) => isPathActive(link.href, activePath)),
    ) ?? false
  );
}

// ---------------------------------------------------------------------------
// Mega-menu row badge
// ---------------------------------------------------------------------------

/**
 * Badge chip shown after a mega-menu row's label. Smaller and pill-shaped where
 * `ProgramCard`'s is a squared ribbon overlaying an image — these rows are dense text, so
 * the chip has to sit on the baseline as an annotation rather than compete with the title.
 *
 * `align-middle` + `whitespace-nowrap` keep it on the label's line: the row is inline
 * content (the optional description is a sibling block below), so without them a long
 * badge would drop or wrap mid-word in a narrow column.
 *
 * Not exposed to assistive tech separately — the label already names the destination and
 * "New" read after every such link is noise, so the chip is decorative here.
 */
function MegaMenuBadge({ badge }: { badge: MegaMenuItemBadge }) {
  return (
    <span
      className={
        "ml-2 inline-block whitespace-nowrap rounded-full px-1.5 py-0.5 align-middle " +
        "text-[10px] font-bold uppercase leading-none tracking-wider"
      }
      style={badge.style}
    >
      {badge.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Desktop mega-menu panel
// ---------------------------------------------------------------------------

interface DesktopMegaMenuProps {
  config: MegaMenuConfig;
  isOpen: boolean;
  onClose: () => void;
  triggerId: string;
  panelId: string;
  activePath?: string;
}

function DesktopMegaMenu({
  config,
  isOpen,
  onClose,
  triggerId,
  panelId,
  activePath,
}: DesktopMegaMenuProps): React.JSX.Element | null {
  const panelRef = React.useRef<HTMLDivElement>(null);

  // Close on Escape from anywhere inside the panel
  React.useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        // Return focus to the trigger
        const trigger = document.getElementById(triggerId);
        trigger?.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, triggerId]);

  // Close on outside click
  React.useEffect(() => {
    if (!isOpen) return;
    function handlePointerDown(e: PointerEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        const trigger = document.getElementById(triggerId);
        if (!trigger?.contains(e.target as Node)) {
          onClose();
        }
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isOpen, onClose, triggerId]);

  if (!isOpen) return null;

  return (
    <div
      ref={panelRef}
      id={panelId}
      role="region"
      aria-label="Programs menu"
      className={cn(
        // Solid white panel, hairline top border, soft shadow — no tinted surface, so
        // it reads as one continuous white sheet with the header above it.
        "absolute left-0 right-0 top-full z-50 mt-px border-t border-border bg-card",
        "shadow-[0_8px_24px_-12px_rgb(0_0_0/0.18)]",
        "animate-in fade-in slide-in-from-top-1 duration-[150ms]",
      )}
    >
      <div className="mx-auto max-w-screen-xl px-6 py-8">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-3 lg:grid-cols-4">
          {config.sections.map((section) => (
            <div key={section.heading}>
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
                {section.heading}
              </p>
              <ul className="flex flex-col gap-1" role="list">
                {section.items.map((item) => {
                  const isCurrent = isPathActive(item.href, activePath);
                  return (
                  <li key={item.href}>
                    <a
                      href={item.href}
                      onClick={onClose}
                      aria-current={isCurrent ? "page" : undefined}
                      className={cn(
                        // Group so the label can take the accent colour on row hover.
                        "group block rounded-md px-2 py-1.5 text-sm text-fg-muted",
                        // Faint brand tint instead of a grey fill — enough to show which
                        // row is active without breaking the white surface.
                        "transition-colors duration-[150ms] ease-out hover:bg-brand-50",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                        // The current program keeps the hover tint permanently.
                        isCurrent && "bg-brand-50",
                      )}
                    >
                      <span
                        className={cn(
                          "font-medium text-fg transition-colors group-hover:text-brand-700",
                          isCurrent && "text-brand-700",
                        )}
                      >
                        {item.label}
                      </span>
                      {item.badge ? <MegaMenuBadge badge={item.badge} /> : null}
                      {item.description ? (
                        <span className="mt-0.5 block text-xs text-fg-muted">
                          {item.description}
                        </span>
                      ) : null}
                    </a>
                  </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
        {config.footer ? (
          <div className="mt-6 border-t border-border pt-6">{config.footer}</div>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mobile menu (Radix Dialog with accordion for mega-menu items)
// ---------------------------------------------------------------------------

interface MobileMenuProps {
  navItems: NavItem[];
  bookSlotHref: string;
  onBookSlotClick?: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activePath?: string;
}

function MobileMenu({
  navItems,
  bookSlotHref,
  onBookSlotClick,
  open,
  onOpenChange,
  activePath,
}: MobileMenuProps): React.JSX.Element {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        {/* Overlay */}
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-fg/40 data-[state=open]:animate-in data-[state=open]:fade-in data-[state=closed]:animate-out data-[state=closed]:fade-out" />

        {/* Panel slides in from top */}
        <DialogPrimitive.Content
          aria-label="Navigation menu"
          className={cn(
            "fixed inset-x-0 top-0 z-50 max-h-[90vh] overflow-y-auto bg-card shadow-md",
            "data-[state=open]:animate-in data-[state=open]:slide-in-from-top data-[state=closed]:animate-out data-[state=closed]:slide-out-to-top",
            "duration-[200ms]",
            "focus-visible:outline-none",
          )}
        >
          {/* Hidden title for a11y */}
          <DialogPrimitive.Title className="sr-only">Navigation menu</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Site navigation links
          </DialogPrimitive.Description>

          {/* Close button row */}
          <div className="flex items-center justify-end border-b border-border px-4 py-4">
            <DialogPrimitive.Close
              aria-label="Close navigation menu"
              className={cn(
                "rounded-md p-2 text-fg-subtle transition-colors hover:bg-surface hover:text-fg",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
            >
              <X className="size-5" aria-hidden="true" />
            </DialogPrimitive.Close>
          </div>

          {/* Nav items */}
          <nav aria-label="Mobile navigation">
            <AccordionPrimitive.Root
              type="multiple"
              // The section containing the current page starts expanded, so opening the
              // menu on a program page shows where you are without a tap.
              defaultValue={navItems
                .filter((item) => item.megaMenu && isNavItemActive(item, activePath))
                .map((item) => item.label)}
              className="divide-y divide-border"
            >
              {navItems.map((item) => {
                const isActive = isNavItemActive(item, activePath);

                if (item.megaMenu) {
                  return (
                    <AccordionPrimitive.Item key={item.label} value={item.label}>
                      <AccordionPrimitive.Header asChild>
                        <h2 className="m-0">
                          <AccordionPrimitive.Trigger
                            aria-current={isActive ? "true" : undefined}
                            className={cn(
                              "flex w-full items-center justify-between px-4 py-4 text-base font-medium text-fg",
                              "transition-colors hover:bg-surface",
                              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                              "[&[data-state=open]>svg]:rotate-180",
                              isActive && MOBILE_ACTIVE,
                            )}
                          >
                            {item.label}
                            <ChevronDown
                              aria-hidden="true"
                              className="size-4 shrink-0 text-fg-muted transition-transform duration-[150ms] ease-out"
                            />
                          </AccordionPrimitive.Trigger>
                        </h2>
                      </AccordionPrimitive.Header>
                      <AccordionPrimitive.Content className="overflow-hidden data-[state=open]:animate-accordion-down data-[state=closed]:animate-accordion-up">
                        <div className="bg-surface px-4 pb-4">
                          {item.megaMenu.sections.map((section) => (
                            <div key={section.heading} className="mt-4">
                              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
                                {section.heading}
                              </p>
                              <ul className="flex flex-col gap-1" role="list">
                                {section.items.map((link) => {
                                  const isCurrent = isPathActive(link.href, activePath);
                                  return (
                                    <li key={link.href}>
                                      <a
                                        href={link.href}
                                        onClick={() => onOpenChange(false)}
                                        aria-current={isCurrent ? "page" : undefined}
                                        className={cn(
                                          "block rounded-md px-2 py-2 text-sm text-fg-muted",
                                          "hover:bg-card hover:text-fg",
                                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                                          isCurrent && "bg-card font-medium text-brand-700",
                                        )}
                                      >
                                        {link.label}
                                        {link.badge ? <MegaMenuBadge badge={link.badge} /> : null}
                                      </a>
                                    </li>
                                  );
                                })}
                              </ul>
                            </div>
                          ))}
                        </div>
                      </AccordionPrimitive.Content>
                    </AccordionPrimitive.Item>
                  );
                }

                return (
                  <div key={item.label}>
                    <a
                      href={item.href}
                      onClick={() => onOpenChange(false)}
                      aria-current={isActive ? "page" : undefined}
                      className={cn(
                        "block px-4 py-4 text-base font-medium text-fg",
                        "transition-colors hover:bg-surface",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                        isActive && MOBILE_ACTIVE,
                      )}
                    >
                      {item.label}
                    </a>
                  </div>
                );
              })}
            </AccordionPrimitive.Root>
          </nav>

          {/* CTA */}
          <div className="border-t border-border p-4">
            <a
              href={bookSlotHref}
              onClick={() => {
                onBookSlotClick?.();
                onOpenChange(false);
              }}
              className={cn(
                "flex min-h-[44px] w-full items-center justify-center rounded-md bg-brand-500 px-6 text-base font-semibold text-white",
                "transition-colors hover:bg-brand-600 active:bg-brand-700",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              )}
            >
              Book Free Slot
            </a>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

// ---------------------------------------------------------------------------
// MarketingHeader (public component)
// ---------------------------------------------------------------------------

export function MarketingHeader({
  logo,
  navItems,
  bookSlotHref,
  onBookSlotClick,
  activePath,
  className,
  "data-testid": testId,
}: MarketingHeaderProps): React.JSX.Element {
  const [isSticky, setIsSticky] = React.useState(false);
  const [openMegaMenu, setOpenMegaMenu] = React.useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = React.useState(false);

  // Sticky scroll detection — client-only, guarded with useEffect
  React.useEffect(() => {
    function onScroll() {
      setIsSticky(window.scrollY > 4);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Close mega-menu when mobile menu opens (and vice-versa)
  React.useEffect(() => {
    if (mobileOpen) setOpenMegaMenu(null);
  }, [mobileOpen]);

  // Hover-to-open, but ONLY on devices that genuinely hover. On a touchscreen a tap
  // fires mouseenter AND click; with hover-open wired to mouseenter the click would
  // immediately toggle the just-opened panel shut, so the menu could never be opened
  // by tapping. Gating on `(hover: hover) and (pointer: fine)` leaves touch on the
  // click-to-toggle path. Read in an effect — `matchMedia` is browser-only.
  const supportsHover = React.useRef(false);
  React.useEffect(() => {
    supportsHover.current = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  }, []);

  return (
    <>
      <header
        data-testid={testId ?? "marketing-header"}
        // Closing on the HEADER's mouseleave (not the trigger's) is what makes
        // hover-to-open usable: the mega-menu panel is rendered inside this element, so
        // moving the pointer from the trigger down into the panel never leaves the
        // header and never closes it. No timers, no gap-bridging hacks.
        onMouseLeave={() => {
          if (supportsHover.current) setOpenMegaMenu(null);
        }}
        className={cn(
          // Solid white rather than bg-card/95 + blur: with a white panel hanging off
          // the bottom, a translucent header let page content ghost through and made
          // the two surfaces read as slightly different whites.
          "sticky top-0 z-40 w-full border-b border-border bg-card",
          "transition-shadow duration-[150ms] ease-out",
          isSticky && "shadow-sm",
          className,
        )}
      >
        <div className="relative mx-auto flex max-w-screen-xl items-center gap-6 px-4 py-3 md:px-6">
          {/* Logo */}
          <a
            href="/"
            aria-label="StimuliiQ — home"
            className="shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card rounded-sm"
          >
            {logo}
          </a>

          {/* Desktop nav */}
          <nav aria-label="Primary navigation" className="hidden lg:flex lg:flex-1 lg:items-center lg:gap-1">
            {navItems.map((item) => {
              const isActive = isNavItemActive(item, activePath);

              if (item.megaMenu) {
                const isOpen = openMegaMenu === item.label;
                const triggerId = `mega-trigger-${item.label.replace(/\s+/g, "-").toLowerCase()}`;
                const panelId = `mega-panel-${item.label.replace(/\s+/g, "-").toLowerCase()}`;

                return (
                  <div
                    key={item.label}
                    className="relative"
                    onMouseEnter={() => {
                      if (supportsHover.current) setOpenMegaMenu(item.label);
                    }}
                  >
                    <button
                      id={triggerId}
                      type="button"
                      aria-expanded={isOpen}
                      aria-controls={isOpen ? panelId : undefined}
                      aria-haspopup="true"
                      // "true" rather than "page": the trigger is a button that opens a
                      // panel, not the link to the current page — one of its children is.
                      aria-current={isActive ? "true" : undefined}
                      onClick={() => setOpenMegaMenu(isOpen ? null : item.label)}
                      className={cn(
                        "relative inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium",
                        // Minimal: no filled pill in any state — the background stays white
                        // and only the text/chevron colour carries hover + open.
                        "bg-transparent text-fg-muted transition-colors hover:text-brand-600",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        (isOpen || isActive) && "text-brand-600",
                        isActive && ACTIVE_UNDERLINE,
                      )}
                    >
                      {item.label}
                      <ChevronDown
                        aria-hidden="true"
                        className={cn(
                          "size-3.5 transition-transform duration-[150ms] ease-out",
                          isOpen && "rotate-180",
                        )}
                      />
                    </button>
                  </div>
                );
              }

              return (
                <a
                  key={item.label}
                  href={item.href}
                  aria-current={isActive ? "page" : undefined}
                  // Hovering a plain link also dismisses an open mega-menu — otherwise
                  // sliding from "Courses" to "Mentors" leaves the panel hanging open
                  // over the page.
                  onMouseEnter={() => {
                    if (supportsHover.current) setOpenMegaMenu(null);
                  }}
                  className={cn(
                    "relative rounded-md px-3 py-2 text-sm font-medium text-fg-muted",
                    "transition-colors hover:text-brand-600",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    isActive && ["text-brand-600", ACTIVE_UNDERLINE],
                  )}
                >
                  {item.label}
                </a>
              );
            })}
          </nav>

          {/* Desktop CTA */}
          <a
            href={bookSlotHref}
            onClick={onBookSlotClick}
            className={cn(
              "hidden lg:inline-flex min-h-[44px] items-center rounded-md bg-brand-500 px-5 text-sm font-semibold text-white",
              "transition-colors hover:bg-brand-600 active:bg-brand-700",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              "shrink-0",
            )}
          >
            Book Free Slot
          </a>

          {/* Mobile hamburger */}
          <button
            type="button"
            aria-label="Open navigation menu"
            aria-expanded={mobileOpen}
            aria-controls="mobile-nav-panel"
            onClick={() => setMobileOpen(true)}
            className={cn(
              "ml-auto rounded-md p-2 text-fg-muted lg:hidden",
              "transition-colors hover:bg-surface hover:text-fg",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            <Menu className="size-5" aria-hidden="true" />
          </button>
        </div>

        {/* Desktop mega-menus — rendered inside the sticky header so they push content down correctly */}
        {navItems.map((item) => {
          if (!item.megaMenu) return null;
          const isOpen = openMegaMenu === item.label;
          const triggerId = `mega-trigger-${item.label.replace(/\s+/g, "-").toLowerCase()}`;
          const panelId = `mega-panel-${item.label.replace(/\s+/g, "-").toLowerCase()}`;

          return (
            <DesktopMegaMenu
              key={item.label}
              config={item.megaMenu}
              isOpen={isOpen}
              onClose={() => setOpenMegaMenu(null)}
              triggerId={triggerId}
              panelId={panelId}
              activePath={activePath}
            />
          );
        })}
      </header>

      {/* Mobile menu (Radix Dialog — focus-trapped, Escape-closes) */}
      <MobileMenu
        navItems={navItems}
        bookSlotHref={bookSlotHref}
        onBookSlotClick={onBookSlotClick}
        open={mobileOpen}
        onOpenChange={setMobileOpen}
        activePath={activePath}
      />
    </>
  );
}

MarketingHeader.displayName = "MarketingHeader";
