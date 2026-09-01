// CRM notifications — the staff side of the bell that has been a disabled placeholder in
// the top bar since P6.
//
// The API already served /me/notifications to any authenticated user (notifications.view
// is seeded at scope=own to EVERY role), so nothing new was needed server-side to turn
// this on; only the CRM had no client for it. Lead assignment is what finally made it
// worth having: it is the first CRM event where somebody needs to be told something
// happened rather than going to look for it.
//
// WHY POLLING AND NOT SSE HERE (the LMS hook opens an EventSource):
//   The CRM is a long-lived internal dashboard — a rep leaves it open all day across many
//   tabs. Each SSE stream holds an open connection per tab for the whole session, which
//   is a real cost for a signal that is fine arriving within a minute. The polling
//   fallback the API already supports (`unread=true`) gives the same badge at a fraction
//   of the connection budget. If a future CRM feature needs sub-second delivery,
//   openStream() is right there and the rest of this hook does not change.
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@repo/api-client";
import type { NotificationDto } from "@repo/types";

import { apiClient } from "../lib/api-client";

export const CRM_NOTIFICATIONS_QUERY_KEY = ["crm", "notifications"] as const;

/** Poll cadence. A minute is well inside "I noticed while working" and costs one tiny request per tab. */
const POLL_INTERVAL_MS = 60_000;

/** How many rows the bell holds. Beyond this, the answer is the pipeline, not a longer list. */
const NOTIFICATION_PAGE_SIZE = 20;

export interface UseCrmNotificationsResult {
  items: NotificationDto[];
  unreadCount: number;
  isLoading: boolean;
  isError: boolean;
  /** True when the session has expired — the bell hides itself rather than showing an error. */
  isSignedOut: boolean;
  markRead: (id: string) => void;
  markAllRead: () => void;
  isMarkingAll: boolean;
}

export function useCrmNotifications(enabled = true): UseCrmNotificationsResult {
  const queryClient = useQueryClient();

  const query = useQuery<{ items: NotificationDto[] }, ApiError>({
    queryKey: CRM_NOTIFICATIONS_QUERY_KEY,
    queryFn: async () => {
      const result = await apiClient.engagement.notifications.list({
        limit: NOTIFICATION_PAGE_SIZE,
      });
      return { items: result.items };
    },
    enabled,
    refetchInterval: POLL_INTERVAL_MS,
    // Poll while the tab is backgrounded too: the whole point is that a rep who is in
    // another tab still comes back to an accurate badge.
    refetchIntervalInBackground: true,
    staleTime: 30_000,
    retry: (failureCount, error) => {
      // Never retry a 401 — the session is gone, and retrying just delays the signed-out
      // state behind three more failing requests.
      if (error instanceof ApiError && error.isUnauthenticated) return false;
      // Nor a 403. A permission denial is not a transient failure — retrying cannot change
      // the answer, it just turns one refused request into three console errors, on a
      // timer, forever. ApiError.isForbidden's own contract says "hide the action, not
      // retry"; this hook was retrying it anyway.
      if (error instanceof ApiError && error.isForbidden) return false;
      return failureCount < 2;
    },
  });

  const isSignedOut = query.error instanceof ApiError && query.error.isUnauthenticated;

  const markRead = useMutation<unknown, ApiError, string>({
    mutationFn: (id) => apiClient.engagement.notifications.markRead(id),
    // Optimistic: the badge must drop the instant the row is clicked, because the click
    // also navigates away. Waiting for the round-trip means the count visibly lags behind
    // what the user just did.
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: CRM_NOTIFICATIONS_QUERY_KEY });
      const previous = queryClient.getQueryData<{ items: NotificationDto[] }>(
        CRM_NOTIFICATIONS_QUERY_KEY,
      );
      queryClient.setQueryData<{ items: NotificationDto[] }>(CRM_NOTIFICATIONS_QUERY_KEY, (data) =>
        data
          ? {
              items: data.items.map((n) =>
                n.id === id ? { ...n, readAt: n.readAt ?? new Date().toISOString() } : n,
              ),
            }
          : data,
      );
      return { previous };
    },
    onError: (_error, _id, context) => {
      const previous = (context as { previous?: { items: NotificationDto[] } } | undefined)
        ?.previous;
      if (previous) queryClient.setQueryData(CRM_NOTIFICATIONS_QUERY_KEY, previous);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: CRM_NOTIFICATIONS_QUERY_KEY }),
  });

  const markAllRead = useMutation<unknown, ApiError, void>({
    mutationFn: () => apiClient.engagement.notifications.markAllRead(),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: CRM_NOTIFICATIONS_QUERY_KEY }),
  });

  const items = React.useMemo(() => query.data?.items ?? [], [query.data]);

  return {
    items,
    unreadCount: items.filter((n) => !n.readAt).length,
    isLoading: query.isLoading,
    isError: query.isError && !isSignedOut,
    isSignedOut,
    markRead: (id) => markRead.mutate(id),
    markAllRead: () => markAllRead.mutate(),
    isMarkingAll: markAllRead.isPending,
  };
}
