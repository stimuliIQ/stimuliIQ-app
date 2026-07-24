// Known public-site destinations — a static suggestion list for nav/footer Link inputs
// (docs/specs/phase-10-ui-polish-ux-audit.md SS-1: "turn the Link input into a
// combobox/datalist pre-filled with the site's known destinations"). Deliberately a
// static list, not fetched from the API (task constraint: no new API calls) — free text
// (external `https://…` links, or any path not in this list) stays fully supported,
// this only adds a suggestion affordance via the native HTML `<datalist>`.
export interface KnownSiteDestination {
  path: string;
  label: string;
}

export const KNOWN_SITE_DESTINATIONS: KnownSiteDestination[] = [
  { path: "/", label: "Home" },
  { path: "/programs", label: "Programs" },
  { path: "/mentors", label: "Mentors" },
  { path: "/scholarship", label: "Scholarship" },
  { path: "/for-colleges", label: "For Colleges" },
  { path: "/about", label: "About" },
  { path: "/blog", label: "Blog" },
  { path: "/contact", label: "Contact" },
  { path: "/gallery", label: "Gallery" },
  { path: "/careers", label: "Careers" },
  { path: "/pricing", label: "Pricing" },
  { path: "/faq", label: "FAQ" },
  { path: "/testimonials", label: "Testimonials" },
  { path: "/partners", label: "Partners" },
  { path: "/faculty", label: "Faculty" },
];
