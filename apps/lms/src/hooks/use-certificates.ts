// LMS Certificates hooks — Phase 4 Task #10.
//
// Fetches for the student-facing certificate list + detail + download URL.
//
// CRITICAL: getDownloadUrl() returns a SHORT-LIVED signed URL.
//   - NEVER cache the URL. Re-call getDownloadUrl() each time the user wants to download.
//   - The hook does NOT cache the URL in query state; it calls the API on every invocation.
//   - Handles 410 CERTIFICATE_REVOKED (AC-F5) and 404 (AC-F2/F3/F4).
//
// CLAUDE.md §3: "No business logic in components — use hooks/services."
"use client";

import { useQuery, useMutation } from "@tanstack/react-query";
import { ApiError } from "@repo/api-client";
import type { CertificateListItem, CertificateDetail, OffsetPaginationMeta } from "@repo/types";

import { apiClient } from "../lib/api-client";

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const CERTIFICATES_LIST_KEY = ["lms", "certificates", "list"] as const;
export const certificateDetailKey = (id: string) => ["lms", "certificates", "detail", id] as const;

// ---------------------------------------------------------------------------
// useMyCertificates — student certificate list
// ---------------------------------------------------------------------------

export interface UseMyCertificatesResult {
  certificates: CertificateListItem[];
  isLoading: boolean;
  isSignedOut: boolean;
  isError: boolean;
  error: ApiError | null;
  refetch: () => void;
}

export function useMyCertificates(): UseMyCertificatesResult {
  const query = useQuery<{ items: CertificateListItem[]; meta: OffsetPaginationMeta }, ApiError>({
    queryKey: CERTIFICATES_LIST_KEY,
    queryFn: () => apiClient.learning.certificates.listMine(),
    staleTime: 60_000,
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.isUnauthenticated) return false;
      return failureCount < 2;
    },
  });

  const isSignedOut = query.error instanceof ApiError && query.error.isUnauthenticated;

  return {
    certificates: query.data?.items ?? [],
    isLoading: query.isLoading,
    isSignedOut,
    isError: query.isError && !isSignedOut,
    error: query.error ?? null,
    refetch: () => void query.refetch(),
  };
}

// ---------------------------------------------------------------------------
// useCertificateDetail — one certificate
// ---------------------------------------------------------------------------

export interface UseCertificateDetailResult {
  certificate: CertificateDetail | undefined;
  isLoading: boolean;
  isSignedOut: boolean;
  isError: boolean;
  error: ApiError | null;
  refetch: () => void;
}

export function useCertificateDetail(id: string): UseCertificateDetailResult {
  const query = useQuery<CertificateDetail, ApiError>({
    queryKey: certificateDetailKey(id),
    queryFn: () => apiClient.learning.certificates.getMine(id),
    staleTime: 60_000,
    enabled: Boolean(id),
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.isUnauthenticated) return false;
      return failureCount < 2;
    },
  });

  const isSignedOut = query.error instanceof ApiError && query.error.isUnauthenticated;

  return {
    certificate: query.data,
    isLoading: query.isLoading,
    isSignedOut,
    isError: query.isError && !isSignedOut,
    error: query.error ?? null,
    refetch: () => void query.refetch(),
  };
}

// ---------------------------------------------------------------------------
// useDownloadCertificate — get a fresh signed download URL on demand
//
// NEVER caches the URL. Call this imperatively (button click) not as a static
// query. Each call mints a new short-lived URL from the backend.
//
// Handles:
//   410 CERTIFICATE_REVOKED → shows revoked error message (AC-F5)
//   404 → certificate doesn't exist or not owned by student (AC-F2/F3/F4)
// ---------------------------------------------------------------------------

export type DownloadError =
  | { type: "revoked"; message: string }
  | { type: "not_found"; message: string }
  | { type: "unknown"; message: string };

export interface UseDownloadCertificateResult {
  download: (certificateId: string) => Promise<{ url: string; filename: string } | null>;
  isDownloading: boolean;
  downloadError: DownloadError | null;
  clearError: () => void;
}

export function useDownloadCertificate(): UseDownloadCertificateResult {
  const mutation = useMutation<
    { url: string; filename: string },
    ApiError,
    string
  >({
    mutationFn: async (certificateId: string) => {
      const response = await apiClient.learning.certificates.getDownloadUrl(certificateId);
      // response: { downloadUrl, expiresAt, filename }
      // We return only the download URL + filename — NEVER cache or persist the URL
      return { url: response.downloadUrl, filename: response.filename };
    },
  });

  const parseError = (err: ApiError | null): DownloadError | null => {
    if (!err) return null;
    const status = err.problem.status;
    if (status === 410) {
      return {
        type: "revoked",
        message: "This certificate has been revoked and is no longer available for download.",
      };
    }
    if (status === 404) {
      return {
        type: "not_found",
        message: "Certificate not found or not yet issued.",
      };
    }
    return {
      type: "unknown",
      message: err.problem.detail ?? err.problem.title ?? "Failed to get download link. Please try again.",
    };
  };

  return {
    download: (certificateId: string) => mutation.mutateAsync(certificateId).catch(() => null),
    isDownloading: mutation.isPending,
    downloadError: parseError(mutation.error ?? null),
    clearError: () => mutation.reset(),
  };
}
