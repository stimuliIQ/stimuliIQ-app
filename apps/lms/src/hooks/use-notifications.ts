// LMS Notifications hook — Phase 6, Task #10.
//
// Manages:
//   - Notification list (paginated, filterable by unread)
//   - SSE stream with polling fallback (LOCK-D3)
//   - Mark-read / mark-all-read mutations
//   - Notification preferences (get + update)
//
// SSE lifecycle:
//   1. On mount, open EventSource via client.engagement.notifications.openStream(baseUrl).
//   2. On 'notification' event: prepend new notification to the list, track newItemIds.
//   3. On EventSource error (offline/PWA): close the stream, fall back to polling interval.
//   4. Cleanup: close EventSource on unmount (prevents stream leak — spec requirement).
//
// CLAUDE.md §3: "no business logic in components — use hooks/services".
"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@repo/api-client";
import type { NotificationDto, NotificationPrefsResponse, NotificationPrefsDto } from "@repo/types";

import { apiClient } from "../lib/api-client";

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const NOTIFICATIONS_QUERY_KEY = ["lms", "notifications", "list"] as const;
export const NOTIFICATIONS_UNREAD_QUERY_KEY = ["lms", "notifications", "unread"] as const;
export const NOTIFICATION_PREFS_QUERY_KEY = ["lms", "notifications", "prefs"] as const;

/** How long between polling interval (ms) when SSE is unavailable. */
const POLL_INTERVAL_MS = 30_000;

// ---------------------------------------------------------------------------
// useNotifications — list + SSE + polling fallback + mark-read
// ---------------------------------------------------------------------------

export interface UseNotificationsResult {
  items: NotificationDto[];
  unreadCount: number;
  newItemIds: ReadonlySet<string>;
  isLoading: boolean;
  isSignedOut: boolean;
  isError: boolean;
  error: ApiError | null;
  hasMore: boolean;
  isSseConnected: boolean;
  markRead: (id: string) => void;
  markAllRead: () => void;
  loadMore: () => void;
  refetch: () => void;
}

/**
 * useNotifications — notification list + real-time SSE + polling fallback.
 *
 * SSE strategy (LOCK-D3):
 *   - Attempt to open EventSource on mount.
 *   - If SSE errors (network, offline, proxy), fall back to polling.
 *   - EventSource is closed in cleanup to prevent leaks.
 *
 * The newItemIds set is cleared after the first render cycle after arrival so
 * the live-region announces exactly once per batch.
 */
