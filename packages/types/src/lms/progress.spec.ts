// `summariseCourseProgress` is the ONE definition of course completion, run identically by
// the API and both frontends. It is arithmetic, so it typechecks whatever it returns — these
// tests pin the three judgement calls inside it, each of which produced a real bug when it
// was made differently in different places.
import { describe, it, expect } from "vitest";

import { summariseCourseProgress } from "./progress.schemas.js";

describe("summariseCourseProgress", () => {
  it("reports the plain fraction", () => {
    expect(summariseCourseProgress(49, 50)).toEqual({
      lessonsTotal: 50,
      lessonsCompleted: 49,
      lessonsPending: 1,
      progressPct: 98,
      isComplete: false,
    });
  });

  it("is complete only when every lesson is done", () => {
    expect(summariseCourseProgress(50, 50).isComplete).toBe(true);
    expect(summariseCourseProgress(50, 50).progressPct).toBe(100);
    expect(summariseCourseProgress(49, 50).isComplete).toBe(false);
  });

  it("never rounds an unfinished course up to 100%", () => {
    // 199/200 is 99.5%, which Math.round makes 100. A card reading "100%" beside a
    // "Continue learning" button is exactly the contradiction this helper exists to
    // prevent, so short of the line caps at 99.
    const almost = summariseCourseProgress(199, 200);
    expect(almost.progressPct).toBe(99);
    expect(almost.isComplete).toBe(false);
    expect(almost.lessonsPending).toBe(1);
  });

  it("treats a programme with no lessons as 0%, not 100%", () => {
    // Vacuous truth would say "all zero lessons are done". A brand-new programme showing
    // every enrolled student as Completed is not a state anybody wants to explain.
    expect(summariseCourseProgress(0, 0)).toEqual({
      lessonsTotal: 0,
      lessonsCompleted: 0,
      lessonsPending: 0,
      progressPct: 0,
      isComplete: false,
    });
  });

  it("clamps a completed count that exceeds the total", () => {
    // Possible for a moment if a finished lesson is removed from the curriculum. 104% is
    // not a number to show anybody.
    expect(summariseCourseProgress(26, 25)).toMatchObject({
      lessonsCompleted: 25,
      lessonsPending: 0,
      progressPct: 100,
      isComplete: true,
    });
  });

  it("floors negatives and truncates fractions rather than propagating them", () => {
    expect(summariseCourseProgress(-3, 10).lessonsCompleted).toBe(0);
    expect(summariseCourseProgress(5, -10)).toMatchObject({ lessonsTotal: 0, progressPct: 0 });
    expect(summariseCourseProgress(2.9, 10).lessonsCompleted).toBe(2);
  });
});
