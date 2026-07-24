// /projects — the student's project work.
//
// Projects are assignments with kind='project'; this route surfaces them on their
// own rather than buried in the Assignments list, because a program's FINAL
// project gates certificate issuance. The nav entry only appears when the student
// actually has project work (see LmsShell) — a program without a project issues
// the certificate on completion with no project step.
import type { Metadata } from "next";

import { LmsShell } from "../../components/shell/lms-shell";
import { ProjectsListContent } from "../../components/projects/projects-list-content";

export const metadata: Metadata = {
  title: "Projects — stimuliiq",
};

export default function ProjectsPage() {
  return (
    <LmsShell>
      <ProjectsListContent />
    </LmsShell>
  );
}
