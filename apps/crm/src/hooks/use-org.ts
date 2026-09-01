// Org-hierarchy data hooks (docs/specs/org-teams.md, ADR-0069). CLAUDE.md §3: no business
// logic in components — every screen that shows a team or a reporting line reads it here.
//
// `useMyOrgPosition()` is the one most screens want: where the signed-in person sits, and
// therefore whether they lead or manage anything. It is cached for the session because a
// person's team changes about as often as they change jobs, and it is what the leave screens
// will use to preview an approval chain without a second round trip.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateTeamRequest,
  ListTeamsQuery,
  SetTeamMembersRequest,
  UpdateTeamRequest,
} from "@repo/types";

import { apiClient } from "../lib/api-client";

export const ORG_QUERY_KEY = ["org"] as const;

/**
 * Invalidates the WHOLE org tree on every write, deliberately — teams, the team detail, the
 * staff picker and the viewer's own position are four views of the same rows, and a write
 * that changed a team's lead has to move all four. Same call `useInvalidateLeave` makes.
 */
function useInvalidateOrg() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: ORG_QUERY_KEY });
}

export function useTeamsList(query: ListTeamsQuery) {
  return useQuery({
    queryKey: [...ORG_QUERY_KEY, "teams", query] as const,
    queryFn: () => apiClient.crm.org.listTeams(query),
    placeholderData: (previousData) => previousData,
  });
}

export function useTeam(id: string | null) {
  return useQuery({
    queryKey: [...ORG_QUERY_KEY, "team", id] as const,
    queryFn: () => apiClient.crm.org.getTeam(id!),
    enabled: Boolean(id),
  });
}

/**
 * The pool for the manager / lead / member pickers. Carries each person's current team, so
 * the picker can SAY "already on Sales" rather than silently hiding them — a name missing
 * from a list with no explanation is what gets reported as "the dropdown is broken".
 */
export function useAssignableStaff() {
  return useQuery({
    queryKey: [...ORG_QUERY_KEY, "staff"] as const,
    queryFn: () => apiClient.crm.org.listStaff(),
    staleTime: 5 * 60_000,
  });
}

/** Where the signed-in person sits. Needs no permission — it takes no user id. */
export function useMyOrgPosition() {
  return useQuery({
    queryKey: [...ORG_QUERY_KEY, "me"] as const,
    queryFn: () => apiClient.crm.org.myPosition(),
    staleTime: 5 * 60_000,
  });
}

export function useCreateTeam() {
  const invalidate = useInvalidateOrg();
  return useMutation({
    mutationFn: (body: CreateTeamRequest) => apiClient.crm.org.createTeam(body),
    onSuccess: invalidate,
  });
}

export function useUpdateTeam() {
  const invalidate = useInvalidateOrg();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateTeamRequest }) =>
      apiClient.crm.org.updateTeam(id, body),
    onSuccess: invalidate,
  });
}

export function useSetTeamMembers() {
  const invalidate = useInvalidateOrg();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: SetTeamMembersRequest }) =>
      apiClient.crm.org.setTeamMembers(id, body),
    onSuccess: invalidate,
  });
}

export function useDeleteTeam() {
  const invalidate = useInvalidateOrg();
  return useMutation({
    mutationFn: (id: string) => apiClient.crm.org.deleteTeam(id),
    onSuccess: invalidate,
  });
}
