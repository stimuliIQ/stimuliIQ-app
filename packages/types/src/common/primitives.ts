// Shared primitive schemas reused across resource DTOs. Keep this file small —
// one canonical definition per primitive so FE/BE never re-derive validation
// rules independently (CLAUDE.md §3.2).

import { z } from "zod";

/** PKs are uuid v4 strings everywhere (docs/05 §1, locked decision). */
export const UuidSchema = z.string().uuid();

/**
 * Permission data-scope dimension enforced server-side by the ScopeInterceptor
 * (docs/04-trd-architecture.md §2.4). `all` = tenant-wide, `branch` = own
 * branch, `assigned` = records assigned to the actor, `own` = actor's own
 * records only.
 */
export const PermissionScopeSchema = z.enum(["all", "branch", "assigned", "own"]);
export type PermissionScope = z.infer<typeof PermissionScopeSchema>;

/**
 * Shape of a permission key: TWO OR MORE dot-separated lowercase segments.
 *
 * It used to be `module.action` EXACTLY, which quietly made roles unsavable. The seeded
 * catalog has always carried deeper keys — `reports.revenue.view`, `leave.calendar.view`,
 * `careers.openings.manage`, `onboarding.fields.manage`, `dpdp.erasure.execute`,
 * `mentor.dashboard.view` — and the CRM permission matrix renders every one of them as a
 * toggle. Because that save is a FULL REPLACE, switching a single one of those on made the
 * entire PUT fail validation (400), taking the role's other, perfectly valid grants down
 * with it: "Couldn't save permissions — one or more fields failed validation", with nothing
 * on screen naming the offending field. Reads were never affected, only writes, which is
 * exactly why the catalog kept offering keys that could not be saved.
 *
 * The catalog remains the real gate — RolesService.updatePermissions resolves every key
 * against it and 404s on an unknown one. This pattern is only a cheap shape check.
 */
export const PERMISSION_KEY_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;
export const PERMISSION_KEY_MESSAGE =
  "must be dot-separated lowercase segments, e.g. `students.edit` or `reports.revenue.view`";

/**
 * A flattened, resolved permission grant for the current user — the shape
 * the frontend needs to do RBAC-aware UI hiding. `key` is a dotted permission
 * key (e.g. `students.edit`, `reports.revenue.view`). The server is still the
 * only enforcement point; this is presentation-only (CLAUDE.md §3.5).
 */
export const PermissionGrantSchema = z.object({
  key: z.string().regex(PERMISSION_KEY_PATTERN, PERMISSION_KEY_MESSAGE),
  scope: PermissionScopeSchema,
});
export type PermissionGrant = z.infer<typeof PermissionGrantSchema>;

/** E.164-ish phone validation: optional leading +, 8-15 digits. India-first but not locked to +91. */
export const PhoneSchema = z
  .string()
  .regex(/^\+?[1-9]\d{7,14}$/, "must be a valid phone number in E.164-like format");

/**
 * Password policy: min 10 chars, at least one letter and one digit. Adjust
 * centrally here only. NOTE for OpenAPI consumers: JSON Schema's `pattern`
 * keyword can only carry the LAST `.regex()` zod-to-openapi sees (letter
 * check), so the digit requirement is enforced by zod at runtime but is not
 * independently visible in the generated `pattern` — see the description.
 */
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

const PASSWORD_LETTER_RE = /[A-Za-z]/;
const PASSWORD_DIGIT_RE = /[0-9]/;

