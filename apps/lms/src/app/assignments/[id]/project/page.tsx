// Project detail page (/assignments/[id]/project) — student-facing.
// Shows project milestone list + per-milestone submission forms + feedback.
// P4 Task #10: docs/02 §7.6 Projects.
import type { Metadata } from "next";

import { LmsShell } from "../../../../components/shell/lms-shell";
import { ProjectDetailContent } from "../../../../components/assignments/project-detail-content";

export const metadata: Metadata = {
  title: "Project | stimuliiq",
  description: "View and submit your project milestones.",
};

interface Props {
  params: Promise<{ id: string }>;
}

export default async function ProjectDetailPage({ params }: Props) {
  const { id } = await params;
  return (
    <LmsShell>
      <ProjectDetailContent assignmentId={id} />
    </LmsShell>
  );
}
