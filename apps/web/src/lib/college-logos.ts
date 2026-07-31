/**
 * College logo fallback — maps a college's NAME to a logo bundled under
 * `apps/web/public/colleges/`.
 *
 * WHY THIS EXISTS: the partner colleges are CRM-managed (`Partner` rows, category
 * `college_partner`), and each row can carry an uploaded `logoUrl`. None of the live rows
 * currently do, so every card on the homepage and /for-colleges rendered as an initials
 * monogram. The logos we actually have were extracted from the college logo sheet into
 * `docs/colleges/logos/` and are now shipped with the app; this module is what lets a
 * card find one without anybody re-uploading 27 images through the CRM.
 *
 * PRECEDENCE: an uploaded `logoUrl` always wins. This is the fallback, consulted only
 * when the CRM row has no logo of its own — so uploading a logo in the CRM still
 * overrides the bundled file, with no code change.
 *
 * MATCHING is on a slug of the name, not the raw string, so trivial punctuation drift in
 * the CRM ("M.S. Ramaiah" vs "M. S. Ramaiah", "&" vs "and") still resolves. A name with
 * no bundled logo returns undefined and the caller falls back to its monogram chip —
 * adding a college in the CRM can never break the grid.
 *
 * TO ADD A LOGO: drop `<nn>-<slug>.jpeg` into `apps/web/public/colleges/` and add the
 * slug → filename pair below. The numeric prefix is the logo sheet's ordering and is
 * deliberately not part of the slug.
 */

/**
 * Slug (derived from the college name) → filename under `/public/colleges/`.
 * Generated from the extracted logo sheet; keep sorted by the sheet's numbering.
 */
const LOGO_BY_SLUG: Record<string, string> = {
  "manipal-tata-medical-college": "01-manipal-tata-medical-college.jpeg",
  "santosh-medical-college-and-hospital": "02-santosh-medical-college-and-hospital.jpeg",
  "m-s-ramaiah-medical-college": "03-m-s-ramaiah-medical-college.jpeg",
  "kasturba-medical-college-kmc-manipal": "04-kasturba-medical-college-kmc-manipal.jpeg",
  "lady-shri-ram-college-for-women-lsr": "05-lady-shri-ram-college-for-women-lsr.jpeg",
  "tata-institute-of-social-sciences-tiss": "06-tata-institute-of-social-sciences-tiss.jpeg",
  "christ-university-christ": "07-christ-university-christ.jpeg",
  "gitam-institute-of-medical-sciences-and-research": "08-gitam-institute-of-medical-sciences-and-research.jpeg",
  "srm-dental-college": "09-srm-dental-college.jpeg",
  "mgm-medical-college-navi-mumbai": "10-mgm-medical-college-navi-mumbai.jpeg",
  "kalinga-institute-of-medical-sciences-kims": "11-kalinga-institute-of-medical-sciences-kims.jpeg",
  "sri-venkateswara-institute-of-medical-sciences-svims":
    "12-sri-venkateswara-institute-of-medical-sciences-svims.jpeg",
  "esic-medical-college-and-hospital-chennai": "13-esic-medical-college-and-hospital-chennai.jpeg",
  "esic-medical-college-and-hospital-hyderabad": "14-esic-medical-college-and-hospital-hyderabad.jpeg",
  "bharati-vidyapeeth-dental-college-and-hospital": "15-bharati-vidyapeeth-dental-college-and-hospital.jpeg",
  "adesh-medical-college-and-hospital": "16-adesh-medical-college-and-hospital.jpeg",
  "indira-gandhi-medical-college-and-research-institute":
    "17-indira-gandhi-medical-college-and-research-institute.jpeg",
  "rajarajeswari-medical-college-and-hospital": "18-rajarajeswari-medical-college-and-hospital.jpeg",
  "bhaskar-medical-college": "19-bhaskar-medical-college.jpeg",
  "asram-medical-college": "20-asram-medical-college.jpeg",
  "kle-s-jgmm-medical-college": "21-kle-s-jgmm-medical-college.jpeg",
  "sspm-medical-college-and-lifetime-hospital": "22-sspm-medical-college-and-lifetime-hospital.jpeg",
  "aiims-jammu": "23-aiims-jammu.jpeg",
  "aiims-hyderabad-bibinagar": "24-aiims-hyderabad-bibinagar.jpeg",
  "aiims-jodhpur": "25-aiims-jodhpur.jpeg",
  "aiims-nagpur": "26-aiims-nagpur.jpeg",
  "indira-gandhi-govt-medical-college-iggmc": "27-indira-gandhi-govt-medical-college-iggmc.jpeg",
};

/**
 * Every bundled logo, as a `/public` path, in logo-sheet order.
 *
 * For DECORATIVE use (the /for-colleges hero collage). Deliberately the bundled sheet
 * rather than the live CRM partner list, for two reasons: a decorative layer must never
 * render empty if the API is unreachable, and CRM-uploaded logos resolve through the asset
 * CDN — which is currently unset in production, so those URLs 404. The live, named college
 * list still drives the marquee section further down the same page; this is only wallpaper.
 */
export const BUNDLED_COLLEGE_LOGOS: readonly string[] = Object.values(LOGO_BY_SLUG).map(
  (file) => `/colleges/${file}`,
);

/**
 * "Kasturba Medical College (KMC), Manipal" → "kasturba-medical-college-kmc-manipal".
 *
 * `&` becomes `and` BEFORE punctuation is stripped — otherwise "College & Hospital" and
 * "College and Hospital" would slug differently and half the sheet would miss.
 */
function slugifyCollegeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Bundled logo path for a college name, or `undefined` when we don't ship one.
 * Callers should prefer any CRM-uploaded `logoUrl` over this.
 */
export function bundledCollegeLogo(name: string): string | undefined {
  const file = LOGO_BY_SLUG[slugifyCollegeName(name)];
  return file ? `/colleges/${file}` : undefined;
}

/**
 * The logo to render for a college: the CRM upload if there is one, otherwise the
 * bundled sheet logo, otherwise nothing (caller renders a monogram).
 */
export function resolveCollegeLogo(name: string, uploadedUrl?: string | null): string | undefined {
  return uploadedUrl ?? bundledCollegeLogo(name);
}
