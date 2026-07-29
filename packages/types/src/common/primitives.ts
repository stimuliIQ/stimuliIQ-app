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
 * A flattened, resolved permission grant for the current user — the shape
 * the frontend needs to do RBAC-aware UI hiding. `key` is `module.action`
 * (e.g. `students.edit`). The server is still the only enforcement point;
 * this is presentation-only (CLAUDE.md §3.5).
 */
export const PermissionGrantSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/, "must be `module.action`"),
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
export const PasswordSchema = z
  .string()
  .min(10, "password must be at least 10 characters")
  .max(128)
  .regex(/[A-Za-z]/, "password must contain at least one letter")
  .regex(/[0-9]/, "password must contain at least one digit")
  .describe(
    "Min 10 chars, max 128, must contain at least one letter and one digit " +
      "(both rules enforced server-side; only the letter check is representable in the JSON Schema `pattern`).",
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
