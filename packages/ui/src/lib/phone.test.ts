import { describe, it, expect } from "vitest";

import {
  PHONE_INPUT_PROPS,
  PHONE_LOCAL_LENGTH,
  isCompleteLocalPhone,
  toE164Phone,
  toLocalPhoneDigits,
} from "./phone";

describe("toLocalPhoneDigits", () => {
  it("keeps a clean 10-digit number as-is", () => {
    expect(toLocalPhoneDigits("9876543210")).toBe("9876543210");
  });

  it("strips separators and formatting", () => {
    expect(toLocalPhoneDigits("98765 43210")).toBe("9876543210");
    expect(toLocalPhoneDigits("(98765)-43210")).toBe("9876543210");
  });

  it("unwraps a stored E.164 value so it round-trips into the field", () => {
    expect(toLocalPhoneDigits("+919876543210")).toBe("9876543210");
    expect(toLocalPhoneDigits("919876543210")).toBe("9876543210");
  });

  it("drops a leading trunk zero", () => {
    expect(toLocalPhoneDigits("09876543210")).toBe("9876543210");
  });

  it("truncates anything longer instead of mis-stripping a country code", () => {
    // 11 digits that merely START with "91" is a typo, not a country code —
    // stripping it would silently eat the first two digits.
    expect(toLocalPhoneDigits("91876543210")).toBe("9187654321");
  });

  it("caps input at the local length", () => {
    expect(toLocalPhoneDigits("12345678901234").length).toBe(PHONE_LOCAL_LENGTH);
  });

  it("returns empty for blank/nullish input", () => {
    expect(toLocalPhoneDigits("")).toBe("");
    expect(toLocalPhoneDigits(null)).toBe("");
    expect(toLocalPhoneDigits(undefined)).toBe("");
    expect(toLocalPhoneDigits("abc")).toBe("");
  });
});

describe("isCompleteLocalPhone", () => {
  it("is true only at exactly 10 digits", () => {
    expect(isCompleteLocalPhone("9876543210")).toBe(true);
    expect(isCompleteLocalPhone("+919876543210")).toBe(true);
    expect(isCompleteLocalPhone("987654321")).toBe(false);
    expect(isCompleteLocalPhone("")).toBe(false);
  });
});

describe("toE164Phone", () => {
  it("prefixes the country code", () => {
    expect(toE164Phone("9876543210")).toBe("+919876543210");
  });

  it("is idempotent on an already-normalised value", () => {
    expect(toE164Phone(toE164Phone("9876543210"))).toBe("+919876543210");
  });

  it("returns empty for blank input rather than a bare country code", () => {
    expect(toE164Phone("")).toBe("");
    expect(toE164Phone(undefined)).toBe("");
  });
});

describe("PHONE_INPUT_PROPS", () => {
  it("caps the field at the local length", () => {
    expect(PHONE_INPUT_PROPS.maxLength).toBe(PHONE_LOCAL_LENGTH);
    expect(PHONE_INPUT_PROPS.inputMode).toBe("numeric");
  });
});
