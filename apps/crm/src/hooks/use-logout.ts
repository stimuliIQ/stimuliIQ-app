// Logout mutation — clears the session + the cached `me` query so the app
// shell re-renders into the signed-out state, and returns the URL to the
// dashboard. Kept out of the Topbar component per CLAUDE.md §3 ("no business
// logic in components").
//
// WHY IT NAVIGATES.
// AppShell swaps `<LoginForm />` in for the current route while signed out; it never
// touches the URL. So signing out of /marketing/targets left the URL there, the login form
// rendered over it, and signing back in dropped you straight back onto /marketing/targets
// instead of the dashboard. Sending the browser to "/" on the way out is what makes the
// next sign-in land on the dashboard, and it also stops the last page somebody was working
// on sitting in the URL bar of a signed-out screen.
//
// `replace: true` so Back does not walk into the page they just signed out of.
//
// Deliberately in `onSettled` rather than `onSuccess`, matching the cache invalidation
// beside it: if the logout request fails, the local session state is still cleared, and the
// URL should not be left behind pointing somewhere the user believes they have left.
//
// NOTE this is the ONLY auth transition that navigates. Signing in does NOT force "/",
// so a session that expires mid-task returns you to the page you were on once you
// re-authenticate — which is the right behaviour there, and is not what "log out and log
// back in" means.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import { apiClient } from "../lib/api-client";
import { ME_QUERY_KEY } from "./use-me";

export function useLogout() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  return useMutation({
    mutationFn: () => apiClient.auth.logout(),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
      void navigate({ to: "/", replace: true });
    },
  });
}
