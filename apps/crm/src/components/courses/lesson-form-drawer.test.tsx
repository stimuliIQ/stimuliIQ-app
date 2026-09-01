// Tests for the lesson body on a VIDEO lesson.
//
// The property under test is the one that changed. A video lesson used to be refused a body:
// the drawer replaced the textarea with "a video lesson's content is its video" and the save
// dropped `content` from the PATCH, so a summary of the video, or the reading meant to follow
// it, had nowhere to live even though the column and the API always accepted one. What matters
// is that the field is offered for a video lesson, that what is typed actually reaches the
// mutation, and that an existing body round-trips instead of being wiped by a save that only
// touched the title.
//
// The non-video types are covered too, narrowly: they already worked, and the point is that
// widening the field to video did not quietly change them.

import * as React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@repo/ui";

import { LessonFormDrawer } from "./lesson-form-drawer";

// Radix's Select needs pointer events jsdom does not implement, and changing the lesson type is
// half of what these tests do. Swap ONLY Select/SelectItem for native equivalents (the
// established pattern, see assessment-form-drawer.test.tsx); every other @repo/ui component
// stays real, so the drawer under test is still the actual drawer.
vi.mock("@repo/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@repo/ui")>();
  return {
    ...actual,
    Select: ({
      label,
      value,
      onValueChange,
      children,
      "data-testid": testId,
    }: {
      label?: string;
      value?: string;
      onValueChange?: (value: string) => void;
      children?: React.ReactNode;
      "data-testid"?: string;
    }) => (
      <label>
        {label}
        <select data-testid={testId} value={value ?? ""} onChange={(e) => onValueChange?.(e.target.value)}>
          {children}
        </select>
      </label>
    ),
    SelectItem: ({ value, children }: { value: string; children?: React.ReactNode }) => (
      <option value={value}>{children}</option>
    ),
  };
});

const PROGRAM_ID = "11111111-1111-4111-8111-111111111111";
const MODULE_ID = "22222222-2222-4222-8222-222222222222";
const LESSON_ID = "33333333-3333-4333-8333-333333333333";

const updateLessonMock = vi.fn();

/** Swapped per test so each one controls the lesson the drawer loads. */
let lessonDetail: { id: string; title: string; type: string; order: number; isPreview: boolean; content: string | null };

vi.mock("../../hooks/use-courses", () => ({
  useLesson: () => ({ data: lessonDetail, isLoading: false, isError: false, refetch: vi.fn() }),
  useUpdateLesson: () => ({ mutateAsync: updateLessonMock, isPending: false }),
}));

const LESSON_NODE = {
  id: LESSON_ID,
  title: "Semantic HTML",
  type: "video" as const,
  order: 0,
  isPreview: true,
};

function renderDrawer() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <LessonFormDrawer
          programId={PROGRAM_ID}
          moduleId={MODULE_ID}
          lesson={LESSON_NODE}
          open
          onOpenChange={() => {}}
        />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  updateLessonMock.mockReset().mockResolvedValue({});
  lessonDetail = { id: LESSON_ID, title: "Semantic HTML", type: "video", order: 0, isPreview: true, content: null };
});

describe("LessonFormDrawer, body on a video lesson", () => {
  it("offers a body field on a video lesson", () => {
    renderDrawer();

    expect(screen.getByTestId("lesson-form-content")).toBeInTheDocument();
    expect(screen.getByText("Summary & notes")).toBeInTheDocument();
  });

  it("still points at the camera button for the video file itself", () => {
    renderDrawer();

    // The textarea must not read as the place the video goes.
    expect(screen.getByTestId("lesson-form-video-note")).toHaveTextContent(/camera button/i);
  });

  it("sends what was typed on a video lesson to the API", async () => {
    const user = userEvent.setup();
    renderDrawer();

    await user.type(screen.getByTestId("lesson-form-content"), "Covers headings and landmarks.");
    await user.click(screen.getByTestId("lesson-form-save"));

    await waitFor(() => expect(updateLessonMock).toHaveBeenCalledTimes(1));
    expect(updateLessonMock).toHaveBeenCalledWith({
      moduleId: MODULE_ID,
      lessonId: LESSON_ID,
      body: { title: "Semantic HTML", type: "video", content: "Covers headings and landmarks." },
    });
  });

  it("does not wipe an existing video body when only the title is edited", async () => {
    lessonDetail = { ...lessonDetail, content: "<p>Watch, then read MDN on landmarks.</p>" };
    const user = userEvent.setup();
    renderDrawer();

    await user.type(screen.getByTestId("lesson-form-title"), " basics");
    await user.click(screen.getByTestId("lesson-form-save"));

    await waitFor(() => expect(updateLessonMock).toHaveBeenCalledTimes(1));
    expect(updateLessonMock).toHaveBeenCalledWith({
      moduleId: MODULE_ID,
      lessonId: LESSON_ID,
      body: {
        title: "Semantic HTML basics",
        type: "video",
        content: "<p>Watch, then read MDN on landmarks.</p>",
      },
    });
  });

  it("keeps the body when the type is switched from reading to video", async () => {
    lessonDetail = { ...lessonDetail, type: "reading", content: "<p>Existing reading.</p>" };
    const user = userEvent.setup();
    renderDrawer();

    // A reading lesson labels the same field "Content".
    expect(screen.getByText("Content")).toBeInTheDocument();

    await user.selectOptions(screen.getByTestId("lesson-form-type"), "video");
    await user.click(screen.getByTestId("lesson-form-save"));

    await waitFor(() => expect(updateLessonMock).toHaveBeenCalledTimes(1));
    expect(updateLessonMock).toHaveBeenCalledWith({
      moduleId: MODULE_ID,
      lessonId: LESSON_ID,
      body: { title: "Semantic HTML", type: "video", content: "<p>Existing reading.</p>" },
    });
  });
});