export function useNotifications(): UseNotificationsResult {
  const queryClient = useQueryClient();
  const [items, setItems] = React.useState<NotificationDto[]>([]);
  const [newItemIds, setNewItemIds] = React.useState<ReadonlySet<string>>(new Set());
  const [cursor, setCursor] = React.useState<string | undefined>(undefined);
  const [hasMore, setHasMore] = React.useState(false);
  const [isSseConnected, setIsSseConnected] = React.useState(false);

  // ── Initial list fetch ──────────────────────────────────────────────────
  const query = useQuery<{ items: NotificationDto[]; meta: { nextCursor?: string; hasMore?: boolean } }, ApiError>({
    queryKey: NOTIFICATIONS_QUERY_KEY,
    queryFn: async () => {
      const result = await apiClient.engagement.notifications.list({ limit: 20 });
      return result as { items: NotificationDto[]; meta: { nextCursor?: string; hasMore?: boolean } };
    },
    staleTime: 30_000,
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.isUnauthenticated) return false;
      return failureCount < 2;
    },
  });

  // Populate items from initial fetch
  React.useEffect(() => {
    if (query.data) {
      setItems(query.data.items);
      setCursor(query.data.meta.nextCursor);
      setHasMore(query.data.meta.hasMore ?? false);
    }
  }, [query.data]);

  // ── SSE stream + polling fallback ────────────────────────────────────────
  const pollingRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const esRef = React.useRef<EventSource | null>(null);
  const isSignedOut = query.error instanceof ApiError && query.error.isUnauthenticated;

  React.useEffect(() => {
    if (isSignedOut) return;
    if (typeof window === "undefined") return; // SSR guard

    const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

    // Attempt SSE
    let sseErrored = false;

    function startPolling() {
      if (pollingRef.current) return;
      pollingRef.current = setInterval(async () => {
        try {
          const result = await apiClient.engagement.notifications.list({ unread: true, limit: 20 });
          // Only add truly new items (not already in the list)
          setItems((prev) => {
            const prevIds = new Set(prev.map((n) => n.id));
            const incoming = result.items.filter((n) => !prevIds.has(n.id));
            if (incoming.length === 0) return prev;
            setNewItemIds(new Set(incoming.map((n) => n.id)));
            return [...incoming, ...prev];
          });
        } catch {
          // polling errors are silent — offline/PWA scenario
        }
      }, POLL_INTERVAL_MS);
    }

    try {
      const es = apiClient.engagement.notifications.openStream(baseUrl);
      esRef.current = es;

      es.addEventListener("open", () => {
        setIsSseConnected(true);
        // Clear polling if SSE reconnects
        if (pollingRef.current) {
          clearInterval(pollingRef.current);
          pollingRef.current = null;
        }
      });

      es.addEventListener("notification", (evt: Event) => {
        const messageEvent = evt as MessageEvent<string>;
        try {
          const parsed = JSON.parse(messageEvent.data) as { data: NotificationDto };
          const incoming = parsed.data;
          setItems((prev) => {
            if (prev.some((n) => n.id === incoming.id)) return prev;
            return [incoming, ...prev];
          });
          setNewItemIds(new Set([incoming.id]));
        } catch {
          // malformed SSE data — ignore
        }
      });

      es.addEventListener("error", () => {
        if (!sseErrored) {
          sseErrored = true;
          setIsSseConnected(false);
          es.close();
          esRef.current = null;
          // Fall back to polling
          startPolling();
        }
      });
    } catch {
      // EventSource construction failed (e.g. server-side render) — use polling
      startPolling();
    }

    return () => {
      // REQUIRED: close EventSource on cleanup to prevent leaks (spec requirement)
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [isSignedOut]);

  // Clear newItemIds after the announcement cycle
  React.useEffect(() => {
    if (newItemIds.size === 0) return;
    const timer = setTimeout(() => setNewItemIds(new Set()), 3000);
    return () => clearTimeout(timer);
  }, [newItemIds]);

  // ── Mutations ────────────────────────────────────────────────────────────

  const markReadMutation = useMutation<{ unreadCount: number }, ApiError, string>({
    mutationFn: (id) => apiClient.engagement.notifications.markRead(id),
    onSuccess: (_, id) => {
      setItems((prev) =>
        prev.map((n) =>
          n.id === id ? { ...n, readAt: new Date().toISOString() } : n,
        ),
      );
      void queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_UNREAD_QUERY_KEY });
    },
  });

  const markAllReadMutation = useMutation<{ unreadCount: number }, ApiError, void>({
    mutationFn: () => apiClient.engagement.notifications.markAllRead(),
    onSuccess: () => {
      const now = new Date().toISOString();
      setItems((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? now })));
      void queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_UNREAD_QUERY_KEY });
    },
  });

  // ── Load more ────────────────────────────────────────────────────────────

  const loadMore = React.useCallback(async () => {
    if (!hasMore || !cursor) return;
    try {
      const result = await apiClient.engagement.notifications.list({ cursor, limit: 20 });
      const paginatedResult = result as { items: NotificationDto[]; meta: { nextCursor?: string; hasMore?: boolean } };
      setItems((prev) => [...prev, ...paginatedResult.items]);
      setCursor(paginatedResult.meta.nextCursor);
      setHasMore(paginatedResult.meta.hasMore ?? false);
    } catch {
      // load-more errors surface through the parent error state
    }
  }, [hasMore, cursor]);

  const unreadCount = items.filter((n) => !n.readAt).length;

  return {
    items,
    unreadCount,
    newItemIds,
    isLoading: query.isLoading,
    isSignedOut,
    isError: query.isError && !isSignedOut,
    error: query.error ?? null,
    hasMore,
    isSseConnected,
    markRead: (id) => markReadMutation.mutate(id),
    markAllRead: () => markAllReadMutation.mutate(),
    loadMore: () => void loadMore(),
    refetch: () => void query.refetch(),
  };
}

// ---------------------------------------------------------------------------
// useNotificationPrefs — get + update
// ---------------------------------------------------------------------------

export interface UseNotificationPrefsResult {
  prefs: NotificationPrefsResponse | undefined;
  isLoading: boolean;
  isSignedOut: boolean;
  isError: boolean;
  isSaving: boolean;
  updatePrefs: (body: NotificationPrefsDto) => Promise<void>;
}

export function useNotificationPrefs(): UseNotificationPrefsResult {
  const queryClient = useQueryClient();

  const query = useQuery<NotificationPrefsResponse, ApiError>({
    queryKey: NOTIFICATION_PREFS_QUERY_KEY,
    queryFn: () => apiClient.engagement.notifications.getPrefs(),
    staleTime: 60_000,
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.isUnauthenticated) return false;
      return failureCount < 2;
    },
  });

  const mutation = useMutation<NotificationPrefsResponse, ApiError, NotificationPrefsDto>({
    mutationFn: (body) => apiClient.engagement.notifications.updatePrefs(body),
    onSuccess: (data) => {
      queryClient.setQueryData(NOTIFICATION_PREFS_QUERY_KEY, data);
    },
  });

  const isSignedOut = query.error instanceof ApiError && query.error.isUnauthenticated;

  return {
    prefs: query.data,
    isLoading: query.isLoading,
    isSignedOut,
    isError: query.isError && !isSignedOut,
    isSaving: mutation.isPending,
    updatePrefs: async (body) => {
      await mutation.mutateAsync(body);
    },
  };
}
