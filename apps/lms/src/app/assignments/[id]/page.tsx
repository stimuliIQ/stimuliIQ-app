// Assignment detail page (/assignments/[id]) — student-facing.
// Shows assignment instructions + submission form + grade + feedback.
// P4 Task #10: docs/02 §7.5 Assignment detail + submit.
import type { Metadata } from "next";

import { LmsShell } from "../../../components/shell/lms-shell";
import { AssignmentDetailContent } from "../../../components/assignments/assignment-detail-content";

export const metadata: Metadata = {
  title: "Assignment — stimuliiq",
  description: "View assignment details and submit your work.",
};

interface Props {
  params: Promise<{ id: string }>;
}

export default async function AssignmentDetailPage({ params }: Props) {
  const { id } = await params;
  return (
    <LmsShell>
      <AssignmentDetailContent assignmentId={id} />
    </LmsShell>
  );
}
