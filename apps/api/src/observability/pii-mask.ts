// apps/api/src/observability/pii-mask.ts
//
// Single shared PII-masking helper (Rule H-4, AC-48, docs/plans/phase-7.md task #9) used
// by BOTH the pino logger formatter (observability/logger.ts) and the Sentry
// `beforeSend` scrubber (observability/sentry.ts) — one masking implementation, not two
// that could drift. Masks emails as `j***@e***.com` and phone numbers as
// `+91XXXXX1234`-style (international prefix preserved, middle digits redacted, last 4
// kept) wherever they appear in a string value — regardless of the field/key name — so
// a free-form interpolated log/error message (`Sending OTP to ${phone}`) is covered, not
// just a matching key name.

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

// Matches an optional international prefix (`+`<1-3 digits>, optionally followed by a
// space/hyphen) plus 10-13 digits — covers Indian mobile numbers (+91XXXXXXXXXX /
// bare 10-digit) and most other E.164-ish formats without over-matching short numeric
// ids (OTP codes, order numbers), which are intentionally shorter than 10 digits.
const PHONE_RE = /(\+\d{1,3}[-\s]?)?\d{10,13}\b/g;

export function maskEmail(value: string): string {
  return value.replace(EMAIL_RE, (match) => {
    const atIndex = match.indexOf("@");
    const local = match.slice(0, atIndex);
    const domain = match.slice(atIndex + 1);
    const domainParts = domain.split(".");
    const maskedLocal = local.length > 1 ? `${local[0]}***` : "*";
    const firstDomainPart = domainParts[0] ?? "";
    const maskedFirstDomainPart = firstDomainPart.length > 1 ? `${firstDomainPart[0]}***` : "*";
    const rest = domainParts.slice(1).join(".");
    return rest ? `${maskedLocal}@${maskedFirstDomainPart}.${rest}` : `${maskedLocal}@${maskedFirstDomainPart}`;
  });
}

export function maskPhone(value: string): string {
  // Reuses the SAME capturing group PHONE_RE itself matched (rather than re-deriving
  // the prefix with a second, independently-backtracking regex) — PHONE_RE's engine may
  // backtrack `\d{1,3}` down to fewer digits than a naive greedy re-match would pick, so
  // a second regex applied to the already-matched substring could disagree with where
  // PHONE_RE actually drew the prefix/digits boundary.
  return value.replace(PHONE_RE, (match: string, prefixGroup: string | undefined) => {
    const prefix = prefixGroup ?? "";
    const digits = match.slice(prefix.length).replace(/\D/g, "");
    if (digits.length < 6) {
      // Too short to confidently be a phone number rather than some other numeric id —
      // leave it untouched rather than mangling e.g. a 6-8 digit order/OTP reference.
      return match;
    }
    const last4 = digits.slice(-4);
    const maskedCount = Math.max(digits.length - 4, 0);
    return `${prefix.replace(/[-\s]/g, "")}${"X".repeat(maskedCount)}${last4}`;
  });
}

/** Masks BOTH emails and phone numbers found anywhere in the given string. */
export function maskPiiString(value: string): string {
  return maskPhone(maskEmail(value));
}

const MAX_DEPTH = 4;

/**
 * Skip these keys entirely when walking a log/event object — they're either already
 * covered by pino's own `redact` config (headers/cookies live under `req`/`res`) or are
 * non-plain-data objects (raw Error, the raw Express req/res) that must not be
 * deep-cloned/walked here.
 */
const SKIP_KEYS = new Set(["req", "res", "err", "error", "stack"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && value.constructor === Object;
}

/**
 * Recursively masks email/phone patterns in string values of a plain-data object, up to
 * a bounded depth, skipping known non-plain-data / already-redacted keys (see
 * `SKIP_KEYS`). Returns a NEW value — never mutates the input (pino/Sentry may reuse the
 * passed-in object elsewhere).
 */
export function maskPiiDeep<T>(value: T, depth = MAX_DEPTH): T {
  if (depth <= 0) {
    return value;
  }
  if (typeof value === "string") {
    return maskPiiString(value) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => maskPiiDeep(item, depth - 1)) as unknown as T;
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = SKIP_KEYS.has(key) ? val : maskPiiDeep(val, depth - 1);
    }
    return out as unknown as T;
  }
  return value;
}
