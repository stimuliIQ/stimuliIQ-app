/**
 * Phone-number input rules — one canonical definition shared by `web`, `crm`
 * and every lead form in this package.
 *
 * Product rule: a mobile number is ALWAYS entered as exactly 10 local digits.
 * The country code is never typed by the user — it is added on submit, so the
 * wire format stays the E.164 `+91XXXXXXXXXX` the API and the DB already store
 * (see `PhoneSchema` in @repo/types, which still accepts legacy/international
 * values so historic rows keep validating).
 *
 * Why the sanitiser rather than only `maxLength`: `maxLength` does not apply to
 * autofill or paste-then-replace in every browser, and stored values come back
 * from the API in E.164 — `toLocalPhoneDigits` makes both round-trip into a
 * 10-digit field instead of showing `+9198765…` and being truncated mid-number.
 */

/** Every phone field in the product is exactly this many digits. */
export const PHONE_LOCAL_LENGTH = 10;

/** Country code prepended on submit (India-first market). */
export const PHONE_COUNTRY_CODE = "+91";

/** Placeholder used by every phone field so the expected shape is obvious. */
export const PHONE_PLACEHOLDER = "10-digit mobile number";

/**
 * Attributes every phone `<input>` shares: numeric keypad on mobile, hard
 * 10-character cap, and a pattern so native validation agrees with ours.
 */
export const PHONE_INPUT_PROPS = {
  type: "tel",
  inputMode: "numeric" as const,
  autoComplete: "tel",
  maxLength: PHONE_LOCAL_LENGTH,
  pattern: `[0-9]{${PHONE_LOCAL_LENGTH}}`,
};

/**
 * Reduce anything the user typed/pasted — or the API returned — to at most 10
 * local digits.
 *
 * Country code / trunk prefix is only stripped at the exact lengths that make
 * it unambiguous (12 digits starting `91`, 11 digits starting `0`); at any
 * other length the value is simply truncated, so typing an 11th digit never
 * silently eats the first two.
 */
export function toLocalPhoneDigits(raw: string | null | undefined): string {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length === PHONE_LOCAL_LENGTH + 2 && digits.startsWith("91")) {
    return digits.slice(2);
  }
  if (digits.length === PHONE_LOCAL_LENGTH + 1 && digits.startsWith("0")) {
    return digits.slice(1);
  }
  return digits.slice(0, PHONE_LOCAL_LENGTH);
}

/** True when the value is a complete 10-digit local number. */
export function isCompleteLocalPhone(raw: string | null | undefined): boolean {
  return toLocalPhoneDigits(raw).length === PHONE_LOCAL_LENGTH;
}

/**
 * Wire format: `+91XXXXXXXXXX`. Returns `""` for an empty input so optional
 * phone fields can stay omitted rather than sending a bare country code.
 */
export function toE164Phone(
  raw: string | null | undefined,
  countryCode: string = PHONE_COUNTRY_CODE,
): string {
  const local = toLocalPhoneDigits(raw);
  return local ? `${countryCode}${local}` : "";
}

/** Shared copy for the "not 10 digits" validation message. */
export const PHONE_LENGTH_MESSAGE = `Enter a ${PHONE_LOCAL_LENGTH}-digit mobile number`;
