// Derived view of the student's PROJECTS (assignments with kind='project').
//
// WHY DERIVED, NOT A NEW ENDPOINT:
//   A project IS an assignment (`kind='project'` + milestones) — see
//   packages/types learning/assignments.schemas.ts. GET /me/assignments already
//   returns them with `kind`, `isFinal` and per-student `status`, so filtering
//   client-side reuses the SAME cache entry the Assignments page uses: opening
//   Projects costs no extra request, and both surfaces can never disagree.
//
// The `hasProjects` flag drives whether the "Projects" nav item renders at all —
// a program without a project should not show an empty section (and its students
// go straight to a certificate on completion, since certificate eligibility
// treats "no final project" as vacuously satisfied).
"use client";

import * as React from "react";
import type { AssignmentListItem } from "@repo/types";

import { useMyAssignments } from "./use-assignments";

export interface UseMyProjectsResult {
  projects: AssignmentListItem[];
  /** True when this student has at least one project across their programs. */
  hasProjects: boolean;
  /** Projects still needing work (not yet graded) — drives the nav badge. */
  pendingCount: number;
  isLoading: boolean;
  isSignedOut: boolean;
  isError: boolean;
  refetch: () => void;
}

export function useMyProjects(): UseMyProjectsResult {
  const { assignments, isLoading, isSignedOut, isError, refetch } = useMyAssignments();

  const projects = React.useMemo(
    () => assignments.filter((a) => a.kind === "project"),
    [assignments],
  );

  // "Pending" = anything not yet graded: never submitted, overdue, or awaiting
  // review. A graded project is done from the student's point of view.
  const pendingCount = React.useMemo(
    () => projects.filter((p) => p.status !== "graded").length,
    [projects],
  );

  return {
    projects,
    hasProjects: projects.length > 0,
    pendingCount,
    isLoading,
    isSignedOut,
    isError,
    refetch,
  };
}
