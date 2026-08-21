import { maskEmail, maskPhone, maskPiiString, maskPiiDeep } from "./pii-mask";

describe("maskEmail, AC-48", () => {
  it("masks a typical email as j***@e***.com-style", () => {
    expect(maskEmail("jane@example.com")).toBe("j***@e***.com");
  });

  it("masks every email found in a longer string", () => {
    const out = maskEmail("Contact jane@example.com or john@test.co.in for help");
    expect(out).not.toContain("jane@example.com");
    expect(out).not.toContain("john@test.co.in");
    expect(out).toContain("j***@e***.com");
  });

  it("leaves non-email strings untouched", () => {
    expect(maskEmail("no email here")).toBe("no email here");
  });
});

describe("maskPhone, AC-48", () => {
  it("masks a +91-prefixed Indian mobile number, preserving the prefix and last 4 digits", () => {
    const out = maskPhone("+919876541234");
    expect(out).not.toContain("9876541234");
    expect(out).toMatch(/^\+91X+1234$/);
  });

  it("masks a bare 10-digit number", () => {
    const out = maskPhone("9876541234");
    expect(out).not.toBe("9876541234");
    expect(out).toMatch(/^X+1234$/);
  });

  it("does not touch short numeric ids (e.g. a 6-digit OTP code)", () => {
    expect(maskPhone("482913")).toBe("482913");
  });
});

describe("maskPiiString", () => {
  it("masks both an email and a phone number in the same string", () => {
    const out = maskPiiString("Student jane@example.com, phone +919876541234, enrolled.");
    expect(out).not.toContain("jane@example.com");
    expect(out).not.toContain("9876541234");
    expect(out).toContain("j***@e***.com");
  });
});

describe("maskPiiDeep", () => {
  it("masks PII in nested plain-object fields, bounded by depth", () => {
    const input = {
      name: "Jane",
      contact: { email: "jane@example.com", phone: "+919876541234" },
    };

    const out = maskPiiDeep(input);

    expect(out.contact.email).not.toContain("jane@example.com");
    expect(out.contact.phone).not.toContain("9876541234");
    expect(out.name).toBe("Jane");
  });

  it("masks PII inside arrays", () => {
    const out = maskPiiDeep({ emails: ["a@example.com", "b@example.com"] });
    expect(out.emails[0]).not.toContain("a@example.com");
    expect(out.emails[1]).not.toContain("b@example.com");
  });

  it("does NOT walk into req/res/err/error/stack keys (avoids touching raw circular objects)", () => {
    const circular: Record<string, unknown> = { self: undefined };
    circular.self = circular;
    const input = { req: circular, msg: "user@example.com" };

    const out = maskPiiDeep(input) as typeof input;

    expect(out.req).toBe(circular); // untouched, same reference
    expect(out.msg).not.toContain("user@example.com");
  });

  it("never mutates the input object", () => {
    const input = { email: "jane@example.com" };
    maskPiiDeep(input);
    expect(input.email).toBe("jane@example.com");
  });
});
