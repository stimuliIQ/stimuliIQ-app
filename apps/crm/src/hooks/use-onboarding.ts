// Onboarding data hooks — the CRM half of stimuliiq.com/onboarding. All I/O goes through
// `client.crm.onboarding.*`; components hold no business logic (CLAUDE.md §3.3).
//
// Two query families, invalidated independently: the FIELDS (the question set staff
// author) and the SUBMISSIONS (what students sent). Editing a question must not blow away
// a paginated submissions list the user is halfway through reading, and vice versa.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ApproveOnboardingSubmissionRequest,
  CreateOnboardingFieldRequest,
  ListOnboardingFieldsQuery,
  ListOnboardingSubmissionsQuery,
  RejectOnboardingSubmissionRequest,
  ReorderOnboardingFieldsRequest,
  UpdateOnboardingFieldRequest,
  UpdateOnboardingSubmissionRequest,
} from "@repo/types";

import { apiClient } from "../lib/api-client";
import { STUDENTS_QUERY_KEY } from "./use-students";
import { ENROLLMENTS_QUERY_KEY } from "./use-enrollments";

export const ONBOARDING_FIELDS_QUERY_KEY = ["onboarding", "fields"] as const;
export const ONBOARDING_SUBMISSIONS_QUERY_KEY = ["onboarding", "submissions"] as const;

// ── Fields ────────────────────────────────────────────────────────────────

export function useOnboardingFields(query: ListOnboardingFieldsQuery = {}) {
  return useQuery({
    queryKey: [...ONBOARDING_FIELDS_QUERY_KEY, "list", query] as const,
    queryFn: () => apiClient.crm.onboarding.fields.list(query),
  });
}

function useInvalidateFields() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: ONBOARDING_FIELDS_QUERY_KEY });
}

export function useCreateOnboardingField() {
  const invalidate = useInvalidateFields();
  return useMutation({
    mutationFn: (body: CreateOnboardingFieldRequest) => apiClient.crm.onboarding.fields.create(body),
    onSuccess: invalidate,
  });
}

export function useUpdateOnboardingField() {
  const invalidate = useInvalidateFields();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateOnboardingFieldRequest }) =>
      apiClient.crm.onboarding.fields.update(id, body),
    onSuccess: invalidate,
  });
}

export function useDeleteOnboardingField() {
  const invalidate = useInvalidateFields();
  return useMutation({
    mutationFn: (id: string) => apiClient.crm.onboarding.fields.remove(id),
    onSuccess: invalidate,
  });
}

export function useReorderOnboardingFields() {
  const invalidate = useInvalidateFields();
  return useMutation({
    mutationFn: (body: ReorderOnboardingFieldsRequest) => apiClient.crm.onboarding.fields.reorder(body),
    onSuccess: invalidate,
  });
}

// ── Submissions ───────────────────────────────────────────────────────────

export function useOnboardingSubmissions(query: ListOnboardingSubmissionsQuery) {
  return useQuery({
    queryKey: [...ONBOARDING_SUBMISSIONS_QUERY_KEY, "list", query] as const,
    queryFn: () => apiClient.crm.onboarding.submissions.list(query),
    placeholderData: (previousData) => previousData,
  });
}

/**
 * Detail — enabled only when a row is actually open. The response carries short-lived
 * SIGNED attachment URLs, so it is deliberately not cached for long: a stale detail would
 * hand the user an expired receipt link.
 */
export function useOnboardingSubmission(id: string | null) {
  return useQuery({
    queryKey: [...ONBOARDING_SUBMISSIONS_QUERY_KEY, "detail", id] as const,
    queryFn: () => apiClient.crm.onboarding.submissions.get(id as string),
    enabled: Boolean(id),
    staleTime: 0,
  });
}

function useInvalidateSubmissions() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: ONBOARDING_SUBMISSIONS_QUERY_KEY });
}

export function useUpdateOnboardingSubmission() {
  const invalidate = useInvalidateSubmissions();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateOnboardingSubmissionRequest }) =>
      apiClient.crm.onboarding.submissions.update(id, body),
    onSuccess: invalidate,
  });
}

export function useDeleteOnboardingSubmission() {
  const invalidate = useInvalidateSubmissions();
  return useMutation({
    mutationFn: (id: string) => apiClient.crm.onboarding.submissions.remove(id),
    onSuccess: invalidate,
  });
}

// ── The two decisions ─────────────────────────────────────────────────────

/**
 * The batches this submission can be approved into — the open cohorts of the program the
 * student picked, resolved server-side so the dialog can never offer a finished cohort or
 * one from the wrong program.
 *
 * Fetched only when the Accept dialog is actually open: it is a per-submission query and
 * loading it for every row the user merely glances at would be a request per click.
 */
export function useOnboardingApprovableBatches(id: string | null) {
  return useQuery({
    queryKey: [...ONBOARDING_SUBMISSIONS_QUERY_KEY, "batches", id] as const,
    queryFn: () => apiClient.crm.onboarding.submissions.listBatches(id as string),
    enabled: Boolean(id),
  });
}

/**
 * The staff an applicant can be tagged to on approval.
 *
 * Not keyed by submission id: the candidate set is the same for every applicant, so this is
 * one cached list for the whole screen rather than a refetch per row. `enabled` is driven by
 * the accept panel being open, so merely browsing the queue never fetches a staff directory.
 */
export function useOnboardingTaggableStaff(enabled: boolean) {
  return useQuery({
    queryKey: [...ONBOARDING_SUBMISSIONS_QUERY_KEY, "taggable-staff"] as const,
    queryFn: () => apiClient.crm.onboarding.submissions.listTaggableStaff(),
    enabled,
  });
}

/**
 * Accept: creates or matches the student, enrols them, optionally records the offline
 * payment (invoice) and emails them. Invalidates far more than the submissions list because
 * a successful approval also changes Students, Enrollments and — when it invoiced — the
 * commerce ledger; leaving those stale would show a freshly enrolled student as absent.
 */
export function useApproveOnboardingSubmission() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ApproveOnboardingSubmissionRequest }) =>
      apiClient.crm.onboarding.submissions.approve(id, body),
    onSuccess: () => {
      // `["commerce"]` is the shared prefix of orders/payments/invoices (use-orders.ts et al),
      // so one entry refreshes the whole ledger the invoice just landed in.
      const affected = [ONBOARDING_SUBMISSIONS_QUERY_KEY, STUDENTS_QUERY_KEY, ENROLLMENTS_QUERY_KEY, ["commerce"]];
      for (const key of affected) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });
}

/** Reject: records the decision and emails the student to contact support. */
export function useRejectOnboardingSubmission() {
  const invalidate = useInvalidateSubmissions();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: RejectOnboardingSubmissionRequest }) =>
      apiClient.crm.onboarding.submissions.reject(id, body),
    onSuccess: invalidate,
  });
}
