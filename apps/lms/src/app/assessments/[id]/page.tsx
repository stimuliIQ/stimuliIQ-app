// Assessment detail + quiz page (/assessments/[id]) — student-facing.
// Shows assessment metadata + QuizRunner + CountdownTimer + results.
// P4 Task #10: docs/02 §7.9 Assessment take + instant score.
import type { Metadata } from "next";

import { LmsShell } from "../../../components/shell/lms-shell";
import { AssessmentDetailContent } from "../../../components/assessments/assessment-detail-content";

export const metadata: Metadata = {
  title: "Take Assessment — stimuliiq",
  description: "Complete your assessment within the allowed time.",
};

interface Props {
  params: Promise<{ id: string }>;
}

export default async function AssessmentDetailPage({ params }: Props) {
  const { id } = await params;
  return (
    <LmsShell>
      <AssessmentDetailContent assessmentId={id} />
    </LmsShell>
  );
}
