// Onboarding data hooks — the CRM half of stimuliiq.com/onboarding. All I/O goes through
// `client.crm.onboarding.*`; components hold no business logic (CLAUDE.md §3.3).
//
// Two query families, invalidated independently: the FIELDS (the question set staff
// author) and the SUBMISSIONS (what students sent). Editing a question must not blow away
// a paginated submissions list the user is halfway through reading, and vice versa.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateOnboardingFieldRequest,
  ListOnboardingFieldsQuery,
  ListOnboardingSubmissionsQuery,
  ReorderOnboardingFieldsRequest,
  UpdateOnboardingFieldRequest,
  UpdateOnboardingSubmissionRequest,
} from "@repo/types";

import { apiClient } from "../lib/api-client";

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
