// Colleges data hooks (Phase-11 locked templates, docs/plans/phase-11-locked-templates.md
// P4) — mirrors use-mentors.ts conventions (CLAUDE.md §3: no business logic in
// components). `client.crm.colleges.*` (aliased `client.crm.content.colleges`) — never a
// hand-written fetch. A "College" is a `Partner` row (category="college_partner") on its
// own dedicated CRM screen (see packages/types/src/crm/colleges.schemas.ts file header for
// why this isn't just the generic Partners screen).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateCollegeRequest, ListCollegesQuery, UpdateCollegeRequest } from "@repo/types";

import { apiClient } from "../lib/api-client";

export const COLLEGES_QUERY_KEY = ["colleges"] as const;

export function useCollegesList(query: ListCollegesQuery) {
  return useQuery({
    queryKey: [...COLLEGES_QUERY_KEY, "list", query] as const,
    queryFn: () => apiClient.crm.colleges.list(query),
    placeholderData: (previousData) => previousData,
  });
}

function useInvalidateColleges() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: COLLEGES_QUERY_KEY });
}

export function useCreateCollege() {
  const invalidate = useInvalidateColleges();
  return useMutation({
    mutationFn: (body: CreateCollegeRequest) => apiClient.crm.colleges.create(body),
    onSuccess: invalidate,
  });
}

export function useUpdateCollege() {
  const invalidate = useInvalidateColleges();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateCollegeRequest }) => apiClient.crm.colleges.update(id, body),
    onSuccess: invalidate,
  });
}

export function useDeleteCollege() {
  const invalidate = useInvalidateColleges();
  return useMutation({
    mutationFn: (id: string) => apiClient.crm.colleges.remove(id),
    onSuccess: invalidate,
  });
}
