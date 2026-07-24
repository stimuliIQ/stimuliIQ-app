import * as React from "react";

import { cn } from "../lib/cn";

/**
 * LogoWall — partner / hiring-company logo grid, per docs/01-prd-website.md §7.2
 * ("College partners / hiring partners — logo wall").
 *
 * Lazy loading: each logo image is rendered with `loading="lazy"` so they only load
 * as the section enters the viewport. This is the browser-native lazy-load approach
 * (no IntersectionObserver needed here), SSR-safe, no extra JS.
 *
 * a11y:
 * - Each logo <img> must have a meaningful `alt` (the company name).
 * - The container uses `role="list"` + `aria-label` for the section type.
 * - Decorative HR separators are aria-hidden.
 *
 * SSR-safe: purely presentational, no client-only APIs.
 *
 * Usage:
 *   <LogoWall
 *     heading="Our Hiring Partners"
 *     logos={[
 *       { name: "TCS", src: "/logos/tcs.svg" },
 *       { name: "Infosys", src: "/logos/infosys.svg" },
 *     ]}
 *   />
 */

export interface LogoItem {
  name: string;
  src: string;
}

export interface LogoWallProps {
  heading?: string;
  logos: LogoItem[];
  className?: string;
  "data-testid"?: string;
}

export function LogoWall({
  heading,
  logos,
  className,
  "data-testid": testId,
}: LogoWallProps): React.JSX.Element {
  return (
    <section
      data-testid={testId ?? "logo-wall"}
      aria-label={heading ?? "Partner logos"}
      className={cn("w-full py-12", className)}
    >
      <div className="mx-auto max-w-screen-xl px-4 md:px-6">
        {heading ? (
          <h2 className="mb-8 text-center text-sm font-semibold uppercase tracking-wider text-fg-subtle">
            {heading}
          </h2>
        ) : null}

        <ul
          role="list"
          className={cn(
            "flex flex-wrap items-center justify-center gap-x-8 gap-y-6",
            "md:gap-x-12 md:gap-y-8",
          )}
        >
          {logos.map((logo) => (
            <li key={logo.name} className="flex items-center justify-center">
              <img
                src={logo.src}
                alt={logo.name}
                loading="lazy"
                decoding="async"
                className={cn(
                  "h-8 w-auto object-contain opacity-60 grayscale",
                  "transition-all duration-[150ms] hover:opacity-100 hover:grayscale-0",
                )}
              />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

LogoWall.displayName = "LogoWall";
