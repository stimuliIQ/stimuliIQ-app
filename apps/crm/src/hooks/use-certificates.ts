// Certificates data hooks — Phase 4 CRM surface.
// Eligibility list, issue / revoke / reissue / recommend.
// All business logic lives in hooks (CLAUDE.md §3).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  IssueCertificateRequest,
  ListEligibilityBatchesQuery,
  ListEligibilityQuery,
  RecommendCertificateRequest,
  ReissueCertificateRequest,
  RevokeCertificateRequest,
} from "@repo/types";

import { apiClient } from "../lib/api-client";

// ── Query keys ────────────────────────────────────────────────────────────────

export const CERTIFICATES_QUERY_KEY = ["certificates"] as const;

export function eligibilityListKey(query: Partial<ListEligibilityQuery>) {
  return [...CERTIFICATES_QUERY_KEY, "eligibility", "list", query] as const;
}
export function eligibilityBatchesKey(query: Partial<ListEligibilityBatchesQuery>) {
  return [...CERTIFICATES_QUERY_KEY, "eligibility", "batches", query] as const;
}
export function eligibilityDetailKey(enrollmentId: string) {
  return [...CERTIFICATES_QUERY_KEY, "eligibility", enrollmentId] as const;
}
export function certificateDetailKey(id: string) {
  return [...CERTIFICATES_QUERY_KEY, "detail", id] as const;
}
export function templatesKey() {
  return [...CERTIFICATES_QUERY_KEY, "templates"] as const;
}

// ── Eligibility ───────────────────────────────────────────────────────────────

export function useEligibilityList(
  query: Partial<ListEligibilityQuery>,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: eligibilityListKey(query),
    queryFn: () => apiClient.learning.certificates.listEligibility(query),
    placeholderData: (prev) => prev,
    enabled: options?.enabled ?? true,
  });
}

/**
 * Batch-first landing view of the Certificates page — one row per cohort.
 * The counts are cheap aggregates; `completionReadyCount` is the completion
 * gate ALONE (assessments/final project are only resolved on drill-in, where
 * `useEligibilityList({ batchId })` runs the full three-gate engine per row).
 */
export function useEligibilityBatches(
  query: Partial<ListEligibilityBatchesQuery>,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: eligibilityBatchesKey(query),
    queryFn: () => apiClient.learning.certificates.listEligibilityBatches(query),
    placeholderData: (prev) => prev,
    enabled: options?.enabled ?? true,
  });
}

export function useEligibilityDetail(enrollmentId: string | undefined) {
  return useQuery({
    queryKey: eligibilityDetailKey(enrollmentId ?? ""),
    queryFn: () => apiClient.learning.certificates.getEligibility(enrollmentId as string),
    enabled: Boolean(enrollmentId),
  });
}

export function useCertificateTemplates() {
  return useQuery({
    queryKey: templatesKey(),
    queryFn: () => apiClient.learning.certificates.listTemplates(),
    staleTime: 5 * 60 * 1000, // templates change rarely
  });
}

export function useCertificateCrm(id: string | undefined) {
  return useQuery({
    queryKey: certificateDetailKey(id ?? ""),
    queryFn: () => apiClient.learning.certificates.getCrm(id as string),
    enabled: Boolean(id),
  });
}

// ── Mutations ─────────────────────────────────────────────────────────────────

function useInvalidateCertificates() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: CERTIFICATES_QUERY_KEY });
  };
}

/**
 * Issue a certificate for an eligible enrollment.
 * Server runs eligibility engine first (422 NOT_ELIGIBLE with reasons on failure).
 * Permission: certificates.issue.
 */
export function useIssueCertificate() {
  const invalidate = useInvalidateCertificates();
  return useMutation({
    mutationFn: (body: IssueCertificateRequest) =>
      apiClient.learning.certificates.issue(body),
    onSuccess: () => invalidate(),
  });
}

/**
 * Faculty recommends an enrollment (flag only — no cert row created).
 * Permission: certificates.recommend.
 */
export function useRecommendCertificate() {
  const invalidate = useInvalidateCertificates();
  return useMutation({
    mutationFn: ({ enrollmentId, body }: { enrollmentId: string; body: RecommendCertificateRequest }) =>
      apiClient.learning.certificates.recommend(enrollmentId, body),
    onSuccess: () => invalidate(),
  });
}

/**
 * Revoke a valid certificate. INSTANT — the public verify endpoint reflects
 * it immediately (AC-G1/AC-G2). Destructive: caller must show ConfirmDialog.
 * Permission: certificates.revoke.
 */
export function useRevokeCertificate() {
  const invalidate = useInvalidateCertificates();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: RevokeCertificateRequest }) =>
      apiClient.learning.certificates.revoke(id, body),
    onSuccess: () => invalidate(),
  });
}

/**
 * Reissue a revoked certificate. Old row soft-deleted; old cert_uid invalidated (AC-G3).
 * Permission: certificates.issue.
 */
export function useReissueCertificate() {
  const invalidate = useInvalidateCertificates();
  return useMutation({
    mutationFn: ({ enrollmentId, body }: { enrollmentId: string; body: ReissueCertificateRequest }) =>
      apiClient.learning.certificates.reissue(enrollmentId, body),
    onSuccess: () => invalidate(),
  });
}
