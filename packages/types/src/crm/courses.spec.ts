// `EnrollmentPaymentUrlSchema` guards the destination of a PUBLIC button: whatever passes
// here is what a student's browser is sent to when they press "Enroll Now". These tests pin
// the two judgement calls (https only, trimmed) so a looser `.url()` cannot creep back in.
import { describe, it, expect } from "vitest";

import { EnrollmentPaymentUrlSchema, UpdateProgramRequestSchema } from "./courses.schemas.js";

describe("EnrollmentPaymentUrlSchema", () => {
  it("accepts a Razorpay payment link", () => {
    expect(EnrollmentPaymentUrlSchema.parse("https://rzp.io/l/neurology-workshop")).toBe(
      "https://rzp.io/l/neurology-workshop",
    );
  });

  it("trims whitespace copied from the dashboard", () => {
    expect(EnrollmentPaymentUrlSchema.parse("  https://rzp.io/l/abc \n")).toBe("https://rzp.io/l/abc");
  });

  it.each(["http://rzp.io/l/abc", "javascript:alert(1)", "rzp.io/l/abc", ""])(
    "rejects %p",
    (value) => {
      expect(EnrollmentPaymentUrlSchema.safeParse(value).success).toBe(false);
    },
  );
});

describe("UpdateProgramRequestSchema.enrollmentPaymentUrl", () => {
  it("accepts null to clear the link", () => {
    expect(UpdateProgramRequestSchema.parse({ enrollmentPaymentUrl: null })).toEqual({
      enrollmentPaymentUrl: null,
    });
  });

  it("accepts omission (field untouched)", () => {
    expect(UpdateProgramRequestSchema.parse({})).toEqual({});
  });
});
