/**
 * PartnerColleges — homepage "In Collaboration with…" block: a card grid of
 * partner colleges (logo, name, focus line, established year, city).
 *
 * Server Component — purely presentational, no client JS.
 *
 * DATA (CRM-managed): the live list comes from the CRM Colleges screen
 * (`/crm/colleges` → `Partner` rows, category `college_partner`), fetched on the
 * home page via `GET /public/partners?category=college_partner` and passed in as
 * `colleges`. When that list is empty (e.g. a freshly-cleaned DB, or the API is
 * down) the section falls back to the hardcoded `PARTNER_COLLEGES` showcase below,
 * so it never renders blank — the same resilience contract as the rest of the
 * code-owned homepage.
 *
 * Logos: a live college carries a minted `logoUrl` (from the CRM upload); hardcoded
 * fallback entries may carry a `logo` path under /public. When neither is present we
 * render a monogram chip from the initials, so the grid stays visually complete.
 *
 * Responsive: 1 col → 2 cols (sm) → 3 cols (lg) → 4 (xl).
 *
 * a11y: section landmark + aria-label, h2/h3 hierarchy, role="list" grid,
 * decorative logo/monogram + location pin hidden from screen readers.
 */
import type { PublicPartner } from "@repo/types";

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

interface PartnerCollege {
  name: string;
  focus?: string;
  established?: string;
  city?: string;
  /** Optional logo — a minted CDN URL (live) or a /public path (fallback). */
  logo?: string;
}

/** Normalise a live CRM college (`PublicPartner`) into the card's shape. */
function toCard(p: PublicPartner): PartnerCollege {
  return {
    name: p.name,
    focus: p.focus ?? undefined,
    established: p.established != null ? String(p.established) : undefined,
    city: p.city ?? undefined,
    logo: p.logoUrl ?? undefined,
  };
}

const PARTNER_COLLEGES: PartnerCollege[] = [
  {
    name: "St. John's Medical College",
    focus: "Teaching Hospital & Research",
    established: "1963",
    city: "Bengaluru",
  },
  {
    name: "Manipal College of Medical Sciences",
    focus: "Multi-speciality & Research",
    established: "1953",
    city: "Bengaluru",
  },
  {
    name: "MS Ramaiah Medical College",
    focus: "Clinical Research & Education",
    established: "1979",
    city: "Bengaluru",
  },
  {
    name: "Kempegowda Institute of Medical Sciences",
    focus: "Healthcare & Allied Sciences",
    established: "1980",
    city: "Bengaluru",
  },
  {
    name: "Bangalore Medical College & RI",
    focus: "Government Teaching Hospital",
    established: "1955",
    city: "Bengaluru",
  },
  {
    name: "RajaRajeswari Medical College",
    focus: "Modern Medical Education",
    established: "2004",
    city: "Bengaluru",
  },
  {
    name: "Grant Medical College & Sir JJ Hospital",
    focus: "Premier Government Medical College",
    established: "1845",
    city: "Mumbai",
  },
  {
    name: "KEM Hospital & Seth GS Medical College",
    focus: "Research & Clinical Excellence",
    established: "1926",
    city: "Mumbai",
  },
  {
    name: "Lokmanya Tilak Municipal Medical College",
    focus: "Municipal Teaching Hospital",
    established: "1964",
    city: "Mumbai",
  },
  {
    name: "LTMMC Sion Hospital",
    focus: "Healthcare & Surgical Sciences",
    established: "1964",
    city: "Mumbai",
  },
  {
    name: "D.Y. Patil Medical College",
    focus: "Private Medical Education & Research",
    established: "1989",
    city: "Mumbai",
  },
  {
    name: "Topiwala National Medical College",
    focus: "Nair Hospital — Trauma & Emergency",
    established: "1921",
    city: "Mumbai",
  },
];

// ---------------------------------------------------------------------------
// Bits
// ---------------------------------------------------------------------------

/** First letter of up to two significant words, e.g. "St. John's Medical College" → "SJ". */
function monogram(name: string): string {
  return name
    .replace(/[^A-Za-z ]/g, " ")
    .split(" ")
    .filter((word) => word.length > 1)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join("");
}

function PinIcon() {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5 text-chart-1"
    >
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

function CollegeCard({ college }: { college: PartnerCollege }) {
  return (
    <li className="flex items-start gap-3 rounded-xl border border-border bg-card p-3.5 transition-colors duration-[150ms] hover:border-chart-3">
      <span
        aria-hidden="true"
        className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-surface"
      >
        {college.logo ? (
          <img
            src={college.logo}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-contain p-1"
          />
        ) : (
          <span className="text-xs font-bold tracking-tight text-fg-muted">
            {monogram(college.name)}
          </span>
        )}
      </span>

      <div className="min-w-0">
        <h3 className="text-sm font-semibold leading-snug text-fg">
          {college.name}
        </h3>
        {college.focus ? (
          <p className="mt-0.5 text-xs leading-snug text-chart-3">
            {college.focus}
          </p>
        ) : null}
        {college.established || college.city ? (
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-fg-subtle">
            {college.established ? <span>Est. {college.established}</span> : null}
            {college.city ? (
              <span className="inline-flex items-center gap-1">
                <PinIcon />
                {college.city}
              </span>
            ) : null}
          </p>
        ) : null}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------

export function PartnerColleges({ colleges }: { colleges?: PublicPartner[] }) {
  // Prefer the live CRM-managed list; fall back to the hardcoded showcase when the
  // API returns nothing (empty/clean DB or a failed fetch) so the section is never blank.
  const list: PartnerCollege[] =
    colleges && colleges.length > 0 ? colleges.map(toCard) : PARTNER_COLLEGES;

  return (
    <section
      aria-label="Partner colleges and institutions"
      data-testid="partner-colleges"
      className="border-t border-border py-12 lg:py-16"
    >
      <div className="mx-auto max-w-screen-xl px-4 md:px-6">
        <div className="mx-auto mb-8 max-w-xl text-center lg:mb-10">
          <h2 className="text-2xl font-bold tracking-tight text-fg md:text-3xl">
            In Collaboration with{" "}
            <span className="text-chart-3">Leading Institutions</span>
          </h2>
          <p className="mx-auto mt-3 text-sm leading-relaxed text-fg-muted">
            Our programs are developed in partnership with top colleges and
            institutions across India.
          </p>
        </div>

        <ul
          role="list"
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
        >
          {list.map((college) => (
            <CollegeCard key={college.name} college={college} />
          ))}
        </ul>
      </div>
    </section>
  );
}
