// Tests for the lesson summary living in the resources drawer.
//
// This drawer is where staff already are when they finish attaching a video or a deck, so the
// lesson's written body is editable here as well as in the pencil editor. Both write the same
// `lessons.content` through the same hooks. What matters is that the summary is seeded from the
// lesson rather than starting blank (a blank box over an existing body invites overwriting it
// with nothing), that saving sends only the body — the title and type belong to the pencil —
// and that Save stays disabled until something actually changed, so it is never a no-op PATCH.

import * as React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@repo/ui";

// Radix Select needs pointer events jsdom does not implement; the attachment form has one.
vi.mock("@repo/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@repo/ui")>();
  return {
    ...actual,
    Select: ({ label, value, children }: { label?: string; value?: string; children?: React.ReactNode }) => (
      <label>
        {label}
        <select value={value ?? ""} onChange={() => {}}>
          {children}
        </select>
      </label>
    ),
    SelectItem: ({ value, children }: { value: string; children?: React.ReactNode }) => (
      <option value={value}>{children}</option>
    ),
    FileUpload: () => <div data-testid="stub-file-upload" />,
  };
});

const PROGRAM_ID = "11111111-1111-4111-8111-111111111111";
const MODULE_ID = "22222222-2222-4222-8222-222222222222";
const LESSON_ID = "33333333-3333-4333-8333-333333333333";

const updateLessonMock = vi.fn();
let lessonDetail: { id: string; title: string; type: string; order: number; isPreview: boolean; content: string | null };

vi.mock("../../hooks/use-courses", () => ({
  useLesson: () => ({ data: lessonDetail, isLoading: false, isError: false, refetch: vi.fn() }),
  useUpdateLesson: () => ({ mutateAsync: updateLessonMock, isPending: false }),
}));

vi.mock("../../hooks/use-lesson-resources", () => ({
  useLessonResources: () => ({ data: [], isLoading: false }),
  useResourceUploadUrl: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCreateLessonResource: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteLessonResource: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { LessonResourcesDrawer } from "./lesson-resources-drawer";

function renderDrawer(canEdit = true) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <LessonResourcesDrawer
          programId={PROGRAM_ID}
          moduleId={MODULE_ID}
          lessonId={LESSON_ID}
          lessonTitle="Semantic HTML"
          open
          onOpenChange={() => {}}
          canEdit={canEdit}
        />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  updateLessonMock.mockReset().mockResolvedValue({});
  lessonDetail = { id: LESSON_ID, title: "Semantic HTML", type: "video", order: 0, isPreview: true, content: null };
});

describe("LessonResourcesDrawer, lesson summary", () => {
  it("offers the summary alongside the attachments", () => {
    renderDrawer();

    expect(screen.getByTestId("lesson-summary-input")).toBeInTheDocument();
    expect(screen.getByText("Attached files")).toBeInTheDocument();
  });

  it("seeds the box with the body the lesson already has", () => {
    lessonDetail = { ...lessonDetail, content: "<p>Covers landmark roles.</p>" };

    renderDrawer();

    expect(screen.getByTestId("lesson-summary-input")).toHaveValue("<p>Covers landmark roles.</p>");
  });

  it("saves only the body — title and type stay the pencil's business", async () => {
    const user = userEvent.setup();
    renderDrawer();

    await user.type(screen.getByTestId("lesson-summary-input"), "Covers headings.");
    await user.click(screen.getByTestId("lesson-summary-save"));

    await waitFor(() => expect(updateLessonMock).toHaveBeenCalledTimes(1));
    expect(updateLessonMock).toHaveBeenCalledWith({
      moduleId: MODULE_ID,
      lessonId: LESSON_ID,
      body: { content: "Covers headings." },
    });
  });

  it("keeps Save disabled until the body actually changes", async () => {
    lessonDetail = { ...lessonDetail, content: "<p>Unchanged.</p>" };
    const user = userEvent.setup();
    renderDrawer();

    expect(screen.getByTestId("lesson-summary-save")).toBeDisabled();

    await user.type(screen.getByTestId("lesson-summary-input"), " More.");
    expect(screen.getByTestId("lesson-summary-save")).toBeEnabled();
  });

  it("hides the summary editor from a viewer who cannot edit", () => {
    renderDrawer(false);

    expect(screen.queryByTestId("lesson-summary-input")).not.toBeInTheDocument();
  });
});
