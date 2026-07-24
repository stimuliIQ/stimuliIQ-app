// Lead-form config data hooks (admin) — Phase 9 Completion T32/T40.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateLeadFormRequest, ListLeadFormsQuery, UpdateLeadFormRequest } from "@repo/types";

import { apiClient } from "../lib/api-client";

export const LEAD_FORMS_QUERY_KEY = ["lead-forms"] as const;

export function leadFormsListKey(query: ListLeadFormsQuery) {
  return [...LEAD_FORMS_QUERY_KEY, "list", query] as const;
}

export function useLeadFormsList(query: ListLeadFormsQuery) {
  return useQuery({
    queryKey: leadFormsListKey(query),
    queryFn: () => apiClient.crm.leadForms.list(query),
    placeholderData: (previousData) => previousData,
  });
}

function useInvalidateLeadForms() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: LEAD_FORMS_QUERY_KEY });
}

export function useCreateLeadForm() {
  const invalidate = useInvalidateLeadForms();
  return useMutation({
    mutationFn: (body: CreateLeadFormRequest) => apiClient.crm.leadForms.create(body),
    onSuccess: invalidate,
  });
}

export function useUpdateLeadForm() {
  const invalidate = useInvalidateLeadForms();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateLeadFormRequest }) =>
      apiClient.crm.leadForms.update(id, body),
    onSuccess: invalidate,
  });
}
