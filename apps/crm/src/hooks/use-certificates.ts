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

// ── The document itself ───────────────────────────────────────────────────────

export function certificateFileKey(id: string, disposition: string) {
  return [...CERTIFICATES_QUERY_KEY, "file", id, disposition] as const;
}

/**
 * A short-lived signed URL for a certificate PDF — the document the student receives.
 *
 * `disposition: "inline"` is what the preview panel frames; `"attachment"` is what the
 * Download button sends the browser to. They are separate URLs because the disposition is
 * signed INTO the URL (S3 `ResponseContentDisposition`), not chosen by the client.
 *
 * `gcTime: 0` on purpose: a signed URL is a bearer credential for the object, so it should
 * not sit in the query cache after the panel that needed it has closed. `staleTime` is well
 * inside the URL's own lifetime, so reopening the same certificate within a couple of
 * minutes reuses a URL that is still valid rather than minting another.
 */
/**
 * The document a TEMPLATE issues, rendered with sample values.
 *
 * Unlike `useCertificateFileUrl`, which needs a certificate that has already been awarded
 * to somebody, this answers "what will a student get?" before anyone is given one.
 *
 * Not cached and not retried. The response carries ~1.4 MB of base64 PDF, so holding it in
 * the query cache after the drawer closes would keep that in memory for a document the
 * reader has finished with; `enabled` keeps it from firing at all until a template is
 * picked. A failed render is a server-side problem (missing artwork, missing font) that
 * retrying restates rather than fixes.
 */
export function useCertificateTemplateSpecimen(templateId: string | null) {
  return useQuery({
    queryKey: [...CERTIFICATES_QUERY_KEY, "template-specimen", templateId ?? ""] as const,
    queryFn: () => apiClient.learning.certificates.getTemplateSpecimen(templateId as string),
    enabled: Boolean(templateId),
    gcTime: 0,
    staleTime: 0,
    retry: false,
  });
}

export function useCertificateFileUrl(
  certificateId: string | null,
  disposition: "inline" | "attachment" = "inline",
) {
  return useQuery({
    queryKey: certificateFileKey(certificateId ?? "", disposition),
    queryFn: () =>
      apiClient.learning.certificates.getCrmDownloadUrl(certificateId as string, disposition),
    enabled: Boolean(certificateId),
    gcTime: 0,
    staleTime: 2 * 60 * 1000,
    // A certificate with no document and no template cannot be regenerated, and retrying
    // says so three times instead of once.
    retry: false,
  });
}
