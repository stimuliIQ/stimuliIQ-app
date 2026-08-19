// Assessments list page (/assessments) — student-facing.
// P4 Task #10: docs/02 §7.9 Assessments list.
//
// PageHeader lives here, at page level, not inside AssessmentsListContent — the
// content component returns early for the loading/signed-out/error/empty states,
// so a header rendered only on its success branch disappeared entirely for a
// student with no assessments yet, leaving the page with no <h1> at all. Same
// shape as /forum and the rest of the LMS: one page-level header, then content.
import type { Metadata } from "next";

import { PageHeader } from "@repo/ui";

import { LmsShell } from "../../components/shell/lms-shell";
import { AssessmentsListContent } from "../../components/assessments/assessments-list-content";

export const metadata: Metadata = {
  title: "My Assessments — stimuliiq",
  description: "View and take your course quizzes and tests.",
};

export default function AssessmentsPage() {
  return (
    <LmsShell>
      <div className="space-y-6 md:space-y-8" data-testid="assessments-page">
        <PageHeader
          title="My Assessments"
          description="Quizzes and tests from your enrolled courses."
        />
        <AssessmentsListContent />
      </div>
    </LmsShell>
  );
}
