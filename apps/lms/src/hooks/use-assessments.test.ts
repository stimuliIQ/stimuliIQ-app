// use-assessments hook tests — Phase 4 Task #10.
//
// Tests the query key structure and verifies the answer-key absence guarantee
// at the type level (the actual security guarantee is in @repo/types and the
// integration tests in task #12).

import {
  ASSESSMENTS_LIST_KEY,
  assessmentDetailKey,
  attemptKey,
} from "./use-assessments";

describe("assessment query keys", () => {
  it("ASSESSMENTS_LIST_KEY is stable", () => {
    expect(ASSESSMENTS_LIST_KEY).toEqual(["lms", "assessments", "list"]);
  });

  it("assessmentDetailKey includes the id", () => {
    const key = assessmentDetailKey("assess-123");
    expect(key).toEqual(["lms", "assessments", "detail", "assess-123"]);
  });

  it("attemptKey includes the attempt id", () => {
    const key = attemptKey("attempt-456");
    expect(key).toEqual(["lms", "attempts", "attempt-456"]);
  });
});

// ---------------------------------------------------------------------------
// Answer-key type-level test
// The @repo/types compile-time assertion in assessments.schemas.ts already
// proves answerKey cannot be added to AssessmentQuestionPublic. Here we add
// a runtime import test to catch any accidental re-export of banned fields.
// ---------------------------------------------------------------------------

describe("answer-key isolation (AC-D2, AC-J9)", () => {
  it("AssessmentQuestionPublic type from @repo/types has no answerKey property at runtime", async () => {
    // We simulate what the QuizRunner receives: a parsed question object.
    // The schema parse should not include answerKey in output even if it is in input.
    const { AssessmentQuestionPublicSchema } = await import("@repo/types");

    // A mock question with a rogue answerKey field (as if a malicious server sent it)
    const rawWithAnswerKey = {
      id: "q-1",
      type: "mcq",
      prompt: "What is 2+2?",
      options: [{ id: "a", text: "3" }, { id: "b", text: "4" }],
      points: 5,
      order: 1,
      // ROGUE FIELD — should be stripped or cause validation failure
      answerKey: "b",
    };

    // zod schema should parse without the rogue field (strict mode would throw, lenient strips)
    // The schema is not strict() on the public type, so it strips unknown keys.
    // This test verifies that even if a rogue key comes from the backend,
    // the parsed TypeScript object does not carry it.
    const parsed = AssessmentQuestionPublicSchema.safeParse(rawWithAnswerKey);
    if (parsed.success) {
      // The parsed value must not have answerKey
      expect(Object.prototype.hasOwnProperty.call(parsed.data, "answerKey")).toBe(false);
    }
    // If parsing fails, that is also acceptable (the schema rejected the rogue field).
    // Either outcome ensures answerKey never reaches the component.
  });
});
