/**
 * The handful of icons the careers pages use.
 *
 * Inline SVG rather than an icon package: `apps/web` deliberately has no icon dependency —
 * every other component here hand-rolls its SVG — and pulling one in for six glyphs would
 * ship a library to every visitor of a marketing site to save a few lines.
 *
 * All are 24×24 stroke icons on `currentColor`, so they inherit text colour and size from
 * their container, and all are `aria-hidden`: each one sits beside a visible text label, so
 * announcing it would just repeat that label to a screen reader.
 */

type IconProps = { className?: string };

const BASE = {
  "aria-hidden": true as const,
  xmlns: "http://www.w3.org/2000/svg",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function MapPinIcon({ className }: IconProps) {
  return (
    <svg {...BASE} className={className}>
      <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

export function ClockIcon({ className }: IconProps) {
  return (
    <svg {...BASE} className={className}>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

export function BriefcaseIcon({ className }: IconProps) {
  return (
    <svg {...BASE} className={className}>
      <rect width="20" height="14" x="2" y="7" rx="2" />
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </svg>
  );
}

export function UsersIcon({ className }: IconProps) {
  return (
    <svg {...BASE} className={className}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

export function RupeeIcon({ className }: IconProps) {
  return (
    <svg {...BASE} className={className}>
      <path d="M6 3h12M6 8h12M6 13h4a5 5 0 0 0 0-10M6 13l8 8" />
    </svg>
  );
}

export function CalendarClockIcon({ className }: IconProps) {
  return (
    <svg {...BASE} className={className}>
      <path d="M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h6M16 2v4M8 2v4M3 10h18" />
      <circle cx="17.5" cy="17.5" r="4.5" />
      <path d="M17.5 15.5V18l1.5 1" />
    </svg>
  );
}

export function ArrowRightIcon({ className }: IconProps) {
  return (
    <svg {...BASE} className={className}>
      <path d="M5 12h14M12 5l7 7-7 7" />
    </svg>
  );
}

export function ArrowLeftIcon({ className }: IconProps) {
  return (
    <svg {...BASE} className={className}>
      <path d="M19 12H5M12 19l-7-7 7-7" />
    </svg>
  );
}

export function ShieldCheckIcon({ className }: IconProps) {
  return (
    <svg {...BASE} className={className}>
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

export function CheckCircleIcon({ className }: IconProps) {
  return (
    <svg {...BASE} className={className}>
      <circle cx="12" cy="12" r="10" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}
