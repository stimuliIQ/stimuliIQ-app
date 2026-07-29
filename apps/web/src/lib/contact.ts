/**
 * Company contact details — the single source of truth for the public website.
 *
 * WHY THIS FILE EXISTS: the WhatsApp number used to be duplicated across six files
 * (contact page, site shell, program detail, book-a-slot form, enroll page, refund
 * policy), two of them with no env fallback at all, and the human-readable number was
 * a separate literal that silently desynced from the `wa.me` href. Everything now
 * derives from `WHATSAPP_NUMBER` below, so the display string can never disagree with
 * the link.
 *
 * NOT CMS-editable: `SiteSetting`'s `contact` group only carries `contactText` and the
 * WhatsApp `{number, message}` pair — there is no email/address/city field, and the
 * schemas are `.strict()`. The runtime precedence for the WhatsApp number is therefore
 *   `contact.whatsapp.number` (DB) → `NEXT_PUBLIC_WHATSAPP_NUMBER` → the constant here,
 * and the postal address is code-owned (ships with a deploy, not a CRM save). Do not add
 * an address field to the CRM without a reader on this side — a save-that-does-nothing is
 * the exact trap that got `stats.headline` removed in P10-2.
 */

/**
 * E.164 digits WITHOUT the leading `+` — this is the form `wa.me/<number>` requires.
 * Country code (91) + 10-digit subscriber number.
 */
export const WHATSAPP_NUMBER = "919177748321";

/** Human-readable rendering of {@link WHATSAPP_NUMBER}. Keep the two in sync. */
export const WHATSAPP_DISPLAY = "+91 91777 48321";

/** `tel:` href for the same number. */
export const PHONE_HREF = "+919177748321";

/** General enquiries inbox shown on the contact page — the live, monitored mailbox. */
export const CONTACT_EMAIL = "support.stimuliiq@gmail.com";

/**
 * Support inbox referenced by the refund policy and transactional email footers.
 * NOTE: `@stimuliiq.com` addresses depend on domain mail delivery being configured;
 * {@link CONTACT_EMAIL} is the address the team actually reads today.
 */
export const SUPPORT_EMAIL = "support@stimuliiq.com";

/**
 * Registered office. `lines` is the display form (one <span> per line); the discrete
 * fields below back the schema.org `PostalAddress` node in the sitewide JSON-LD.
 */
export const ADDRESS = {
  name: "Stimuli IQ",
  streetAddress: "A' Square Business Centre, Waltair Uplands, Waltair Main Road",
  addressLocality: "Visakhapatnam",
  addressRegion: "Andhra Pradesh",
  postalCode: "530003",
  addressCountry: "IN",
  /** Display lines, in render order. */
  lines: [
    "Stimuli IQ",
    "A' Square Business Centre",
    "Waltair Uplands, Waltair Main Road",
    "Visakhapatnam – 530003",
  ],
} as const;

/** Single-line address, for meta tags and the footer. */
export const ADDRESS_ONE_LINE = ADDRESS.lines.join(", ");

/**
 * Build a `wa.me` link with an optional prefilled message.
 * The message is encoded exactly once, here — callers must pass RAW text.
 */
export function buildWhatsAppHref(message?: string): string {
  const base = `https://wa.me/${WHATSAPP_NUMBER}`;
  return message ? `${base}?text=${encodeURIComponent(message)}` : base;
}
