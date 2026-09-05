// Video library data hooks (CRM/staff surface) — Phase 9 Completion T26/T38.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AttachCaptionsRequest, CreateVideoAssetRequest, ListVideoAssetsQuery } from "@repo/types";

import { apiClient } from "../lib/api-client";

export const VIDEO_LIBRARY_QUERY_KEY = ["video-library"] as const;

export function videoLibraryListKey(query: Partial<ListVideoAssetsQuery>) {
  return [...VIDEO_LIBRARY_QUERY_KEY, "list", query] as const;
}

export function useVideoLibraryList(
  query: Partial<ListVideoAssetsQuery> = {},
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: videoLibraryListKey(query),
    queryFn: () => apiClient.crm.videoLibrary.list(query),
    placeholderData: (previousData) => previousData,
    // Callers without `videolib.view` (e.g. a course editor whose role lacks the
    // video permission) pass enabled:false so the list never fires a doomed 403.
    enabled: options.enabled ?? true,
  });
}

export function useVideoAsset(id: string | undefined) {
  return useQuery({
    queryKey: [...VIDEO_LIBRARY_QUERY_KEY, "detail", id ?? ""] as const,
    queryFn: () => apiClient.crm.videoLibrary.get(id as string),
    enabled: Boolean(id),
  });
}

function useInvalidateVideoLibrary() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: VIDEO_LIBRARY_QUERY_KEY });
}

export function useIngestVideoAsset() {
  const invalidate = useInvalidateVideoLibrary();
  return useMutation({
    mutationFn: (body: CreateVideoAssetRequest) => apiClient.crm.videoLibrary.create(body),
    onSuccess: invalidate,
  });
}

export function useAttachVideoCaptions() {
  const invalidate = useInvalidateVideoLibrary();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: AttachCaptionsRequest }) =>
      apiClient.crm.videoLibrary.attachCaptions(id, body),
    onSuccess: invalidate,
  });
}

/**
 * Takes the video off its lesson (soft-delete).
 *
 * The counterpart to `useIngestVideoAsset` in replace mode: replace fixes "wrong file",
 * this answers "this lesson should not have a video". Uploading to the same lesson
 * afterwards works and produces a NEW asset — the deleted file is not restored.
 */
export function useDeleteVideoAsset() {
  const invalidate = useInvalidateVideoLibrary();
  return useMutation({
    mutationFn: (id: string) => apiClient.crm.videoLibrary.remove(id),
    onSuccess: invalidate,
  });
}

/**
 * Confirms the browser's direct PUT finished. Flips non-transcoding providers
 * (local dev) to `ready`; a status no-op for Cloudflare Stream / Mux, where the
 * transcode webhook stays authoritative. Invalidates so the table shows the
 * new status immediately.
 */
export function useMarkVideoUploaded() {
  const invalidate = useInvalidateVideoLibrary();
  return useMutation({
    mutationFn: ({ id, durationS }: { id: string; durationS?: number }) =>
      apiClient.crm.videoLibrary.markUploaded(id, durationS != null ? { durationS } : {}),
    onSuccess: invalidate,
  });
}

/**
 * Short-TTL signed playback URL for staff preview. NOT cached (`gcTime: 0`,
 * `staleTime: 0`): the URL is a credential that expires in minutes, so every
 * open of the preview drawer must mint a fresh one.
 */
export function useVideoPreviewUrl(id: string | undefined) {
  return useQuery({
    queryKey: [...VIDEO_LIBRARY_QUERY_KEY, "preview-url", id ?? ""] as const,
    queryFn: () => apiClient.crm.videoLibrary.previewUrl(id as string),
    enabled: Boolean(id),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}
