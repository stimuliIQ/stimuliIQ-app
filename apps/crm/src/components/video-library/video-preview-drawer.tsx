// Video preview drawer — lets STAFF actually watch the file attached to a lesson
// before students ever see it ("which video is uploaded?").
//
// SECURITY: the playback URL is minted per-open by GET /crm/videos/:id/preview-url
// (permission videolib.view + program scope) and is SHORT-TTL + signed. It is never
// cached (see useVideoPreviewUrl) and the raw storage key / provider asset id are
// never exposed to this component.
//
// CLAUDE.md §3: "no business logic in components — use hooks/services".
import * as React from "react";
import { RefreshCw, Replace } from "lucide-react";
import {
  Button,
  Drawer,
  DrawerContent,
  DrawerBody,
  DrawerFooter,
  EmptyState,
  Skeleton,
  StatusChip,
  VideoPlayer,
} from "@repo/ui";
import type { VideoAsset } from "@repo/types";

import { useVideoPreviewUrl } from "../../hooks/use-video-library";
import { queryErrorMessage } from "../../lib/surface-error";

interface VideoPreviewDrawerProps {
  video: VideoAsset | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Opens the ingest drawer pre-filled to this lesson (replace the file). */
  onReplace?: (video: VideoAsset) => void;
  canReplace?: boolean;
}

function formatDuration(durationS: number | null): string {
  if (!durationS) return "Unknown length";
  const m = Math.floor(durationS / 60);
  const s = durationS % 60;
  return `${m}m ${s}s`;
}

export function VideoPreviewDrawer({
  video,
  open,
  onOpenChange,
  onReplace,
  canReplace = false,
}: VideoPreviewDrawerProps): React.JSX.Element {
  const { data, isLoading, isError, error, refetch } = useVideoPreviewUrl(
    open && video ? video.id : undefined,
  );

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        title={video ? video.lessonTitle : "Video preview"}
        description="Preview the source file attached to this lesson. Students see this same video in the LMS."
        size="lg"
        data-testid="video-preview-drawer"
      >
        <DrawerBody className="flex flex-col gap-4">
          {video ? (
            <div className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
              <StatusChip
                tone={video.status === "ready" ? "success" : video.status === "processing" ? "info" : "danger"}
                label={video.status}
                size="sm"
              />
              <span>{formatDuration(video.durationS)}</span>
              <span aria-hidden="true">·</span>
              <span>{video.provider}</span>
            </div>
          ) : null}

          {/* NOT ready: no file to play yet — say so plainly rather than showing a broken player. */}
          {video && video.status !== "ready" ? (
            <EmptyState
              title={video.status === "processing" ? "No video uploaded yet" : "This video failed to process"}
              description={
                video.status === "processing"
                  ? "This lesson has a video slot but no playable file yet. Upload one to make it available to students."
                  : "Re-upload the source file to fix this lesson."
              }
              action={
                canReplace && onReplace ? (
                  <Button variant="secondary" onClick={() => onReplace(video)} data-testid="video-preview-upload-cta">
                    <Replace className="size-4" aria-hidden="true" />
                    Upload video
                  </Button>
                ) : undefined
              }
              data-testid="video-preview-not-ready"
            />
          ) : isLoading ? (
            <Skeleton shape="block" className="aspect-video w-full rounded-lg" />
          ) : isError ? (
            <EmptyState
              title="Couldn't load the preview"
              description={queryErrorMessage(error, "The playback URL could not be minted.")}
              action={
                <Button variant="secondary" onClick={() => refetch()} data-testid="video-preview-retry">
                  <RefreshCw className="size-4" aria-hidden="true" />
                  Try again
                </Button>
              }
              data-testid="video-preview-error"
            />
          ) : data ? (
            <VideoPlayer
              src={data.url}
              aria-label={`Preview of ${video?.lessonTitle ?? "lesson video"}`}
              data-testid="video-preview-player"
            />
          ) : null}
        </DrawerBody>

        <DrawerFooter>
          {canReplace && video && onReplace ? (
            <Button variant="secondary" onClick={() => onReplace(video)} data-testid="video-preview-replace">
              <Replace className="size-4" aria-hidden="true" />
              Replace video
            </Button>
          ) : null}
          <Button onClick={() => onOpenChange(false)} data-testid="video-preview-close">
            Close
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