export const PasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `password must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH)
  .regex(PASSWORD_LETTER_RE, "password must contain at least one letter")
  .regex(PASSWORD_DIGIT_RE, "password must contain at least one digit")
  .describe(
    `Min ${PASSWORD_MIN_LENGTH} chars, max ${PASSWORD_MAX_LENGTH}, must contain at least one letter and one digit ` +
      "(both rules enforced server-side; only the letter check is representable in the JSON Schema `pattern`).",
  );

/**
 * The password policy expressed as individually-checkable rules, so a form can show
 * WHICH requirement is still unmet instead of only a single collapsed error string.
 *
 * Deliberately built from the SAME constants/regexes as `PasswordSchema` above rather
 * than restating them: a checklist that drifts from the validator is worse than none,
 * because it tells the user they have satisfied a rule the server then rejects. Adding
 * a rule means adding it here and to the schema in one edit, in this file only.
 *
 * `label` is user-facing copy (sentence case, no trailing period) — it is rendered
 * verbatim by `PasswordRequirements` in @repo/ui.
 */
export interface PasswordRule {
  id: "length" | "letter" | "digit";
  label: string;
  isMet: (value: string) => boolean;
}

export const PASSWORD_RULES: readonly PasswordRule[] = [
  {
    id: "length",
    label: `At least ${PASSWORD_MIN_LENGTH} characters`,
    isMet: (value) => value.length >= PASSWORD_MIN_LENGTH && value.length <= PASSWORD_MAX_LENGTH,
  },
  { id: "letter", label: "Contains a letter", isMet: (value) => PASSWORD_LETTER_RE.test(value) },
  { id: "digit", label: "Contains a digit", isMet: (value) => PASSWORD_DIGIT_RE.test(value) },
];

/** Evaluates every rule against `value`. Order matches `PASSWORD_RULES`. */
export function checkPasswordRules(value: string): Array<{ id: PasswordRule["id"]; label: string; met: boolean }> {
  return PASSWORD_RULES.map((rule) => ({ id: rule.id, label: rule.label, met: rule.isMet(value) }));
}

/**
 * A query-string boolean that treats `?flag=false` as FALSE.
 *
 * `z.coerce.boolean()` is `Boolean(value)`, so EVERY non-empty string coerces to `true` —
 * "false" and "0" included. A query string only ever carries strings, so a filter declared
 * with `z.coerce.boolean()` is permanently stuck ON for any client that sends the parameter
 * explicitly, which `toQueryString` (@repo/api-client) always does: it serializes
 * `{ includeDeleted: false }` to `?includeDeleted=false`, which then parses back as `true`.
 *
 * That is how soft-deleted faculty kept appearing in the CRM list while the detail route
 * (which filters `deletedAt: null` unconditionally) answered 404 for the very same row.
 *
 * Use this for any boolean that arrives via the query string. Body fields are parsed from
 * JSON and already carry real booleans, so they do not need it.
 */
export const BooleanQueryFlagSchema = z.preprocess(
  (value) => (typeof value === "string" ? value.toLowerCase() === "true" : value),
  z.boolean(),
);

/** 6-digit numeric OTP code, as issued by the (stubbed) SmsProvider. */
export const OtpCodeSchema = z.string().regex(/^\d{6}$/, "OTP must be exactly 6 digits");

/** ISO-8601 datetime string (used wherever a Date crosses the wire). */
export const IsoDateTimeSchema = z.string().datetime({ offset: true });

/** ISO-8601 date-only string (`YYYY-MM-DD`), used for date-only fields (e.g. batch start/end). */
export const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be an ISO-8601 date (YYYY-MM-DD)");

/**
 * S3/R2 object storage key (never a raw URL) — e.g. `blog/covers/abc123.jpg`. Public CDN
 * URLs are always minted server-side from a key like this (StorageProvider convention,
 * CLAUDE.md §1); the raw key itself is never exposed on a PUBLIC read DTO. Used by every
 * `*ImageKey`/`*PhotoKey` field across content DTOs, including the Phase-10 page-builder
 * block registry (docs/specs/phase-10-page-builder.md "Shared conventions").
 *
 * SECURITY (M1/L1 review): a bare `z.string()` here previously accepted arbitrary
 * absolute URLs/paths (`https://evil.com/x`, `javascript:alert(1)`, `../../etc/passwd`)
 * wherever an *ImageKey field is later concatenated onto a CDN base URL
 * (content.util.ts#mintCdnUrl) — an open-redirect/traversal-shaped input class. Tightened
 * to reject:
 *   - a leading "/" (an absolute path), EXCEPT the legacy "/images/..." static-asset
 *     prefix (checked against `prisma/fixtures/builder-pages/*.json`, the Phase-10
 *     migration fixtures for the 6 audited pages — EVERY `*ImageKey` value there is a
 *     pre-existing `/images/...` public-folder path from before the S3/R2 migration,
 *     e.g. "/images/hero/hero-background.avif"; this exception keeps those fixtures parseable).
 *   - "//" anywhere (protocol-relative URL trick).
 *   - any URI scheme — a ":" appearing before the first "/" (or with no "/" at all).
 *   - any "../" path-traversal segment.
 */
export const ObjectKeySchema = z
  .string()
  .min(1)
  .max(500)
  .refine(
    (value) => !value.startsWith("/") || value.startsWith("/images/"),
    "must not be an absolute path (the legacy \"/images/\" static-asset prefix is the one exception)",
  )
  .refine((value) => !value.includes("//"), "must not contain \"//\"")
  .refine((value) => {
    const firstSlash = value.indexOf("/");
    const firstColon = value.indexOf(":");
    if (firstColon === -1) return true;
    return firstSlash !== -1 && firstColon > firstSlash;
  }, "must not contain a URI scheme (e.g. \"javascript:\", \"data:\", \"https:\")")
  .refine((value) => !value.split("/").includes(".."), "must not contain \"..\" path segments");

/**
 * A same-origin relative path (`/programs`, `#apply`), an `https://` absolute URL, or an
 * explicit `mailto:` link. Deliberately excludes plain `http://` (no insecure absolute
 * links) and any other URI scheme (`javascript:`, `data:`, etc. — XSS surface). Shared by
 * every `href` field across the Phase-10 page-builder block registry AND the `SiteSetting`
 * nav/footer link schemas (docs/specs/phase-10-page-builder.md "Shared conventions":
 * "href fields are validated as either a same-origin relative path ... or an https://
 * absolute URL ... mailto: allowed explicitly where audited").
 */
export const HrefSchema = z
  .string()
  .min(1)
  .max(2048)
  .refine(
    (value) =>
      value.startsWith("/") ||
      value.startsWith("#") ||
      /^https:\/\/[^\s]+$/.test(value) ||
      /^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
    "href must be a relative path (/…), an in-page anchor (#…), an https:// URL, or a mailto: link",
  );
