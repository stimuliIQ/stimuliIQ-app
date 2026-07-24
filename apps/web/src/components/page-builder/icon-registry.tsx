/**
 * BlockIcon — resolves a page-builder `IconKey` (the closed enum,
 * `@repo/types` `IconKeySchema`) to an inline SVG. Consolidates the icon sets that were
 * previously scattered/duplicated per hardcoded section (`why-us.tsx`'s Mentor/Pricing/
 * Trophy/Star, `stats-bento.tsx`'s GraduationCap/Stack/MapPin, `about/page.tsx`'s
 * PillarIcon lms/mentor/project/certificate/placement/pricing, `hero-centered.tsx`'s User/
 * Video, `partner-colleges.tsx`'s Pin) into one keyed registry so every page-builder block
 * that accepts `iconKey` renders consistently.
 *
 * Deliberately closed (docs/specs/phase-10-page-builder.md "Shared conventions" — no block
 * ever accepts raw SVG/HTML for an icon; this is an XSS-surface control, not a UI
 * convenience). `check` is used as the safe fallback for any key not (yet) present here —
 * `design-system` owns extending `IconKeySchema` + this map together.
 */
import type { IconKey } from "@repo/types";

type IconProps = { className?: string };

function svg(paths: React.ReactNode) {
  return function Icon({ className }: IconProps) {
    return (
      <svg
        aria-hidden="true"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className ?? "h-6 w-6"}
      >
        {paths}
      </svg>
    );
  };
}

const ICONS: Record<IconKey, (props: IconProps) => React.JSX.Element> = {
  mentor: svg(
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M5 20c0-3.3 3.1-5 7-5s7 1.7 7 5" />
    </>,
  ),
  pricing: svg(
    <>
      <path d="M6 3h12" />
      <path d="M6 8h12" />
      <path d="m6 13 8.5 8" />
      <path d="M6 13h3c5 0 5-10 0-10" />
    </>,
  ),
  trophy: svg(
    <>
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
      <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
      <path d="M4 22h16" />
      <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
      <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
    </>,
  ),
  star: svg(
    <path d="M11.5 3.4a.53.53 0 0 1 1 0l2.1 4.9 5.3.5c.46.04.65.62.3.93l-4 3.5 1.2 5.2a.53.53 0 0 1-.8.57L12 16.3 7.4 19a.53.53 0 0 1-.8-.57l1.2-5.2-4-3.5a.53.53 0 0 1 .3-.93l5.3-.5 2.1-4.9Z" />,
  ),
  "graduation-cap": svg(
    <>
      <path d="M22 10 12 5 2 10l10 5 10-5Z" />
      <path d="M6 12v5c0 1 2.5 2.5 6 2.5s6-1.5 6-2.5v-5" />
      <path d="M22 10v6" />
    </>,
  ),
  stack: svg(
    <>
      <path d="m12 3 9 5-9 5-9-5 9-5Z" />
      <path d="m3 13 9 5 9-5" />
      <path d="m3 17 9 5 9-5" />
    </>,
  ),
  "map-pin": svg(
    <>
      <path d="M20 10c0 5.5-8 12-8 12s-8-6.5-8-12a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </>,
  ),
  lms: svg(
    <>
      <rect x="3" y="4" width="18" height="14" rx="2" />
      <path d="M3 9h18" />
      <path d="M12 22h.01" />
    </>,
  ),
  project: svg(
    <>
      <path d="m8 8-4 4 4 4" />
      <path d="m16 8 4 4-4 4" />
      <path d="m13 5-2 14" />
    </>,
  ),
  certificate: svg(
    <>
      <circle cx="12" cy="9" r="5" />
      <path d="m9 13-1.5 8L12 18.5 16.5 21 15 13" />
    </>,
  ),
  placement: svg(
    <>
      <rect x="3" y="8" width="18" height="12" rx="2" />
      <path d="M9 8V6a3 3 0 0 1 6 0v2" />
      <path d="M3 13h18" />
    </>,
  ),
  check: svg(<path d="M20 6 9 17l-5-5" />),
  user: svg(
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M5 20c0-3.3 3.1-5 7-5s7 1.7 7 5" />
    </>,
  ),
  video: svg(
    <>
      <rect x="2" y="6" width="14" height="12" rx="2" />
      <path d="m16 10 6-3v10l-6-3" />
    </>,
  ),
  pin: svg(
    <>
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </>,
  ),
};

export function BlockIcon({
  iconKey,
  className,
}: {
  iconKey: IconKey | null | undefined;
  className?: string;
}): React.JSX.Element {
  const Icon = (iconKey ? ICONS[iconKey] : undefined) ?? ICONS.check;
  return <Icon className={className} />;
}
