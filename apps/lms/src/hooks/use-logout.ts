// Logout mutation — revokes the session server-side, clears ALL cached data
// (drop student PII from the query cache on sign-out), then redirects to the
// login page. Kept out of components per CLAUDE.md §3 ("no business logic in
// components"). Mirrors apps/crm/src/hooks/use-logout.ts, plus a redirect
// because LMS pages don't gate at the shell level (each page reads `me`).
"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

import { apiClient } from "../lib/api-client";
import { purgeAllOffline } from "../lib/offline-video-store";

export function useLogout() {
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: () => apiClient.auth.logout(),
    // onSettled (not onSuccess): even if the network call fails, the user asked
    // to leave — drop the cache and send them to /login regardless.
    onSettled: () => {
      queryClient.clear();
      // Offline lesson videos are course content, not just cache — a shared or lab
      // device must not keep one student's downloaded library available to whoever
      // signs in next. Fire-and-forget: sign-out must never block on storage.
      void purgeAllOffline();
      router.replace("/login");
    },
  });
}
