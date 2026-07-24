// Logout mutation — clears the session + the cached `me` query so the app
// shell re-renders into the signed-out state. Kept out of the Topbar
// component per CLAUDE.md §3 ("no business logic in components").
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "../lib/api-client";
import { ME_QUERY_KEY } from "./use-me";

export function useLogout() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => apiClient.auth.logout(),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
    },
  });
}
