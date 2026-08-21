// apps/api/src/modules/content/site-settings.constants.ts
//
// Fallback defaults for `GET /public/site-settings` (docs/specs/phase-10-page-builder.md).
// All 7 keys are guaranteed present by `prisma/seed.ts` ("Phase-10 Page Builder —
// SiteSetting defaults") in every real deployment; this constant is a pure safety net
// for a corrupted/missing row (e.g. a row deleted out-of-band, or a fresh DB that
// skipped seeding) so the public endpoint degrades to a sane hardcoded default INSTEAD
// OF 500ing — never leaving `web`'s nav/footer/SEO/contact without a value. Values
// mirror the seed's defaults 1:1 (which in turn mirror what `apps/web` hardcodes today —
// see prisma/seed.ts's "Phase-10 Page Builder — SiteSetting defaults" block for the
// source-file provenance of each key), so a fallback is visually indistinguishable from
// the real seeded row.
//
// P10-2 (real-user defect promoted from follow-up): `stats.headline` was REMOVED
// entirely — `apps/web`'s homepage never actually read this setting (the homepage stat
// trio is sourced from the `home` page's Page Builder `stat_group` block instead), so
// editing it in the CRM saved successfully but changed nothing on the live site. The
// Page Builder `stat_group` block is now the single source of truth for on-page stats.

import type { PublicSiteSettingsResponse, SiteSettingGroup, SiteSettingKey } from "@repo/types";

/** `key.split(".")[0]` for all 7 seeded keys IS the key's group — see site-settings.schemas.ts. */
export function keyToGroup(key: SiteSettingKey): SiteSettingGroup {
  return key.split(".")[0] as SiteSettingGroup;
}

export const DEFAULT_PUBLIC_SITE_SETTINGS: PublicSiteSettingsResponse = {
  "nav.primary_links": [
    { label: "Courses", href: "/programs" },
    { label: "Mentors", href: "/mentors" },
    { label: "Scholarship", href: "/scholarship" },
    { label: "For Colleges", href: "/for-colleges" },
    { label: "About", href: "/about" },
    { label: "Blog", href: "/blog" },
    { label: "Contact", href: "/contact" },
  ],
  "footer.columns": [
    {
      heading: "Company",
      links: [
        { label: "About Us", href: "/about" },
        { label: "Mentors", href: "/mentors" },
        { label: "Faculty", href: "/faculty" },
        { label: "Testimonials", href: "/testimonials" },
        { label: "Partners", href: "/partners" },
        { label: "Gallery", href: "/gallery" },
        { label: "Careers", href: "/careers" },
      ],
    },
    {
      heading: "Resources",
      links: [
        { label: "Blog", href: "/blog" },
        { label: "Scholarship", href: "/scholarship" },
        { label: "FAQ", href: "/faq" },
        { label: "Pricing", href: "/pricing" },
        { label: "For Colleges", href: "/for-colleges" },
      ],
    },
    {
      heading: "Legal",
      links: [
        { label: "Privacy Policy", href: "/privacy" },
        { label: "Terms of Service", href: "/terms" },
        { label: "Refund Policy", href: "/refund-policy" },
        { label: "Contact Us", href: "/contact" },
      ],
    },
  ],
  "footer.legal_links": [
    { label: "Privacy Policy", href: "/privacy" },
    { label: "Terms of Service", href: "/terms" },
    { label: "Refund Policy", href: "/refund-policy" },
  ],
  "footer.copyright_text": {
    template: "© {year} StimuliiQ Technologies Pvt. Ltd. All rights reserved.",
  },
  "seo.defaults": {
    siteName: "StimuliiQ",
    defaultDescription:
      "StimuliiQ, India's next generation healthcare learning platform. Structured training, real internships, and mentorship from healthcare industry experts for medical, psychology, and allied health science students.",
    defaultOgImagePath: "/og-default.png",
  },
  "contact.details": {
    contactText: "India's Next Generation Healthcare Learning Platform",
  },
  "contact.whatsapp": {
    number: "919177748321",
    // RAW text, never pre-encoded: the web shell applies encodeURIComponent() exactly
    // once when building the wa.me href. This value used to be stored URL-encoded here
    // (but raw in prisma/seed.ts), so whenever this fallback was served the message
    // double-encoded into "Hi%252C%2520I%2520want...".
    message: "Hi, I want to know more about StimuliiQ programs",
  },
  // Off by default — the strip renders nothing until a super_admin flips `enabled`
  // in CRM → Marketing → Site settings → Announcement.
  "announcement.bar": {
    enabled: false,
    message: "Admissions are open. Book a free counselling slot today.",
    mode: "static",
  },
};
