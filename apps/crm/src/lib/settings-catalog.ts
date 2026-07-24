// Curated catalog of KNOWN platform/company settings, rendered by the Settings
// page as typed form controls (text / email / textarea / select) instead of a raw
// "type a key + paste JSON" editor. This is presentation metadata only — the wire
// contract is still the generic `Setting` key/value store (packages/types
// platform/settings.schemas.ts); a catalog entry just declares how a given key
// should look and be edited in the CRM.
//
// HONESTY NOTE (see docs P10-2 — the `stats.headline` "save-does-nothing" trap that
// was removed): these values are STORED configuration/reference data (company
// profile, display defaults). They are the source-of-truth record of that
// information; the catalog deliberately avoids behavioural toggles that would imply
// an effect the backend does not yet wire up. When a setting becomes actually
// consumed by a module, add it here (and, if it drives behaviour, say so in its
// `description`).

import type { SettingScope } from "@repo/types";

export type SettingControl = "text" | "textarea" | "select";

export interface SettingField {
  /** The `Setting.key` this field reads/writes (e.g. "company.supportEmail"). */
  key: string;
  /** Visible field label. */
  label: string;
  /** One-line helper text under the field. */
  description?: string;
  control: SettingControl;
  /** For `control: "text"` — the underlying HTML input type. */
  inputType?: "text" | "email" | "url" | "tel";
  /** Placeholder / example value (also used to hint the default). */
  placeholder?: string;
  /** For `control: "select"` — the allowed values. */
  options?: Array<{ value: string; label: string }>;
}

export interface SettingGroup {
  title: string;
  /** Optional short blurb under the group heading. */
  description?: string;
  fields: SettingField[];
}

/**
 * Every known setting, grouped per scope. Keys not listed here still work — they
 * appear under the Settings page's "Advanced" section as raw key/value rows, so no
 * data is ever hidden.
 */
export const SETTINGS_CATALOG: Record<SettingScope, SettingGroup[]> = {
  // Company scope: tenant-configurable profile & contact details CRM staff maintain.
  company: [
    {
      title: "Company profile",
      description: "How your organisation identifies itself across the platform.",
      fields: [
        {
          key: "company.legalName",
          label: "Legal / brand name",
          description: "Shown as the issuer on generated invoices.",
          control: "text",
          placeholder: "Stimuliiq Technologies Pvt. Ltd.",
        },
        { key: "company.websiteUrl", label: "Website URL", control: "text", inputType: "url", placeholder: "https://stimuliiq.com" },
        { key: "company.address", label: "Registered address", control: "textarea", placeholder: "Street, City, State, PIN" },
      ],
    },
    {
      title: "Support contact",
      description: "Where students and leads reach your team.",
      fields: [
        {
          key: "company.supportEmail",
          label: "Support email",
          description: "Shown alongside the company name on generated invoices.",
          control: "text",
          inputType: "email",
          placeholder: "help@stimuliiq.com",
        },
        { key: "company.supportPhone", label: "Support phone", control: "text", inputType: "tel", placeholder: "+91 98765 43210" },
        { key: "company.whatsappNumber", label: "WhatsApp number", control: "text", inputType: "tel", placeholder: "+91 98765 43210" },
      ],
    },
  ],
  // System scope: platform-wide display defaults (Owner/Admin only).
  system: [
    {
      title: "Localisation defaults",
      description: "Default display conventions for the platform.",
      fields: [
        {
          key: "platform.defaultCurrency",
          label: "Default currency",
          control: "select",
          options: [
            { value: "INR", label: "Indian Rupee (₹ INR)" },
            { value: "USD", label: "US Dollar ($ USD)" },
            { value: "EUR", label: "Euro (€ EUR)" },
          ],
        },
        { key: "platform.timezone", label: "Default timezone", control: "text", placeholder: "Asia/Kolkata" },
        {
          key: "platform.dateFormat",
          label: "Date format",
          control: "select",
          options: [
            { value: "DD/MM/YYYY", label: "DD/MM/YYYY (31/12/2026)" },
            { value: "MM/DD/YYYY", label: "MM/DD/YYYY (12/31/2026)" },
            { value: "YYYY-MM-DD", label: "YYYY-MM-DD (2026-12-31)" },
          ],
        },
      ],
    },
  ],
};

/** Every catalog key for a scope — used to split "known" vs "advanced/custom" settings. */
export function catalogKeysForScope(scope: SettingScope): Set<string> {
  return new Set(SETTINGS_CATALOG[scope].flatMap((group) => group.fields.map((field) => field.key)));
}

/**
 * Coerces a stored `Setting.value` (arbitrary JSON) into the string a typed catalog
 * control edits. Strings pass through; anything else (a value set via the Advanced
 * raw-JSON editor) is shown as its JSON text so it is never silently dropped.
 */
export function settingValueToString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}
