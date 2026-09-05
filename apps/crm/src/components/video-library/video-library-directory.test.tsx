// Delete coverage for the video library.
//
// The gap this closes: a lesson's video could be REPLACED but never taken off, so a video
// uploaded to the wrong lesson stayed there forever. `videolib.delete` had been seeded and
// granted since Phase 9 with no route and no button consuming it.
//
// What is worth testing here is the gating and the confirm step, not the mutation itself:
// the destructive action must not appear for a role without `videolib.delete`, and must
// not fire until somebody confirms.
import * as React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@repo/ui";
import type { MeResponse, PermissionGrant, VideoAsset } from "@repo/types";

import { VideoLibraryDirectory } from "./video-library-directory";

const useVideoLibraryListMock = vi.fn();
const useDeleteVideoAssetMock = vi.fn();
const deleteMutate = vi.fn();

vi.mock("../../hooks/use-video-library", () => ({
  useVideoLibraryList: (...args: unknown[]) => useVideoLibraryListMock(...args),
  useDeleteVideoAsset: (...args: unknown[]) => useDeleteVideoAssetMock(...args),
  // The drawers this component renders pull these; none are exercised by these tests.
  useVideoPreviewUrl: () => ({ data: undefined, isLoading: false, isError: false, error: null, refetch: vi.fn() }),
  useIngestVideoAsset: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAttachVideoCaptions: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useMarkVideoUploaded: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

const VIDEO: VideoAsset = {
  id: "video-1",
  lessonId: "lesson-1",
  lessonTitle: "Intro to CSS",
  provider: "noop",
  status: "ready",
  durationS: 90,
  captions: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

// hasPermission reads {key, scope} grants, not bare strings.
function me(keys: string[]): MeResponse {
  const permissions: PermissionGrant[] = keys.map((key) => ({ key, scope: "all" }) as PermissionGrant);
  return { permissions } as unknown as MeResponse;
}

// The ingest drawer this component always renders calls useProgramsList (a real
// useQuery), so a provider is required even though these tests never open it.
function renderDirectory(permissionKeys: string[]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <VideoLibraryDirectory me={me(permissionKeys)} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useVideoLibraryListMock.mockReset();
  useDeleteVideoAssetMock.mockReset();
  deleteMutate.mockReset();
  useVideoLibraryListMock.mockReturnValue({
    data: { items: [VIDEO], meta: { total: 1 } },
    isLoading: false,
    isFetching: false,
    isError: false,
    refetch: vi.fn(),
  });
  useDeleteVideoAssetMock.mockReturnValue({ mutate: deleteMutate, isPending: false });
});

describe("VideoLibraryDirectory, removing a video", () => {
  it("offers Delete to a role holding videolib.delete", () => {
    renderDirectory(["videolib.view", "videolib.delete"]);
    expect(screen.getByTestId("video-library-delete-video-1")).toBeInTheDocument();
  });

  // The server is the real boundary, but a button that 403s is a bug of its own: it tells
  // a faculty member they can remove a video and then refuses.
  it("hides Delete from a role without videolib.delete, even one that may replace", () => {
    renderDirectory(["videolib.view", "videolib.upload", "videolib.edit"]);
    expect(screen.queryByTestId("video-library-delete-video-1")).not.toBeInTheDocument();
    // The non-destructive action it sits beside is still there, so this is gating and not
    // the row failing to render at all.
    expect(screen.getByTestId("video-library-replace-video-1")).toBeInTheDocument();
  });

  it("does not delete on the first click — it asks first, naming the lesson", async () => {
    const user = userEvent.setup();
    renderDirectory(["videolib.view", "videolib.delete"]);

    await user.click(screen.getByTestId("video-library-delete-video-1"));

    expect(deleteMutate).not.toHaveBeenCalled();
    const dialog = screen.getByTestId("confirm-delete-video");
    expect(within(dialog).getByText(/Intro to CSS/)).toBeInTheDocument();
  });

  it("deletes the confirmed video once, and only after confirming", async () => {
    const user = userEvent.setup();
    renderDirectory(["videolib.view", "videolib.delete"]);

    await user.click(screen.getByTestId("video-library-delete-video-1"));
    const dialog = screen.getByTestId("confirm-delete-video");
    await user.click(within(dialog).getByRole("button", { name: /remove video/i }));

    expect(deleteMutate).toHaveBeenCalledTimes(1);
    expect(deleteMutate.mock.calls[0]?.[0]).toBe("video-1");
  });
});
