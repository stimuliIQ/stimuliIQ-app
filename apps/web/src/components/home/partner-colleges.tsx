/**
 * PartnerColleges — homepage "In Collaboration with…" block: a card grid of
 * partner colleges. Centered-column cards: logo chip on top, then name, focus
 * line, and an Est./city meta row pinned to a shared bottom baseline.
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
 * Logos: a live college carries a minted `logoUrl` (from the CRM upload); when it does
 * not, `resolveCollegeLogo` falls back to the logo bundled under /public/colleges (see
 * `lib/college-logos.ts` — none of the live CRM rows carry an upload today, which is why
 * every card was rendering as initials). With neither, we render a monogram chip, so the
 * grid stays visually complete for a college we don't have artwork for.
 *
 * Responsive: 1 col → 2 cols (sm) → 3 cols (lg) → 4 (xl). The grid renders every college
 * in full — it used to sit in a height-capped scrolling viewport, which produced a
 * nested scrollbar inside the page and hid most of the list behind it.
 *
 * a11y: section landmark + aria-label, h2/h3 hierarchy, role="list" grid,
 * decorative logo/monogram + location pin hidden from screen readers.
 */
import type { PublicPartner } from "@repo/types";
import { bundledCollegeLogo, resolveCollegeLogo } from "../../lib/college-logos";

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
    logo: resolveCollegeLogo(p.name, p.logoUrl),
  };
}

/**
 * Fallback showcase, used only when the CRM list is empty or the API is down.
 *
 * These are the same 27 institutions the CRM holds, transcribed from
 * `docs/colleges/College_Logo_Sheet.docx` — so the fallback and the live list agree, and
 * every entry resolves a bundled logo. `focus` is each institution's own affiliation line
 * from that sheet and `city` its locality; `established` is deliberately absent because
 * the sheet doesn't carry founding years and they are not ours to invent.
 */
