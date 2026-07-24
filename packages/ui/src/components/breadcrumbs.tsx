import * as React from "react";
import { ChevronRight } from "lucide-react";

import { cn } from "../lib/cn";

/**
 * Breadcrumbs — accessible breadcrumb navigation with JSON-LD BreadcrumbList export.
 * Per docs/01-prd-website.md §7.1/§7.9 ("breadcrumb on deep pages", Schema.org Breadcrumb).
 *
 * a11y:
 * - <nav aria-label="Breadcrumb"> + <ol> per ARIA best-practice.
 * - Current (last) item: aria-current="page", no <a> link.
 * - Separator chevrons: aria-hidden.
 *
 * JSON-LD: `buildBreadcrumbJsonLd(items)` returns an escaped BreadcrumbList string.
 *
 * SSR-safe: purely presentational.
 *
 * Usage:
 *   <Breadcrumbs
 *     items={[
 *       { label: "Home", href: "/" },
 *       { label: "Programs", href: "/programs" },
 *       { label: "Python for Data Science" },
 *     ]}
 *   />
 */

export interface BreadcrumbItem {
  label: string;
  /** When omitted, this item is treated as the current page (no link). */
  href?: string;
}

export interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  className?: string;
  "data-testid"?: string;
}

// ---------------------------------------------------------------------------
// JSON-LD helper
// ---------------------------------------------------------------------------

/** Build escaped BreadcrumbList JSON-LD. Inject in <head> or pass to Next.js metadata. */
export function buildBreadcrumbJsonLd(items: BreadcrumbItem[], baseUrl = ""): string {
  const obj = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.label,
      ...(item.href ? { item: `${baseUrl}${item.href}` } : {}),
    })),
  };
  return JSON.stringify(obj).replace(/<\/script>/gi, "<\\/script>");
}

// ---------------------------------------------------------------------------
// Breadcrumbs (public component)
// ---------------------------------------------------------------------------

export function Breadcrumbs({
  items,
  className,
  "data-testid": testId,
}: BreadcrumbsProps): React.JSX.Element {
  return (
    <nav
      data-testid={testId ?? "breadcrumbs"}
      aria-label="Breadcrumb"
      className={cn("w-full", className)}
    >
      <ol
        role="list"
        className="flex flex-wrap items-center gap-1 text-sm"
      >
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`} className="flex items-center gap-1">
              {/* Separator (not before first item) */}
              {index > 0 ? (
                <ChevronRight
                  aria-hidden="true"
                  className="size-3.5 shrink-0 text-fg-subtle"
                />
              ) : null}

              {isLast || !item.href ? (
                <span
                  aria-current={isLast ? "page" : undefined}
                  className={cn(
                    isLast ? "font-medium text-fg" : "text-fg-muted",
                  )}
                >
                  {item.label}
                </span>
              ) : (
                <a
                  href={item.href}
                  className={cn(
                    "text-fg-muted transition-colors hover:text-fg",
                    "focus-visible:outline-none focus-visible:underline focus-visible:decoration-ring",
                  )}
                >
                  {item.label}
                </a>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

Breadcrumbs.displayName = "Breadcrumbs";
