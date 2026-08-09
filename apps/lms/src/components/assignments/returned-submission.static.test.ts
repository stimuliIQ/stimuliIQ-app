// apps/lms/src/components/assignments/returned-submission.static.test.ts
//
// Regression guard for the STUDENT half of the send-back loop.
//
// A reviewer can now return a submission for changes (POST /crm/submissions/:id/return).
// That is only useful if the student's screen tells them so and lets them resubmit — and
// before this work it did neither:
//
//   1. `deriveAssignmentStatus` collapsed `returned` into `submitted`, so the page said
//      "Submitted" and the student waited for a verdict that had already arrived;
//   2. `canResubmit` was `allowResubmit && (isGraded || isSubmitted)` — `returned` was
//      absent, so the Submit-again button never rendered for the one state that exists
//      precisely to ask for another attempt.
//
// Both are one-token conditions that would regress silently and invisibly: nothing throws,
// nothing 500s, the student simply never resubmits and nobody finds out until a cohort's
// projects are all stuck.
//
// ─── WHY THIS IS A "STATIC" TEST ────────────────────────────────────────────────
//
// `apps/lms` has NO component-render harness: `@testing-library/react` is not a dependency
// here (vitest + jsdom only, for hook/pure-function tests — see src/hooks/*.test.ts and
// engagement-a11y.static.test.ts, which documents the same constraint at length). Adding it
// is a new-dependency decision (CLAUDE.md §1) this change does not make unilaterally. So
// these assert on the SOURCE, which is weaker than rendering but strong enough to catch the
// exact regression: the conditions above being narrowed back.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const DETAIL_PATH = resolve(__dirname, "./assignment-detail-content.tsx");
const CHIP_PATH = resolve(__dirname, "./assignment-status-chip.tsx");

describe("returned submissions — student-facing flow", () => {
  const detailSource = readFileSync(DETAIL_PATH, "utf8");
  const chipSource = readFileSync(CHIP_PATH, "utf8");

  it("recognises the returned status at all", () => {
    expect(detailSource).toMatch(/const isReturned = submission\?\.status === "returned"/);
  });

  // The regression that makes the whole loop dead: without `isReturned` here, the student
  // is told to make changes and given no way to submit them.
  it("lets a returned submission be resubmitted", () => {
    const match = detailSource.match(/const canResubmit = [^;]+;/);
    expect(match).not.toBeNull();
    expect(match![0]).toContain("isReturned");
  });

  it("shows the reviewer's reason, not just the status", () => {
    expect(detailSource).toContain('data-testid="assignment-returned-notice"');
    // The reason travels into dangerouslySetInnerHTML like any other feedback, so it must
    // go through the same DOMPurify path (AC-J8) rather than an exception nobody revisits.
    expect(detailSource).toMatch(/function ReturnedReason[\s\S]*sanitizeHtml\(reason\)/);
  });

  it("never calls it rejected or failed — the student is expected to try again", () => {
    const notice = detailSource.slice(
      detailSource.indexOf('data-testid="assignment-returned-notice"'),
      detailSource.indexOf('data-testid="assignment-returned-notice"') + 900,
    );
    expect(notice.toLowerCase()).not.toMatch(/\brejected\b|\bfailed\b/);
    expect(notice).toContain("Changes needed");
  });

  it("gives the status chip a returned entry in both maps", () => {
    // A missing key here is a runtime `undefined` tone/label on the one status that asks
    // the student to act.
    expect(chipSource).toMatch(/returned: "warning"/);
    expect(chipSource).toMatch(/returned: "Changes needed"/);
  });
});