const PARTNER_COLLEGES: PartnerCollege[] = [
  { name: "Manipal Tata Medical College", focus: "Constituent of MAHE (Deemed), Manipal", city: "Jamshedpur" },
  { name: "Santosh Medical College & Hospital", focus: "Santosh Deemed to be University", city: "Ghaziabad" },
  { name: "M. S. Ramaiah Medical College", focus: "Affiliated to RGUHS", city: "Bengaluru" },
  { name: "Kasturba Medical College (KMC), Manipal", focus: "Constituent of MAHE (Deemed)", city: "Manipal" },
  { name: "Lady Shri Ram College for Women (LSR)", focus: "Constituent college, University of Delhi", city: "New Delhi" },
  { name: "Tata Institute of Social Sciences (TISS)", focus: "Deemed to be University", city: "Mumbai" },
  { name: "Christ University (CHRIST)", focus: "Deemed to be University", city: "Bengaluru" },
  { name: "GITAM Institute of Medical Sciences & Research", focus: "GITAM Deemed to be University", city: "Visakhapatnam" },
  { name: "SRM Dental College", focus: "SRM Institute of Science & Technology", city: "Ramapuram" },
  { name: "MGM Medical College, Navi Mumbai", focus: "MGM Institute of Health Sciences (Deemed)", city: "Kamothe" },
  { name: "Kalinga Institute of Medical Sciences (KIMS)", focus: "KIIT Deemed to be University", city: "Bhubaneswar" },
  { name: "Sri Venkateswara Institute of Medical Sciences (SVIMS)", focus: "State University (SVIMS, Tirupati)", city: "Tirupati" },
  { name: "ESIC Medical College & Hospital, Chennai", focus: "ESIC, Ministry of Labour & Employment", city: "K.K. Nagar" },
  { name: "ESIC Medical College & Hospital, Hyderabad", focus: "ESIC, Ministry of Labour & Employment", city: "Sanathnagar" },
  { name: "Bharati Vidyapeeth Dental College & Hospital", focus: "Bharati Vidyapeeth Deemed University", city: "Pune" },
  { name: "Adesh Medical College & Hospital", focus: "Affiliated to Kurukshetra University", city: "Shahabad" },
  { name: "Indira Gandhi Medical College & Research Institute", focus: "Govt. of Puducherry / Pondicherry University", city: "Puducherry" },
  { name: "Rajarajeswari Medical College & Hospital", focus: "Affiliated to RGUHS", city: "Bengaluru" },
  { name: "Bhaskar Medical College", focus: "Affiliated to KNRUHS", city: "Moinabad" },
  { name: "ASRAM Medical College", focus: "Affiliated to Dr. NTR University of Health Sciences", city: "Eluru" },
  { name: "KLE's JGMM Medical College", focus: "KLE Academy of Higher Education & Research", city: "Hubballi" },
  { name: "SSPM Medical College & Lifetime Hospital", focus: "Affiliated to MUHS, Nashik", city: "Padve" },
  { name: "AIIMS Jammu", focus: "Institute of National Importance", city: "Vijaypur" },
  { name: "AIIMS Hyderabad (Bibinagar)", focus: "Institute of National Importance", city: "Bibinagar" },
  { name: "AIIMS Jodhpur", focus: "Institute of National Importance", city: "Jodhpur" },
  { name: "AIIMS Nagpur", focus: "Institute of National Importance", city: "Mihan" },
  { name: "Indira Gandhi Govt. Medical College (IGGMC)", focus: "Govt. of Maharashtra, affiliated to MUHS", city: "Nagpur" },
].map((c) => ({ ...c, logo: bundledCollegeLogo(c.name) }));

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
    // Horizontal card: logo chip on the LEFT, text stacked on the right. This was a
    // centered column (logo above the name, meta row pinned to a shared baseline),
    // which read well but cost ~180px of height per card — twelve of those pushed the
    // section past a full screen. Laying it out on one axis roughly halves the height
    // and lets the meta row sit inline instead of on its own bordered line.
    <li className="group flex items-center gap-3 rounded-xl border border-border bg-card p-3 shadow-sm transition-all duration-[150ms] hover:border-chart-3/50 hover:shadow-md">
      <span
        aria-hidden="true"
        className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-chart-3/10 ring-1 ring-inset ring-chart-3/15"
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
          <span className="text-xs font-bold tracking-tight text-chart-3">
            {monogram(college.name)}
          </span>
        )}
      </span>

      <div className="min-w-0 flex-1">
        <h3 className="truncate text-[13px] font-semibold leading-snug text-fg" title={college.name}>
          {college.name}
        </h3>
        {college.focus ? (
          <p className="truncate text-[11px] leading-snug text-chart-3" title={college.focus}>
            {college.focus}
          </p>
        ) : null}
        {college.established || college.city ? (
          <p className="mt-0.5 flex items-center gap-2 text-[10px] text-fg-subtle">
            {college.established ? <span>Est. {college.established}</span> : null}
            {college.city ? (
              <span className="inline-flex min-w-0 items-center gap-0.5">
                <PinIcon />
                <span className="truncate">{college.city}</span>
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
      className="py-12 lg:py-16"
    >
      <div className="mx-auto max-w-screen-xl px-4 md:px-6">
        <div className="mx-auto mb-8 max-w-xl text-center lg:mb-10">
          <h2 className="text-2xl font-bold tracking-tight text-fg md:text-3xl">
            Institutional <span className="text-chart-3">Network</span>
          </h2>
          <p className="mx-auto mt-3 text-sm leading-relaxed text-fg-muted">
            Endorsed by students from Leading Educational Institutions
          </p>
        </div>

        {/* Every college, in one grid. This was a `max-h` + `overflow-y-auto` viewport,
            which capped the section's height at the cost of a scrollbar nested inside the
            page — it hid two thirds of the list and hijacked the wheel over that region.
            The cards are compact enough (one row each) that the full list is a reasonable
            page cost. */}
        <ul
          role="list"
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
          data-testid="partner-colleges-grid"
        >
          {list.map((college) => (
            <CollegeCard key={college.name} college={college} />
          ))}
        </ul>
      </div>
    </section>
  );
}
