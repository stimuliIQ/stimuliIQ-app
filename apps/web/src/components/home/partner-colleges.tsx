/**
 * PartnerColleges — homepage "Institutional Network" block: two rows of college
 * cards scrolling continuously in opposite directions (a seamless CSS marquee).
 * Each card is a horizontal chip — logo on the left, name / affiliation / city
 * stacked on the right.
 *
 * Server Component — purely presentational, no client JS (the marquee is pure
 * CSS; see the `college-marquee` rules in `app/globals.css`).
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
 * Layout/a11y: owned by `CollegeMarquee` (see `home/college-marquee.tsx`), which the
 * live CRM-driven renderer (`page-builder/blocks/live-collection-ref-block.tsx`, the
 * `partners` collection) shares — so this fallback and the real thing look identical.
 * This file keeps only the section chrome, the heading copy, and the fallback data.
 */
import type { PublicPartner } from "@repo/types";
import { bundledCollegeLogo, resolveCollegeLogo } from "../../lib/college-logos";
import { CollegeMarquee, type CollegeCardItem } from "./college-marquee";

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

type PartnerCollege = CollegeCardItem;

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
      </div>

      {/* Deliberately OUTSIDE the content column: the rows are full-bleed, so they run
          edge to edge and fade out at the viewport margins. */}
      <CollegeMarquee colleges={list} />
    </section>
  );
}
