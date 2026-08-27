// Course-type contract tests. `slugifyCourseTypeKey` is run by BOTH the API (which
// generates the stored key) and the CRM form (which previews it), so a disagreement between
// them would show up as a key that is not what the screen promised.

import { describe, expect, it } from "vitest";

import {
  CourseTypeKeySchema,
  CreateCourseTypeRequestSchema,
  UpdateCourseTypeRequestSchema,
  courseTypeLabel,
  slugifyCourseTypeKey,
} from "./course-types.schemas.js";

describe("slugifyCourseTypeKey", () => {
  it("lowercases and joins words with underscores", () => {
    expect(slugifyCourseTypeKey("B.Tech")).toBe("b_tech");
    expect(slugifyCourseTypeKey("B.Sc Nursing")).toBe("b_sc_nursing");
    expect(slugifyCourseTypeKey("Allied Health")).toBe("allied_health");
    expect(slugifyCourseTypeKey("MBBS")).toBe("mbbs");
  });

  it("collapses runs of punctuation and trims the edges", () => {
    expect(slugifyCourseTypeKey("  M.Sc — Nursing!! ")).toBe("m_sc_nursing");
  });

  it("returns an empty string when there is nothing usable, rather than an empty-ish key", () => {
    expect(slugifyCourseTypeKey("!!!")).toBe("");
    expect(slugifyCourseTypeKey("   ")).toBe("");
  });

  it("always produces something the key schema accepts", () => {
    for (const label of ["B.Tech", "B.Sc Nursing", "MBBS", "Post-Graduate (Medicine)", "2 Year Diploma"]) {
      expect(CourseTypeKeySchema.safeParse(slugifyCourseTypeKey(label)).success).toBe(true);
    }
  });

  it("never ends in an underscore, even when truncated at the 60-character cap", () => {
    const key = slugifyCourseTypeKey(`${"a".repeat(59)} nursing`);
    expect(key.length).toBeLessThanOrEqual(60);
    expect(key.endsWith("_")).toBe(false);
  });
});

describe("request schemas", () => {
  it("does not accept a caller-supplied key on create — it is derived from the label", () => {
    const result = CreateCourseTypeRequestSchema.safeParse({ label: "MBBS", key: "something_else" });
    expect(result.success).toBe(false);
  });

  it("does not accept a key on update either — the stored key is immutable", () => {
    expect(UpdateCourseTypeRequestSchema.safeParse({ key: "renamed" }).success).toBe(false);
    expect(UpdateCourseTypeRequestSchema.safeParse({ label: "Renamed" }).success).toBe(true);
  });

  it("trims the label so ' MBBS ' and 'MBBS' cannot both exist", () => {
    const result = CreateCourseTypeRequestSchema.parse({ label: "  MBBS  " });
    expect(result.label).toBe("MBBS");
  });
});

describe("courseTypeLabel", () => {
  const options = [
    { key: "mbbs", label: "MBBS" },
    { key: "b_sc_nursing", label: "B.Sc Nursing" },
  ];

  it("resolves a live key to its label", () => {
    expect(courseTypeLabel("mbbs", options)).toBe("MBBS");
  });

  it("falls back to the raw key for an option that no longer exists, never a blank", () => {
    expect(courseTypeLabel("bds", options)).toBe("bds");
  });

  it("returns null when the student has no course type recorded", () => {
    expect(courseTypeLabel(null, options)).toBeNull();
    expect(courseTypeLabel(undefined, options)).toBeNull();
  });
});
