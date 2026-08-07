// Unit tests for `buildOnboardingAnswerIssues` — the shared answer validator that BOTH the
// public form (inline errors, before submit) and the API (the 422 body) run.
//
// It is worth being explicit about why this one function has its own spec: an onboarding
// form whose questions live in a database cannot be validated by a fixed zod object, so the
// usual "one schema, two consumers" guarantee doesn't apply. This function is what replaces
// it. If it drifts, the browser and the server start disagreeing about what a valid
// submission is — and the failure mode is a form that looks fine and then 422s.
//
// Runs under @repo/types' own vitest (the package is ESM).

import { describe, it, expect } from "vitest";
import { buildOnboardingAnswerIssues, type OnboardingValidatableField } from "./onboarding.schemas.js";

function field(overrides: Partial<OnboardingValidatableField> & Pick<OnboardingValidatableField, "key" | "type">): OnboardingValidatableField {
  return {
    label: overrides.key,
    required: false,
    options: null,
    allowOther: false,
    ...overrides,
  };
}

const keys = (issues: Array<{ key: string }>) => issues.map((issue) => issue.key);

describe("buildOnboardingAnswerIssues", () => {
  describe("required-ness", () => {
    it("flags a missing required answer", () => {
      const fields = [field({ key: "full_name", type: "text", required: true, label: "Name" })];
      expect(keys(buildOnboardingAnswerIssues(fields, {}))).toEqual(["full_name"]);
    });

    it("treats whitespace as empty", () => {
      const fields = [field({ key: "full_name", type: "text", required: true })];
      expect(keys(buildOnboardingAnswerIssues(fields, { full_name: "   " }))).toEqual(["full_name"]);
    });

    it("treats an unticked required checkbox as missing (a consent box must be ticked)", () => {
      const fields = [field({ key: "consent", type: "checkbox", required: true, label: "I agree" })];
      expect(keys(buildOnboardingAnswerIssues(fields, { consent: false }))).toEqual(["consent"]);
      expect(buildOnboardingAnswerIssues(fields, { consent: true })).toEqual([]);
    });

    it("leaves an empty OPTIONAL answer alone — and does not then format-check it", () => {
      const fields = [field({ key: "referrals", type: "email" })];
      expect(buildOnboardingAnswerIssues(fields, { referrals: "" })).toEqual([]);
    });
  });

  describe("format rules", () => {
    it("rejects a malformed email and accepts a valid one", () => {
      const fields = [field({ key: "email", type: "email", required: true })];
      expect(keys(buildOnboardingAnswerIssues(fields, { email: "not-an-email" }))).toEqual(["email"]);
      expect(buildOnboardingAnswerIssues(fields, { email: "ananya@example.com" })).toEqual([]);
    });

    // The single product-wide mobile rule: exactly ten local digits.
    it("requires exactly 10 digits for a phone, ignoring punctuation", () => {
      const fields = [field({ key: "phone", type: "phone", required: true })];
      expect(buildOnboardingAnswerIssues(fields, { phone: "98765 43210" })).toEqual([]);
      expect(keys(buildOnboardingAnswerIssues(fields, { phone: "98765" }))).toEqual(["phone"]);
    });

    it("rejects a non-ISO date", () => {
      const fields = [field({ key: "dob", type: "date", required: true })];
      expect(buildOnboardingAnswerIssues(fields, { dob: "2026-08-07" })).toEqual([]);
      expect(keys(buildOnboardingAnswerIssues(fields, { dob: "07/08/2026" }))).toEqual(["dob"]);
    });

    it("accepts a number as either a JS number or a numeric string", () => {
      const fields = [field({ key: "year", type: "number", required: true })];
      expect(buildOnboardingAnswerIssues(fields, { year: 2026 })).toEqual([]);
      expect(buildOnboardingAnswerIssues(fields, { year: "2026" })).toEqual([]);
      expect(keys(buildOnboardingAnswerIssues(fields, { year: "two thousand" }))).toEqual(["year"]);
    });
  });

  describe("choices", () => {
    const choices = ["September", "October"];

    it("rejects an off-list answer when Other is not allowed", () => {
      const fields = [field({ key: "month", type: "radio", required: true, options: choices })];
      expect(keys(buildOnboardingAnswerIssues(fields, { month: "Marchember" }))).toEqual(["month"]);
    });

    // Google Forms' "Other:" escape hatch — the whole point is that free text passes.
    it("accepts any free text when Other IS allowed", () => {
      const fields = [field({ key: "month", type: "radio", required: true, options: choices, allowOther: true })];
      expect(buildOnboardingAnswerIssues(fields, { month: "January next year" })).toEqual([]);
    });

    it("still requires an answer when Other is allowed", () => {
      const fields = [field({ key: "month", type: "radio", required: true, options: choices, allowOther: true })];
      expect(keys(buildOnboardingAnswerIssues(fields, { month: "" }))).toEqual(["month"]);
    });
  });

  describe("server-authoritative types", () => {
    // Membership is checked against the live catalog on the server; the browser has no
    // authoritative list, so it must not invent a rule of its own here.
    it("does not second-guess a program answer's value", () => {
      const fields = [field({ key: "program", type: "program", required: true })];
      expect(buildOnboardingAnswerIssues(fields, { program: "any-uuid-shaped-thing" })).toEqual([]);
    });
  });

  describe("resilience to a form edited mid-fill", () => {
    // A student partway through when staff deactivate a question should not hit a hard
    // error on submit for a question that no longer exists.
    it("ignores answers to keys that are not in the field list", () => {
      const fields = [field({ key: "full_name", type: "text", required: true })];
      expect(buildOnboardingAnswerIssues(fields, { full_name: "Ananya", removed_question: "x" })).toEqual([]);
    });
  });

  it("returns one issue per offending field, so every problem shows at once", () => {
    const fields = [
      field({ key: "full_name", type: "text", required: true }),
      field({ key: "email", type: "email", required: true }),
      field({ key: "phone", type: "phone", required: true }),
    ];
    expect(keys(buildOnboardingAnswerIssues(fields, { email: "nope", phone: "123" }))).toEqual([
      "full_name",
      "email",
      "phone",
    ]);
  });
});
