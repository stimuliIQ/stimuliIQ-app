// Assessments list page (/assessments) — student-facing.
// P4 Task #10: docs/02 §7.9 Assessments list.
import type { Metadata } from "next";

import { LmsShell } from "../../components/shell/lms-shell";
import { AssessmentsListContent } from "../../components/assessments/assessments-list-content";

export const metadata: Metadata = {
  title: "My Assessments — stimuliiq",
  description: "View and take your course quizzes and tests.",
};

export default function AssessmentsPage() {
  return (
    <LmsShell>
      <AssessmentsListContent />
    </LmsShell>
  );
}
