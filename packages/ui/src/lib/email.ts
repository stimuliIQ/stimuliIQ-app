/**
 * Email-address input rules — one canonical definition shared by every lead
 * form in this package, mirroring what the API's zod `EmailSchema` accepts.
 *
 * Deliberately permissive about the local part (quoting, plus-addressing and
 * unicode are all legal) and strict only about the two things a typo actually
 * breaks: exactly one `@`, and a dotted domain with a real TLD. A stricter
 * regex rejects valid addresses, which is worse than letting the server have
 * the last word.
 */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

/** True when the value looks like a deliverable address. */
export function isValidEmail(raw: string | null | undefined): boolean {
  const value = (raw ?? "").trim();
  return value.length > 0 && value.length <= 254 && EMAIL_PATTERN.test(value);
}

/** Shared copy for the "that is not an email address" validation message. */
export const EMAIL_FORMAT_MESSAGE = "Enter a valid email address, like you@example.com";
