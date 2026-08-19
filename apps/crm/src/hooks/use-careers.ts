// Careers data hooks — job openings + the application review queue (ADR-0066).
// No business logic in components (CLAUDE.md §3.3): everything here goes through
// `client.crm.careers.*`, never a hand-written fetch.
//
// ONE INVALIDATION HELPER FOR BOTH RESOURCES, on purpose. Every review verb changes an
// application AND the parent opening's applicant counts, and closing an opening changes what
// the applications list filters by. Invalidating both together means a reviewer never sees
// "3 pending" next to a queue they just emptied — the alternative is remembering to
// cross-invalidate at seven call sites, which is the kind of thing that gets forgotten once
// and then looks like a caching bug forever.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateJobOpeningRequest,
  HoldCareerApplicationRequest,
  ListCareerApplicationsQuery,
  ListJobOpeningsQuery,
  OfferCareerApplicationRequest,
  OfferLetterUploadUrlRequest,
  RejectCareerApplicationRequest,
  ShortlistCareerApplicationRequest,
  UpdateJobOpeningRequest,
} from "@repo/types";

import { apiClient } from "../lib/api-client";

export const CAREERS_QUERY_KEY = ["careers"] as const;
export const JOB_OPENINGS_QUERY_KEY = [...CAREERS_QUERY_KEY, "openings"] as const;
export const CAREER_APPLICATIONS_QUERY_KEY = [...CAREERS_QUERY_KEY, "applications"] as const;

function useInvalidateCareers() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: CAREERS_QUERY_KEY });
}

// ── Openings ────────────────────────────────────────────────────────────────

export function useJobOpeningsList(query: ListJobOpeningsQuery) {
  return useQuery({
    queryKey: [...JOB_OPENINGS_QUERY_KEY, "list", query] as const,
    queryFn: () => apiClient.crm.careers.openings.list(query),
    placeholderData: (previousData) => previousData,
  });
}

export function useCreateJobOpening() {
  const invalidate = useInvalidateCareers();
  return useMutation({
    mutationFn: (body: CreateJobOpeningRequest) => apiClient.crm.careers.openings.create(body),
    onSuccess: invalidate,
  });
}

export function useUpdateJobOpening() {
  const invalidate = useInvalidateCareers();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateJobOpeningRequest }) =>
      apiClient.crm.careers.openings.update(id, body),
    onSuccess: invalidate,
  });
}

export function useDeleteJobOpening() {
  const invalidate = useInvalidateCareers();
  return useMutation({
    mutationFn: (id: string) => apiClient.crm.careers.openings.remove(id),
    onSuccess: invalidate,
  });
}

// ── Applications ────────────────────────────────────────────────────────────

export function useCareerApplicationsList(query: ListCareerApplicationsQuery) {
  return useQuery({
    queryKey: [...CAREER_APPLICATIONS_QUERY_KEY, "list", query] as const,
    queryFn: () => apiClient.crm.careers.applications.list(query),
    placeholderData: (previousData) => previousData,
  });
}

/**
 * One candidate's full record, including short-lived signed download URLs for the resume
 * and the offer letter.
 *
 * `staleTime: 0` and no cache reuse across opens: those URLs expire in five minutes, so a
 * drawer reopened later must re-fetch rather than hand the reviewer a dead download link.
 */
export function useCareerApplication(id: string | null) {
  return useQuery({
    queryKey: [...CAREER_APPLICATIONS_QUERY_KEY, "detail", id] as const,
    queryFn: () => apiClient.crm.careers.applications.get(id as string),
    enabled: Boolean(id),
    staleTime: 0,
    gcTime: 0,
  });
}

// ── The four review verbs ───────────────────────────────────────────────────
// Four hooks, not one parameterised mutation. Each sends a different email (or, for hold,
// none), and keeping them apart means a call site cannot pass the wrong verb by changing a
// string. See careers.schemas.ts's file header.

export function useHoldApplication() {
  const invalidate = useInvalidateCareers();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body?: HoldCareerApplicationRequest }) =>
      apiClient.crm.careers.applications.hold(id, body ?? {}),
    onSuccess: invalidate,
  });
}

export function useShortlistApplication() {
  const invalidate = useInvalidateCareers();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ShortlistCareerApplicationRequest }) =>
      apiClient.crm.careers.applications.shortlist(id, body),
    onSuccess: invalidate,
  });
}

export function useOfferApplication() {
  const invalidate = useInvalidateCareers();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: OfferCareerApplicationRequest }) =>
      apiClient.crm.careers.applications.offer(id, body),
    onSuccess: invalidate,
  });
}

export function useRejectApplication() {
  const invalidate = useInvalidateCareers();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body?: RejectCareerApplicationRequest }) =>
      apiClient.crm.careers.applications.reject(id, body ?? {}),
    onSuccess: invalidate,
  });
}

// ── Supporting actions ──────────────────────────────────────────────────────

export function useResendAcknowledgement() {
  const invalidate = useInvalidateCareers();
  return useMutation({
    mutationFn: (id: string) => apiClient.crm.careers.applications.resendAcknowledgement(id),
    onSuccess: invalidate,
  });
}

export function useDeleteCareerApplication() {
  const invalidate = useInvalidateCareers();
  return useMutation({
    mutationFn: (id: string) => apiClient.crm.careers.applications.remove(id),
    onSuccess: invalidate,
  });
}

/**
 * Signed-PUT request for the offer letter, shaped for `FileUpload`'s `requestUploadUrl`
 * prop. Not a mutation hook: `FileUpload` owns the upload lifecycle and just needs a
 * function that hands back a URL.
 */
export function requestOfferLetterUploadUrl(
  applicationId: string,
  file: File,
): Promise<{ url: string; storageKey: string }> {
  const body: OfferLetterUploadUrlRequest = {
    // The API allow-lists PDF only — an offer letter is a document to be signed, not an
    // editable file. Passing the browser's type through unchecked would just 422 later.
    contentType: "application/pdf",
    fileName: file.name,
    sizeBytes: file.size,
  };
  return apiClient.crm.careers.applications
    .getOfferLetterUploadUrl(applicationId, body)
    .then((signed) => ({ url: signed.uploadUrl, storageKey: signed.storageKey }));
}
