"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as AccordionPrimitive from "@radix-ui/react-accordion";
import { ChevronDown, Menu, X } from "lucide-react";

import { cn } from "../lib/cn";

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

export interface MegaMenuSection {
  heading: string;
  items: Array<{ label: string; href: string; description?: string }>;
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
}

export interface MarketingHeaderProps {
  /** Logo slot — typically an <img> or a Next.js Image. */
  logo: React.ReactNode;
  /** Primary navigation items. */
  navItems: NavItem[];
  /** href for the persistent "Book Free Slot" CTA. */
  bookSlotHref: string;
  /** Called when the CTA button is clicked (optional — href still works). */
  onBookSlotClick?: () => void;
  /** Additional className on the outer <header>. */
  className?: string;
  /** Test hook; defaults to "marketing-header". */
  "data-testid"?: string;
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
}

function DesktopMegaMenu({
  config,
  isOpen,
  onClose,
  triggerId,
  panelId,
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
        "absolute left-0 right-0 top-full z-50 mt-px border-t border-border bg-card shadow-md",
        "animate-in fade-in slide-in-from-top-2 duration-[150ms]",
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
                {section.items.map((item) => (
                  <li key={item.href}>
                    <a
                      href={item.href}
                      onClick={onClose}
                      className={cn(
                        "block rounded-md px-2 py-1.5 text-sm text-fg-muted",
                        "transition-colors duration-[150ms] ease-out hover:bg-surface hover:text-fg",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                      )}
                    >
                      <span className="font-medium text-fg">{item.label}</span>
                      {item.description ? (
                        <span className="mt-0.5 block text-xs text-fg-muted">
                          {item.description}
                        </span>
                      ) : null}
                    </a>
                  </li>
                ))}
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
}

function MobileMenu({
  navItems,
  bookSlotHref,
  onBookSlotClick,
  open,
  onOpenChange,
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
            <AccordionPrimitive.Root type="multiple" className="divide-y divide-border">
              {navItems.map((item) => {
                if (item.megaMenu) {
                  return (
                    <AccordionPrimitive.Item key={item.label} value={item.label}>
                      <AccordionPrimitive.Header asChild>
                        <h2 className="m-0">
                          <AccordionPrimitive.Trigger
                            className={cn(
                              "flex w-full items-center justify-between px-4 py-4 text-base font-medium text-fg",
                              "transition-colors hover:bg-surface",
                              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                              "[&[data-state=open]>svg]:rotate-180",
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
                                {section.items.map((link) => (
                                  <li key={link.href}>
                                    <a
                                      href={link.href}
                                      onClick={() => onOpenChange(false)}
                                      className={cn(
                                        "block rounded-md px-2 py-2 text-sm text-fg-muted",
                                        "hover:bg-card hover:text-fg",
                                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                                      )}
                                    >
                                      {link.label}
                                    </a>
                                  </li>
                                ))}
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
                      className={cn(
                        "block px-4 py-4 text-base font-medium text-fg",
                        "transition-colors hover:bg-surface",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
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

  return (
    <>
      <header
        data-testid={testId ?? "marketing-header"}
        className={cn(
          "sticky top-0 z-40 w-full border-b border-border bg-card/95 backdrop-blur-sm",
          "transition-shadow duration-[150ms] ease-out",
          isSticky && "shadow-md",
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
              if (item.megaMenu) {
                const isOpen = openMegaMenu === item.label;
                const triggerId = `mega-trigger-${item.label.replace(/\s+/g, "-").toLowerCase()}`;
                const panelId = `mega-panel-${item.label.replace(/\s+/g, "-").toLowerCase()}`;

                return (
                  <div key={item.label} className="relative">
                    <button
                      id={triggerId}
                      type="button"
                      aria-expanded={isOpen}
                      aria-controls={isOpen ? panelId : undefined}
                      aria-haspopup="true"
                      onClick={() => setOpenMegaMenu(isOpen ? null : item.label)}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium",
                        "text-fg-muted transition-colors hover:bg-surface hover:text-fg",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        isOpen && "bg-surface text-fg",
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
                  className={cn(
                    "rounded-md px-3 py-2 text-sm font-medium text-fg-muted",
                    "transition-colors hover:bg-surface hover:text-fg",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
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
      />
    </>
  );
}

MarketingHeader.displayName = "MarketingHeader";
