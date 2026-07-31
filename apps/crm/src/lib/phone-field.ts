// Phone-field plumbing for CRM forms — the CRM half of the product-wide rule
// that a mobile number is always exactly 10 local digits (see
// packages/ui/src/lib/phone.ts for the rule and the pure helpers).
//
// Three pieces, because a react-hook-form field needs all three:
//   1. `phoneFieldProps` — DOM behaviour: numeric keypad, 10-char cap, and a
//      sanitiser so paste/autofill can't smuggle in a longer value.
//   2. `requireLocalPhones` — schema wrapper for the zodResolver, because RHF
//      ignores per-field `validate` rules once a resolver is attached, and the
//      shared `PhoneSchema` still (deliberately) accepts 8–15 digits so legacy
//      E.164 rows keep validating.
//   3. `toE164Phone` (re-exported) — applied at submit so the wire format stays
//      `+91XXXXXXXXXX` regardless of what the field shows.
import type * as React from "react";
import type { UseFormRegisterReturn } from "react-hook-form";
import { z } from "zod";
import {
  PHONE_INPUT_PROPS,
  PHONE_LENGTH_MESSAGE,
  PHONE_PLACEHOLDER,
  isCompleteLocalPhone,
  toE164Phone,
  toLocalPhoneDigits,
} from "@repo/ui";

export { toE164Phone, toLocalPhoneDigits, isCompleteLocalPhone };

/**
 * Spread onto an `<Input>` alongside `register("phone")`:
 *
 *   <Input label="Phone" {...phoneFieldProps(register("phone"))} error={…} />
 *
 * Pass any prop AFTER the spread to override it (e.g. a different placeholder
 * for an alternate/guardian number).
 */
export function phoneFieldProps(registration: UseFormRegisterReturn) {
  return {
    ...PHONE_INPUT_PROPS,
    placeholder: PHONE_PLACEHOLDER,
    ...registration,
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
      // Rewrite before RHF reads it, so form state and the visible field agree.
      event.target.value = toLocalPhoneDigits(event.target.value);
      return registration.onChange(event);
    },
  };
}

/**
 * Wrap a request schema so the named fields must be a COMPLETE 10-digit number
 * when present. Blank stays blank — optional phone fields are still optional.
 *
 * Without this a 9-digit entry passes the shared `PhoneSchema` (which allows
 * 8–15 digits) and would be saved as an unreachable `+91` number.
 */
export function requireLocalPhones<T extends z.ZodTypeAny>(schema: T, fields: readonly string[]) {
  return schema.superRefine((value, ctx) => {
    if (value === null || typeof value !== "object") return;
    for (const field of fields) {
      const raw = (value as Record<string, unknown>)[field];
      if (typeof raw !== "string" || raw.trim() === "") continue;
      if (!isCompleteLocalPhone(raw)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: PHONE_LENGTH_MESSAGE,
        });
      }
    }
  });
}

/** `toE164Phone` that returns `undefined` (not `""`) for a blank optional field. */
export function optionalE164Phone(raw: string | null | undefined): string | undefined {
  return toE164Phone(raw) || undefined;
}
