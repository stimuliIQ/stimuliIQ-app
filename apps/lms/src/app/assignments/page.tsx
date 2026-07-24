// Assignments list page (/assignments) — student-facing.
// Mobile-first, LmsShell, bottom-tab-nav.
// P4 Task #10: docs/02 §7.5 Assignments list.
import type { Metadata } from "next";

import { LmsShell } from "../../components/shell/lms-shell";
import { AssignmentsListContent } from "../../components/assignments/assignments-list-content";

export const metadata: Metadata = {
  title: "My Assignments — stimuliiq",
  description: "View and submit your course assignments and projects.",
};

export default function AssignmentsPage() {
  return (
    <LmsShell>
      <AssignmentsListContent />
    </LmsShell>
  );
}
