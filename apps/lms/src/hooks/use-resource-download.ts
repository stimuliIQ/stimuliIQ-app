// useDownloadResource — signed download URL for a lesson resource file.
// Mirrors useDownloadCertificate() (use-certificates.ts): fetch-on-click,
// NEVER cache the URL — each click re-mints a fresh short-lived signed GET URL
// via client.lms.lessons.getResourceDownloadUrl(lessonId, resourceId).
//
// CLAUDE.md §3: "No business logic in components — use hooks/services."
"use client";

import { useMutation } from "@tanstack/react-query";
import { ApiError } from "@repo/api-client";
import type { ResourceDownloadResponse } from "@repo/types";

import { apiClient } from "../lib/api-client";

export type ResourceDownloadError =
  | { type: "not_found"; message: string }
  | { type: "unknown"; message: string };

export interface UseDownloadResourceResult {
  download: (params: { lessonId: string; resourceId: string }) => Promise<ResourceDownloadResponse | null>;
  isDownloading: boolean;
  downloadError: ResourceDownloadError | null;
  clearError: () => void;
}

export function useDownloadResource(): UseDownloadResourceResult {
  const mutation = useMutation<ResourceDownloadResponse, ApiError, { lessonId: string; resourceId: string }>({
    mutationFn: ({ lessonId, resourceId }) => apiClient.lms.lessons.getResourceDownloadUrl(lessonId, resourceId),
  });

  const parseError = (err: ApiError | null): ResourceDownloadError | null => {
    if (!err) return null;
    if (err.status === 404) {
      return {
        type: "not_found",
        message: "This resource isn't available. It may have been removed, or you may not have access.",
      };
    }
    return {
      type: "unknown",
      message: err.problem.detail ?? err.problem.title ?? "Failed to get download link. Please try again.",
    };
  };

  return {
    download: (params) => mutation.mutateAsync(params).catch(() => null),
    isDownloading: mutation.isPending,
    downloadError: parseError(mutation.error ?? null),
    clearError: () => mutation.reset(),
  };
}
