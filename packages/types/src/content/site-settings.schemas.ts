// Phase-10 page builder: `SiteSetting` contract — sitewide marketing-website primitives
// (nav labels, footer columns, SEO defaults, contact details, WhatsApp number),
// editable ONLY from the CRM (super_admin, `site_settings.view`/`.edit`
// — see prisma model comment + prisma/seed.ts). Backs `model SiteSetting`
// (tenantId+key+group+value, partial-unique-after-soft-delete on (tenantId,key)).
//
// Admin CRUD under /api/v1/crm/site-settings; public (published-values-only, cacheable)
// read under /api/v1/public/site-settings.
//
// KEYED VALIDATION: unlike the generic `Setting` model (`platform/settings.schemas.ts`,
// `value: z.unknown()`), every one of the 7 seeded `SiteSetting` keys has a CLOSED,
// specific value shape (matching exactly what prisma/seed.ts seeds today, which in turn
// mirrors what apps/web currently hardcodes — see that seed block's comments for each
// key's source file). `SiteSettingValueSchemaByKey` is the single source of truth both
// `backend-builder`'s upsert handler (looks up the schema for the `:key` path param and
// parses `value` against it — this is a RUNTIME lookup, not a static per-route zod
// schema, because the shape depends on a path param, not the route itself) and any CRM
// per-key edit form must use.
//
// REMOVED (P10-2, real-user defect promoted from follow-up): `stats.headline` was
// dropped entirely — `apps/web`'s homepage never actually read this setting (the
// homepage stat trio comes from the `home` page's Page Builder `stat_group` block
// instead), so a super_admin editing "Stats" in the CRM saved successfully but visibly
// changed NOTHING on the live site — a save-but-does-nothing trap. Decision: the Page
// Builder `stat_group` block is the single source of truth for on-page stats; a
// site-wide "stats" SiteSetting duplicated that responsibility with no consumer. Do
// NOT re-add a `stats.*` key without first wiring a real `apps/web` consumer.

import { z } from "zod";
import { PhoneSchema, HrefSchema } from "../common/primitives.js";
import { UuidSchema, IsoDateTimeSchema } from "../common/primitives.js";

// ─────────────────────────────────────────────────────────────────────────
// The 7 seeded keys (prisma/seed.ts "Phase-10 Page Builder — SiteSetting defaults")
// ─────────────────────────────────────────────────────────────────────────

export const SiteSettingKeySchema = z.enum([
  "nav.primary_links",
  "footer.columns",
  "footer.legal_links",
  "footer.copyright_text",
  "seo.defaults",
  "contact.details",
  "contact.whatsapp",
]);
export type SiteSettingKey = z.infer<typeof SiteSettingKeySchema>;

/** `group` mirrors each key's leading dotted-namespace segment — CRM UI tab grouping only. */
export const SiteSettingGroupSchema = z.enum(["nav", "footer", "seo", "contact"]);
export type SiteSettingGroup = z.infer<typeof SiteSettingGroupSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Per-key value schemas
// ─────────────────────────────────────────────────────────────────────────

const NavLinkSchema = z.object({ label: z.string().min(1).max(60), href: HrefSchema }).strict();

/** `nav.primary_links` — the header's static nav link list. */
export const NavPrimaryLinksValueSchema = z.array(NavLinkSchema).min(1).max(12);
export type NavPrimaryLinksValue = z.infer<typeof NavPrimaryLinksValueSchema>;

/** `footer.columns` — footer link columns (heading + links). */
export const FooterColumnsValueSchema = z
  .array(
    z
      .object({
        heading: z.string().min(1).max(60),
        links: z.array(NavLinkSchema).min(1).max(20),
      })
      .strict(),
  )
  .min(1)
  .max(6);
export type FooterColumnsValue = z.infer<typeof FooterColumnsValueSchema>;

/** `footer.legal_links` — the compact legal-links row (privacy/terms/refund). */
export const FooterLegalLinksValueSchema = z.array(NavLinkSchema).max(10);
export type FooterLegalLinksValue = z.infer<typeof FooterLegalLinksValueSchema>;

/**
 * `footer.copyright_text` — `template` carries a literal `{year}` placeholder,
 * interpolated client-side with the current year at render time (matches
 * `site-shell.tsx`'s `CURRENT_YEAR` behavior; NOT baked in server-side so it never goes
 * stale).
 */
export const FooterCopyrightTextValueSchema = z
  .object({ template: z.string().min(1).max(300) })
  .strict()
  .refine((v) => v.template.includes("{year}"), "template must contain the literal \"{year}\" placeholder");
export type FooterCopyrightTextValue = z.infer<typeof FooterCopyrightTextValueSchema>;

/** `seo.defaults` — sitewide fallback SEO metadata (`apps/web/src/lib/seo/metadata.ts`). */
export const SeoDefaultsValueSchema = z
  .object({
    siteName: z.string().min(1).max(100),
    defaultDescription: z.string().min(1).max(300),
    /** Relative path (NOT a full URL) — combined with `NEXT_PUBLIC_SITE_URL` at render time. */
    defaultOgImagePath: z.string().min(1).max(500).startsWith("/", "must be a site-relative path"),
  })
  .strict();
export type SeoDefaultsValue = z.infer<typeof SeoDefaultsValueSchema>;

/** `contact.details` — the footer/contact-page blurb. */
export const ContactDetailsValueSchema = z.object({ contactText: z.string().min(1).max(500) }).strict();
export type ContactDetailsValue = z.infer<typeof ContactDetailsValueSchema>;

