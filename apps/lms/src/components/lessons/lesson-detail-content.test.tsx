// Tests for the lesson body on a VIDEO lesson.
//
// A video lesson used to render the player and nothing else: `lesson.content` was read only on
// the reading/assignment/quiz branch, so a summary written in the CRM reached the API, was
// returned in the DTO, and then landed nowhere a student could see. What matters here is that
// a video lesson renders the body when there is one, and renders no "About this lesson" frame
// when there isn't — an empty titled card reads as something that failed to load.

import * as React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { LessonDetailResponse } from "@repo/types";

// next/navigation: the component reads ?t= for the resume position.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

// The player owns the stream-url fetch, progress pings and watermark — none of which this
// test is about. Stub it so the test exercises the layout around it, not the video pipeline.
vi.mock("./lesson-video-player", () => ({
  LessonVideoPlayer: () => <div data-testid="stub-player" />,
}));
vi.mock("./lesson-notes-panel", () => ({ LessonNotesPanel: () => <div /> }));
vi.mock("../shared/bookmark-button", () => ({ BookmarkButton: () => <div /> }));
vi.mock("../courses/course-context-panel", () => ({
  CourseContextPanel: () => <div />,
  CourseContextPanelDrawer: () => <div />,
}));
vi.mock("../../hooks/use-progress-reporting", () => ({
  useProgressReporting: () => ({ markComplete: vi.fn(), isMarkingComplete: false, isCompleted: false }),
}));

let lesson: LessonDetailResponse;

vi.mock("../../hooks/use-lesson", () => ({
  useLesson: () => ({
    data: lesson,
    isLoading: false,
    isForbidden: false,
    isSignedOut: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

import { LessonDetailContent } from "./lesson-detail-content";

// The resource list mints a signed download URL through a TanStack `useMutation`, so the
// component needs a QueryClient even on a lesson with no resources — the hook runs either
// way. A fresh client per render keeps the three cases independent.
function renderLesson(): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <LessonDetailContent lessonId={BASE.id} />
    </QueryClientProvider>,
  );
}

const BASE: LessonDetailResponse = {
  id: "33333333-3333-4333-8333-333333333333",
  title: "Semantic HTML",
  type: "video",
  order: 0,
  isPreview: true,
  moduleId: "22222222-2222-4222-8222-222222222222",
  moduleTitle: "HTML, CSS & JavaScript Foundations",
  programId: "11111111-1111-4111-8111-111111111111",
  programTitle: "Full-Stack Web Development Internship",
  enrollmentId: null,
  content: null,
  videoMeta: { status: "ready", durationS: 610, captionTracks: [], provider: "noop" },
  resources: [],
  progress: null,
  nextLessonId: null,
  prevLessonId: null,
};

beforeEach(() => {
  lesson = { ...BASE };
});

describe("LessonDetailContent, body on a video lesson", () => {
  it("shows the summary the faculty wrote, under the player", () => {
    lesson = { ...BASE, content: "<p>Covers headings and landmark roles.</p>" };

    renderLesson();

    const summary = screen.getByTestId("video-lesson-summary");
    expect(summary).toHaveTextContent("Covers headings and landmark roles.");
    expect(screen.getByText("About this lesson")).toBeInTheDocument();
    // The player is still the primary element — the summary sits alongside it, not instead.
    expect(screen.getByTestId("stub-player")).toBeInTheDocument();
  });

  it("renders no empty card when the video has no summary", () => {
    renderLesson();

    expect(screen.queryByTestId("video-lesson-summary")).not.toBeInTheDocument();
    expect(screen.queryByText("About this lesson")).not.toBeInTheDocument();
    expect(screen.getByTestId("stub-player")).toBeInTheDocument();
  });

  it("still renders a reading lesson's body on the reading branch", () => {
    lesson = { ...BASE, type: "reading", videoMeta: null, content: "<p>Read this first.</p>" };

    renderLesson();

    expect(screen.getByTestId("reading-lesson-card")).toHaveTextContent("Read this first.");
    expect(screen.queryByTestId("video-lesson-summary")).not.toBeInTheDocument();
  });
});
