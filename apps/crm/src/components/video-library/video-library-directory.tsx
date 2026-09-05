// Video library directory — upload → transcode status → captions → attached
// lesson, per Phase 9 Completion T26/T38 (docs/plans/phase-9-completion.md).
import * as React from "react";
import { Plus, Subtitles, Play, Replace, Trash2 } from "lucide-react";
import { Button, ConfirmDialog, DataTable, type DataTableColumn, DataFilterBar, EmptyState, PageHeader, Select, SelectItem, StatusChip, useToast } from "@repo/ui";
import type { MeResponse, VideoAsset, VideoStatus } from "@repo/types";

import { useVideoLibraryList, useDeleteVideoAsset } from "../../hooks/use-video-library";
import { useDebouncedValue } from "../../hooks/use-debounced-value";
import { hasPermission } from "../../lib/permissions";
import { surfaceError } from "../../lib/surface-error";
import { VideoIngestDrawer } from "./video-ingest-drawer";
import { VideoCaptionDrawer } from "./video-caption-drawer";
import { VideoPreviewDrawer } from "./video-preview-drawer";

const STATUS_TONE: Record<VideoStatus, "info" | "success" | "danger"> = {
  processing: "info",
  ready: "success",
  errored: "danger",
};

export function VideoLibraryDirectory({ me }: { me: MeResponse | undefined }): React.JSX.Element {
  // apps/api/src/modules/lms/video-library.controller.ts: view/upload/edit/delete
  // (upload — not "create" — for the ingest permission).
  const canUpload = hasPermission(me?.permissions, "videolib.upload");
  const canEdit = hasPermission(me?.permissions, "videolib.edit");
  const canDelete = hasPermission(me?.permissions, "videolib.delete");
  const [search, setSearch] = React.useState("");
  const [status, setStatus] = React.useState<VideoStatus | undefined>(undefined);
  const [page, setPage] = React.useState(1);
  const [ingestOpen, setIngestOpen] = React.useState(false);
  const [captionVideo, setCaptionVideo] = React.useState<VideoAsset | null>(null);
  const [previewVideo, setPreviewVideo] = React.useState<VideoAsset | null>(null);
  /** Non-null = the ingest drawer is in "replace this lesson's file" mode. */
  const [replaceVideo, setReplaceVideo] = React.useState<VideoAsset | null>(null);
  const pageSize = 20;

  /** Non-null = the confirm dialog is asking about taking this video off its lesson. */
  const [deleteTarget, setDeleteTarget] = React.useState<VideoAsset | null>(null);
  const deleteMutation = useDeleteVideoAsset();
  const { toast } = useToast();

  function handleDelete() {
    if (!deleteTarget) return;
    deleteMutation.mutate(deleteTarget.id, {
      onSuccess: () => {
        toast({ title: "Video removed", variant: "success" });
        setDeleteTarget(null);
      },
      onError: (err) => {
        surfaceError(toast, err, "Failed to remove the video");
        setDeleteTarget(null);
      },
    });
  }

  /** Replace flows from the preview drawer: close preview, open ingest pre-filled. */
  function startReplace(video: VideoAsset) {
    setPreviewVideo(null);
    setReplaceVideo(video);
    setIngestOpen(true);
  }

  /** Delete from the preview drawer: same handoff as replace — close the drawer, then
   *  ask. Leaving the drawer open would stack a confirm dialog over a video player that
   *  is still holding a freshly minted playback URL. */
  function startDelete(video: VideoAsset) {
    setPreviewVideo(null);
    setDeleteTarget(video);
  }

  const debouncedSearch = useDebouncedValue(search);
  React.useEffect(() => setPage(1), [debouncedSearch, status]);

  const { data, isLoading, isFetching, isError, refetch } = useVideoLibraryList({
    page,
    pageSize,
    search: debouncedSearch || undefined,
    status,
  });

  const columns: Array<DataTableColumn<VideoAsset>> = [
    { id: "lessonTitle", header: "Lesson", cell: (row) => row.lessonTitle },
    { id: "provider", header: "Provider", cell: (row) => row.provider },
    { id: "status", header: "Status", cell: (row) => <StatusChip tone={STATUS_TONE[row.status]} label={row.status} size="sm" /> },
    {
      id: "durationS",
      header: "Duration",
      cell: (row) => (row.durationS ? `${Math.floor(row.durationS / 60)}m ${row.durationS % 60}s` : "-"),
      align: "right",
    },
    { id: "captions", header: "Captions", cell: (row) => (row.captions?.length ? `${row.captions.length} track(s)` : "None") },
  ];

  if (isError) {
    return (
      <EmptyState
        title="Couldn't load the video library"
        action={
          <Button variant="secondary" onClick={() => refetch()}>
            Try again
          </Button>
        }
        data-testid="video-library-error"
      />
    );
  }

  return (
    <div className="space-y-4 md:space-y-5" data-testid="video-library-directory">
      <PageHeader
        title="Video library"
        description="Upload source video, track transcode status, and manage caption tracks."
        actions={
          canUpload ? (
            <Button onClick={() => setIngestOpen(true)} data-testid="video-library-upload-button">
              <Plus className="size-4" aria-hidden="true" />
              Upload video
            </Button>
          ) : null
        }
      />

      <DataTable
        toolbar={
          <DataFilterBar searchValue={search} onSearchChange={setSearch} searchPlaceholder="Lesson title…" data-testid="video-library-filter-bar">
            <Select
              label="Status"
              placeholder="All statuses"
              value={status}
              onValueChange={(value) => setStatus(value === "__all__" ? undefined : (value as VideoStatus))}
              wrapperClassName="w-40"
              data-testid="video-library-status-filter"
            >
              <SelectItem value="__all__">All statuses</SelectItem>
              <SelectItem value="processing">Processing</SelectItem>
              <SelectItem value="ready">Ready</SelectItem>
              <SelectItem value="errored">Errored</SelectItem>
            </Select>
          </DataFilterBar>
        }
        columns={columns}
        rows={data?.items ?? []}
        getRowId={(row) => row.id}
        loading={isLoading || isFetching}
        onRowClick={(row) => setPreviewVideo(row)}
        rowActions={(row) => (
          <div className="flex items-center gap-1">
            {/* Preview is the primary action — "which video is on this lesson?" */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPreviewVideo(row)}
              data-testid={`video-library-preview-${row.id}`}
            >
              <Play className="size-4" aria-hidden="true" />
              Preview
            </Button>
            {canUpload ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => startReplace(row)}
                data-testid={`video-library-replace-${row.id}`}
              >
                <Replace className="size-4" aria-hidden="true" />
                {row.status === "ready" ? "Replace" : "Upload"}
              </Button>
            ) : null}
            {canEdit ? (
              <Button variant="ghost" size="sm" onClick={() => setCaptionVideo(row)} data-testid={`video-library-captions-${row.id}`}>
                <Subtitles className="size-4" aria-hidden="true" />
                Captions
              </Button>
            ) : null}
            {canDelete ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDeleteTarget(row)}
                aria-label={`Remove the video from ${row.lessonTitle}`}
                data-testid={`video-library-delete-${row.id}`}
              >
                <Trash2 className="size-4 text-danger" aria-hidden="true" />
                Delete
              </Button>
            ) : null}
          </div>
        )}
        pagination={{ page, pageSize, total: data?.meta.total ?? 0, onPageChange: setPage }}
        emptyState={{ title: "No videos yet", description: "Upload a source video for a lesson to get started." }}
        caption="Video library"
        data-testid="video-library-table"
      />

      <VideoIngestDrawer
        open={ingestOpen}
        onOpenChange={(open) => {
          setIngestOpen(open);
          if (!open) setReplaceVideo(null);
        }}
        replaceFor={replaceVideo}
      />
      <VideoCaptionDrawer open={Boolean(captionVideo)} onOpenChange={(open) => !open && setCaptionVideo(null)} video={captionVideo} />
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Remove this video?"
        description={
          deleteTarget
            ? `"${deleteTarget.lessonTitle}" will have no video, and students will see "Video not available yet" on that lesson. You can upload a new one to it at any time, but this file will not come back.`
            : ""
        }
        confirmLabel="Remove video"
        tone="danger"
        onConfirm={handleDelete}
        loading={deleteMutation.isPending}
        data-testid="confirm-delete-video"
      />
            <VideoPreviewDrawer
        video={previewVideo}
        open={Boolean(previewVideo)}
        onOpenChange={(open) => !open && setPreviewVideo(null)}
        onReplace={startReplace}
        canReplace={canUpload}
        onDelete={startDelete}
        canDelete={canDelete}
      />
    </div>
  );
}