/**
 * `contact.whatsapp` — the WhatsApp float button's number + prefilled message.
 * `number` reuses the shared `PhoneSchema` (matches the seeded "919999999999" — E.164-ish,
 * no leading `+` required). `message` is stored URL-encoded (matches the seed value and
 * `site-shell.tsx`'s existing `NEXT_PUBLIC_WHATSAPP_MESSAGE` convention).
 */
export const ContactWhatsappValueSchema = z
  .object({
    number: PhoneSchema,
    message: z.string().min(1).max(500),
  })
  .strict();
export type ContactWhatsappValue = z.infer<typeof ContactWhatsappValueSchema>;

/**
 * Keyed lookup map: `SiteSettingValueSchemaByKey[key]` is the schema that MUST validate
 * that key's `value`. Runtime-looked-up by `backend-builder`'s upsert handler (the path
 * param `:key` determines which schema applies — not expressible as a single static
 * per-route zod body schema).
 */
export const SiteSettingValueSchemaByKey = {
  "nav.primary_links": NavPrimaryLinksValueSchema,
  "footer.columns": FooterColumnsValueSchema,
  "footer.legal_links": FooterLegalLinksValueSchema,
  "footer.copyright_text": FooterCopyrightTextValueSchema,
  "seo.defaults": SeoDefaultsValueSchema,
  "contact.details": ContactDetailsValueSchema,
  "contact.whatsapp": ContactWhatsappValueSchema,
} as const satisfies Record<SiteSettingKey, z.ZodTypeAny>;

/** Discriminated-by-key value union — mainly useful for CRM form typing (`key` narrows `value`). */
export const SiteSettingKeyedValueSchema = z.discriminatedUnion("key", [
  z.object({ key: z.literal("nav.primary_links"), value: NavPrimaryLinksValueSchema }).strict(),
  z.object({ key: z.literal("footer.columns"), value: FooterColumnsValueSchema }).strict(),
  z.object({ key: z.literal("footer.legal_links"), value: FooterLegalLinksValueSchema }).strict(),
  z.object({ key: z.literal("footer.copyright_text"), value: FooterCopyrightTextValueSchema }).strict(),
  z.object({ key: z.literal("seo.defaults"), value: SeoDefaultsValueSchema }).strict(),
  z.object({ key: z.literal("contact.details"), value: ContactDetailsValueSchema }).strict(),
  z.object({ key: z.literal("contact.whatsapp"), value: ContactWhatsappValueSchema }).strict(),
]);
export type SiteSettingKeyedValue = z.infer<typeof SiteSettingKeyedValueSchema>;

// ─────────────────────────────────────────────────────────────────────────
// CRM admin endpoints — /api/v1/crm/site-settings
// ─────────────────────────────────────────────────────────────────────────

/** `GET /crm/site-settings` — list (small, non-paginated: exactly 7 rows exist). */
export const ListSiteSettingsQuerySchema = z
  .object({
    group: SiteSettingGroupSchema.optional(),
  })
  .strict();
export type ListSiteSettingsQuery = z.infer<typeof ListSiteSettingsQuerySchema>;

export const SiteSettingSchema = z.object({
  id: UuidSchema,
  key: SiteSettingKeySchema,
  group: SiteSettingGroupSchema,
  /** Validated against `SiteSettingValueSchemaByKey[key]` server-side; typed loosely
   *  here (per-key narrowing happens via `SiteSettingKeyedValueSchema` where needed). */
  value: z.unknown(),
  updatedAt: IsoDateTimeSchema,
});
export type SiteSetting = z.infer<typeof SiteSettingSchema>;

/**
 * `PUT /crm/site-settings/:key` — upsert-by-key. Wire-level DTO carries `value: unknown`
 * (like `SetSettingRequestSchema`, `platform/settings.schemas.ts`); the SERVER validates
 * `value` against `SiteSettingValueSchemaByKey[key]` (looked up from the path param) before
 * writing. Rejects (400, field-level errors) any `value` that doesn't match that key's
 * closed shape, and rejects (404) any `:key` outside `SiteSettingKeySchema`'s 7 literals —
 * this endpoint does NOT create new keys, only sets the 7 seeded ones.
 */
export const UpsertSiteSettingRequestSchema = z
  .object({
    value: z.unknown(),
  })
  .strict();
export type UpsertSiteSettingRequest = z.infer<typeof UpsertSiteSettingRequestSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Public read — /api/v1/public/site-settings
// ─────────────────────────────────────────────────────────────────────────

/**
 * `GET /public/site-settings` — anonymous, cacheable (all 7 values are non-sensitive
 * sitewide marketing primitives; safe for CDN/browser caching — no per-user variance).
 * Returns ALL 7 keys as a flat keyed object (small, fixed-size payload; the `web` shell/
 * footer/SEO-defaults consumer wants all of them on every render, so a list+filter round
 * trip would be pure overhead versus one small object).
 */
export const PublicSiteSettingsResponseSchema = z.object({
  "nav.primary_links": NavPrimaryLinksValueSchema,
  "footer.columns": FooterColumnsValueSchema,
  "footer.legal_links": FooterLegalLinksValueSchema,
  "footer.copyright_text": FooterCopyrightTextValueSchema,
  "seo.defaults": SeoDefaultsValueSchema,
  "contact.details": ContactDetailsValueSchema,
  "contact.whatsapp": ContactWhatsappValueSchema,
});
export type PublicSiteSettingsResponse = z.infer<typeof PublicSiteSettingsResponseSchema>;
